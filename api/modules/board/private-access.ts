import type { DbClient } from '../../db.js'
import type { BoardFault, BoardOverview } from '../../contracts/board.js'
import type { inspectAuthorizedSpace } from '../private-capabilities.js'
import { SESSION_IDLE_MILLISECONDS } from '../session-policy.js'

export interface AccessSpaceRow {
  id: string
  space_key: string
  display_name: string
  time_zone: string
  lifecycle: BoardOverview['space']['lifecycle']
  revision: number
  access_revision: string | number
}

export async function recheckAccess(
  client: DbClient,
  claims: NonNullable<ReturnType<typeof inspectAuthorizedSpace>>,
): Promise<{ ok: true; space: AccessSpaceRow; role: 'member' | 'space-administrator' } | { ok: false; fault: BoardFault }> {
  const spaceResult = await client.query<AccessSpaceRow>(
    `select id, space_key, display_name, time_zone, lifecycle, revision, access_revision
     from team.spaces where id = $1 for share`,
    [claims.spaceId],
  )
  const space = spaceResult.rows[0]
  if (!space) return { ok: false, fault: { kind: 'not-found' } }
  const accessChanged = Number(space.access_revision) !== claims.accessRevision
  if (accessChanged && claims.use !== 'board-follow') return { ok: false, fault: { kind: 'forbidden' } }

  const member = await client.query<{ id: string; role: 'member' | 'space-administrator' }>(
    `select id, role from team.members
     where id = $1 and space_id = $2 and identity_id = $3 and ended_at is null
     for share`,
    [claims.memberId, claims.spaceId, claims.identityId],
  )
  if (!member.rows[0]) return { ok: false, fault: { kind: 'forbidden' } }

  const session = await client.query(
    `select id from team.browser_sessions
     where id = $1 and identity_id = $2 and revoked_at is null
       and absolute_expires_at > now()
       and last_active_at + $3 * interval '1 millisecond' > now()
     for share`,
    [claims.sessionId, claims.identityId, SESSION_IDLE_MILLISECONDS],
  )
  if (!session.rows[0]) return { ok: false, fault: { kind: 'forbidden' } }
  if (claims.use !== 'board-read' && space.lifecycle !== 'active') {
    return { ok: false, fault: { kind: 'read-only', reason: space.lifecycle === 'archived' ? 'space-archived' : 'deletion-scheduled' } }
  }
  if (accessChanged) {
    return { ok: false, fault: { kind: 'forbidden' } }
  }
  return { ok: true, space, role: member.rows[0].role }
}
