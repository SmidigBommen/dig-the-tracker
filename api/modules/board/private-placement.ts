import type { DbClient } from '../../db.js'
import type { TaskDestination } from '../../contracts/board.js'
import { BoardRejection } from './private-cursors.js'

export async function appendRank(client: DbClient, spaceId: string, taskId: string, columnId: string) {
  await client.query(`update team.tasks set rank = (
    select coalesce(max(rank), 0) + 1024 from team.tasks
    where space_id = $1 and column_id = $3 and archived_at is null and id <> $2
  ) where space_id = $1 and id = $2`, [spaceId, taskId, columnId])
}

export async function placeTask(client: DbClient, spaceId: string,
  task: { id: string; column_id: string; archived_at: Date | null }, destination: TaskDestination) {
  if (task.archived_at) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'task', message: 'Restore the Task before moving it.' }] })
  const columns = await client.query<{ order_revision: number }>(
    'select order_revision from team.board_columns where space_id = $1 and id::text = $2 and archived_at is null', [spaceId, destination.columnId])
  if (!columns.rows[0]) throw new BoardRejection({ kind: 'not-found' })
  if (columns.rows[0].order_revision !== destination.expectedOrderRevision) throw new BoardRejection({ kind: 'conflict', reason: 'stale-order' })
  const place = destination.place
  const anchored = place.kind === 'before' || place.kind === 'after'
  if (!anchored && place.kind !== 'first' && place.kind !== 'last') throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'place', message: 'Choose a relative position.' }] })
  const ahead = place.kind === 'first' || place.kind === 'before'
  let rank: bigint
  if (anchored) {
    if (place.taskId === task.id) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'place', message: 'Choose another Task as the anchor.' }] })
    const anchor = await client.query<{ rank: string; number: string }>(
      'select rank, number from team.tasks where space_id = $1 and column_id = $2 and id::text = $3 and archived_at is null',
      [spaceId, destination.columnId, place.taskId])
    if (!anchor.rows[0]) throw new BoardRejection({ kind: 'not-found' })
    const neighbor = await client.query<{ rank: string }>(`select rank from team.tasks
      where space_id = $1 and column_id = $2 and archived_at is null and id <> $3
        and (rank, number) ${ahead ? '<' : '>'} ($4::bigint, $5::bigint)
      order by rank ${ahead ? 'desc' : 'asc'}, number ${ahead ? 'desc' : 'asc'} limit 1`,
    [spaceId, destination.columnId, task.id, anchor.rows[0].rank, anchor.rows[0].number])
    const at = BigInt(anchor.rows[0].rank)
    const other = neighbor.rows[0] ? BigInt(neighbor.rows[0].rank) : at + (ahead ? -2048n : 2048n)
    rank = (at + other) / 2n
    if (rank === at || rank === other) {
      await client.query(`with ordered as (
        select id, row_number() over (order by rank, number) * 1024 as rank from team.tasks
        where space_id = $1 and column_id = $2 and archived_at is null
      ) update team.tasks task set rank = ordered.rank from ordered where task.id = ordered.id`, [spaceId, destination.columnId])
      return placeTask(client, spaceId, task, destination)
    }
  } else {
    const edge = await client.query<{ rank: string }>(`select coalesce(${ahead ? 'min' : 'max'}(rank), 0)::text as rank
      from team.tasks where space_id = $1 and column_id = $2 and archived_at is null and id <> $3`, [spaceId, destination.columnId, task.id])
    rank = BigInt(edge.rows[0].rank) + (ahead ? -1024n : 1024n)
  }
  await client.query(`update team.tasks set column_id = $3, rank = $4, revision = revision + 1, updated_at = now()
    where space_id = $1 and id = $2`, [spaceId, task.id, destination.columnId, rank.toString()])
  await client.query('update team.board_columns set order_revision = order_revision + 1 where space_id = $1 and id in ($2, $3)',
    [spaceId, task.column_id, destination.columnId])
}

export async function taskPlacement(client: DbClient, spaceId: string, taskId: string): Promise<import('../../contracts/board.js').TaskPlacement> {
  const current = await client.query<{ column_id: import('../shared.js').ColumnId; rank: string; number: string }>(
    'select column_id, rank, number from team.tasks where space_id = $1 and id = $2', [spaceId, taskId])
  const task = current.rows[0]
  const next = await client.query<{ id: import('../shared.js').TaskId }>(`select id from team.tasks where space_id = $1 and column_id = $2 and archived_at is null
    and (rank, number) > ($3::bigint, $4::bigint) order by rank, number limit 1`, [spaceId, task.column_id, task.rank, task.number])
  if (next.rows[0]) return { columnId: task.column_id, beforeTaskId: next.rows[0].id }
  const previous = await client.query<{ id: import('../shared.js').TaskId }>(`select id from team.tasks where space_id = $1 and column_id = $2 and archived_at is null
    and (rank, number) < ($3::bigint, $4::bigint) order by rank desc, number desc limit 1`, [spaceId, task.column_id, task.rank, task.number])
  return { columnId: task.column_id, ...(previous.rows[0] ? { afterTaskId: previous.rows[0].id } : {}) }
}
