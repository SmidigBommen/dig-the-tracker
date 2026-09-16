import type { DbClient } from '../../db.js'
import type { inspectAuthenticatedIdentity } from '../private-capabilities.js'
import { SESSION_IDLE_MILLISECONDS } from '../session-policy.js'
export async function lockBrowserAccess(client: DbClient,claims: NonNullable<ReturnType<typeof inspectAuthenticatedIdentity>>): Promise<boolean> {
  const result=await client.query(`select id from team.browser_sessions where id=$1 and identity_id=$2 and revoked_at is null
    and absolute_expires_at>now() and last_active_at+$3*interval '1 millisecond'>now() for share`,[claims.sessionId,claims.identityId,SESSION_IDLE_MILLISECONDS])
  return result.rowCount===1
}
