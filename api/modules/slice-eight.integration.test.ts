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

run('Slice 8 search and reports', () => {
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
    return { ...member, session: resolved.value, browserSession: accepted.value.session }
  }

  it('searches Task content, tags, assignee and key within the authorized Space', async () => {
    const app = await setup()
    const member = await invite(app, 'Linnea')
    const memberAccess = await access(member, 'board-read')
    const members = await app.board.read(memberAccess, { kind: 'overview' })
    if (!members.ok || members.value.kind !== 'overview') throw new Error('Missing overview')
    const assigneeId = members.value.value.currentMemberId
    const added = await change(app, { kind: 'capture-task', input: { title: 'Unicode café delivery', description: 'Investigate latency', tags: ['Operations'], assigneeId } })
    if (!added.ok || !added.value.result.taskId) throw new Error('Capture failed')
    const search = (text: string) => app.board.read(memberAccess, { kind: 'tasks', selection: { kind: 'search', text } })
    for (const text of ['café', 'latency', 'Operations', 'Linnea', 'DIG-1']) {
      expect(await search(text)).toMatchObject({ ok: true, value: { kind: 'tasks', value: { items: [expect.objectContaining({ id: added.value.result.taskId })] } } })
    }
    await change(app, { kind: 'add-comment', taskId: added.value.result.taskId, text: 'commentonlyword', mentions: [] })
    expect(await search('commentonlyword')).toMatchObject({ ok: true, value: { value: { items: [] } } })
    await setup('OTHER')
    await change(app, { kind: 'capture-task', input: { title: 'Confidential othersecret' } }, 'OTHER')
    expect(await search('othersecret')).toMatchObject({ ok: true, value: { value: { items: [] } } })
    expect(await search('OTHER-1')).toMatchObject({ ok: true, value: { value: { items: [] } } })
  })
  it('separates open, Closed and Archived results and expires changed search pages', async () => {
    const app = await setup()
    const first = await capture(app), second = await capture(app), third = await capture(app)
    const columns = (await overview(app)).columns
    await change(app, { kind: 'place-task', task: { taskId: second, expectedRevision: 1 as never }, destination: {
      columnId: columns[2].id, expectedOrderRevision: columns[2].orderRevision, place: { kind: 'last' },
    } })
    await change(app, { kind: 'archive-task', task: { taskId: third, expectedRevision: 1 as never } })
    const permission = await access(app, 'board-read')
    const search = (include: 'open'|'closed'|'archived'|'all', after?: import('./shared.js').OpaqueCursor) => app.board.read(permission, {
      kind: 'tasks', selection: { kind: 'search', text: 'Discuss', include }, page: { size: 1, after },
    })
    for (const [scope,id] of [['open',first],['closed',second],['archived',third]] as const) {
      expect(await search(scope)).toMatchObject({ ok: true, value: { value: { items: [expect.objectContaining({ id })] } } })
    }
    const page = await search('all')
    if (!page.ok || page.value.kind !== 'tasks' || !page.value.value.next) throw new Error('Expected next page')
    expect(await search('all',page.value.value.next)).toMatchObject({ ok: true, value: { value: { items: [expect.objectContaining({ id: second })] } } })
    expect(await search('open',page.value.value.next)).toMatchObject({ ok: false, fault: { kind: 'cursor-expired' } })
    await capture(app)
    expect(await search('all',page.value.value.next)).toMatchObject({ ok: false, fault: { kind: 'cursor-expired' } })
  })

  it('reports current WIP, oldest work and Cycle time after reopening', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const columns = (await overview(app)).columns
    const move = async (index: number) => {
      const task = await detail(app,taskId), current = (await overview(app)).columns[index]
      expect((await change(app, { kind: 'place-task', task: { taskId, expectedRevision: task.revision },
        destination: { columnId: current.id, expectedOrderRevision: current.orderRevision, place: { kind: 'last' } } })).ok).toBe(true)
    }
    await move(1)
    const started = (await detail(app,taskId)).startedAt
    await move(2)
    await move(1)
    expect((await detail(app,taskId)).startedAt).toBe(started)
    const permission = await access(app,'board-read')
    const active = await app.board.read(permission,{ kind: 'flow' })
    expect(active).toMatchObject({ ok: true, value: { value: {
      columns: expect.arrayContaining([expect.objectContaining({ id: columns[1].id, tasks: 1, limit: 3 })]),
      oldest: { items: [expect.objectContaining({ id: taskId })] }, medianCycleTimeMilliseconds: null,
    } } })
    await move(2)
    const closed = await detail(app,taskId)
    const report = await app.board.read(permission,{ kind: 'flow' })
    expect(report).toMatchObject({ ok: true, value: { value: {
      oldest: { items: [] }, medianCycleTimeMilliseconds: closed.cycleTimeMilliseconds, cycleTimeSampleSize: 1,
      throughput: expect.arrayContaining([expect.objectContaining({ completed: 2, rejected: 0, cancelled: 0, duplicate: 0 })]),
    } } })
  })

  it('keeps WIP history correct through parent-family archive and restore', async () => {
    const app = await setup()
    const parent = await capture(app)
    const child = await change(app,{ kind: 'capture-task', input: { title: 'Child', parentTaskId: parent } })
    if (!child.ok || !child.value.result.taskId) throw new Error('Capture failed')
    for (const taskId of [parent,child.value.result.taskId]) {
      const active = (await overview(app)).columns[1]
      await change(app,{ kind: 'place-task', task: { taskId, expectedRevision: 1 as never }, destination: {
        columnId: active.id, expectedOrderRevision: active.orderRevision, place: { kind: 'last' },
      } })
    }
    const active = (await overview(app)).columns[1]
    const report = async () => {
      const result = await app.board.read(await access(app,'board-read'),{ kind: 'flow' })
      if (!result.ok || result.value.kind !== 'flow') throw new Error(JSON.stringify(result))
      return result.value.value
    }
    const before = await report()
    expect(before.history).toHaveLength(30)
    expect(before.history.at(-1)?.columns.find((column) => column.columnId === active.id)?.tasks).toBe(2)
    expect(before.history[0].columns.find((column) => column.columnId === active.id)?.tasks).toBe(0)
    await change(app,{ kind: 'archive-task', task: { taskId: parent, expectedRevision: (await detail(app,parent)).revision } })
    await change(app,{ kind: 'restore-task', task: { taskId: parent, expectedRevision: (await detail(app,parent)).revision } })
    const after = await report()
    expect(after.history.every((day) => day.columns.every((column) => column.tasks === 0))).toBe(true)
  })

  it('shows only assigned Active work, alphabetically, with bounded Member pages', async () => {
    const app = await setup()
    await invite(app,'Zoe')
    await invite(app,'Amir')
    const board = await overview(app)
    const zoe = board.members.find((member) => member.displayName === 'Zoe')!
    const permission = await access(app,'board-read')
    for (const columnIndex of [0,1,1,2]) {
      const taskId = await capture(app)
      await change(app,{ kind: 'revise-task', task: { taskId,expectedRevision: 1 as never },changes: { assigneeId: zoe.id } })
      if (columnIndex) {
        const column = (await overview(app)).columns[columnIndex]
        await change(app,{ kind: 'place-task',task: { taskId,expectedRevision: 2 as never },destination: {
          columnId: column.id,expectedOrderRevision: column.orderRevision,place: { kind: 'last' },
        } })
      }
    }
    const report = await app.board.read(permission,{ kind: 'workload',page: { size: 1 } })
    if (!report.ok || report.value.kind !== 'workload') throw new Error(JSON.stringify(report))
    expect(report.value.value.members.map((row) => row.member.displayName)).toEqual(['admin','Amir','Zoe'])
    const assigned = report.value.value.members.find((row) => row.member.id === zoe.id)!
    expect(assigned.activeTasks).toBe(2)
    expect(assigned.tasks.items.map((task) => task.key)).toEqual(['DIG-2'])
    expect(assigned.tasks.next).toBeDefined()
    const next = await app.board.read(permission,{ kind: 'workload',memberId: zoe.id,page: { size: 1,after: assigned.tasks.next } })
    expect(next).toMatchObject({ ok: true,value: { value: { members: [{ member: { id: zoe.id },tasks: { items: [expect.objectContaining({ key: 'DIG-3' })] } }] } } })
    const other = await setup('OTHER')
    const foreignMember = (await other.board.read(await access(other,'board-read','OTHER'),{ kind: 'overview' }))
    if (!foreignMember.ok || foreignMember.value.kind !== 'overview') throw new Error('Missing foreign Board')
    expect(await app.board.read(permission,{ kind: 'workload',memberId: foreignMember.value.value.currentMemberId }))
      .toMatchObject({ ok: false,fault: { kind: 'not-found' } })
  })

  it('uses local day and week boundaries across DST and backfills the same WIP history',async () => {
    const app = await setup()
    const ids: string[] = []
    for (const [started,closed,outcome] of [
      ['2026-03-28T22:30:00Z','2026-03-29T22:30:00Z','completed'],
      ['2026-03-28T21:30:00Z','2026-03-29T21:30:00Z','rejected'],
    ] as const) {
      const taskId = await capture(app); ids.push(taskId)
      for (const index of [1,2]) {
        const column = (await overview(app)).columns[index]
        await change(app,{ kind: 'place-task',task: { taskId,expectedRevision: (await detail(app,taskId)).revision },destination: {
          columnId: column.id,expectedOrderRevision: column.orderRevision,place: { kind: 'last' },
        },...(index === 2 ? { closure: { outcome: { kind: outcome } } } : {}) })
      }
      // Historical fixtures represent the state and immutable events at the report clock.
      await db.query(`update team.tasks set created_at=$2::timestamptz-interval '1 hour',started_at=$2,closed_at=$3,column_entered_at=$3 where id=$1`,[taskId,started,closed])
      await db.query(`update team.task_events set occurred_at=case when kind='closed' or details->'toColumn'->>'flowRole'='complete'
        then $3::timestamptz else $2::timestamptz end where task_id=$1`,[taskId,started,closed])
      await db.query('update team.board_wip_deltas set occurred_at=case when delta=1 then $2::timestamptz else $3::timestamptz end where task_id=$1',[taskId,started,closed])
    }
    const module = new BoardModuleImplementation(db,{ now: () => new Date('2026-03-30T12:00:00Z') })
    const permission = await access(app,'board-read')
    const read = async () => {
      const result = await module.read(permission,{ kind: 'flow' })
      if (!result.ok || result.value.kind !== 'flow') throw new Error(JSON.stringify(result))
      return result.value.value
    }
    const before = await read()
    const active = (await overview(app)).columns[1].id
    expect(before.medianCycleTimeMilliseconds).toBe(86400000)
    expect(before.throughput.find(week => week.startDate === '2026-03-23')).toMatchObject({ completed: 0,rejected: 1 })
    expect(before.throughput.find(week => week.startDate === '2026-03-30')).toMatchObject({ completed: 1,rejected: 0 })
    for (const [date,count] of [['2026-03-28',2],['2026-03-29',1],['2026-03-30',0]] as const) {
      expect(before.history.find(day => day.date === date)?.columns.find(column => column.columnId === active)?.tasks).toBe(count)
    }
    const migration = (await (await import('../migrate.js')).loadMigrations('db/migrations')).find(item => item.version === '202609090005_wip_history')!
    const client = await db.connect()
    try { await client.query('begin'); await client.query(migration.down); await client.query(migration.up); await client.query('commit') }
    catch (error) { await client.query('rollback'); throw error } finally { client.release() }
    expect((await read()).history).toEqual(before.history)
    // Outcome changes preserve closure evidence; Tasks closed without starting are excluded from the median.
    await change(app,{ kind: 'change-outcome',task: { taskId: ids[0] as never,expectedRevision: 3 as never },outcome: { kind: 'cancelled' } })
    expect((await read()).throughput).toEqual(before.throughput)
  })

  it('keeps indexed search and report reads bounded with 100,000 retained Tasks',async () => {
    const app = await setup()
    const insert = `insert into team.tasks(space_id,number,column_id,title,description,created_by_member_id,assignee_id,archived_at,closed_at,outcome,started_at)
      select $1,n,c.id,case when n=100000 then 'Needlequartz' else 'Historical task '||n end,repeat('Retained description. ',20),m.id,m.id,
        case when n<=90000 then now()-interval '180 days' end,
        case when n<=90000 then now()-interval '180 days' end,
        case when n<=90000 then 'completed' end,now()-interval '181 days'
      from generate_series($2::integer,$3::integer) n join team.board_columns c on c.space_id=$1 and c.flow_role=case when n<=90000 then 'complete' else 'active' end
      join team.members m on m.space_id=$1`
    await db.query(insert,[app.created.id,1,90000])
    // Refresh tiny-table statistics before Active inserts trigger thousands of Task foreign-key checks.
    await db.query('analyze team.tasks')
    await db.query(insert,[app.created.id,90001,100000])
    await db.query(`insert into team.task_events(space_id,task_id,actor_member_id,kind,details,occurred_at)
      select space_id,id,created_by_member_id,'closed',jsonb_build_object('outcome',jsonb_build_object('kind',outcome)),closed_at
      from team.tasks where space_id=$1 and closed_at is not null`,[app.created.id])
    await db.query('analyze team.task_events')
    await db.query('analyze team.tasks')
    await db.query('analyze team.board_wip_deltas')
    const permission = await access(app,'board-read')
    const elapsed: Record<string,number> = {}
    for (const query of [{ kind: 'tasks',selection: { kind: 'search',text: 'Needlequartz',include: 'all' } },{ kind: 'flow' },{ kind: 'workload' }] as const) {
      const started = performance.now()
      const result = await app.board.read(permission,query)
      elapsed[query.kind] = Math.round(performance.now()-started)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(JSON.stringify(result))
      if (result.value.kind === 'tasks') expect(result.value.value.items.map(task => task.key)).toEqual(['DIG-100000'])
      if (result.value.kind === 'flow') {
        expect(result.value.value.oldest.items).toHaveLength(50)
        expect(result.value.value.oldest.next).toBeDefined()
        expect(result.value.value.medianCycleTimeMilliseconds).toBeNull()
      }
      if (result.value.kind === 'workload') {
        expect(result.value.value.members[0].activeTasks).toBe(10000)
        expect(result.value.value.members[0].tasks.items).toHaveLength(10)
      }
      expect(elapsed[query.kind]).toBeLessThan(1500)
    }
    const searchPlan = await db.query(`explain(analyze,buffers,format json) select id from team.tasks
      where space_id=$1 and to_tsvector('simple',title || ' ' || description) @@ to_tsquery('simple','needlequartz:*')`,[app.created.id])
    const plan = searchPlan.rows[0]['QUERY PLAN'][0].Plan
    expect(JSON.stringify(plan)).toContain('Bitmap Index Scan')
    expect(plan['Actual Rows']).toBe(1)
    expect(plan['Shared Hit Blocks']+plan['Shared Read Blocks']).toBeLessThan(1000)
    console.log('Slice 8 local 100k read milliseconds',elapsed)
  },30000)

  it('resolves only accessible Task references and conceals private and missing targets through HTTP',async () => {
    const app = await setup()
    await capture(app)
    const viewer = await invite(app,'viewer')
    await setup('PRIVATE')
    await change(app,{ kind: 'capture-task',input: { title: 'Private work' } },'PRIVATE')
    const { createTeamServer } = await import('../server.js')
    const { loadConfig } = await import('../config.js')
    const server = createTeamServer({ identity: app.identity,space: app.space,board: app.board },loadConfig({ ALLOWED_ORIGINS: origin }))
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
    const port = (server.address() as import('node:net').AddressInfo).port
    try {
      const query = { kind: 'references',keys: ['DIG-1','PRIVATE-1','MISSING-1','DIG-999'] }
      const response = await fetch(`http://127.0.0.1:${port}/api/spaces/DIG/board/views?query=${encodeURIComponent(JSON.stringify(query))}`,{
        headers: { cookie: `dig_session=${viewer.browserSession.sessionSecret}` },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ kind: 'references',value: [{ key: 'DIG-1',spaceKey: 'DIG' }] })
      const accessible = await fetch(`http://127.0.0.1:${port}/api/spaces/DIG/board/views?query=${encodeURIComponent(JSON.stringify(query))}`,{
        headers: { cookie: `dig_session=${app.browserSession.sessionSecret}` },
      })
      expect(await accessible.json()).toMatchObject({ kind: 'references',value: expect.arrayContaining([
        expect.objectContaining({ key: 'DIG-1' }),expect.objectContaining({ key: 'PRIVATE-1' }),
      ]) })
    } finally { server.closeIdleConnections();await new Promise<void>(resolve => server.close(() => resolve())) }
  })

})
