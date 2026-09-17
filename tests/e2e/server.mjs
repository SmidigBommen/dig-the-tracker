import { AgentModuleImplementation } from '../../api-dist/modules/agent/agent-module.js'
import { mkdir,writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createDatabase } from '../../api-dist/db.js'
import { migrate } from '../../api-dist/migrate.js'
import { loadConfig } from '../../api-dist/config.js'
import { createTeamServer } from '../../api-dist/server.js'
import { MockOidcAdapter } from '../../api-dist/adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from '../../api-dist/modules/identity/identity-module.js'
import { SpaceModuleImplementation } from '../../api-dist/modules/space/space-module.js'
import { BoardModuleImplementation } from '../../api-dist/modules/board/board-module.js'
import { SpaceExportModuleImplementation } from '../../api-dist/modules/export/export-module.js'

const databaseUrl = process.env.DIG_E2E_DATABASE_URL
if (!databaseUrl || new URL(databaseUrl).pathname !== '/dig_e2e' || !['127.0.0.1','localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('Browser tests require the disposable loopback dig_e2e database')
await migrate(databaseUrl)
const db = createDatabase(databaseUrl)
await db.query('truncate team.identities,team.space_key_reservations cascade')
const origin = 'http://127.0.0.1:5180',issuer = 'https://identity.example.test',secret = 'e2e-test-session-secret-with-32-bytes'
const space = new SpaceModuleImplementation(db,{ invitationHmacSecret: secret,sessionHmacSecret: secret })
const board = new BoardModuleImplementation(db),exports = new SpaceExportModuleImplementation(db)
const fixtures = {}
let identity
for (const project of ['chromium','firefox','webkit','phone']) {
  identity = new IdentityModuleImplementation(db,new MockOidcAdapter({ issuer,subject: project,displayName: 'Ada Tester' }),{
    redirectUri: `${origin}/api/auth/callback`,allowedOrigins: new Set([origin]),installationAdministrators: new Set([`${issuer}|${project}`]),sessionHmacSecret: secret,
  })
  const begun = await identity.signIn({ kind: 'begin' })
  const signed = await identity.signIn({ kind: 'complete',attemptSecret: begun.value.attemptSecret,callback: { code: 'accepted-code',state: new URL(begun.value.authorizationUrl).searchParams.get('state') } })
  const session = await identity.session({ kind: 'resolve',use: 'read',evidence: { sessionSecret: signed.value.session.sessionSecret } })
  const result = await space.change(session.value.identity,{ requestId: randomUUID(),command: { kind: 'create-space',input: { key: project.toUpperCase(),displayName: `${project} release checks`,timeZone: 'Europe/Oslo' } } })
  if (!result.ok) throw new Error('Fixture creation failed')
  fixtures[project] = { cookie: signed.value.session.sessionSecret,key: project.toUpperCase() }
}
await mkdir('.test-artifacts',{ recursive: true })
await writeFile('.test-artifacts/browser-sessions.json',JSON.stringify(fixtures),{ mode: 0o600 })
const shutdown = new AbortController()
const server = createTeamServer({ agents:new AgentModuleImplementation(db,board,{runHmacSecret:secret}),identity,space,board,exports },loadConfig({ ALLOWED_ORIGINS: origin,STATIC_DIR: 'dist' }),async () => true,shutdown.signal)
server.listen(5180,'127.0.0.1')
process.on('SIGTERM',() => { shutdown.abort();server.close(async () => { await db.end() }) })
