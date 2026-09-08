// @vitest-environment node
import type { AddressInfo } from 'node:net'
import { createTeamServer } from '../server.js'
import { loadConfig } from '../config.js'
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

run('Slice 3 capture and shape work', () => {
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

  it('captures a numbered Task in Intake and opens its plain-text detail after reload', async () => {
    const app = await setup()
    const result = await change(app, { kind: 'capture-task', input: { title: 'Plan the dig', description: 'First line\nSecond line' } })
    expect(result.ok).toBe(true)
    const board = new BoardModuleImplementation(db)
    const overview = await board.read(await access(app, 'board-read'), { kind: 'overview' })
    if (!overview.ok || overview.value.kind !== 'overview') throw new Error('Overview failed')
    const intake = overview.value.value.columns.find((column) => column.intake)!
    expect(intake.tasks.items).toMatchObject([{ key: 'DIG-1', title: 'Plan the dig', columnId: intake.id, revision: 1 }])
    expect(intake.tasks.items[0]).not.toHaveProperty('description')
    const detail = await board.read(await access(app, 'board-read'), { kind: 'task', task: { kind: 'key', taskKey: 'DIG-1' as never } })
    expect(detail).toMatchObject({ ok: true, value: { kind: 'task', sequence: 1, value: { description: 'First line\nSecond line' } } })
  })
  it('allocates unique sequential numbers concurrently and replays an identical request once', async () => {
    const app = await setup()
    const permitted = await access(app, 'board-change')
    const request = { requestId: 'same-capture' as RequestId,
      command: { kind: 'capture-task' as const, input: { title: 'One capture' } } }
    const retries = await Promise.all(Array.from({ length: 8 }, () => app.board.change(permitted, request)))
    for (const receipt of retries) expect(receipt).toEqual(retries[0])
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => change(app, {
      kind: 'capture-task', input: { title: `Concurrent ${index}` },
    })))
    expect(results.every((result) => result.ok)).toBe(true)
    const overview = await app.board.read(await access(app, 'board-read'), { kind: 'overview' })
    if (!overview.ok || overview.value.kind !== 'overview') throw new Error('Overview failed')
    expect(overview.value.value.columns.find((column) => column.intake)!.tasks.items.map((task) => task.key))
      .toEqual(Array.from({ length: 21 }, (_, index) => `DIG-${index + 1}`))
    expect(await app.board.change(permitted, { ...request, command: { kind: 'capture-task', input: { title: 'Different' } } }))
      .toEqual({ ok: false, fault: { kind: 'conflict', reason: 'request-id-reused' } })
  })

  it('revises a Task by stable ID and returns current detail beside a stale edit', async () => {
    const app = await setup()
    await change(app, { kind: 'capture-task', input: { title: 'Original' } })
    const readAccess = await access(app, 'board-read')
    const original = await app.board.read(readAccess, { kind: 'task', task: { kind: 'key', taskKey: 'DIG-1' as never } })
    if (!original.ok || original.value.kind !== 'task') throw new Error('Task failed')
    const task = { taskId: original.value.value.id, expectedRevision: original.value.value.revision }
    expect((await change(app, { kind: 'revise-task', task, changes: { title: 'Changed', description: 'Details' } })).ok).toBe(true)
    expect(await change(app, { kind: 'revise-task', task, changes: { title: 'My draft' } }))
      .toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'stale-task', current: {
        kind: 'task', value: { id: task.taskId, key: 'DIG-1', title: 'Changed', description: 'Details', revision: 2 },
      } } })
  })

  async function taskDetail(app: Awaited<ReturnType<typeof signIn>>, key = 'DIG-1') {
    const result = await app.board.read(await access(app, 'board-read', key.split('-')[0]), {
      kind: 'task', task: { kind: 'key', taskKey: key as never },
    })
    if (!result.ok || result.value.kind !== 'task') throw new Error(`Task failed: ${JSON.stringify(result)}`)
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

  it('assigns by Member ID and atomically unassigns open Tasks when that Member is removed', async () => {
    const app = await setup()
    await invite(app)
    const members = await app.space.read(app.session.identity, { kind: 'members', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members failed')
    const member = members.value.members.find((candidate) => candidate.displayName === 'member')!
    await change(app, { kind: 'capture-task', input: { title: 'Assigned work' } })
    const original = await taskDetail(app)
    expect((await change(app, { kind: 'revise-task', task: { taskId: original.id, expectedRevision: original.revision }, changes: { assigneeId: member.id } })).ok).toBe(true)
    expect(await taskDetail(app)).toMatchObject({ assignee: { id: member.id, displayName: 'member' }, revision: 2 })
    const removed = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: {
      kind: 'remove-member', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey }, member: { memberId: member.id, expectedRevision: member.revision },
    } })
    expect(removed.ok).toBe(true)
    const unassigned = await taskDetail(app)
    expect(unassigned).toMatchObject({ assignee: null, revision: 3 })
    expect(await change(app, { kind: 'revise-task', task: { taskId: unassigned.id, expectedRevision: unassigned.revision }, changes: { assigneeId: member.id } }))
      .toEqual({ ok: false, fault: { kind: 'not-found' } })
  })

  it('creates case-insensitively unique inline Tags and enforces Unicode text limits', async () => {
    const app = await setup()
    await change(app, { kind: 'capture-task', input: { title: '🌱'.repeat(200), description: '🌱'.repeat(20_000), tags: ['Delivery', 'delivery', '🌱'.repeat(40)] } })
    const task = await taskDetail(app)
    expect(task.tags.map((tag) => tag.name)).toEqual(['Delivery', '🌱'.repeat(40)])
    await change(app, { kind: 'capture-task', input: { title: 'Reuse Tag', tags: ['DELIVERY'] } })
    expect((await taskDetail(app, 'DIG-2')).tags[0].id).toBe(task.tags[0].id)
    for (const input of [
      { title: '' }, { title: '🌱'.repeat(201) }, { title: 'Valid', description: '🌱'.repeat(20_001) },
      { title: 'Valid', tags: ['🌱'.repeat(41)] }, { title: 'Valid', tags: [''] },
      { title: 'Valid', tags: Array.from({ length: 21 }, (_, index) => `Tag${index}`) },
    ]) expect(await change(app, { kind: 'capture-task', input })).toMatchObject({ ok: false, fault: { kind: 'invalid' } })
    expect((await change(app, { kind: 'revise-task', task: { taskId: task.id, expectedRevision: task.revision }, changes: { tags: [] } })).ok).toBe(true)
    expect((await taskDetail(app)).tags).toEqual([])
  })

  it('gives one-level Subtasks their own keys in Intake and conceals foreign parent IDs', async () => {
    const app = await setup()
    const other = await setup('ELSE')
    await change(other, { kind: 'capture-task', input: { title: 'Foreign' } }, 'ELSE')
    const foreign = await taskDetail(other, 'ELSE-1')
    expect(await change(app, { kind: 'capture-task', input: { title: 'Denied', parentTaskId: foreign.id } }))
      .toEqual({ ok: false, fault: { kind: 'not-found' } })
    await change(app, { kind: 'capture-task', input: { title: 'Parent' } })
    const parent = await taskDetail(app)
    expect((await change(app, { kind: 'capture-task', input: { title: 'Subtask', parentTaskId: parent.id } })).ok).toBe(true)
    const child = await taskDetail(app, 'DIG-2')
    expect(child).toMatchObject({ parentTaskId: parent.id, columnId: parent.columnId })
    expect((await taskDetail(app)).subtasks.items).toMatchObject([{ id: child.id, key: 'DIG-2' }])
    expect(await change(app, { kind: 'capture-task', input: { title: 'Too deep', parentTaskId: child.id } }))
      .toEqual({ ok: false, fault: { kind: 'rule-violation', rule: 'subtask-depth' } })
  })

  it('pages each lane and Subtasks with scoped cursors that expire after changes', async () => {
    const app = await setup()
    for (const title of ['First', 'Second', 'Third']) await change(app, { kind: 'capture-task', input: { title } })
    const readAccess = await access(app, 'board-read')
    const first = await app.board.read(readAccess, { kind: 'overview', firstPageSize: 2 })
    if (!first.ok || first.value.kind !== 'overview') throw new Error('Overview failed')
    const intake = first.value.value.columns.find((column) => column.intake)!
    expect(intake.tasks.items.map((task) => task.key)).toEqual(['DIG-1', 'DIG-2'])
    expect(intake.tasks.next).toEqual(expect.any(String))
    const selection = { kind: 'column' as const, columnId: intake.id }
    const second = await app.board.read(readAccess, { kind: 'tasks', selection, page: { after: intake.tasks.next, size: 2 } })
    expect(second).toMatchObject({ ok: true, value: { kind: 'tasks', value: { items: [{ key: 'DIG-3' }] } } })
    expect(await app.board.read(readAccess, { kind: 'tasks', selection: { kind: 'column', columnId: first.value.value.columns[1].id }, page: { after: intake.tasks.next } }))
      .toEqual({ ok: false, fault: { kind: 'cursor-expired' } })
    await change(app, { kind: 'capture-task', input: { title: 'Fourth' } })
    expect(await app.board.read(readAccess, { kind: 'tasks', selection, page: { after: intake.tasks.next } }))
      .toEqual({ ok: false, fault: { kind: 'cursor-expired' } })
    for (const size of [0, -1, 201, 1.5]) expect(await app.board.read(readAccess, { kind: 'tasks', selection, page: { size } }))
      .toMatchObject({ ok: false, fault: { kind: 'invalid' } })
    const parent = await taskDetail(app)
    for (let index = 0; index < 3; index++) await change(app, { kind: 'capture-task', input: { title: `Subtask ${index}`, parentTaskId: parent.id } })
    const detail = await app.board.read(readAccess, { kind: 'task', task: { kind: 'id', taskId: parent.id }, subtasks: { size: 2 } })
    if (!detail.ok || detail.value.kind !== 'task') throw new Error('Detail failed')
    expect(detail.value.value.subtasks.items).toHaveLength(2)
    expect(detail.value.value.subtasks.next).toEqual(expect.any(String))
    expect(await app.board.read(readAccess, { kind: 'task', task: { kind: 'id', taskId: parent.id }, subtasks: { size: 2, after: detail.value.value.subtasks.next } }))
      .toMatchObject({ ok: true, value: { value: { subtasks: { items: [{ key: 'DIG-7' }] } } } })
  })

  it('archives and restores a Task family without losing keys or descriptions', async () => {
    const app = await setup()
    await change(app, { kind: 'capture-task', input: { title: 'Parent', description: 'Keep this' } })
    const parent = await taskDetail(app)
    await change(app, { kind: 'capture-task', input: { title: 'Child', parentTaskId: parent.id } })
    expect((await change(app, { kind: 'archive-task', task: { taskId: parent.id, expectedRevision: parent.revision } })).ok).toBe(true)
    const archived = await taskDetail(app)
    expect(archived).toMatchObject({ archived: true, description: 'Keep this', key: 'DIG-1' })
    expect(await taskDetail(app, 'DIG-2')).toMatchObject({ archived: true })
    const board = await app.board.read(await access(app, 'board-read'), { kind: 'overview' })
    if (!board.ok || board.value.kind !== 'overview') throw new Error('Board failed')
    expect(board.value.value.columns.flatMap((column) => column.tasks.items)).toEqual([])
    const archive = await app.board.read(await access(app, 'board-read'), { kind: 'tasks', selection: { kind: 'archive' }, page: { size: 1 } })
    expect(archive).toMatchObject({ ok: true, value: { value: { items: [{ key: 'DIG-1' }], next: expect.any(String) } } })
    expect((await change(app, { kind: 'restore-task', task: { taskId: parent.id, expectedRevision: archived.revision } })).ok).toBe(true)
    expect(await taskDetail(app)).toMatchObject({ archived: false, key: 'DIG-1', description: 'Keep this', columnId: parent.columnId })
    expect(await taskDetail(app, 'DIG-2')).toMatchObject({ archived: false })
  })

  it('captures and revises through authenticated HTTP with CSRF and typed safe faults', async () => {
    const app = await setup()
    const server = createTeamServer(app, loadConfig({ ALLOWED_ORIGINS: origin }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/spaces/DIG/board`
    const headers = { origin, cookie: `dig_session=${app.browserSession.sessionSecret}`,
      'x-csrf-token': app.browserSession.csrfToken, 'content-type': 'application/json' }
    const body = JSON.stringify({ requestId: 'http-capture', command: { kind: 'capture-task', input: { title: 'From HTTP' } } })
    try {
      expect((await fetch(`${base}/changes`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body })).status).toBe(401)
      expect((await fetch(`${base}/changes`, { method: 'POST', headers: { ...headers, 'x-csrf-token': '' }, body })).status).toBe(403)
      const captured = await fetch(`${base}/changes`, { method: 'POST', headers, body })
      expect(captured.status).toBe(200)
      expect(await captured.json()).toMatchObject({ result: { kind: 'capture-task' }, update: { sequence: 1 } })
      const query = { kind: 'task', task: { kind: 'key', taskKey: 'DIG-1' } }
      const read = await fetch(`${base}/views?query=${encodeURIComponent(JSON.stringify(query))}`, { headers })
      expect(read.status).toBe(200)
      const detail = await read.json()
      expect(detail).toMatchObject({ kind: 'task', value: { title: 'From HTTP' } })
      const malformed = await fetch(`${base}/changes`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'bad', command: { kind: 'capture-task', input: { title: 123 } } }) })
      expect(malformed.status).toBe(400)
      expect(await malformed.text()).not.toMatch(/postgres|stack|TypeError/)
      const versioned = { taskId: detail.value.id, expectedRevision: detail.value.revision }
      const revise = (title: string) => fetch(`${base}/changes`, { method: 'POST', headers,
        body: JSON.stringify({ requestId: randomUUID(), command: { kind: 'revise-task', task: versioned, changes: { title } } }) })
      expect((await revise('Saved')).status).toBe(200)
      const stale = await revise('Draft')
      expect(stale.status).toBe(409)
      expect(await stale.json()).toMatchObject({ fault: { kind: 'conflict', reason: 'stale-task', current: { value: { title: 'Saved' } } } })
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
  })

  it('uses bounded indexed pages with 100,000 retained Tasks in one Space', async () => {
    const app = await setup()
    await db.query(`insert into team.tasks (space_id, number, column_id, title, description, created_by_member_id, archived_at)
      select $1, number, column_row.id, 'Scale Task ' || number, repeat('Detail only. ', 100), member.id,
             case when number <= 90000 then now() else null end
      from generate_series(1, 100000) number
      cross join team.board_columns column_row cross join team.members member
      where column_row.space_id = $1 and column_row.is_intake and member.space_id = $1`, [app.created.id])
    await db.query('analyze team.tasks')
    const readAccess = await access(app, 'board-read')
    const started = performance.now()
    const overview = await app.board.read(readAccess, { kind: 'overview' })
    if (!overview.ok || overview.value.kind !== 'overview') throw new Error('Overview failed')
    const intake = overview.value.value.columns.find((column) => column.intake)!
    expect(intake.tasks.items).toHaveLength(50)
    expect(intake.counts).toEqual({ tasks: 10000, parentTasks: 10000, subtasks: 0 })
    expect(intake.tasks.items[0].key).toBe('DIG-90001')
    expect(intake.tasks.items.some((task) => 'description' in task)).toBe(false)
    expect(performance.now() - started).toBeLessThan(1500)
    const next = await app.board.read(readAccess, { kind: 'tasks', selection: { kind: 'column', columnId: intake.id }, page: { after: intake.tasks.next, size: 200 } })
    if (!next.ok || next.value.kind !== 'tasks') throw new Error('Page failed')
    expect(next.value.value.items).toHaveLength(200)
    expect(next.value.value.items[0].key).toBe('DIG-90051')
    expect((await taskDetail(app, 'DIG-100000')).title).toBe('Scale Task 100000')
    const plan = await db.query(`explain (analyze, buffers, format json)
      select id, number, title from team.tasks where space_id = $1 and column_id = $2
      and archived_at is null and number > 95000 order by number limit 51`, [app.created.id, intake.id])
    const explanation = plan.rows[0]['QUERY PLAN'][0].Plan
    expect(JSON.stringify(explanation)).toContain('tasks_column_page_idx')
    expect(explanation['Actual Rows']).toBe(51)
    expect(explanation['Shared Hit Blocks'] + explanation['Shared Read Blocks']).toBeLessThan(250)
  }, 30_000)

  it('autocompletes Space Tags through bounded pages even when their Tasks are archived', async () => {
    const app = await setup()
    await change(app, { kind: 'capture-task', input: { title: 'Tagged', tags: ['Delivery', 'Design', 'Operations'] } })
    const task = await taskDetail(app)
    await change(app, { kind: 'archive-task', task: { taskId: task.id, expectedRevision: task.revision } })
    const first = await app.board.read(await access(app, 'board-read'), { kind: 'tags', text: 'DE', page: { size: 1 } })
    expect(first).toMatchObject({ ok: true, value: { kind: 'tags', value: { items: [{ name: 'Delivery' }], next: expect.any(String) } } })
    if (!first.ok || first.value.kind !== 'tags') throw new Error('Tags failed')
    const next = await app.board.read(await access(app, 'board-read'), { kind: 'tags', text: 'DE', page: { size: 1, after: first.value.value.next } })
    expect(next).toMatchObject({ ok: true, value: { value: { items: [{ name: 'Design' }] } } })
  })

  it('conceals foreign Task and Member IDs and rejects forged or stale capabilities', async () => {
    const app = await setup()
    const other = await setup('ELSE')
    await change(other, { kind: 'capture-task', input: { title: 'Foreign' } }, 'ELSE')
    const foreign = await taskDetail(other, 'ELSE-1')
    const otherMembers = await other.space.read(other.session.identity, { kind: 'members', space: { kind: 'key', spaceKey: 'ELSE' as SpaceKey } })
    if (!otherMembers.ok || otherMembers.value.kind !== 'members') throw new Error('Members failed')
    const readAccess = await access(app, 'board-read')
    for (const taskId of [foreign.id, randomUUID() as typeof foreign.id, 'malformed' as typeof foreign.id]) {
      expect(await app.board.read(readAccess, { kind: 'task', task: { kind: 'id', taskId } }))
        .toEqual({ ok: false, fault: { kind: 'not-found' } })
      expect(await change(app, { kind: 'revise-task', task: { taskId, expectedRevision: 1 as never }, changes: { title: 'Denied' } }))
        .toEqual({ ok: false, fault: { kind: 'not-found' } })
    }
    expect(await change(app, { kind: 'capture-task', input: { title: 'Foreign assignee', assigneeId: otherMembers.value.members[0].id } }))
      .toEqual({ ok: false, fault: { kind: 'not-found' } })
    const request = { requestId: randomUUID() as RequestId, command: { kind: 'capture-task' as const, input: { title: 'Denied' } } }
    expect(await app.board.change({} as never, request)).toEqual({ ok: false, fault: { kind: 'forbidden' } })
    expect(await app.board.change(readAccess as never, request)).toEqual({ ok: false, fault: { kind: 'forbidden' } })
    const oldAccess = await access(app, 'board-change')
    expect((await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'archive-space', space: { spaceId: app.created.id, expectedRevision: app.created.revision } } })).ok).toBe(true)
    expect(await app.board.change(oldAccess, request)).toEqual({ ok: false, fault: { kind: 'forbidden' } })
  })

  it('serializes assignment against Member removal and never leaves an open assignment behind', async () => {
    const app = await setup()
    await invite(app)
    const members = await app.space.read(app.session.identity, { kind: 'members', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members failed')
    const member = members.value.members.find((candidate) => candidate.displayName === 'member')!
    await change(app, { kind: 'capture-task', input: { title: 'Race' } })
    const task = await taskDetail(app)
    const permitted = await access(app, 'board-change')
    const blocker = await db.connect()
    let outcomes
    try {
      await blocker.query('begin')
      await blocker.query('select id from team.spaces where id = $1 for update', [app.created.id])
      const assigning = app.board.change(permitted, { requestId: randomUUID() as RequestId, command: { kind: 'revise-task',
        task: { taskId: task.id, expectedRevision: task.revision }, changes: { assigneeId: member.id } } })
      const removing = app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: { kind: 'remove-member',
        space: { kind: 'key', spaceKey: 'DIG' as SpaceKey }, member: { memberId: member.id, expectedRevision: member.revision } } })
      await blocker.query('commit')
      outcomes = await Promise.all([assigning, removing])
    } finally { await blocker.query('rollback'); blocker.release() }
    expect(outcomes[1].ok).toBe(true)
    if (!outcomes[0].ok) expect(outcomes[0].fault.kind).toBe('forbidden')
    expect((await taskDetail(app)).assignee).toBeNull()
  })

  it('invalidates a family larger than 200 without a partial authoritative Task projection', async () => {
    const app = await setup()
    await change(app, { kind: 'capture-task', input: { title: 'Large family' } })
    const parent = await taskDetail(app)
    await db.query(`insert into team.tasks (space_id, number, column_id, title, created_by_member_id, parent_task_id)
      select $1, number, $2, 'Subtask ' || number, member.id, $3 from generate_series(2, 202) number
      cross join team.members member where member.space_id = $1`, [app.created.id, parent.columnId, parent.id])
    const archived = await change(app, { kind: 'archive-task', task: { taskId: parent.id, expectedRevision: parent.revision } })
    if (!archived.ok) throw new Error('Archive failed')
    expect(archived.value.update.changes.filter((change) => change.kind !== 'column-order-revised').map((change) => change.kind))
      .toEqual(['board-counts-revised', 'query-revisions-changed'])
    expect(await taskDetail(app, 'DIG-202')).toMatchObject({ archived: true })
    const root = await taskDetail(app)
    const restored = await change(app, { kind: 'restore-task', task: { taskId: root.id, expectedRevision: root.revision } })
    expect(restored.ok).toBe(true)
    expect(await taskDetail(app, 'DIG-202')).toMatchObject({ archived: false, columnId: parent.columnId })
  })

})
