import type { DbClient } from '../../db.js'
import type { BoardCommandResult, BoardUpdate, BoardProjectionChange, BoardWarning, ChangeReceipt, ChangeRequest } from '../../contracts/board.js'
import type { ChangeSequence, Instant, Revision } from '../shared.js'

export async function commitChange(client: DbClient, spaceId: string, memberId: string,
  request: ChangeRequest, requestHash: string, result: BoardCommandResult,
  changes: BoardProjectionChange[], warnings: BoardWarning[] = []): Promise<ChangeReceipt> {
  const update = await appendUpdate(client, spaceId, changes, request.requestId)
  const receipt: ChangeReceipt = { result, warnings, update }
  await client.query(`insert into team.board_request_receipts (space_id, member_id, request_id, request_hash, response)
    values ($1,$2,$3,$4,$5)`, [spaceId, memberId, request.requestId, requestHash, receipt])
  return receipt
}

export async function appendUpdate(client: DbClient, spaceId: string, changes: BoardProjectionChange[], requestId?: ChangeRequest['requestId']): Promise<BoardUpdate> {
  const advanced = await client.query<{ sequence: string; occurred_at: Date }>(
    'update team.boards set change_sequence = change_sequence + 1 where space_id = $1 returning change_sequence as sequence, now() as occurred_at', [spaceId])
  const sequence = Number(advanced.rows[0].sequence)
  const update: BoardUpdate = { sequence: sequence as ChangeSequence, ...(requestId ? { requestId } : {}), occurredAt: advanced.rows[0].occurred_at.toISOString() as Instant,
    changes: [...changes, { kind: 'query-revisions-changed', revisions: { tasks: sequence as Revision, inbox: sequence as Revision } }] }
  await client.query('insert into team.board_updates (space_id, sequence, update) values ($1,$2,$3)', [spaceId, update.sequence, update])
  return update
}
