import type { DbClient } from '../../db.js'
import type { Closure, Outcome, TaskHistoryEntry } from '../../contracts/board.js'
import { BoardRejection } from './private-cursors.js'
import { recordEvent } from './private-history.js'

export interface FlowTask {
  id: string
  column_id: string
  closed_at: Date | null
  outcome: Outcome['kind'] | null
  duplicate_task_id: string | null
  archived_at: Date | null
}

export function currentOutcome(task: Pick<FlowTask, 'outcome' | 'duplicate_task_id'>): Outcome | null {
  return task.outcome === 'duplicate' ? { kind: 'duplicate', taskId: task.duplicate_task_id as Extract<Outcome, { kind: 'duplicate' }>['taskId'] }
    : task.outcome ? { kind: task.outcome } : null
}

export async function validateOutcome(client: DbClient, spaceId: string, taskId: string, outcome: Outcome) {
  if (!outcome || !['completed', 'rejected', 'cancelled', 'duplicate'].includes(outcome.kind)) {
    throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'outcome', message: 'Choose a closure Outcome.' }] })
  }
  if (outcome.kind === 'duplicate') {
    if (outcome.taskId === taskId) throw new BoardRejection({ kind: 'rule-violation', rule: 'duplicate-target-invalid' })
    const target = await client.query('select id from team.tasks where space_id = $1 and id::text = $2', [spaceId, outcome.taskId])
    if (!target.rows[0]) throw new BoardRejection({ kind: 'not-found' })
  }
}

export async function transitionTask(client: DbClient, spaceId: string, actorId: string, task: FlowTask,
  columnId: string, closure?: Closure): Promise<TaskHistoryEntry[]> {
  const columns = await client.query<NonNullable<TaskHistoryEntry['toColumn']>>(
    'select id, name, flow_role as "flowRole" from team.board_columns where space_id = $1 and id in ($2, $3)', [spaceId, task.column_id, columnId])
  const fromColumn = columns.rows.find((column) => column.id === task.column_id)!
  const toColumn = columns.rows.find((column) => column.id === columnId)!
  if (closure && toColumn.flowRole !== 'complete') throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'closure', message: 'Only a Complete Column accepts a closure.' }] })
  if (closure?.comment !== undefined && (typeof closure.comment !== 'string' || [...closure.comment].length > 5000)) {
    throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'comment', message: 'Use at most 5,000 characters.' }] })
  }
  if (task.column_id === columnId) {
    if (closure) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'closure', message: 'Use Change Outcome for a Closed Task.' }] })
    return [await recordEvent(client, spaceId, task.id, actorId, 'place-task', {})]
  }
  const closing = toColumn.flowRole === 'complete'
  const outcome = closing ? closure?.outcome ?? { kind: 'completed' as const } : null
  if (outcome) await validateOutcome(client, spaceId, task.id, outcome)
  if (closure?.comment && outcome?.kind !== 'rejected' && outcome?.kind !== 'cancelled') throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'comment', message: 'Closing comments accompany Rejected or Cancelled.' }] })
  await client.query(`update team.tasks set column_entered_at = now(),
    started_at = case when $3 = 'active' then coalesce(started_at, now()) else started_at end,
    closed_at = case when $3 = 'complete' then now() else null end, outcome = $4, duplicate_task_id = $5
    where space_id = $1 and id = $2`, [spaceId, task.id, toColumn.flowRole, outcome?.kind ?? null, outcome?.kind === 'duplicate' ? outcome.taskId : null])
  const events = [await recordEvent(client, spaceId, task.id, actorId, 'column-transition', { fromColumn, toColumn })]
  if (closing) events.push(await recordEvent(client, spaceId, task.id, actorId, 'closed', { outcome: outcome!, comment: closure?.comment }))
  else if (task.closed_at) events.push(await recordEvent(client, spaceId, task.id, actorId, 'reopened', { previousOutcome: currentOutcome(task)! }))
  return events
}

export async function changeOutcome(client: DbClient, spaceId: string, actorId: string, task: FlowTask, outcome: Outcome) {
  if (!task.closed_at || task.archived_at) throw new BoardRejection({ kind: 'rule-violation', rule: 'closure-required' })
  await validateOutcome(client, spaceId, task.id, outcome)
  await client.query(`update team.tasks set outcome = $3, duplicate_task_id = $4, revision = revision + 1, updated_at = now()
    where space_id = $1 and id = $2`, [spaceId, task.id, outcome.kind, outcome.kind === 'duplicate' ? outcome.taskId : null])
  return recordEvent(client, spaceId, task.id, actorId, 'outcome-changed', { outcome, previousOutcome: currentOutcome(task)! })
}
