import { SpaceExportModuleImplementation } from './export/export-module.js'
// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { createTeamServer } from '../server.js'
import { loadConfig } from '../config.js'
import { SpaceModuleImplementation } from './space/space-module.js'
import { BoardModuleImplementation } from './board/board-module.js'
import type { AddressInfo } from 'node:net'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database

run('Slice 9 personal appearance', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  beforeEach(async () => { await db.query('truncate team.identities, team.space_key_reservations cascade') })
  afterAll(async () => { await db.end() })

  async function signIn(subject = 'ada') {
    const identity = new IdentityModuleImplementation(db, new MockOidcAdapter({
      issuer: 'https://identity.example.test', subject, displayName: subject,
    }), { redirectUri: `${origin}/api/auth/callback`, allowedOrigins: new Set([origin]),
      installationAdministrators: new Set(), sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes' })
    const begun = await identity.signIn({ kind: 'begin' })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in failed')
    const result = await identity.signIn({ kind: 'complete', attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state: new URL(begun.value.authorizationUrl).searchParams.get('state')! } })
    if (!result.ok || result.value.kind !== 'established') throw new Error('Sign-in failed')
    const evidence = { sessionSecret: result.value.session.sessionSecret, csrfToken: result.value.session.csrfToken, origin }
    return { identity, evidence, identityId: result.value.identityView.id }
  }

  it('defaults to Nature and System, persists across sign-ins, and isolates accounts', async () => {
    const ada = await signIn()
    expect(await ada.identity.appearance({ kind: 'read', evidence: ada.evidence })).toEqual({ ok: true,
      value: { identityId: ada.identityId, palette: 'nature', mode: 'system', revision: 0 } })
    expect(await ada.identity.appearance({ kind: 'change', evidence: ada.evidence,
      preference: { palette: 'tokyo-night', mode: 'light' }, expectedRevision: 0 })).toEqual({ ok: true,
      value: { identityId: ada.identityId, palette: 'tokyo-night', mode: 'light', revision: 1 } })
    const again = await signIn()
    expect(await again.identity.appearance({ kind: 'read', evidence: again.evidence })).toMatchObject({ ok: true,
      value: { palette: 'tokyo-night', mode: 'light', revision: 1 } })
    const other = await signIn('mira')
    expect(await other.identity.appearance({ kind: 'read', evidence: other.evidence })).toMatchObject({ ok: true,
      value: { identityId: other.identityId, palette: 'nature', mode: 'system', revision: 0 } })
    await ada.identity.session({ kind: 'end', evidence: ada.evidence, requestId: randomUUID() as never })
    expect(await ada.identity.appearance({ kind: 'read', evidence: ada.evidence })).toMatchObject({ ok: false, fault: { kind: 'not-authenticated' } })
  })

  it('serves account preferences through HTTP with CSRF, value validation, and stale-write protection', async () => {
    const ada = await signIn()
    const server = createTeamServer({ exports: new SpaceExportModuleImplementation(db), identity: ada.identity,
      space: new SpaceModuleImplementation(db, { invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes', sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes' }),
      board: new BoardModuleImplementation(db) }, loadConfig({ ALLOWED_ORIGINS: origin }))
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/appearance`
    const headers = { cookie: `dig_session=${ada.evidence.sessionSecret}`, origin, 'x-csrf-token': ada.evidence.csrfToken, 'content-type': 'application/json' }
    const post = (body: unknown, override = {}) => fetch(url, { method: 'POST', headers: { ...headers,...override }, body: JSON.stringify(body) })
    const change = { preference: { palette: 'neutral', mode: 'dark' }, expectedRevision: 0 }
    try {
      expect((await fetch(url)).status).toBe(401)
      expect(await (await fetch(url, { headers })).json()).toMatchObject({ palette: 'nature',mode: 'system',revision: 0 })
      expect((await post(change, { 'x-csrf-token': 'wrong' })).status).toBe(403)
      expect((await post(change, { origin: 'https://untrusted.example' })).status).toBe(403)
      expect((await post({ ...change, identityId: 'another-person' })).status).toBe(400)
      expect((await post({ ...change, preference: { palette: 'custom',mode: 'dark' } })).status).toBe(400)
      expect((await post({ ...change, preference: { palette: 'nature',mode: 'dark',css: 'anything' } })).status).toBe(400)
      expect((await post(change)).status).toBe(200)
      expect(await (await post(change)).json()).toMatchObject({ palette: 'neutral',mode: 'dark',revision: 1 })
      const stale = await post({ ...change, preference: { palette: 'nature',mode: 'light' } })
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ fault: { kind: 'appearance-conflict',current: { palette: 'neutral',mode: 'dark',revision: 1 } } })
      expect(await (await fetch(url, { headers })).json()).toMatchObject({ palette: 'neutral',mode: 'dark',revision: 1 })
    } finally { server.closeIdleConnections();await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
