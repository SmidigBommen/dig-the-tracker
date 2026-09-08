import type { DbClient } from '../../db.js'
import type { Page, TaskHistoryEntry } from '../../contracts/board.js'
import type { Instant, MemberId, PageRequest } from '../shared.js'
import { decodeCursor, encodeCursor, pageSize } from './private-cursors.js'

interface EventRow {
  id: string
  kind: string
  occurred_at: Date
  actor_member_id: MemberId
  display_name: string
  details: Partial<TaskHistoryEntry>
}

function entry(row: EventRow): TaskHistoryEntry {
  const summaries: Record<string, string> = {
    'capture-task': 'Created Task', 'revise-task': 'Edited Task', 'archive-task': 'Archived Task',
    'restore-task': 'Restored Task', 'assignee-cleared': 'Unassigned Task after membership ended',
    'column-transition': 'Moved Task', 'place-task': 'Reordered Task', closed: 'Closed Task',
    reopened: 'Reopened Task', 'outcome-changed': 'Changed Outcome',
  }
  return { id: row.id, kind: row.kind, occurredAt: row.occurred_at.toISOString() as Instant,
    summary: summaries[row.kind] ?? row.kind, actor: { id: row.actor_member_id, displayName: row.display_name },
    ...(row.details.fromColumn ? { fromColumn: row.details.fromColumn } : {}),
    ...(row.details.toColumn ? { toColumn: row.details.toColumn } : {}),
    ...(row.details.outcome ? { outcome: row.details.outcome } : {}),
    ...(row.details.previousOutcome ? { previousOutcome: row.details.previousOutcome } : {}),
    ...(row.details.comment ? { comment: row.details.comment } : {}) }
}

const eventQuery = `select event.id::text, event.kind, event.occurred_at, event.actor_member_id, event.details, identity.display_name
  from team.task_events event join team.members member on member.space_id = event.space_id and member.id = event.actor_member_id
  join team.identities identity on identity.id = member.identity_id`

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
