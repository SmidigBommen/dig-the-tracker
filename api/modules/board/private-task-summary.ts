import type { DbClient } from '../../db.js'
import type { TaskSummary, TagView } from '../../contracts/board.js'
import type { MemberId, TaskId, TaskKey, ColumnId, Revision } from '../shared.js'
import { currentOutcome, type FlowTask } from './private-flow.js'

export interface TaskRow extends FlowTask {
  started_at: Date | null
  column_entered_at: Date
  space_id: string
  rank: string
  archived_at: Date | null
  parent_task_id: string | null
  assignee_id: string | null
  id: string
  space_key: string
  number: string
  title: string
  description: string
  column_id: string
  revision: number
  created_at: Date
  updated_at: Date
}

export async function taskSummary(client: DbClient, task: TaskRow): Promise<TaskSummary> {
  const assignee = task.assignee_id ? await client.query<{ id: MemberId; displayName: string }>(
    `select member.id, identity.display_name as "displayName" from team.members member
     join team.identities identity on identity.id = member.identity_id where member.id = $1 and member.space_id = $2`,
    [task.assignee_id, task.space_id],
  ) : undefined
  const tags = await client.query<TagView>(
    `select tag.id, tag.name from team.task_tags link join team.tags tag on tag.id = link.tag_id and tag.space_id = link.space_id
     where link.space_id = $1 and link.task_id = $2 order by lower(tag.name), tag.id`, [task.space_id, task.id],
  )
  return { outcome: currentOutcome(task), closedAt: task.closed_at?.toISOString() as import('../shared.js').Instant ?? null, archived: Boolean(task.archived_at), parentTaskId: task.parent_task_id as TaskId | null, tags: tags.rows, id: task.id as TaskId, key: `${task.space_key}-${task.number}` as TaskKey,
    title: task.title, assignee: assignee?.rows[0] ?? null, columnId: task.column_id as ColumnId, revision: task.revision as Revision }
}
