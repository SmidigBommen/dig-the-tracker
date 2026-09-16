import type { DbClient } from '../../db.js'
import { exportArray, exportRows, type ExportIds, type ExportRow } from '../private-export.js'

// Called inside SpaceModule's authorized, repeatable-read export transaction.
export async function* exportBoard(client: DbClient, spaceId: string, ids: ExportIds, check: () => Promise<void>): AsyncGenerator<string> {
  const board = (await client.query('select workflow_revision as "workflowRevision",created_at as "createdAt" from team.boards where space_id=$1',[spaceId])).rows[0]
  yield `,"board":${JSON.stringify({ id: 'board-1',...board })}`
  yield* exportArray('columns',exportRows(client,`select id,name,flow_role as "flowRole",is_intake as intake,
    is_completion as completion,wip_limit as "wipLimit",position,archived_at as "archivedAt",revision
    from team.board_columns where space_id=$1 order by position,id`,spaceId,check),ids,{ id: 'column' })
  yield* exportArray('tags',exportRows(client,'select id,name from team.tags where space_id=$1 order by lower(name),id',spaceId,check),ids,{ id: 'tag' })
  yield* exportArray('tasks',exportRows(client,`select id,number::float8 as number,title,description,column_id as "columnId",
    row_number() over(partition by column_id order by rank,number)::int as position,
    parent_task_id as "parentTaskId",assignee_id as "assigneeId",created_by_member_id as "createdBy",revision,
    created_at as "createdAt",updated_at as "updatedAt",archived_at as "archivedAt",restored_at as "restoredAt",
    started_at as "startedAt",column_entered_at as "columnEnteredAt",closed_at as "closedAt",outcome,duplicate_task_id as "duplicateTaskId"
    from team.tasks where space_id=$1 order by number`,spaceId,check),ids,
    { id: 'task',columnId: 'column',parentTaskId: 'task',assigneeId: 'member',createdBy: 'member',duplicateTaskId: 'task' })
  yield* exportArray('taskTags',exportRows(client,`select task_id as "taskId",tag_id as "tagId" from team.task_tags where space_id=$1 order by task_id,tag_id`,spaceId,check),ids,{ taskId: 'task',tagId: 'tag' })
  yield* exportArray('comments',exportRows(client,`select id,task_id as "taskId",author_member_id as "authorId",text,revision,
    created_at as "createdAt",edited_at as "editedAt",removed_at as "removedAt",removed_by_member_id as "removedBy",
    origin_event_id::text as "originEventId" from team.task_comments where space_id=$1 order by ordering_key`,spaceId,check),ids,
    { id: 'comment',taskId: 'task',authorId: 'member',removedBy: 'member',originEventId: 'event' })
  yield* exportArray('mentions',exportRows(client,`select comment_id as "commentId",member_id as "memberId" from team.comment_mentions where space_id=$1 order by comment_id,member_id`,spaceId,check),ids,{ commentId: 'comment',memberId: 'member' })
  yield* exportArray('history',exportRows(client,`select id::text,task_id as "taskId",actor_member_id as "actorId",kind,occurred_at as "occurredAt",details
    from team.task_events where space_id=$1 order by id`,spaceId,check),ids,{ id: 'event',taskId: 'task',actorId: 'member' },row => ({ ...row,details: historyDetails(row.kind,row.details,ids) }))
}

function historyDetails(kind: unknown, value: unknown, ids: ExportIds): ExportRow {
  const details = value as ExportRow
  const result: ExportRow = {}
  // Keep known event fields only. Old closing-comment text is represented by the
  // current revision/tombstone in comments, never resurrected from event JSON.
  for (const key of ['fromColumn','toColumn']) if (details[key]) {
    const column = details[key] as ExportRow
    result[key] = { id: ids.ref('column',column.id),name: column.name,flowRole: column.flowRole }
  }
  for (const key of ['outcome','previousOutcome']) if (details[key]) {
    const outcome = details[key] as ExportRow
    result[key] = { kind: outcome.kind,...(outcome.kind === 'duplicate' ? { taskId: ids.ref('task',outcome.taskId) } : {}) }
  }
  if (kind === 'assignee-cleared') result.formerMemberId = ids.ref('member',details.formerMemberId)
  const changes = (kind === 'capture-task' ? details.input : kind === 'revise-task' ? details.changes : undefined) as ExportRow | undefined
  if (changes) {
    const fields: ExportRow = {}
    for (const key of ['title','description','tags']) if (changes[key] !== undefined) fields[key] = changes[key]
    for (const [key,type] of [['assigneeId','member'],['parentTaskId','task']]) if (changes[key] !== undefined) fields[key] = ids.ref(type,changes[key])
    result.changes = fields
  }
  return result
}
