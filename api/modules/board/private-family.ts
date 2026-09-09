import type { DbClient } from '../../db.js'

export async function restoreFamily(client: DbClient, spaceId: string, taskId: string, actorId: string) {
  // Keep large families in SQL; the receipt invalidates bounded browser pages.
  await client.query(`with family as materialized (
      select task.id, task.number, task.column_id as previous_column_id, destination.id as destination_id
      from team.tasks task join team.board_columns destination on destination.space_id = task.space_id
        and destination.archived_at is null and case when task.closed_at is null then destination.is_intake else destination.is_completion end
      where task.space_id = $1 and (task.id = $2 or task.parent_task_id = $2) and task.archived_at is not null
    ), ranked as (
      select family.*, row_number() over (partition by destination_id order by number) * 1024 + (
        select coalesce(max(rank), 0) from team.tasks where space_id = $1 and column_id = destination_id and archived_at is null
      ) as destination_rank from family
    ), changed as (
      update team.tasks task set archived_at = null, restored_at = now(), column_id = ranked.destination_id, rank = ranked.destination_rank,
        column_entered_at = now(), revision = revision + 1, updated_at = now()
      from ranked where task.space_id = $1 and task.id = ranked.id returning task.id, ranked.previous_column_id, task.column_id
    ), restored_events as (
      insert into team.task_events (space_id, task_id, actor_member_id, kind, details)
      select $1, id, $3, 'restore-task', '{}'::jsonb from changed
    ) insert into team.task_events (space_id, task_id, actor_member_id, kind, details)
      select $1, changed.id, $3, 'column-transition', jsonb_build_object(
        'fromColumn', jsonb_build_object('id', source.id, 'name', source.name, 'flowRole', source.flow_role),
        'toColumn', jsonb_build_object('id', destination.id, 'name', destination.name, 'flowRole', destination.flow_role))
      from changed join team.board_columns source on source.space_id = $1 and source.id = changed.previous_column_id
      join team.board_columns destination on destination.space_id = $1 and destination.id = changed.column_id`, [spaceId, taskId, actorId])
}
