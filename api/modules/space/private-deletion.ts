import { inTransaction, type Database } from '../../db.js'

export async function deleteDueSpaces(db: Database, now: Date, installationAdministrators: ReadonlySet<string>): Promise<number> {
  let deleted = 0
  for (let index = 0; index < 20; index++) {
    const changed = await inTransaction(db, async (client) => {
      const due = await client.query<{ id: string; space_key: string }>(`select id,space_key from team.spaces
        where lifecycle='deletion_scheduled' and deletion_scheduled_for <= $1
        order by deletion_scheduled_for,id limit 1 for update skip locked`, [now])
      const space = due.rows[0]
      if (!space) return false
      const members = await client.query<{ identity_id: string }>('select identity_id from team.members where space_id=$1 order by id for update', [space.id])
      const identities = members.rows.map((member) => member.identity_id)
      const identitiesWithProvider = await client.query<{ id: string; oidc_issuer: string; oidc_subject: string }>(
        'select id,oidc_issuer,oidc_subject from team.identities where id=any($1::uuid[])', [identities])
      const revocable = identitiesWithProvider.rows.filter((identity) => !installationAdministrators.has(`${identity.oidc_issuer}|${identity.oidc_subject}`)).map((identity) => identity.id)
      await client.query('select id from team.browser_sessions where identity_id=any($1::uuid[]) order by id for update', [identities])
      await client.query('select id from team.boards where space_id=$1 for update', [space.id])
      // Only the non-personal key reservation survives. Scoped receipts cascade too.
      await client.query('update team.space_key_reservations set reserved_by_identity_id=null where space_key=$1', [space.space_key])
      await client.query('delete from team.spaces where id=$1', [space.id])
      // Installation administrators retain installation access; other identities with no remaining Spaces lose sessions.
      await client.query(`update team.browser_sessions session set revoked_at=coalesce(revoked_at,$2)
        where identity_id=any($1::uuid[]) and not exists (
          select 1 from team.members member where member.identity_id=session.identity_id and member.ended_at is null
        )`, [revocable, now])
      return true
    })
    if (!changed) break
    deleted++
  }
  return deleted
}
