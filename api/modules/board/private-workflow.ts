import type { DbClient } from '../../db.js'
import type { WorkflowPlan, WorkflowView, WorkflowColumnView } from '../../contracts/board.js'
import type { ColumnId, Revision } from '../shared.js'
import { BoardRejection } from './private-cursors.js'

interface ColumnRow {
  id: ColumnId; name: string; flow_role: WorkflowColumnView['flowRole']; is_intake: boolean; is_completion: boolean;
  wip_limit: number | null; position: number; revision: Revision; order_revision: Revision; archived_at: Date | null;
  previous_flow_role: 'queue' | 'active'; previous_wip_limit: number | null; task_count: number
}

async function rows(client: DbClient, spaceId: string) {
  return (await client.query<ColumnRow>(`select column_row.*, (
    select count(*)::int from team.tasks task where task.space_id = $1 and task.column_id = column_row.id and task.archived_at is null
  ) as task_count from team.board_columns column_row where column_row.space_id = $1 order by position`, [spaceId])).rows
}

export async function readWorkflow(client: DbClient, spaceId: string): Promise<WorkflowView> {
  const board = await client.query<{ workflow_revision: Revision }>('select workflow_revision from team.boards where space_id = $1', [spaceId])
  return { revision: board.rows[0].workflow_revision, columns: (await rows(client, spaceId)).map((row) => ({
    id: row.id, name: row.name, flowRole: row.flow_role, intake: row.is_intake, completion: row.is_completion,
    wipLimit: row.wip_limit, archived: Boolean(row.archived_at), position: row.position,
    revision: row.revision, orderRevision: row.order_revision, taskCount: row.task_count,
  })) }
}

function invalid(message: string): never { throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'workflow', message }] }) }

