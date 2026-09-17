import type { DbClient } from '../../db.js'
import type { AgentSpaceOption } from '../../contracts/agents.js'

export interface AgentGrant {
  spaceId: string; memberId: string; joinedAt: string; policyRevision: number
}
interface AgentSpaceRow { id: string; key: string; displayName: string; enabled: boolean; revision: number; lifecycle: string; accessRevision: number; workEpoch:number; memberId: string; joinedAt: string; role: string }
const projection=`s.id,s.space_key as key,s.display_name as "displayName",s.agent_access_enabled as enabled,
  s.agent_access_revision as revision,s.lifecycle,s.access_revision::int as "accessRevision",
  s.agent_work_epoch as "workEpoch",m.id as "memberId",m.joined_at::text as "joinedAt",m.role`
export async function eligibleAgentSpaces(client: DbClient,identityId: string): Promise<AgentSpaceOption[]> {
  return (await client.query<AgentSpaceOption>(`select s.id,s.space_key as key,s.display_name as "displayName",s.agent_access_enabled as enabled,s.agent_access_revision as revision
    from team.spaces s join team.members m on m.space_id=s.id where m.identity_id=$1 and m.ended_at is null
    and s.lifecycle='active' and s.agent_access_enabled order by s.space_key limit 200`,[identityId])).rows
}
export async function lockAgentSpace(client: DbClient,identityId: string,key: string,changing=false): Promise<AgentSpaceRow | undefined> {
  // Space first, then Member, then the caller locks its browser session or agent connection.
  const space=await client.query(`select id from team.spaces where space_key=$1 for ${changing ? 'update' : 'share'}`,[key])
  if(!space.rowCount)return undefined
  return (await client.query<AgentSpaceRow>(`select ${projection} from team.spaces s join team.members m on m.space_id=s.id
    where s.id=$1 and m.identity_id=$2 and m.ended_at is null for share of m`,[space.rows[0].id,identityId])).rows[0]
}
export async function lockGrantSpaces(client: DbClient,identityId: string,ids: string[]): Promise<AgentGrant[] | undefined> {
  await client.query('select id from team.spaces where id=any($1::uuid[]) order by id for share',[ids])
  const rows=(await client.query<AgentSpaceRow>(`select ${projection} from team.spaces s join team.members m on m.space_id=s.id
    where s.id=any($1::uuid[]) and m.identity_id=$2 and m.ended_at is null order by s.id for share of m`,[ids,identityId])).rows
  if(rows.length!==ids.length || rows.some(r=>!r.enabled || r.lifecycle!=='active'))return undefined
  return rows.map(r=>({ spaceId:r.id,memberId:r.memberId,joinedAt:r.joinedAt,policyRevision:r.revision }))
}
export async function changeAgentPolicy(client: DbClient,id: string,enabled: boolean): Promise<AgentSpaceOption> {
  return (await client.query<AgentSpaceOption>(`update team.spaces set agent_access_enabled=$2,agent_access_revision=agent_access_revision+1
    where id=$1 returning id,space_key as key,display_name as "displayName",agent_access_enabled as enabled,agent_access_revision as revision`,[id,enabled])).rows[0]
}
export async function describeAgentGrants(client: DbClient,identityId: string,grants: AgentGrant[]) {
  if(!grants.length)return []
  const rows=(await client.query<AgentSpaceRow>(`select ${projection} from team.spaces s join team.members m on m.space_id=s.id
    where s.id=any($1::uuid[]) and m.identity_id=$2 and m.ended_at is null`,[grants.map(g=>g.spaceId),identityId])).rows
  return grants.map(grant=>{
    const row=rows.find(r=>r.id===grant.spaceId && r.memberId===grant.memberId && r.joinedAt===grant.joinedAt)
    return { id:grant.spaceId,key:row?.key ?? '',displayName:row?.displayName ?? 'Unavailable Space',available:Boolean(row?.enabled && row.lifecycle==='active' && row.revision===grant.policyRevision) }
  })
}

export async function recheckAgentGrant(client: DbClient,identityId: string,grant: AgentGrant): Promise<boolean> {
  const row=(await client.query(`select s.id from team.spaces s join team.members m on m.space_id=s.id
    where s.id=$1 and s.agent_access_enabled and s.lifecycle='active' and s.agent_access_revision=$2
      and m.id=$3 and m.identity_id=$4 and m.ended_at is null and m.joined_at=$5`,
    [grant.spaceId,grant.policyRevision,grant.memberId,identityId,grant.joinedAt])).rows[0]
  return Boolean(row)
}

export async function agentMemberName(client:DbClient,run:{spaceId:string;memberId:string;spaceEpoch:number}):Promise<string|undefined> {
  return (await client.query<{name:string}>(`select i.display_name as name from team.spaces s join team.members m on m.space_id=s.id
    join team.identities i on i.id=m.identity_id where s.id=$1 and m.id=$2 and s.agent_work_epoch=$3 and m.ended_at is null`,[run.spaceId,run.memberId,run.spaceEpoch])).rows[0]?.name
}

export async function lockAgentGrantSpaces(client:DbClient,ids:string[]):Promise<void> {
  await client.query('select id from team.spaces where id=any($1::uuid[]) order by id for share',[ids])
}
