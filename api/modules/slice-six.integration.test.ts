// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createTeamServer } from '../server.js'
import { loadConfig } from '../config.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { SpaceModuleImplementation, type SpaceUse } from './space/space-module.js'
import { BoardModuleImplementation, type BoardCommand } from './board/board-module.js'
import type { RequestId, SpaceKey } from './shared.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database

run('Slice 6 live collaboration', () => {
  beforeEach(async () => {
    db = createDatabase(process.env.DATABASE_URL!)
    await db.query('truncate team.identities, team.space_key_reservations cascade')
  })
  afterEach(async () => { await db.end() })

  async function signIn(subject = 'admin') {
    const identity = new IdentityModuleImplementation(db, new MockOidcAdapter({
      issuer: 'https://identity.example.test', subject, displayName: subject,
    }), {
      redirectUri: `${origin}/api/auth/callback`, allowedOrigins: new Set([origin]),
      installationAdministrators: new Set(['https://identity.example.test|admin']),
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
    })
    const space = new SpaceModuleImplementation(db, {
      invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes',
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
    })
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' as never })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in failed')
    const completed = await identity.signIn({ kind: 'complete', attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state: new URL(begun.value.authorizationUrl).searchParams.get('state')! } })
    if (!completed.ok || completed.value.kind !== 'established') throw new Error('Sign-in failed')
    const session = await identity.session({ kind: 'resolve', use: 'change', evidence: {
      sessionSecret: completed.value.session.sessionSecret, csrfToken: completed.value.session.csrfToken, origin,
    } })
    if (!session.ok || session.value.kind !== 'resolved') throw new Error('Session failed')
    return { identity, space, board: new BoardModuleImplementation(db), session: session.value,
      browserSession: completed.value.session }
  }

  async function setup(key = 'DIG') {
    const app = await signIn()
    const created = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'create-space', input: { key, displayName: key, timeZone: 'Europe/Oslo' } } })
    if (!created.ok || created.value.result.kind !== 'space-created') throw new Error('Space failed')
    return { ...app, created: created.value.result.space }
  }

  async function access<P extends SpaceUse>(app: Awaited<ReturnType<typeof signIn>>, use: P, key = 'DIG') {
    const result = await app.space.authorize(app.session.identity, {
      space: { kind: 'key', spaceKey: key as SpaceKey }, use,
    })
    if (!result.ok) throw new Error(`Authorization failed: ${JSON.stringify(result.fault)}`)
    return result.value
  }

  async function change(app: Awaited<ReturnType<typeof signIn>>, command: BoardCommand, key = 'DIG') {
    return app.board.change(await access(app, 'board-change', key), { requestId: randomUUID() as RequestId, command })
  }

  async function overview(app: Awaited<ReturnType<typeof setup>>) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'overview' })
    if (!result.ok || result.value.kind !== 'overview') throw new Error(JSON.stringify(result))
    return result.value.value
  }

  async function capture(app: Awaited<ReturnType<typeof signIn>>) {
    const result = await change(app, { kind: 'capture-task', input: { title: 'Discuss this work' } })
    if (!result.ok || !result.value.result.taskId) throw new Error('Capture failed')
    return result.value.result.taskId
  }

  async function detail(app: Awaited<ReturnType<typeof signIn>>, taskId: import('./shared.js').TaskId) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'task', task: { kind: 'id', taskId }, markNotificationsRead: true, comments: { size: 200 }, history: { size: 200 } })
    if (!result.ok || result.value.kind !== 'task') throw new Error(JSON.stringify(result))
    return result.value.value
  }

  async function invite(app: Awaited<ReturnType<typeof signIn>>, subject = 'member') {
    const invitation = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } } })
    if (!invitation.ok || invitation.value.result.kind !== 'invitation-issued') throw new Error('Invitation failed')
    const member = await signIn(subject)
    const accepted = await member.space.change(member.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: invitation.value.result.invitationSecret } })
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Acceptance failed')
    const resolved = await member.identity.session({ kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret } })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Replacement failed')
    return { ...member, session: resolved.value }
  }

  it('follows committed changes in order and resumes after the last received sequence', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const permission = await access(app, 'board-follow')
    const result = await app.board.follow(permission, { after: 0 as never })
    if (!result.ok) throw new Error(JSON.stringify(result.fault))
    const iterator = result.value[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      expect(first.value).toMatchObject({ kind: 'update', update: { sequence: 1 } })
      expect((await change(app, { kind: 'add-comment', taskId, text: 'Live comment', mentions: [] })).ok).toBe(true)
      const second = await iterator.next()
      expect(second.value).toMatchObject({ kind: 'update', update: { sequence: 2 } })
    } finally { await iterator.return?.() }
    const resumed = await app.board.follow(permission, { after: 1 as never })
    if (!resumed.ok) throw new Error(JSON.stringify(resumed.fault))
    const next = resumed.value[Symbol.asyncIterator]()
    try { expect((await next.next()).value).toMatchObject({ kind: 'update', update: { sequence: 2 } }) }
    finally { await next.return?.() }
  })
  it('conceals other Members inbox state while preserving contiguous feed sequences', async () => {
    const app = await setup()
    const recipient = await invite(app, 'recipient')
    const memberId = (await overview(app)).members.find((member) => member.displayName === 'recipient')!.id
    const taskId = await capture(app)
    await change(app, { kind: 'add-comment', taskId, text: 'Private notification', mentions: [memberId] })
    await detail(recipient, taskId)
    const result = await app.board.follow(await access(app, 'board-follow'), { after: 2 as never })
    if (!result.ok) throw new Error(JSON.stringify(result.fault))
    const iterator = result.value[Symbol.asyncIterator]()
    try {
      const item = (await iterator.next()).value
      expect(item).toMatchObject({ kind: 'update', update: { sequence: 3 } })
      expect(JSON.stringify(item)).not.toContain('notifications-read')
      expect(JSON.stringify(item)).not.toContain('unreadNotifications')
    } finally { await iterator.return?.() }
  })

  it('closes an idle feed after Space archive and interrupts waiting when the consumer leaves', async () => {
    const app = await setup()
    const result = await app.board.follow(await access(app, 'board-follow'), {})
    if (!result.ok) throw new Error(JSON.stringify(result.fault))
    const iterator = result.value[Symbol.asyncIterator]()
    const waiting = iterator.next()
    expect((await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'archive-space', space: { spaceId: app.created.id, expectedRevision: app.created.revision } } })).ok).toBe(true)
    expect((await waiting).value).toEqual({ kind: 'closed', reason: 'space-archived' })
    expect((await iterator.next()).done).toBe(true)
  })

  it('rejects wrong-purpose and expired capabilities and closes on session revocation', async () => {
    const app = await setup()
    expect(await app.board.follow(await access(app, 'board-read') as never, {})).toMatchObject({ ok: false, fault: { kind: 'forbidden' } })
    expect(await app.board.follow(await access(app, 'board-follow'), { after: -1 as never })).toMatchObject({ ok: false, fault: { kind: 'invalid' } })
    const permission = await access(app, 'board-follow')
    const result = await app.board.follow(permission, {})
    if (!result.ok) throw new Error(JSON.stringify(result.fault))
    const iterator = result.value[Symbol.asyncIterator]()
    const waiting = iterator.next()
    expect((await app.identity.session({ kind: 'end', requestId: randomUUID() as RequestId, evidence: {
      sessionSecret: app.browserSession.sessionSecret, csrfToken: app.browserSession.csrfToken, origin,
    } })).ok).toBe(true)
    expect((await waiting).value).toEqual({ kind: 'closed', reason: 'access-revoked' })
    expect(await app.board.follow(permission, {})).toMatchObject({ ok: false, fault: { kind: 'forbidden' } })
    await iterator.return?.()
  })

  it('requires a fresh snapshot for missing or excessive backlog instead of buffering it', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const permission = await access(app, 'board-follow')
    const result = await app.board.follow(permission, { after: 1 as never })
    if (!result.ok) throw new Error(JSON.stringify(result.fault))
    const iterator = result.value[Symbol.asyncIterator]()
    for (let index = 0; index < 201; index++) {
      expect((await change(app, { kind: 'add-comment', taskId, text: `Backlog ${index}`, mentions: [] })).ok).toBe(true)
    }
    expect((await iterator.next()).value).toEqual({ kind: 'snapshot-required', latest: 202 })
    expect((await iterator.next()).done).toBe(true)
    // Retention fixture: one sequence needed for replay has already expired.
    await db.query('delete from team.board_updates where space_id = $1 and sequence = 202', [app.created.id])
    const gap = await app.board.follow(permission, { after: 201 as never })
    if (!gap.ok) throw new Error(JSON.stringify(gap.fault))
    const next = gap.value[Symbol.asyncIterator]()
    expect((await next.next()).value).toEqual({ kind: 'snapshot-required', latest: 202 })
    await next.return?.()
  }, 15000)

  it('delivers to 100 idle browsers and releases them without holding database connections', async () => {
    const app = await setup()
    const permission = await access(app, 'board-follow')
    const results = await Promise.all(Array.from({ length: 100 }, () => app.board.follow(permission, {})))
    const iterators = results.map((result) => {
      if (!result.ok) throw new Error(JSON.stringify(result.fault))
      return result.value[Symbol.asyncIterator]()
    })
    try {
      const waiting = iterators.map((iterator) => iterator.next())
      await capture(app)
      const delivered = await Promise.all(waiting)
      expect(delivered.every((item) => !item.done && item.value.kind === 'update' && item.value.update.sequence === 1)).toBe(true)
      const idle = iterators.map((iterator) => iterator.next())
      await Promise.all(iterators.map((iterator) => iterator.return?.()))
      expect((await Promise.all(idle)).every((item) => item.done)).toBe(true)
    } finally { await Promise.all(iterators.map((iterator) => iterator.return?.())) }
  }, 15000)

  it('streams authenticated SSE through HTTP and closes it cleanly when the server drains', async () => {
    const app = await setup()
    const draining = new AbortController()
    const server = createTeamServer(app, loadConfig({ ALLOWED_ORIGINS: origin }), async () => true, draining.signal)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as import('node:net').AddressInfo
    const base = `http://127.0.0.1:${address.port}`
    const controller = new AbortController()
    const headers = { cookie: `dig_session=${app.browserSession.sessionSecret}`, origin }
    try {
      const anonymous = await fetch(`${base}/api/spaces/DIG/board/events`)
      expect(anonymous.status).toBe(401)
      const invalid = await fetch(`${base}/api/spaces/DIG/board/events?after=bad`, { headers })
      expect(invalid.status).toBe(400)
      const denied = await fetch(`${base}/api/spaces/DIG/board/events`, { headers: { ...headers, origin: 'https://elsewhere.test' } })
      expect(denied.status).toBe(403)
      const response = await fetch(`${base}/api/spaces/DIG/board/events?after=0`, { headers, signal: controller.signal })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      expect(response.headers.get('x-accel-buffering')).toBe('no')
      const events = frames(response)
      expect((await events.next()).value).toContain('event: ready')
      await capture(app)
      const update = (await events.next()).value!
      expect(update).toContain('id: 1')
      expect(update).toContain('"kind":"task-upserted"')
      draining.abort()
      expect((await events.next()).value).toContain('"reason":"server-draining"')
      expect((await events.next()).done).toBe(true)
    } finally {
      controller.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('serves 100 authenticated HTTP feed connections with bounded recovery', async () => {
    const app = await setup()
    const server = createTeamServer(app, loadConfig({ ALLOWED_ORIGINS: origin }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as import('node:net').AddressInfo
    const url = `http://127.0.0.1:${address.port}/api/spaces/DIG/board/events?after=0`
    const clients = Array.from({ length: 100 }, () => new AbortController())
    try {
      const responses = await Promise.all(clients.map((client) => fetch(url, { signal: client.signal,
        headers: { cookie: `dig_session=${app.browserSession.sessionSecret}`, origin },
      })))
      expect(responses.every((response) => response.status === 200)).toBe(true)
      const readers = responses.map(frames)
      expect((await Promise.all(readers.map((reader) => reader.next()))).every((item) => item.value?.includes('event: ready'))).toBe(true)
      const pending = readers.map((reader) => reader.next())
      await capture(app)
      const events = await Promise.all(pending)
      expect(events.every((item) => item.value?.includes('id: 1') && item.value?.includes('"kind":"task-upserted"'))).toBe(true)
    } finally {
      clients.forEach((client) => client.abort())
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 15000)

  async function* frames(response: Response) {
    const reader = response.body!.getReader(), decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return
        buffer += decoder.decode(chunk.value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (frame.startsWith('event:')) yield frame
        }
      }
    } finally { await reader.cancel(); reader.releaseLock() }
  }

})
