import type { DbClient } from '../../db.js'
import type { Page, TaskHistoryEntry } from '../../contracts/board.js'
import type { Instant, MemberId, PageRequest } from '../shared.js'
import { decodeCursor, encodeCursor, pageSize } from './private-cursors.js'

interface EventRow {
  id: string
  kind: string
  occurred_at: Date
  actor_member_id: MemberId | null
  display_name: string
  details: Partial<TaskHistoryEntry>
  closing_comment_id: string | null
  closing_comment_text: string | null
  closing_comment_removed_at: Date | null
}

function entry(row: EventRow): TaskHistoryEntry {
  const summaries: Record<string, string> = {
    'comment-added': 'Added comment', 'comment-edited': 'Edited comment', 'comment-removed': 'Removed comment', 'comment-moderated': 'Removed comment as administrator',
    'capture-task': 'Created Task', 'revise-task': 'Edited Task', 'archive-task': 'Archived Task',
    'auto-archive-task': 'Automatically archived Task', 'restore-task': 'Restored Task', 'assignee-cleared': 'Unassigned Task after membership ended',
    'column-transition': 'Moved Task', 'place-task': 'Reordered Task', closed: 'Closed Task',
    reopened: 'Reopened Task', 'outcome-changed': 'Changed Outcome',
  }
  return { id: row.id, kind: row.kind, occurredAt: row.occurred_at.toISOString() as Instant,
    summary: summaries[row.kind] ?? row.kind, actor: { id: row.actor_member_id, displayName: row.display_name },
    ...(row.details.fromColumn ? { fromColumn: row.details.fromColumn } : {}),
    ...(row.details.toColumn ? { toColumn: row.details.toColumn } : {}),
    ...(row.details.outcome ? { outcome: row.details.outcome } : {}),
    ...(row.details.previousOutcome ? { previousOutcome: row.details.previousOutcome } : {}),
    ...(row.closing_comment_id ? (row.closing_comment_removed_at ? {} : { comment: row.closing_comment_text! }) : row.details.comment ? { comment: row.details.comment } : {}) }
}

const eventQuery = `select event.id::text, event.kind, event.occurred_at, event.actor_member_id, event.details, coalesce(identity.display_name,'Dig') as display_name, closing.id as closing_comment_id, closing.text as closing_comment_text, closing.removed_at as closing_comment_removed_at
  from team.task_events event left join team.members member on member.space_id = event.space_id and member.id = event.actor_member_id
  left join team.identities identity on identity.id = member.identity_id
  left join team.task_comments closing on closing.space_id = event.space_id and closing.origin_event_id = event.id`

export async function historyPage(client: DbClient, spaceId: string, taskId: string, sequence: number, page: PageRequest): Promise<Page<TaskHistoryEntry>> {
  const size = pageSize(page.size)
  const scope = `${spaceId}:history:${taskId}`
  const last = decodeCursor(page.after, scope, sequence)
  const result = await client.query<EventRow>(`${eventQuery} where event.space_id = $1 and event.task_id = $2
    ${last ? 'and event.id < $4::bigint' : ''} order by event.id desc limit $3`, [spaceId, taskId, size + 1, ...(last ? [last] : [])])
  const rows = result.rows.slice(0, size)
  return { items: rows.map(entry), ...(result.rows.length > size ? { next: encodeCursor(scope, sequence, rows.at(-1)!.id) } : {}) }
}

export async function recordEvent(client: DbClient, spaceId: string, taskId: string, actorId: string, kind: string,
  details: Partial<TaskHistoryEntry>): Promise<TaskHistoryEntry> {
  const result = await client.query<{ id: string }>(`insert into team.task_events (space_id, task_id, actor_member_id, kind, details)
    values ($1,$2,$3,$4,$5) returning id::text`, [spaceId, taskId, actorId, kind, details])
  const row = await client.query<EventRow>(`${eventQuery} where event.id = $1`, [result.rows[0].id])
  return entry(row.rows[0])
}
