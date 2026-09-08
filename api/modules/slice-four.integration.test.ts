// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { SpaceModuleImplementation, type SpaceUse } from './space/space-module.js'
import { BoardModuleImplementation, type BoardCommand } from './board/board-module.js'
import type { RequestId, SpaceKey } from './shared.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database

run('Slice 4 move work and record flow', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  beforeEach(async () => {
    await db.query('truncate team.identities, team.space_key_reservations cascade')
  })
  afterAll(async () => { await db.end() })

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

  it('places Tasks relative to stable anchors and rejects concurrent stale ordering', async () => {
    const app = await setup()
    for (const title of ['First', 'Second', 'Third']) await change(app, { kind: 'capture-task', input: { title } })
    const lane = (await overview(app)).columns[0]
    const [first, second, third] = lane.tasks.items
    const command: BoardCommand = { kind: 'place-task', task: { taskId: third.id, expectedRevision: third.revision },
      destination: { columnId: lane.id, expectedOrderRevision: lane.orderRevision, place: { kind: 'before', taskId: first.id } } }
    const permission = await access(app, 'board-change')
    const request = { requestId: randomUUID() as RequestId, command }
    const moved = await app.board.change(permission, request)
    expect(moved).toMatchObject({ ok: true, value: { update: { changes: expect.arrayContaining([
      expect.objectContaining({ kind: 'task-upserted', placement: { columnId: lane.id, beforeTaskId: first.id } }),
    ]) } } })
    if (!moved.ok) throw new Error(JSON.stringify(moved))
    const upsert = moved.value.update.changes.find((item) => item.kind === 'task-upserted')
    expect(upsert && upsert.kind === 'task-upserted' && upsert.placement.beforeTaskId).toBe(first.id)
    expect(await app.board.change(permission, request)).toEqual(moved)
    expect((await overview(app)).columns[0].tasks.items.map((task) => task.title)).toEqual(['Third', 'First', 'Second'])
    expect(await change(app, { kind: 'place-task', task: { taskId: second.id, expectedRevision: second.revision },
      destination: { columnId: lane.id, expectedOrderRevision: lane.orderRevision, place: { kind: 'first' } } }))
      .toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'stale-order' } })
  })
  async function detail(app: Awaited<ReturnType<typeof setup>>, taskId: import('./shared.js').TaskId) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'task', task: { kind: 'id', taskId }, history: { size: 200 } })
    if (!result.ok || result.value.kind !== 'task') throw new Error(JSON.stringify(result))
    return result.value.value
  }

  async function capture(app: Awaited<ReturnType<typeof setup>>, title: string, parentTaskId?: import('./shared.js').TaskId) {
    const result = await change(app, { kind: 'capture-task', input: { title, parentTaskId } })
    if (!result.ok || !result.value.result.taskId) throw new Error(JSON.stringify(result))
    return detail(app, result.value.result.taskId)
  }

  async function move(app: Awaited<ReturnType<typeof setup>>, taskId: import('./shared.js').TaskId,
    lane: number, closure?: import('../contracts/board.js').Closure) {
    const task = await detail(app, taskId)
    const column = (await overview(app)).columns[lane]
    return change(app, { kind: 'place-task', task: { taskId, expectedRevision: task.revision },
      destination: { columnId: column.id, expectedOrderRevision: column.orderRevision, place: { kind: 'last' } }, closure })
  }

  it('closes, changes Outcome, and reopens while preserving first start and immutable closure history', async () => {
    const app = await setup()
    const task = await capture(app, 'Work through a cycle')
    expect((await move(app, task.id, 1)).ok).toBe(true)
    const active = await detail(app, task.id)
    expect(active.startedAt).toEqual(expect.any(String))
    expect((await move(app, task.id, 2)).ok).toBe(true)
    const closed = await detail(app, task.id)
    expect(closed.outcome).toEqual({ kind: 'completed' })
    expect(closed.closedAt).toEqual(expect.any(String))
    expect(closed.cycleTimeMilliseconds).toEqual(expect.any(Number))
    const cycleTime = closed.cycleTimeMilliseconds
    expect((await change(app, { kind: 'change-outcome', task: { taskId: task.id, expectedRevision: closed.revision }, outcome: { kind: 'cancelled' } })).ok).toBe(true)
    const amended = await detail(app, task.id)
    expect(amended).toMatchObject({ closedAt: closed.closedAt, cycleTimeMilliseconds: cycleTime, outcome: { kind: 'cancelled' } })
    expect((await move(app, task.id, 0)).ok).toBe(true)
    const reopened = await detail(app, task.id)
    expect(reopened).toMatchObject({ outcome: null, closedAt: null, startedAt: active.startedAt, cycleTimeMilliseconds: null })
    expect((await move(app, task.id, 2, { outcome: { kind: 'rejected' }, comment: 'No longer needed' })).ok).toBe(true)
    const reclosed = await detail(app, task.id)
    expect(reclosed.startedAt).toBe(active.startedAt)
    expect(reclosed.cycleTimeMilliseconds!).toBeGreaterThanOrEqual(cycleTime!)
    expect(reclosed.history!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'closed', outcome: { kind: 'completed' }, actor: expect.objectContaining({ displayName: 'admin' }) }),
      expect.objectContaining({ kind: 'outcome-changed', outcome: { kind: 'cancelled' } }),
      expect.objectContaining({ kind: 'reopened' }),
      expect.objectContaining({ kind: 'closed', outcome: { kind: 'rejected' }, comment: 'No longer needed' }),
    ]))
  })

  it('counts parents and Subtasks toward WIP and warns without blocking parent closure', async () => {
    const app = await setup()
    const parent = await capture(app, 'Parent')
    const child = await capture(app, 'Child', parent.id)
    const other = await capture(app, 'Other')
    const fourth = await capture(app, 'Fourth')
    for (const task of [parent, child, other]) expect((await move(app, task.id, 1)).ok).toBe(true)
    const result = await move(app, fourth.id, 1)
    expect(result).toMatchObject({ ok: true, value: { warnings: [{ kind: 'wip-limit-exceeded', limit: 3, actual: 4, parentTasks: 3, subtasks: 1 }] } })
    const closed = await move(app, parent.id, 2)
    expect(closed).toMatchObject({ ok: true, value: { warnings: [{ kind: 'open-subtasks', taskId: parent.id, count: 1 }] } })
    expect((await detail(app, parent.id)).outcome).toEqual({ kind: 'completed' })
    expect((await detail(app, child.id)).outcome).toBeNull()
  })

  it('restores family members to the end of Intake or Complete and records their new transitions', async () => {
    const app = await setup()
    const parent = await capture(app, 'Parent')
    const child = await capture(app, 'Closed child', parent.id)
    await move(app, parent.id, 1)
    await move(app, child.id, 2, { outcome: { kind: 'cancelled' } })
    const closedChild = await detail(app, child.id)
    const current = await detail(app, parent.id)
    expect((await change(app, { kind: 'archive-task', task: { taskId: parent.id, expectedRevision: current.revision } })).ok).toBe(true)
    const later = await capture(app, 'Existing Intake work')
    const archived = await detail(app, parent.id)
    expect((await change(app, { kind: 'restore-task', task: { taskId: parent.id, expectedRevision: archived.revision } })).ok).toBe(true)
    const board = await overview(app)
    expect(board.columns[0].tasks.items.map((task) => task.id)).toEqual([later.id, parent.id])
    const restored = await detail(app, parent.id)
    expect(restored.columnEnteredAt > current.columnEnteredAt).toBe(true)
    expect(restored.startedAt).toBe(current.startedAt)
    const transitions = restored.history!.items.filter((event) => event.kind === 'column-transition')
    expect(transitions[0].toColumn?.id).toBe(board.columns[0].id)
    const restoredChild = await detail(app, child.id)
    expect(restoredChild.outcome).toEqual({ kind: 'cancelled' })
    expect(restoredChild.closedAt).toBe(closedChild.closedAt)
  })

  it('allows unrelated Intake capture while concurrent moves into Active have one winner', async () => {
    const app = await setup()
    const first = await capture(app, 'First')
    const second = await capture(app, 'Second')
    const active = (await overview(app)).columns[1]
    await capture(app, 'Unrelated capture')
    const permission = await access(app, 'board-change')
    const results = await Promise.all([first, second].map((task) => app.board.change(permission, {
      requestId: randomUUID() as RequestId, command: { kind: 'place-task', task: { taskId: task.id, expectedRevision: task.revision },
        destination: { columnId: active.id, expectedOrderRevision: active.orderRevision, place: { kind: 'first' } } },
    })))
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'stale-order' } })
    expect((await overview(app)).columns[1].tasks.items).toHaveLength(1)
  })

  it('validates Duplicate references and rolls back invalid closures without history or ordering changes', async () => {
    const app = await setup()
    const task = await capture(app, 'Duplicate candidate')
    const target = await capture(app, 'Original')
    const other = await setup('OTHER')
    const foreign = await change(other, { kind: 'capture-task', input: { title: 'Private elsewhere' } }, 'OTHER')
    if (!foreign.ok) throw new Error('Capture failed')
    const before = await overview(app)
    expect(await move(app, task.id, 2, { outcome: { kind: 'duplicate', taskId: task.id } }))
      .toMatchObject({ ok: false, fault: { kind: 'rule-violation', rule: 'duplicate-target-invalid' } })
    expect(await move(app, task.id, 2, { outcome: { kind: 'duplicate', taskId: foreign.value.result.taskId! } }))
      .toMatchObject({ ok: false, fault: { kind: 'not-found' } })
    expect(await move(app, task.id, 1, { outcome: { kind: 'completed' } }))
      .toMatchObject({ ok: false, fault: { kind: 'invalid' } })
    expect(await move(app, task.id, 2, { outcome: { kind: 'rejected' }, comment: 'x'.repeat(5001) }))
      .toMatchObject({ ok: false, fault: { kind: 'invalid' } })
    expect(await change(app, { kind: 'change-outcome', task: { taskId: task.id, expectedRevision: task.revision }, outcome: { kind: 'cancelled' } }))
      .toMatchObject({ ok: false, fault: { kind: 'rule-violation', rule: 'closure-required' } })
    expect(await overview(app)).toEqual(before)
    expect((await detail(app, task.id)).history!.items).toHaveLength(1)
    expect((await move(app, task.id, 2, { outcome: { kind: 'duplicate', taskId: target.id } })).ok).toBe(true)
    expect((await detail(app, task.id)).outcome).toEqual({ kind: 'duplicate', taskId: target.id })
  })

  it('keeps bounded relative pages correct after dense insertions and invalidates previous cursors', async () => {
    const app = await setup()
    const anchor = await capture(app, 'Anchor')
    await capture(app, 'Tail')
    const read = await access(app, 'board-read')
    const page = await app.board.read(read, { kind: 'overview', firstPageSize: 1 })
    if (!page.ok || page.value.kind !== 'overview') throw new Error('Overview failed')
    const lane = page.value.value.columns[0]
    expect(lane.tasks.next).toEqual(expect.any(String))
    const expected = [anchor.id]
    for (let index = 0; index < 14; index++) {
      const added = await capture(app, `Inserted ${index}`)
      const column = (await overview(app)).columns[0]
      expect((await change(app, { kind: 'place-task', task: { taskId: added.id, expectedRevision: added.revision },
        destination: { columnId: column.id, expectedOrderRevision: column.orderRevision, place: { kind: 'after', taskId: anchor.id } } })).ok).toBe(true)
      expected.splice(1, 0, added.id)
    }
    expect(await app.board.read(read, { kind: 'tasks', selection: { kind: 'column', columnId: lane.id }, page: { after: lane.tasks.next } }))
      .toMatchObject({ ok: false, fault: { kind: 'cursor-expired' } })
    const firstPage = await app.board.read(read, { kind: 'tasks', selection: { kind: 'column', columnId: lane.id }, page: { size: 5 } })
    if (!firstPage.ok || firstPage.value.kind !== 'tasks') throw new Error('Page failed')
    expect(firstPage.value.value.items.map((task) => task.id)).toEqual(expected.slice(0, 5))
    const nextPage = await app.board.read(read, { kind: 'tasks', selection: { kind: 'column', columnId: lane.id }, page: { size: 5, after: firstPage.value.value.next } })
    if (!nextPage.ok || nextPage.value.kind !== 'tasks') throw new Error('Page failed')
    expect(nextPage.value.value.items.map((task) => task.id)).toEqual(expected.slice(5, 10))
    expect(firstPage.value.value.items[0]).not.toHaveProperty('rank')
  })

  it('pages immutable history independently of Subtasks and replays a closure only once', async () => {
    const app = await setup()
    const task = await capture(app, 'Parent')
    await capture(app, 'Child one', task.id)
    await capture(app, 'Child two', task.id)
    const complete = (await overview(app)).columns[2]
    const request = { requestId: randomUUID() as RequestId, command: { kind: 'place-task' as const,
      task: { taskId: task.id, expectedRevision: task.revision },
      destination: { columnId: complete.id, expectedOrderRevision: complete.orderRevision, place: { kind: 'last' as const } } } }
    const permission = await access(app, 'board-change')
    const receipt = await app.board.change(permission, request)
    expect(receipt.ok).toBe(true)
    expect(await app.board.change(permission, request)).toEqual(receipt)
    const read = await access(app, 'board-read')
    const page = await app.board.read(read, { kind: 'task', task: { kind: 'id', taskId: task.id }, subtasks: { size: 1 }, history: { size: 1 } })
    if (!page.ok || page.value.kind !== 'task') throw new Error('Detail failed')
    expect(page.value.value.history!.items.map((event) => event.kind)).toEqual(['closed'])
    const next = await app.board.read(read, { kind: 'task', task: { kind: 'id', taskId: task.id }, history: { size: 1, after: page.value.value.history!.next } })
    if (!next.ok || next.value.kind !== 'task') throw new Error('Detail failed')
    expect(next.value.value.history!.items.map((event) => event.kind)).toEqual(['column-transition'])
    expect(next.value.value.subtasks.items).toHaveLength(2)
    expect((await detail(app, task.id)).history!.items).toHaveLength(3)
    expect(await app.board.read(read, { kind: 'task', task: { kind: 'id', taskId: task.id }, history: { after: page.value.value.subtasks.next } }))
      .toMatchObject({ ok: false, fault: { kind: 'cursor-expired' } })
  })

})