export async function setWorkflow(client: DbClient, spaceId: string, identityId: string, expectedRevision: Revision, desired: WorkflowPlan): Promise<WorkflowView> {
  const board = await client.query<{ id: string; workflow_revision: Revision }>('select id, workflow_revision from team.boards where space_id = $1', [spaceId])
  if (board.rows[0].workflow_revision !== expectedRevision) throw new BoardRejection({ kind: 'conflict', reason: 'stale-workflow' })
  if (!Array.isArray(desired?.columns) || desired.columns.length < 2 || desired.columns.length > 200) invalid('Use 2 to 200 Columns.')
  const columns = desired.columns
  for (const column of columns) {
    if (!column || typeof column.name !== 'string' || !column.name.trim() || [...column.name.trim()].length > 60
      || !['queue', 'active', 'complete'].includes(column.flowRole) || typeof column.intake !== 'boolean' || typeof column.completion !== 'boolean') invalid('Use a name of 1 to 60 characters and a valid flow role.')
    if (column.flowRole === 'active' && (!Number.isSafeInteger(column.wipLimit) || column.wipLimit! < 1 || column.wipLimit! > 2147483647)) {
      throw new BoardRejection({ kind: 'rule-violation', rule: 'active-wip-limit-required' })
    }
    if (column.flowRole !== 'active' && column.wipLimit !== null) invalid('Only Active Columns have a WIP limit.')
  }
  if (columns.filter((column) => column.intake).length !== 1 || columns.some((column) => column.intake && column.flowRole !== 'queue')) {
    throw new BoardRejection({ kind: 'rule-violation', rule: 'intake-required' })
  }
  if (columns.filter((column) => column.completion).length !== 1 || columns.filter((column) => column.flowRole === 'complete').length !== 1
    || columns.some((column) => column.completion !== (column.flowRole === 'complete'))) {
    throw new BoardRejection({ kind: 'rule-violation', rule: 'completion-required' })
  }
  const existing = await rows(client, spaceId)
  const ids = columns.flatMap((column) => column.id === undefined ? [] : [column.id])
  if (new Set(ids).size !== ids.length) invalid('Each Column may appear only once.')
  if (ids.some((id) => !existing.some((row) => row.id === id))) throw new BoardRejection({ kind: 'not-found' })
  if (existing.length + columns.filter((column) => !column.id).length > 200) invalid('A workflow can retain at most 200 Columns, including archived Columns.')
  for (const row of existing) {
    const next = columns.find((column) => column.id === row.id)
    if (row.task_count && (!next || next.flowRole !== row.flow_role || next.intake !== row.is_intake || next.completion !== row.is_completion)) {
      throw new BoardRejection({ kind: 'rule-violation', rule: 'column-not-empty' })
    }
    if (row.archived_at && next && (next.flowRole !== row.previous_flow_role || next.wipLimit !== row.previous_wip_limit || next.intake || next.completion)) {
      invalid('Restore an archived Column with its previous role and WIP limit before changing it.')
    }
  }
  // All checks precede writes; the Board lock serializes edits and Task movement.
  // Temporary negative positions and cleared flags make terminal replacement atomic.
  await client.query(`with positions as (select id, -1000000 - row_number() over (order by id)::int as position
    from team.board_columns where space_id = $1)
    update team.board_columns c set position = p.position, is_intake = false, is_completion = false
    from positions p where c.space_id = $1 and c.id = p.id`, [spaceId])
  for (const [position, column] of columns.entries()) {
    const old = existing.find((row) => row.id === column.id)
    const previousRole = column.flowRole === 'complete' ? old && old.flow_role !== 'complete' ? old.flow_role : old?.previous_flow_role ?? 'queue' : column.flowRole
    const previousLimit = column.flowRole === 'complete' ? old && old.flow_role !== 'complete' ? old.wip_limit : old?.previous_wip_limit ?? null : column.wipLimit
    const destinationChanged = old && (old.archived_at || old.flow_role !== column.flowRole || old.is_intake !== column.intake
      || old.is_completion !== column.completion || old.wip_limit !== column.wipLimit)
    if (old) await client.query(`update team.board_columns set name=$3, flow_role=$4, is_intake=$5, is_completion=$6, wip_limit=$7,
      position=$8, archived_at=null, revision=revision+1, previous_flow_role=$9, previous_wip_limit=$10,
      order_revision=order_revision+$11 where space_id=$1 and id=$2`,
    [spaceId, old.id, column.name.trim(), column.flowRole, column.intake, column.completion, column.wipLimit, position, previousRole, previousLimit, destinationChanged ? 1 : 0])
    else await client.query(`insert into team.board_columns (space_id,board_id,name,flow_role,is_intake,is_completion,wip_limit,position,previous_flow_role,previous_wip_limit)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [spaceId, board.rows[0].id, column.name.trim(), column.flowRole, column.intake, column.completion, column.wipLimit, position, previousRole, previousLimit])
  }
  const archived = existing.filter((row) => !ids.includes(row.id))
  for (const [index, row] of archived.entries()) await client.query(`update team.board_columns set position=$3,
    archived_at=coalesce(archived_at,now()), flow_role=case when flow_role='complete' then previous_flow_role else flow_role end,
    wip_limit=case when flow_role='complete' then previous_wip_limit else wip_limit end,
    previous_flow_role=case when flow_role='complete' then previous_flow_role else flow_role end,
    previous_wip_limit=case when flow_role='complete' then previous_wip_limit else wip_limit end,
    revision=revision + case when archived_at is null then 1 else 0 end,
    order_revision=order_revision + case when archived_at is null then 1 else 0 end where space_id=$1 and id=$2`, [spaceId,row.id,columns.length+index])
  await client.query('update team.boards set workflow_revision=workflow_revision+1 where space_id=$1', [spaceId])
  const workflow = await readWorkflow(client, spaceId)
  await client.query(`insert into team.space_audit(space_id,actor_identity_id,action,details,occurred_at)
    values($1,$2,'workflow-changed',$3,now())`, [spaceId, identityId, { revision: workflow.revision }])
  return workflow
}
