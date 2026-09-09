import type { DbClient } from '../../db.js'
import type { BoardUpdate } from '../../contracts/board.js'
import type { ChangeSequence, Instant, MemberId, Revision, SpaceId } from '../shared.js'
import { retainRecentUpdates } from './private-receipts.js'

// Called only while SpaceModule holds the Space lock in its membership transaction.
export async function unassignEndedMember(client: DbClient, spaceId: SpaceId, memberId: MemberId, actorMemberId: MemberId, now: Date) {
  await client.query('select id from team.boards where space_id = $1 for update', [spaceId])
  await client.query(
    `with changed as (
       update team.tasks set assignee_id = null, revision = revision + 1, updated_at = $3
       where space_id = $1 and assignee_id = $2 and closed_at is null returning id
     ) insert into team.task_events (space_id, task_id, actor_member_id, kind, details, occurred_at)
       select $1, id, $4, 'assignee-cleared', jsonb_build_object('formerMemberId', $2::text), $3 from changed`,
    [spaceId, memberId, now, actorMemberId],
  )
  const revised = await client.query<{ change_sequence: string }>(
    `update team.boards set change_sequence = change_sequence + 1 where space_id = $1 returning change_sequence`, [spaceId],
  )
  const sequence = Number(revised.rows[0].change_sequence) as ChangeSequence
  const update: BoardUpdate = { sequence, occurredAt: now.toISOString() as Instant, changes: [
    { kind: 'membership-ended', memberId },
    { kind: 'query-revisions-changed', revisions: { tasks: sequence as number as Revision, inbox: 1 as Revision } },
  ] }
  await client.query('insert into team.board_updates (space_id, sequence, update, occurred_at) values ($1,$2,$3,$4)',
    [spaceId, sequence, update, now])
  await retainRecentUpdates(client, spaceId, sequence)
}
