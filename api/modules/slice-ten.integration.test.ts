import { AgentModuleImplementation } from './agent/agent-module.js'
import { SpaceExportModuleImplementation } from './export/export-module.js'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'
import { createTeamServer } from '../server.js'
import { loadConfig } from '../config.js'
import type { AddressInfo } from 'node:net'
// @vitest-environment node
import { randomUUID } from 'node:crypto'
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
let now: Date

run('Slice 10 Space export', () => {
  beforeEach(async () => {
    now = new Date()
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
      now: () => now,
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

  async function capture(app: Awaited<ReturnType<typeof signIn>>) {
    const result = await change(app, { kind: 'capture-task', input: { title: 'Discuss this work' } })
    if (!result.ok || !result.value.result.taskId) throw new Error('Capture failed')
    return result.value.result.taskId
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

  it('lets an active HTTP export finish while shutdown refuses new exports', async () => {
    const app = await setup()
    await capture(app)
    const shutdown = new AbortController()
    let resume!: () => void
    const paused = new Promise<void>(resolve => { resume = resolve })
    const exporter = new SpaceExportModuleImplementation(db)
    const server = createTeamServer({ agents: new AgentModuleImplementation(db,new BoardModuleImplementation(db)), ...app,exports: { async read(access,signal) {
      const result = await exporter.read(access,signal)
      if (!result.ok) return result
      return { ok: true,value: { ...result.value,chunks: (async function* () {
        let first = true
        for await (const chunk of result.value.chunks) {
          yield chunk
          if (first) { first = false;await paused }
        }
      })() } }
    } } },loadConfig({ ALLOWED_ORIGINS: origin }),async () => true,shutdown.signal)
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const headers = { cookie: `dig_session=${app.browserSession.sessionSecret}` }
    try {
      const response = await fetch(`${base}/api/spaces/DIG/export`,{ headers })
      shutdown.abort()
      expect((await fetch(`${base}/health/ready`)).status).toBe(503)
      expect((await fetch(`${base}/api/spaces/DIG/export`,{ headers })).status).toBe(503)
      resume()
      expect((await response.json()).tasks).toHaveLength(1)
    } finally { resume();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('returns a typed unavailable result when the database pool is exhausted', async () => {
    const app = await setup()
    const authorized = await access(app,'space-export')
    const constrained = createDatabase(process.env.DATABASE_URL!)
    constrained.options.max = 1
    constrained.options.connectionTimeoutMillis = 50
    const occupied = await constrained.connect()
    try {
      expect(await new SpaceExportModuleImplementation(constrained).read(authorized)).toEqual({ ok: false,fault: { kind: 'temporarily-unavailable' } })
    } finally { occupied.release();await constrained.end() }
  })

  it('exports the complete Space with local relationships and no account or session identifiers', async () => {
    const app = await setup()
    const member = await invite(app)
    const taskId = await capture(app)
    await change(app,{ kind: 'add-comment',taskId,text: 'A retained comment',mentions: [] })
    const result = await new SpaceExportModuleImplementation(db).read(await access(app,'space-export'))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Export failed')
    let text = ''
    for await (const chunk of result.value.chunks) { if (chunk.kind === 'failed') throw new Error(chunk.fault.kind);text += chunk.text }
    const exported = JSON.parse(text)
    const validate = new Ajv().compile(JSON.parse(await readFile('public/export/space-v1.schema.json','utf8')))
    expect(validate(exported),JSON.stringify(validate.errors)).toBe(true)
    expect(exported).toMatchObject({ format: 'dig-space',schemaVersion: 1,space: { key: 'DIG',displayName: 'DIG' } })
    expect(exported.tasks).toHaveLength(1)
    expect(exported.comments[0]).toMatchObject({ text: 'A retained comment',taskId: exported.tasks[0].id })
    expect(exported.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual(['admin','member'])
    expect(exported.history.length).toBeGreaterThan(0)
    expect(exported.audit.some((e: { action: string }) => e.action === 'invitation-accepted')).toBe(true)
    for (const secret of [taskId,app.created.id,app.session.identityView.id,app.browserSession.sessionSecret,app.browserSession.csrfToken,'https://identity.example.test']) expect(text).not.toContain(secret)
    expect(await member.space.authorize(member.session.identity,{ use: 'space-export',space: { kind: 'key',spaceKey: 'DIG' as SpaceKey } })).toMatchObject({ ok: false,fault: { kind: 'forbidden' } })
  })
  it('downloads an attachment through HTTP, denies anonymous and cross-Space access, and cancels cleanly', async () => {
    const app = await setup()
    await capture(app)
    const server = createTeamServer({ agents: new AgentModuleImplementation(db,new BoardModuleImplementation(db)), ...app,exports: new SpaceExportModuleImplementation(db) },loadConfig({ ALLOWED_ORIGINS: origin }))
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/spaces/DIG/export`
    const headers = { cookie: `dig_session=${app.browserSession.sessionSecret}` }
    try {
      expect((await fetch(url)).status).toBe(401)
      expect((await fetch(url.replace('/DIG/','/OTHER/'),{ headers })).status).toBe(404)
      const response = await fetch(url,{ headers })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="DIG-.*\.json"/)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect((await response.json()).tasks[0].title).toBe('Discuss this work')
      const controller = new AbortController()
      const result = await new SpaceExportModuleImplementation(db).read(await access(app,'space-export'),controller.signal)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Export failed')
      const iterator = result.value.chunks[Symbol.asyncIterator]()
      await iterator.next();controller.abort()
      expect((await iterator.next()).value).toMatchObject({ kind: 'failed',fault: { kind: 'temporarily-unavailable' } })
      await iterator.return?.()
      expect((await app.space.read(app.session.identity,{ kind: 'space',space: { kind: 'key',spaceKey: 'DIG' as SpaceKey } })).ok).toBe(true)
    } finally { server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  async function document(app: Awaited<ReturnType<typeof signIn>>) {
    const result = await new SpaceExportModuleImplementation(db).read(await access(app,'space-export'))
    if (!result.ok) throw new Error('Export failed')
    let text = ''
    for await (const chunk of result.value.chunks) { if (chunk.kind === 'failed') throw new Error(chunk.fault.kind);text += chunk.text }
    const value = JSON.parse(text)
    const validate = new Ajv().compile(JSON.parse(await readFile('public/export/space-v1.schema.json','utf8')))
    expect(validate(value),JSON.stringify(validate.errors)).toBe(true)
    return value
  }

  it('keeps a consistent snapshot without blocking the session and stops after revocation', async () => {
    const app = await setup()
    await capture(app)
    const permission = await access(app,'space-export')
    const result = await new SpaceExportModuleImplementation(db).read(permission)
    if (!result.ok) throw new Error('Export failed')
    const iterator = result.value.chunks[Symbol.asyncIterator]()
    const first = await iterator.next()
    const resolved = await app.identity.session({ kind: 'resolve',use: 'read',evidence: { sessionSecret: app.browserSession.sessionSecret } })
    expect(resolved.ok).toBe(true)
    await capture(app)
    let text = first.value?.kind === 'data' ? first.value.text : ''
    for (let next = await iterator.next();!next.done;next = await iterator.next()) {
      if (next.value.kind === 'failed') throw new Error(next.value.fault.kind)
      text += next.value.text
    }
    expect(JSON.parse(text).tasks).toHaveLength(1)
    expect((await document(app)).tasks).toHaveLength(2)
    const revoked = await new SpaceExportModuleImplementation(db).read(permission)
    if (!revoked.ok) throw new Error('Export failed')
    const stream = revoked.value.chunks[Symbol.asyncIterator]()
    await stream.next()
    await app.identity.session({ kind: 'end',requestId: randomUUID() as RequestId,evidence: { sessionSecret: app.browserSession.sessionSecret,csrfToken: app.browserSession.csrfToken,origin } })
    const remaining = []
    for (let next = await stream.next();!next.done;next = await stream.next()) remaining.push(next.value)
    expect(remaining.at(-1)).toMatchObject({ kind: 'failed',fault: { kind: 'forbidden' } })
    expect(await new SpaceExportModuleImplementation(db).read(permission)).toMatchObject({ ok: false,fault: { kind: 'not-authenticated' } })
  })

  it('exports archived families, duplicate relationships, and comment tombstones without resurrecting removed text', async () => {
    const app = await setup()
    await invite(app)
    const parent = await change(app,{ kind: 'capture-task',input: { title: 'Parent æøå',description: 'Retained description',tags: ['Release'] } })
    if (!parent.ok || !parent.value.result.taskId) throw new Error('Capture failed')
    const parentId = parent.value.result.taskId
    const child = await change(app,{ kind: 'capture-task',input: { title: 'Child',parentTaskId: parentId } })
    if (!child.ok || !child.value.result.taskId) throw new Error('Capture failed')
    const overview = await app.board.read(await access(app,'board-read'),{ kind: 'overview' })
    if (!overview.ok || overview.value.kind !== 'overview') throw new Error('Read failed')
    const completion = overview.value.value.columns.find(column => column.completion)!
    const closed = await change(app,{ kind: 'place-task',task: { taskId: child.value.result.taskId,expectedRevision: 1 as never },
      destination: { columnId: completion.id,expectedOrderRevision: completion.orderRevision,place: { kind: 'last' } },
      closure: { outcome: { kind: 'rejected' },comment: 'REMOVE-THIS-CLOSING-COMMENT' } })
    expect(closed.ok).toBe(true)
    const detail = await app.board.read(await access(app,'board-read'),{ kind: 'task',task: { kind: 'id',taskId: child.value.result.taskId },comments: { size: 200 } })
    if (!detail.ok || detail.value.kind !== 'task') throw new Error('Read failed')
    expect((await change(app,{ kind: 'change-outcome',task: { taskId: child.value.result.taskId,expectedRevision: detail.value.value.revision },outcome: { kind: 'duplicate',taskId: parentId } })).ok).toBe(true)
    const comment = detail.value.value.comments.items[0]
    expect((await change(app,{ kind: 'remove-comment',comment: { commentId: comment.id,expectedRevision: comment.revision } })).ok).toBe(true)
    expect((await change(app,{ kind: 'archive-task',task: { taskId: parentId,expectedRevision: 1 as never } })).ok).toBe(true)
    expect((await app.space.change(app.session.identity,{ requestId: randomUUID() as RequestId,command: { kind: 'archive-space',space: { spaceId: app.created.id,expectedRevision: app.created.revision } } })).ok).toBe(true)
    const exported = await document(app)
    const exportedParent = exported.tasks.find((task: { title: string }) => task.title === 'Parent æøå')
    const exportedChild = exported.tasks.find((task: { title: string }) => task.title === 'Child')
    expect(exported.space.lifecycle).toBe('archived')
    expect(exportedChild).toMatchObject({ parentTaskId: exportedParent.id,duplicateTaskId: exportedParent.id,outcome: 'duplicate' })
    expect(exported.tasks.every((task: { archivedAt: string }) => !!task.archivedAt)).toBe(true)
    expect(exported.comments[0]).toMatchObject({ text: '',removedAt: expect.any(String) })
    expect(exported.taskTags[0]).toMatchObject({ taskId: exportedParent.id,tagId: exported.tags[0].id })
    expect(JSON.stringify(exported)).not.toContain('REMOVE-THIS-CLOSING-COMMENT')
    for (const internal of [parentId,child.value.result.taskId,comment.id,completion.id,app.created.id]) expect(JSON.stringify(exported)).not.toContain(internal)
    expect(exported.history.some((event: { details: { outcome?: { taskId?: string } } }) => event.details.outcome?.taskId === exportedParent.id)).toBe(true)
  })

  it('streams all 100,000 retained Tasks at the 20-Space and 25-Member boundary', async () => {
    const app = await setup()
    for (let index=1;index<20;index++) expect((await app.space.change(app.session.identity,{ requestId: randomUUID() as RequestId,
      command: { kind: 'create-space',input: { key: `S${index}`,displayName: `Space ${index}`,timeZone: 'UTC' } } })).ok).toBe(true)
    for (let index=1;index<25;index++) await invite(app,`member-${index}`)
    // A bulk fixture supplies retained work; assertions use only the public export.
    await db.query(`insert into team.tasks(space_id,number,column_id,title,description,created_by_member_id,archived_at)
      select $1,n,c.id,'Retained Task '||n,repeat('Retained description. ',10),m.id,case when n<=90000 then now() else null end
      from generate_series(1,100000) n cross join team.board_columns c cross join team.members m
      where c.space_id=$1 and c.is_intake and m.space_id=$1 and m.identity_id=$2`,[app.created.id,app.session.identityView.id])
    await db.query('update team.boards set next_task_number=100001 where space_id=$1',[app.created.id])
    const started = performance.now()
    const exported = await document(app)
    expect(exported.members).toHaveLength(25)
    expect(exported.tasks).toHaveLength(100000)
    expect(exported.tasks[99999].title).toBe('Retained Task 100000')
    expect(exported.tasks.filter((task: { archivedAt: string | null }) => task.archivedAt !== null)).toHaveLength(90000)
    expect(exported.tasks.every((task: { title: string }) => task.title.startsWith('Retained Task '))).toBe(true)
    console.info(JSON.stringify({ event: 'export-scale-check',tasks: exported.tasks.length,members: exported.members.length,spaces: 20,durationMs: Math.round(performance.now()-started) }))
  },120_000)

})
