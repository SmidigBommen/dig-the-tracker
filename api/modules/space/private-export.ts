import type { Database, DbClient } from '../../db.js'
import { isDatabaseError, type Result } from '../shared.js'
import type { inspectAuthorizedSpace } from '../private-capabilities.js'
import type { SpaceFault } from './space-module.js'
import { SESSION_IDLE_MILLISECONDS } from '../session-policy.js'
import { ExportIds, ExportStopped, exportArray, exportRows } from '../private-export.js'
import { exportBoard } from '../board/private-export.js'

import type { SpaceExport, ExportChunk } from '../export/export-module.js'

export async function readSpaceExport(db: Database, claims: NonNullable<ReturnType<typeof inspectAuthorizedSpace>>,
  signal?: AbortSignal): Promise<Result<SpaceExport,SpaceFault>> {
  let client: DbClient
  try { client = await db.connect() }
  catch { return { ok: false,fault: { kind: 'temporarily-unavailable' } } }
  let released = false
  const release = () => { if (!released) { released = true;client.release(true) } }
  client.on('error',release)
  const deadline = setTimeout(release,120_000)
  deadline.unref()
  signal?.addEventListener('abort',release,{ once: true })
  const cleanup = () => { clearTimeout(deadline);signal?.removeEventListener('abort',release);release() }
  try {
    if (signal?.aborted) throw new Error('Export cancelled')
    await client.query('begin isolation level repeatable read')
    await client.query("set local statement_timeout='30s'")
    await client.query("set local idle_in_transaction_session_timeout='30s'")
    const space = (await client.query(`select id,space_key as key,display_name as "displayName",time_zone as "timeZone",
      lifecycle,access_revision as "accessRevision",created_at as "createdAt",archived_at as "archivedAt",deletion_scheduled_for as "deletionScheduledFor"
      from team.spaces where id=$1`,[claims.spaceId])).rows[0]
    if (!space) { cleanup();return { ok: false,fault: { kind: 'not-found' } } }
    if (Number(space.accessRevision) !== claims.accessRevision) { cleanup();return { ok: false,fault: { kind: 'forbidden' } } }
    delete space.accessRevision
    const member = (await client.query(`select role from team.members where space_id=$1 and identity_id=$2 and ended_at is null`,[space.id,claims.identityId])).rows[0]
    if (!member) { cleanup();return { ok: false,fault: { kind: 'not-found' } } }
    if (member.role !== 'space-administrator') { cleanup();return { ok: false,fault: { kind: 'forbidden' } } }
    const session = await client.query(`select id from team.browser_sessions where id=$1 and identity_id=$2 and revoked_at is null
      and absolute_expires_at>now() and last_active_at+$3*interval '1 millisecond'>now()`,[claims.sessionId,claims.identityId,SESSION_IDLE_MILLISECONDS])
    if (!session.rowCount) { cleanup();return { ok: false,fault: { kind: 'not-authenticated' } } }
    // Recheck outside the consistent snapshot before every batch. No long-held
    // session lock blocks activity or revocation while a download is in flight.
    const check = async () => {
      if (released) throw new ExportStopped('temporarily-unavailable')
      const current = await db.query(`select 1 from team.spaces s join team.members m on m.space_id=s.id
        join team.browser_sessions b on b.identity_id=m.identity_id where s.id=$1 and s.access_revision=$2
        and m.id=$3 and m.identity_id=$4 and m.role='space-administrator' and m.ended_at is null
        and b.id=$5 and b.revoked_at is null and b.absolute_expires_at>now()
        and b.last_active_at+$6*interval '1 millisecond'>now()`,[claims.spaceId,claims.accessRevision,claims.memberId,claims.identityId,claims.sessionId,SESSION_IDLE_MILLISECONDS])
      if (!current.rowCount) throw new ExportStopped('forbidden')
    }
    const ids = new ExportIds()
    const spaceId = space.id as string
    const generatedAt = new Date().toISOString()
    space.id = ids.ref('space',spaceId)
    async function* chunks() {
      try {
        yield JSON.stringify({ format: 'dig-space',schemaVersion: 1,generatedAt,space }).slice(0,-1)
        yield* exportArray('members',exportRows(client,`select m.id,i.display_name as "displayName",m.role,m.joined_at as "joinedAt",m.ended_at as "endedAt"
          from team.members m join team.identities i on i.id=m.identity_id where m.space_id=$1 order by m.joined_at,m.id`,spaceId,check),ids,{ id: 'member' })
        yield* exportBoard(client,spaceId,ids,check)
        yield* exportArray('invitations',exportRows(client,`select v.id,v.issued_by_member_id as "issuedBy",v.issued_at as "issuedAt",v.expires_at as "expiresAt",
          v.revoked_at as "revokedAt",v.accepted_at as "acceptedAt",i.display_name as "acceptedByDisplayName"
          from team.space_invitations v left join team.identities i on i.id=v.accepted_by_identity_id where v.space_id=$1 order by v.issued_at,v.id`,spaceId,check),ids,{ id: 'invitation',issuedBy: 'member' })
        yield* exportArray('audit',exportRows(client,`select a.id,a.action,i.display_name as "actorDisplayName",a.subject_member_id as "subjectMemberId",
          a.invitation_id as "invitationId",a.occurred_at as "occurredAt",a.details from team.space_audit a join team.identities i on i.id=a.actor_identity_id
          where a.space_id=$1 order by a.ordering_key`,spaceId,check),ids,{ id: 'audit',subjectMemberId: 'member',invitationId: 'invitation' },row => {
            const details = row.details as Record<string,unknown>
            return { ...row,details: row.action === 'workflow-changed' ? { revision: details.revision } : row.action === 'comment-moderated'
              ? { taskId: ids.ref('task',details.taskId),commentId: ids.ref('comment',details.commentId) } : {} }
          })
        await client.query('commit')
        yield '}'
      } finally { cleanup() }
    }
    async function* checked(): AsyncGenerator<ExportChunk> {
      try { for await (const text of chunks()) { if (released) throw new ExportStopped('temporarily-unavailable');yield { kind: 'data',text } } }
      catch (error) { yield { kind: 'failed',fault: { kind: error instanceof ExportStopped ? error.kind : 'temporarily-unavailable' } } }
      finally { cleanup() }
    }
    return { ok: true,value: { filename: `${space.key}-${generatedAt.slice(0,10)}.json`,chunks: checked() } }
  } catch (error) {
    const cancelled = released || signal?.aborted
    cleanup()
    if (isDatabaseError(error) || cancelled) return { ok: false,fault: { kind: 'temporarily-unavailable' } }
    throw error
  }
}
