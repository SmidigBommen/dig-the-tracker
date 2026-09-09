import { runMaintenanceOnce } from '../runtime/maintenance.js'
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

run('Slice 7 workflow and retention', () => {
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

  it('commits an administrator workflow change atomically and replays the receipt', async () => {
    const app = await setup()
    const before = await overview(app)
    const desired = { columns: [...before.columns.map((column) => ({ id: column.id, name: column.name, flowRole: column.flowRole,
      intake: column.intake, completion: column.completion, wipLimit: column.wipLimit })),
      { name: 'Review', flowRole: 'active' as const, intake: false, completion: false, wipLimit: 2 }] }
    const request = { requestId: randomUUID() as RequestId, command: { kind: 'set-workflow' as const, expectedRevision: before.board.workflowRevision, desired } }
    const permission = await access(app, 'board-change')
    const saved = await app.board.change(permission, request)
    expect(saved.ok).toBe(true)
    expect(await app.board.change(permission, request)).toEqual(saved)
    const after = await overview(app)
    expect(after.board.workflowRevision).toBe(2)
    expect(after.columns.map((column) => column.name)).toEqual(['Backlog', 'In Progress', 'Done', 'Review'])
    expect(after.columns[3]).toMatchObject({ flowRole: 'active', wipLimit: 2 })
  })
  async function workflow(app: Awaited<ReturnType<typeof setup>>) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'workflow' })
    if (!result.ok || result.value.kind !== 'workflow') throw new Error(JSON.stringify(result))
    return result.value.value
  }
  function plan(view: Awaited<ReturnType<typeof workflow>>) {
    return view.columns.filter((column) => !column.archived).map(({ id, name, flowRole, intake, completion, wipLimit }) => ({ id, name, flowRole, intake, completion, wipLimit }))
  }

  it('protects populated Columns, enforces terminal roles and rejects stale and non-admin changes', async () => {
    const app = await setup()
    await capture(app)
    const original = await workflow(app)
    const columns = plan(original)
    expect(await change(app, { kind: 'set-workflow', expectedRevision: original.revision, desired: { columns: columns.map((column, index) => ({ ...column, intake: index === 1, flowRole: index === 1 ? 'queue' : column.flowRole, wipLimit: null })) } }))
      .toMatchObject({ ok: false, fault: { kind: 'rule-violation', rule: 'column-not-empty' } })
    expect(await change(app, { kind: 'set-workflow', expectedRevision: original.revision, desired: { columns: columns.filter((column) => !column.completion) } }))
      .toMatchObject({ ok: false, fault: { kind: 'rule-violation', rule: 'completion-required' } })
    expect(await workflow(app)).toEqual(original)
    const member = await invite(app)
    expect(await change(member, { kind: 'set-workflow', expectedRevision: original.revision, desired: { columns } }))
      .toMatchObject({ ok: false, fault: { kind: 'forbidden' } })
    expect((await change(app, { kind: 'set-workflow', expectedRevision: original.revision, desired: { columns } })).ok).toBe(true)
    expect(await change(app, { kind: 'set-workflow', expectedRevision: original.revision, desired: { columns } }))
      .toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'stale-workflow' } })
  })

  it('rejects a prepared move when its destination becomes Complete', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const initial = await workflow(app)
    const columns = plan(initial)
    const destination = initial.columns.find((column) => column.flowRole === 'active')!
    const move: BoardCommand = { kind: 'place-task', task: { taskId, expectedRevision: 1 as never },
      destination: { columnId: destination.id, expectedOrderRevision: destination.orderRevision, place: { kind: 'last' } } }
    expect((await change(app, { kind: 'set-workflow', expectedRevision: initial.revision, desired: { columns: columns.map((column) =>
      column.id === destination.id ? { ...column, flowRole: 'complete', completion: true, wipLimit: null }
        : column.completion ? { ...column, flowRole: 'queue', completion: false } : column) } })).ok).toBe(true)
    expect(await change(app, move)).toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'stale-order' } })
    expect(await detail(app, taskId)).toMatchObject({ closedAt: null, columnId: columns.find((column) => column.intake)!.id })
  })

  it('atomically replaces terminal Columns and restores archived Columns empty with their earlier role and limit', async () => {
    const app = await setup()
    const initial = await workflow(app)
    const columns = plan(initial)
    // Promote the former Active Column to Complete while replacing Intake.
    expect((await change(app, { kind: 'set-workflow', expectedRevision: initial.revision, desired: { columns: [
      { ...columns[1], flowRole: 'complete', completion: true, wipLimit: null },
      { name: 'New intake', flowRole: 'queue', intake: true, completion: false, wipLimit: null },
    ] } })).ok).toBe(true)
    const promoted = await workflow(app)
    expect(promoted.columns.filter((column) => column.archived).map((column) => column.id).sort()).toEqual([columns[0].id, columns[2].id].sort())
    const newIntake = plan(promoted).find((column) => column.intake)!
    expect((await change(app, { kind: 'set-workflow', expectedRevision: promoted.revision, desired: { columns: [newIntake,
      { name: 'Finished', flowRole: 'complete', intake: false, completion: true, wipLimit: null },
    ] } })).ok).toBe(true)
    const archived = await workflow(app)
    const formerActive = archived.columns.find((column) => column.id === columns[1].id)!
    expect(formerActive).toMatchObject({ archived: true, flowRole: 'active', wipLimit: 3, intake: false, completion: false, taskCount: 0 })
    expect((await change(app, { kind: 'set-workflow', expectedRevision: archived.revision, desired: { columns: [...plan(archived),
      { id: formerActive.id, name: formerActive.name, flowRole: formerActive.flowRole, wipLimit: formerActive.wipLimit, intake: false, completion: false },
    ] } })).ok).toBe(true)
    expect((await workflow(app)).columns.find((column) => column.id === formerActive.id)).toMatchObject({ archived: false, flowRole: 'active', wipLimit: 3, taskCount: 0 })
  })

  it.each([
    ['Europe/Oslo', '2026-03-10T11:00:00Z', '2026-04-08T22:00:00Z'],
    ['Europe/Oslo', '2026-10-10T10:00:00Z', '2026-11-08T23:00:00Z'],
    ['America/Los_Angeles', '2026-03-10T11:00:00Z', '2026-04-09T07:00:00Z'],
  ])('archives a family after 30 local dates in %s across daylight saving', async (zone, closedAt, boundary) => {
    const app = await setup()
    await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: {
      kind: 'revise-space', space: { spaceId: app.created.id, expectedRevision: app.created.revision }, changes: { timeZone: zone },
    } })
    const parent = await capture(app)
    const child = await change(app, { kind: 'capture-task', input: { title: 'Open child', parentTaskId: parent } })
    if (!child.ok || !child.value.result.taskId) throw new Error('Child failed')
    const board = await overview(app)
    const complete = board.columns.find((column) => column.completion)!
    expect((await change(app, { kind: 'place-task', task: { taskId: parent, expectedRevision: 1 as never },
      destination: { columnId: complete.id, expectedOrderRevision: complete.orderRevision, place: { kind: 'last' } } })).ok).toBe(true)
    // Historical fixture at the public runtime boundary; commands above create the family and closure.
    await db.query('update team.tasks set closed_at=$2 where id=$1', [parent, closedAt])
    expect(await runMaintenanceOnce(db, new Date(new Date(boundary).getTime()-1))).toEqual({ archivedTasks: 0, deletedSpaces: 0 })
    expect(await runMaintenanceOnce(db, new Date(boundary))).toEqual({ archivedTasks: 2, deletedSpaces: 0 })
    expect(await runMaintenanceOnce(db, new Date(boundary))).toEqual({ archivedTasks: 0, deletedSpaces: 0 })
    const archived = await detail(app, parent)
    expect(archived).toMatchObject({ archived: true, outcome: { kind: 'completed' }, history: { items: expect.arrayContaining([
      expect.objectContaining({ kind: 'auto-archive-task', actor: { id: null, displayName: 'Dig' } }),
    ]) } })
    expect(await detail(app, child.value.result.taskId)).toMatchObject({ archived: true, closedAt: null })
    expect((await change(app, { kind: 'restore-task', task: { taskId: parent, expectedRevision: archived.revision } })).ok).toBe(true)
    const restored = await detail(app, parent)
    expect(restored).toMatchObject({ archived: false, columnId: complete.id, outcome: { kind: 'completed' } })
    expect(await detail(app, child.value.result.taskId)).toMatchObject({ archived: false, columnId: board.columns.find((column) => column.intake)!.id, closedAt: null })
  })

  async function scheduleDeletion(app: Awaited<ReturnType<typeof setup>>) {
    const archived = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'archive-space', space: { spaceId: app.created.id, expectedRevision: app.created.revision } } })
    if (!archived.ok || archived.value.result.kind !== 'space-archived') throw new Error('Archive failed')
    const scheduled = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'schedule-space-deletion', space: { spaceId: app.created.id, expectedRevision: archived.value.result.space.revision } } })
    if (!scheduled.ok || scheduled.value.result.kind !== 'space-deletion-scheduled') throw new Error('Schedule failed')
    return scheduled.value.result.space
  }

  it('deletes only after the grace period, including legacy receipts, and permanently reserves the key', async () => {
    const app = await setup()
    await invite(app)
    const taskId = await capture(app)
    await change(app, { kind: 'add-comment', taskId, text: 'Retained until deletion', mentions: [] })
    const permission = await access(app, 'board-read')
    const scheduled = await scheduleDeletion(app)
    // The previous runtime omits space_id during a rolling deployment.
    const legacy = await db.query(`insert into team.space_request_receipts (identity_id,request_id,request_hash,response,created_at)
      select identity_id,gen_random_uuid(),request_hash,response,created_at from team.space_request_receipts returning space_id`)
    expect(legacy.rows.length).toBeGreaterThan(3)
    expect(legacy.rows.every((row) => row.space_id === app.created.id)).toBe(true)
    const boundary = new Date(scheduled.deletionScheduledFor!)
    expect(await runMaintenanceOnce(db, new Date(boundary.getTime()-1))).toEqual({ deletedSpaces: 0, archivedTasks: 0 })
    expect(await runMaintenanceOnce(db, boundary)).toEqual({ deletedSpaces: 1, archivedTasks: 0 })
    expect((await db.query('select count(*)::int as count from team.space_request_receipts')).rows[0].count).toBe(0)
    expect(await app.board.read(permission, { kind: 'overview' })).toMatchObject({ ok: false, fault: { kind: 'not-found' } })
    const fresh = await signIn()
    expect(await fresh.space.change(fresh.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'create-space', input: { key: 'DIG', displayName: 'Cannot reuse', timeZone: 'UTC' } } }))
      .toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'space-key-unavailable' } })
  })

  it('honors cancellation before the deadline and rejects cancellation after it', async () => {
    const app = await setup()
    const scheduled = await scheduleDeletion(app)
    now = new Date(new Date(scheduled.deletionScheduledFor!).getTime()-1)
    expect((await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: {
      kind: 'cancel-space-deletion', space: { spaceId: app.created.id, expectedRevision: scheduled.revision },
    } })).ok).toBe(true)
    expect(await runMaintenanceOnce(db, new Date(now.getTime()+2))).toEqual({ deletedSpaces: 0, archivedTasks: 0 })
    const again = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: {
      kind: 'schedule-space-deletion', space: { spaceId: app.created.id, expectedRevision: (scheduled.revision+1) as never },
    } })
    if (!again.ok || again.value.result.kind !== 'space-deletion-scheduled') throw new Error('Schedule failed')
    now = new Date(again.value.result.space.deletionScheduledFor!)
    expect(await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: {
      kind: 'cancel-space-deletion', space: { spaceId: app.created.id, expectedRevision: again.value.result.space.revision },
    } })).toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'invalid-lifecycle' } })
  })

  it('gives a restored Closed Task a new retention window and serializes concurrent archive runs', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const complete = (await overview(app)).columns.find((column) => column.completion)!
    await change(app, { kind: 'place-task', task: { taskId, expectedRevision: 1 as never },
      destination: { columnId: complete.id, expectedOrderRevision: complete.orderRevision, place: { kind: 'last' } } })
    await db.query("update team.tasks set closed_at=now()-interval '40 days' where id=$1", [taskId])
    const runs = await Promise.all([runMaintenanceOnce(db), runMaintenanceOnce(db)])
    expect(runs.reduce((total, result) => total + result.archivedTasks, 0)).toBe(1)
    const archived = await detail(app, taskId)
    await change(app, { kind: 'restore-task', task: { taskId, expectedRevision: archived.revision } })
    expect(await runMaintenanceOnce(db)).toMatchObject({ archivedTasks: 0 })
    expect(await runMaintenanceOnce(db, new Date(Date.now()+31*24*60*60*1000))).toMatchObject({ archivedTasks: 1 })
    expect((await detail(app, taskId)).closedAt).toBe(archived.closedAt)
  })

})
