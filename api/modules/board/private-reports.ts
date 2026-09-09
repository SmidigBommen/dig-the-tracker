import type { DbClient } from '../../db.js'
import type { AgedTask, FlowColumn, FlowView, Page, ThroughputWeek } from '../../contracts/board.js'
import type { ColumnId, Instant, PageRequest } from '../shared.js'
import { BoardRejection, decodeCursor, encodeCursor, pageSize } from './private-cursors.js'
import { taskSummary, type TaskRow } from './private-task-summary.js'

async function agedPage(client: DbClient, spaceId: string, spaceKey: string, sequence: number, at: Date, page?: PageRequest, memberId?: string): Promise<Page<AgedTask>> {
  const size = pageSize(page?.size ?? (memberId ? 10 : 50))
  const scope = `${spaceId}:age:${memberId ?? 'all'}`
  const cursor = decodeCursor(page?.after,scope,sequence)
  const [entered,id] = cursor ? JSON.parse(cursor) as [string,string] : [null,null]
  const result = await client.query<TaskRow & { ordering: string }>(`select candidates.*, candidates.column_entered_at::text as ordering, $2::text as space_key from team.board_columns c
    cross join lateral (select t.* from team.tasks t where t.space_id=$1 and t.column_id=c.id and t.archived_at is null
      ${memberId ? 'and t.assignee_id=$6' : ''}
      and ($3::timestamptz is null or (t.column_entered_at,t.id) > ($3,$4::uuid))
      order by t.column_entered_at,t.id limit $5) candidates
    where c.space_id=$1 and c.archived_at is null and c.flow_role='active'
    order by candidates.column_entered_at,candidates.id limit $5`, [spaceId,spaceKey,entered,id,size+1,...(memberId ? [memberId] : [])])
  const rows = result.rows.slice(0,size)
  const items: AgedTask[] = []
  for (const row of rows) items.push({ ...await taskSummary(client,row), columnEnteredAt: row.column_entered_at.toISOString() as Instant,
    ageMilliseconds: Math.max(0,at.getTime()-row.column_entered_at.getTime()) })
  return { items, ...(result.rows.length > size ? { next: encodeCursor(scope,sequence,JSON.stringify([rows.at(-1)!.ordering,rows.at(-1)!.id])) } : {}) }
}

export async function readFlow(client: DbClient, spaceId: string, spaceKey: string, timeZone: string, sequence: number, page?: PageRequest, at = new Date()): Promise<FlowView> {
  const clock = (await client.query<{ at: Date; today: string; start: string }>(`select $2::timestamptz as at,
    ($2::timestamptz at time zone $1)::date::text as today, (($2::timestamptz at time zone $1)::date-29)::text as start`, [timeZone,at])).rows[0]
  const columns = (await client.query<FlowColumn>(`select c.id,c.name,c.archived_at is not null as archived,c.flow_role as "flowRole", c.wip_limit as "limit",
    (select count(*)::int from team.tasks t where t.space_id=$1 and t.column_id=c.id and t.archived_at is null) as tasks
    from team.board_columns c where c.space_id=$1 order by c.position`,[spaceId])).rows
  const cycle = (await client.query<{ median: number | null; count: number }>(`select percentile_cont(0.5) within group (
    order by extract(epoch from (date_trunc('milliseconds',closed_at)-date_trunc('milliseconds',started_at)))*1000)::double precision as median, count(*)::int as count
    from team.tasks where space_id=$1 and closed_at >= ($2::date::timestamp at time zone $3) and closed_at <= $4
      and started_at is not null`,[spaceId,clock.start,timeZone,clock.at])).rows[0]
  const throughput = (await client.query<ThroughputWeek>(`with weeks as (
    select generate_series(date_trunc('week',$2::timestamptz at time zone $3)-interval '11 weeks',
      date_trunc('week',$2::timestamptz at time zone $3),interval '1 week') as start
  ) select start::date::text as "startDate",
    count(*) filter(where e.details->'outcome'->>'kind'='completed')::int as completed,
    count(*) filter(where e.details->'outcome'->>'kind'='rejected')::int as rejected,
    count(*) filter(where e.details->'outcome'->>'kind'='cancelled')::int as cancelled,
    count(*) filter(where e.details->'outcome'->>'kind'='duplicate')::int as duplicate
    from weeks left join team.task_events e on e.space_id=$1 and e.kind='closed'
      and e.occurred_at >= (start at time zone $3) and e.occurred_at < ((start+interval '1 week') at time zone $3) and e.occurred_at <= $2
    group by start order by start`,[spaceId,clock.at,timeZone])).rows
  const history = await wipHistory(client,spaceId,timeZone,clock.start,clock.at,columns)
  return { generatedAt: clock.at.toISOString() as Instant,timeZone,startDate: clock.start,endDate: clock.today,columns,
    oldest: await agedPage(client,spaceId,spaceKey,sequence,clock.at,page),
    medianCycleTimeMilliseconds: cycle.median, cycleTimeSampleSize: cycle.count,throughput,history }
}

