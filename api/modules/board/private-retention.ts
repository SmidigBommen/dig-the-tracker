import { inTransaction, type Database } from '../../db.js'
import { appendUpdate } from './private-receipts.js'
import type { TaskId } from '../shared.js'

export async function archiveDueTasks(db: Database, now: Date): Promise<number> {
  const spaces = await db.query<{ id: string }>(`select s.id from team.spaces s where lifecycle='active' and exists (
    select 1 from team.tasks t where t.space_id=s.id and t.archived_at is null and t.closed_at is not null
      and (greatest(t.closed_at,t.restored_at) at time zone s.time_zone)::date + 30 <= ($1::timestamptz at time zone s.time_zone)::date
  ) order by s.id limit 20`, [now])
  let count = 0
  for (const space of spaces.rows) count += await inTransaction(db, async (client) => {
    const active = await client.query<{ time_zone: string }>("select time_zone from team.spaces where id=$1 and lifecycle='active' for share", [space.id])
    if (!active.rows[0]) return 0
    await client.query('select id from team.boards where space_id=$1 for update', [space.id])
    const archived = await client.query<{ count: number; ids: TaskId[] }>(`with due as materialized (
      select id from team.tasks where space_id=$1 and archived_at is null and closed_at is not null
        and (greatest(closed_at,restored_at) at time zone $3)::date + 30 <= ($2::timestamptz at time zone $3)::date
      order by number limit 100
    ), changed as (
      update team.tasks t set archived_at=$2, revision=revision+1,updated_at=$2
      where t.space_id=$1 and t.archived_at is null and (t.id in (select id from due) or t.parent_task_id in (select id from due))
      returning id,column_id
    ), orders as (
      update team.board_columns set order_revision=order_revision+1 where space_id=$1 and id in (select column_id from changed)
    ), events as (
      insert into team.task_events(space_id,task_id,actor_member_id,kind,details,occurred_at)
      select $1,id,null,'auto-archive-task','{}'::jsonb,$2 from changed
    ) select (select count(*)::int from changed) as count, array(select id from changed limit 201) as ids`, [space.id, now, active.rows[0].time_zone])
    const result = archived.rows[0]
    if (result.count) await appendUpdate(client, space.id, result.ids.length <= 200 ? [{ kind: 'tasks-archived', taskIds: result.ids }] : [])
    return result.count
  })
  return count
}
