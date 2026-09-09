// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createDatabase, type Database } from '../db.js'
import type { AppConfig } from '../config.js'
import { createTeamServer } from '../server.js'
import { BoardModuleImplementation } from './board/board-module.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { SpaceModuleImplementation } from './space/space-module.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://dig:dig-local-only@127.0.0.1:5432/dig'

let db: Database
let now: Date

const identityKey = (subject: string) => `https://identity.example.test|${subject}`

run('Slice 1 Module Interfaces', () => {
  beforeAll(() => {
    db = createDatabase(databaseUrl)
  })

  beforeEach(async () => {
    now = new Date()
    await db.query(`truncate table
      team.space_request_receipts,
      team.board_columns,
      team.boards,
      team.members,
      team.spaces,
      team.space_key_reservations,
      team.browser_sessions,
      team.sign_in_attempts,
      team.identities
      restart identity cascade`)
  })

  afterAll(async () => {
    await db.end()
  })

  function modules(subject = 'admin', allowedOrigins = new Set(['https://dig.example.test'])) {
    const oidc = new MockOidcAdapter({
      issuer: 'https://identity.example.test',
      subject,
      displayName: subject === 'admin' ? 'Ada Admin' : 'Mira Member',
      email: `${subject}@example.test`,
    })
    const identity = new IdentityModuleImplementation(db, oidc, {
      redirectUri: 'https://dig.example.test/api/auth/callback',
      allowedOrigins,
      installationAdministrators: new Set([identityKey('admin')]),
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
      now: () => now,
    })
    const space = new SpaceModuleImplementation(db, {
      invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes',
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
      now: () => now,
    })
    const board = new BoardModuleImplementation(db)
    return { identity, space, board, oidc }
  }

  async function signIn(subject = 'admin') {
    const { identity, space, board } = modules(subject)
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' })
    expect(begun.ok).toBe(true)
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in did not begin')

    const authorization = new URL(begun.value.authorizationUrl)
    const completed = await identity.signIn({
      kind: 'complete',
      attemptSecret: begun.value.attemptSecret,
      callback: {
        code: 'accepted-code',
        state: authorization.searchParams.get('state') ?? '',
      },
    })
    expect(completed.ok).toBe(true)
    if (!completed.ok || completed.value.kind !== 'established') throw new Error('Sign-in did not complete')
    return { identity, space, board, completed: completed.value }
  }

  it('signs in an installation administrator and opens a newly created default Board', async () => {
    const { identity, space, board, completed } = await signIn()
    const session = await identity.session({
      kind: 'resolve',
      use: 'read',
      evidence: { sessionSecret: completed.session.sessionSecret },
    })
    expect(session.ok).toBe(true)
    if (!session.ok || session.value.kind !== 'resolved') throw new Error('Session did not resolve')
    expect(session.value.identityView).toMatchObject({
      displayName: 'Ada Admin',
      installationAdministrator: true,
    })

    const created = await space.change(session.value.identity, {
      requestId: 'create-space-1',
      command: {
        kind: 'create-space',
        input: { displayName: 'Delivery', key: 'dig', timeZone: 'Europe/Oslo' },
      },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('Space was not created')
    expect(created.value.result.space).toMatchObject({
      displayName: 'Delivery',
      key: 'DIG',
      timeZone: 'Europe/Oslo',
    })

    const spaces = await space.read(session.value.identity, { kind: 'switcher', include: 'active' })
    expect(spaces.ok).toBe(true)
    if (!spaces.ok || spaces.value.kind !== 'switcher') throw new Error('Space switcher failed')
    expect(spaces.value.spaces.map((entry) => entry.key)).toEqual(['DIG'])

    const authorized = await space.authorize(session.value.identity, {
      space: { kind: 'key', spaceKey: 'DIG' },
      use: 'board-read',
    })
    expect(authorized.ok).toBe(true)
    if (!authorized.ok) throw new Error('Space authorization failed')

    const overview = await board.read(authorized.value, { kind: 'overview' })
    expect(overview.ok).toBe(true)
    if (!overview.ok || overview.value.kind !== 'overview') throw new Error('Board overview failed')
    expect(overview.value.value.columns.map((column) => [column.name, column.flowRole, column.wipLimit])).toEqual([
      ['Backlog', 'queue', null],
      ['In Progress', 'active', 3],
      ['Done', 'complete', null],
    ])
    expect(overview.value.value.tasks.items).toEqual([])
  })

  it('keeps create-space idempotent and rejects request ID reuse with different content', async () => {
    const { identity, space, completed } = await signIn()
    const resolved = await identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: completed.session.sessionSecret },
    })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Session did not resolve')
    const request = {
      requestId: 'same-request',
      command: { kind: 'create-space' as const, input: { displayName: 'Alpha', key: 'ALP', timeZone: 'UTC' } },
    }

    const first = await space.change(resolved.value.identity, request)
    const retry = await space.change(resolved.value.identity, request)
    expect(retry).toEqual(first)

    const reused = await space.change(resolved.value.identity, {
      ...request,
      command: { kind: 'create-space', input: { displayName: 'Beta', key: 'BET', timeZone: 'UTC' } },
    })
    expect(reused).toEqual({ ok: false, fault: { kind: 'conflict', reason: 'request-id-reused' } })
  })

  it('pages the Space switcher with an opaque, query-scoped cursor', async () => {
    const { identity, space, completed } = await signIn()
    const resolved = await identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: completed.session.sessionSecret },
    })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Session did not resolve')
    for (const [requestId, displayName, key] of [
      ['space-a', 'Alpha', 'ALP'],
      ['space-b', 'Beta', 'BET'],
    ]) {
      const created = await space.change(resolved.value.identity, {
        requestId,
        command: { kind: 'create-space', input: { displayName, key, timeZone: 'UTC' } },
      })
      expect(created.ok).toBe(true)
    }

    const first = await space.read(resolved.value.identity, {
      kind: 'switcher', include: 'active', page: { size: 1 },
    })
    if (!first.ok || first.value.kind !== 'switcher' || !first.value.next) throw new Error('First page missing')
    expect(first.value.spaces.map((entry) => entry.key)).toEqual(['ALP'])

    const second = await space.read(resolved.value.identity, {
      kind: 'switcher', include: 'active', page: { size: 1, after: first.value.next },
    })
    expect(second.ok && second.value.kind === 'switcher' && second.value.spaces.map((entry) => entry.key)).toEqual(['BET'])

    const wrongQuery = await space.read(resolved.value.identity, {
      kind: 'switcher', include: 'all', page: { size: 1, after: first.value.next },
    })
    expect(wrongQuery).toEqual({
      ok: false,
      fault: { kind: 'invalid', issues: [{ field: 'page.after', message: 'Use a cursor from the previous page.' }] },
    })
    const fractionalSize = await space.read(resolved.value.identity, {
      kind: 'switcher', include: 'active', page: { size: 1.5 },
    })
    expect(fractionalSize).toEqual({
      ok: false,
      fault: { kind: 'invalid', issues: [{ field: 'page.size', message: 'Use a positive whole number.' }] },
    })
  })

  it('requires installation-administrator configuration to create a Space', async () => {
    const { identity, space, completed } = await signIn('member')
    const resolved = await identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: completed.session.sessionSecret },
    })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Session did not resolve')

    const result = await space.change(resolved.value.identity, {
      requestId: 'forbidden-create',
      command: { kind: 'create-space', input: { displayName: 'Nope', key: 'NO', timeZone: 'UTC' } },
    })
    expect(result).toEqual({ ok: false, fault: { kind: 'forbidden' } })
  })

  it('consumes each sign-in callback once', async () => {
    const { identity } = modules()
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in did not begin')
    const state = new URL(begun.value.authorizationUrl).searchParams.get('state') ?? ''
    const callback = {
      kind: 'complete' as const,
      attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state },
    }

    expect((await identity.signIn(callback)).ok).toBe(true)
    const replay = await identity.signIn(callback)
    expect(replay).toEqual({ ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } })
  })

  it('redeems the callback with the PKCE verifier correlated to authorization', async () => {
    const { identity, oidc } = modules()
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in did not begin')
    const state = new URL(begun.value.authorizationUrl).searchParams.get('state') ?? ''

    const completed = await identity.signIn({
      kind: 'complete',
      attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state },
    })
    expect(completed.ok).toBe(true)
    expect(oidc.authorizationInputs).toHaveLength(1)
    expect(oidc.redemptionInputs).toHaveLength(1)
  })

  it('rejects mismatched sign-in state and attempt secrets', async () => {
    const { identity } = modules()
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in did not begin')
    const state = new URL(begun.value.authorizationUrl).searchParams.get('state') ?? ''

    const wrongState = await identity.signIn({
      kind: 'complete',
      attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state: `${state}-wrong` },
    })
    expect(wrongState).toEqual({ ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } })

    const wrongSecret = await identity.signIn({
      kind: 'complete',
      attemptSecret: `${begun.value.attemptSecret}-wrong`,
      callback: { code: 'accepted-code', state },
    })
    expect(wrongSecret).toEqual({ ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } })
  })

  it('rolls back Space setup if the default Board cannot be created', async () => {
    const { identity, space, completed } = await signIn()
    const resolved = await identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: completed.session.sessionSecret },
    })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Session did not resolve')

    await db.query(`
      create function team.test_reject_default_columns() returns trigger language plpgsql as $$
      begin
        raise exception 'test failure';
      end
      $$;
      create trigger test_reject_default_columns
      before insert on team.board_columns
      for each statement execute function team.test_reject_default_columns();
    `)
    try {
      const result = await space.change(resolved.value.identity, {
        requestId: 'atomic-space',
        command: { kind: 'create-space', input: { displayName: 'Atomic', key: 'ATM', timeZone: 'UTC' } },
      })
      expect(result).toEqual({ ok: false, fault: { kind: 'temporarily-unavailable' } })
      const counts = await db.query(`select
        (select count(*)::int from team.space_key_reservations) as reservations,
        (select count(*)::int from team.spaces) as spaces,
        (select count(*)::int from team.members) as members,
        (select count(*)::int from team.boards) as boards`)
      expect(counts.rows[0]).toEqual({ reservations: 0, spaces: 0, members: 0, boards: 0 })
    } finally {
      await db.query('drop trigger if exists test_reject_default_columns on team.board_columns')
      await db.query('drop function if exists team.test_reject_default_columns()')
    }
  })

  it('enforces CSRF for changes and the five-day idle limit', async () => {
    const { identity, completed } = await signIn()

    const wrongCsrf = await identity.session({
      kind: 'resolve',
      use: 'change',
      evidence: {
        sessionSecret: completed.session.sessionSecret,
        csrfToken: 'wrong',
        origin: 'https://dig.example.test',
      },
    })
    expect(wrongCsrf).toEqual({ ok: false, fault: { kind: 'csrf' } })

    const stream = await identity.session({
      kind: 'resolve',
      use: 'stream',
      evidence: {
        sessionSecret: completed.session.sessionSecret,
        origin: 'https://dig.example.test',
      },
    })
    expect(stream.ok).toBe(true)

    now = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000 + 1)
    const idle = await identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: completed.session.sessionSecret },
    })
    expect(idle.ok).toBe(false)
    if (!idle.ok) expect(idle.fault.kind).toBe('not-authenticated')

  })

  it('expires after 30 days even when recent activity keeps the idle window alive', async () => {
    const signedIn = await signIn()
    const startedAt = now.getTime()
    for (const day of [4, 8, 12, 16, 20, 24, 28]) {
      now = new Date(startedAt + day * 24 * 60 * 60 * 1000)
      const active = await signedIn.identity.session({
        kind: 'resolve', use: 'read', evidence: { sessionSecret: signedIn.completed.session.sessionSecret },
      })
      expect(active.ok).toBe(true)
    }

    now = new Date(startedAt + 30 * 24 * 60 * 60 * 1000 + 1)
    const expired = await signedIn.identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: signedIn.completed.session.sessionSecret },
    })
    expect(expired.ok).toBe(false)
    if (!expired.ok) expect(expired.fault.kind).toBe('not-authenticated')
  })

  it('revokes the browser session on sign-out', async () => {
    const { identity, completed } = await signIn()
    const ended = await identity.session({
      kind: 'end',
      requestId: 'sign-out-1',
      evidence: {
        sessionSecret: completed.session.sessionSecret,
        csrfToken: completed.session.csrfToken,
        origin: 'https://dig.example.test',
      },
    })
    expect(ended).toEqual({ ok: true, value: { kind: 'ended', session: { kind: 'clear' } } })

    const resolved = await identity.session({
      kind: 'resolve', use: 'read', evidence: { sessionSecret: completed.session.sessionSecret },
    })
    expect(resolved.ok).toBe(false)
  })

  it('delivers the sign-in, Space creation, Board reload, and sign-out flow over HTTP', async () => {
    const allowedOrigins = new Set<string>()
    const { identity, space, board } = modules('admin', allowedOrigins)
    const config: AppConfig = {
      host: '127.0.0.1',
      port: 0,
      databaseUrl,
      allowedOrigins,
      staticDir: null,
      secureCookies: false,
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
      installationAdministrators: new Set([identityKey('admin')]),
      oidc: null,
    }
    const server = createTeamServer({ identity, space, board }, config)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    allowedOrigins.add(origin)

    try {
      const signInWithoutOrigin = await fetch(`${origin}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnTo: '/' }),
      })
      expect(signInWithoutOrigin.status).toBe(403)

      const anonymousSpace = await fetch(`${origin}/api/spaces`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: 'anonymous', displayName: 'No', key: 'NO', timeZone: 'UTC' }),
      })
      expect(anonymousSpace.status).toBe(401)
      expect((await fetch(`${origin}/api/spaces/NO/board`)).status).toBe(401)

      const begun = await fetch(`${origin}/api/auth/sign-in`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ returnTo: '/' }),
      })
      expect(begun.status).toBe(200)
      const beginBody = await begun.json() as { authorizationUrl: string }
      const attemptCookie = cookiePair(begun.headers.get('set-cookie'), 'dig_oidc_attempt')
      const authorization = new URL(beginBody.authorizationUrl)

      const callback = await fetch(
        `${origin}/api/auth/callback?code=accepted-code&state=${encodeURIComponent(authorization.searchParams.get('state') ?? '')}`,
        { headers: { cookie: attemptCookie }, redirect: 'manual' },
      )
      expect(callback.status).toBe(303)
      const sessionCookie = cookiePair(callback.headers.get('set-cookie'), 'dig_session')

      const session = await fetch(`${origin}/api/session`, { headers: { cookie: sessionCookie } })
      expect(session.status).toBe(200)
      const sessionBody = await session.json() as { csrfToken: string }

      const created = await fetch(`${origin}/api/spaces`, {
        method: 'POST',
        headers: {
          cookie: sessionCookie,
          origin,
          'content-type': 'application/json',
          'x-csrf-token': sessionBody.csrfToken,
        },
        body: JSON.stringify({
          requestId: 'http-create-space',
          displayName: 'Delivery',
          key: 'DIG',
          timeZone: 'Europe/Oslo',
        }),
      })
      expect(created.status).toBe(201)

      const overview = await fetch(`${origin}/api/spaces/DIG/board`, { headers: { cookie: sessionCookie } })
      expect(overview.status).toBe(200)
      const overviewBody = await overview.json() as { columns: Array<{ name: string }> }
      expect(overviewBody.columns.map((column) => column.name)).toEqual(['Backlog', 'In Progress', 'Done'])

      const ended = await fetch(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { cookie: sessionCookie, origin, 'x-csrf-token': sessionBody.csrfToken },
      })
      expect(ended.status).toBe(204)
      const afterSignOut = await fetch(`${origin}/api/session`, { headers: { cookie: sessionCookie } })
      expect(afterSignOut.status).toBe(401)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})

function cookiePair(header: string | null, name: string): string {
  const match = header?.match(new RegExp(`(?:^|, )${name}=([^;]*)`))
  if (!match) throw new Error(`Missing ${name} cookie`)
  return `${name}=${match[1]}`
}