async function wipHistory(client: DbClient, spaceId: string, timeZone: string, start: string, at: Date, columns: FlowColumn[]): Promise<FlowView['history']> {
  const deltas = (await client.query<{ date: string; column_id: ColumnId; delta: number }>(`select (occurred_at at time zone $3)::date::text as date,
    column_id,sum(delta)::int as delta from team.board_wip_deltas where space_id=$1
      and occurred_at >= (($2::date+1)::timestamp at time zone $3) and occurred_at <= $4
    group by date,column_id`,[spaceId,start,timeZone,at])).rows
  const counts = new Map(columns.map((column) => [column.id,column.flowRole === 'active' && !column.archived ? column.tasks : 0]))
  const history: FlowView['history'] = []
  for (let offset=29;offset>=0;offset--) {
    const date = new Date(Date.parse(`${start}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10)
    history.unshift({ date,columns: columns.map((column) => ({ columnId: column.id,tasks: counts.get(column.id)! })) })
    for (const delta of deltas) if (delta.date === date) counts.set(delta.column_id,(counts.get(delta.column_id) ?? 0)-delta.delta)
  }
  return history
}

export async function readWorkload(client: DbClient, spaceId: string, spaceKey: string, sequence: number,
  memberId?: import('../shared.js').MemberId, page?: PageRequest): Promise<import('../../contracts/board.js').WorkloadView> {
  const at = (await client.query<{ at: Date }>('select now() as at')).rows[0].at
  if (page?.after && !memberId) throw new BoardRejection({ kind: 'invalid',issues: [{ field: 'memberId',message: 'Choose a Member to continue their Task page.' }] })
  const members = (await client.query<import('../../contracts/board.js').BoardMemberView>(`select m.id,i.display_name as "displayName",m.role
    from team.members m join team.identities i on i.id=m.identity_id where m.space_id=$1 and m.ended_at is null
      and ($2::text is null or m.id::text=$2) order by lower(i.display_name),m.id`,[spaceId,memberId ?? null])).rows
  if (memberId && !members.length) throw new BoardRejection({ kind: 'not-found' })
  const counts = (await client.query<{ assignee_id: string | null; count: number }>(`select t.assignee_id,count(*)::int as count
    from team.board_columns c join team.tasks t on t.space_id=c.space_id and t.column_id=c.id
    where c.space_id=$1 and c.flow_role='active' and c.archived_at is null and t.archived_at is null group by t.assignee_id`,[spaceId])).rows
  const rows: import('../../contracts/board.js').WorkloadView['members'] = []
  for (const member of members) rows.push({ member,activeTasks: counts.find((count) => count.assignee_id === member.id)?.count ?? 0,
    tasks: await agedPage(client,spaceId,spaceKey,sequence,at,page,member.id) })
  return { generatedAt: at.toISOString() as Instant,members: rows,unassignedActiveTasks: counts.find((count) => count.assignee_id === null)?.count ?? 0 }
}
