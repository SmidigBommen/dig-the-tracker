import type { DbClient } from '../../db.js'
import type { AgentFault } from './agent-module.js'
import type { AuthenticatedAgent } from './agent-module.js'
import { recheckAgentGrant,agentMemberName } from '../space/private-agent-access.js'
import type { AgentGrant } from '../space/private-agent-access.js'
export interface AgentClaims { connectionId: string; identityId: string; revision: number;scope:'tasks:read'|'tasks:work';runId?:string;claimId?:string }
const authenticated=new WeakMap<AuthenticatedAgent,AgentClaims>()
export function authenticateClaims(claims: AgentClaims): AuthenticatedAgent { const value=Object.freeze({scope:claims.scope}) as AuthenticatedAgent;authenticated.set(value,claims);return value }
export function inspectAgent(value: AuthenticatedAgent): AgentClaims | undefined { return authenticated.get(value) }
export class AgentRejected extends Error { constructor(readonly fault: AgentFault) { super(fault.kind) } }
export async function connectionGrants(client: DbClient,id: string): Promise<AgentGrant[]> {
  return (await client.query<AgentGrant>(`select space_id as "spaceId",member_id as "memberId",member_joined_at::text as "joinedAt",policy_revision as "policyRevision"
    from team.agent_space_grants where connection_id=$1 order by space_id`,[id])).rows
}
export async function lockAgentCredential(client: DbClient,claims: AgentClaims): Promise<boolean> {
  return (await client.query(`select id from team.agent_connections where id=$1 and identity_id=$2 and revision=$3
    and scope=$4 and revoked_at is null and expires_at>now() for share`,[claims.connectionId,claims.identityId,claims.revision,claims.scope])).rowCount===1
}

export interface LiveRun { id:string;connectionId:string;connectionName:string;identityId:string;connectionRevision:number;connectionExpiresAt:Date;spaceId:string;memberId:string;joinedAt:string;policyRevision:number;spaceEpoch:number;memberName:string }
export async function readLiveRun(client:DbClient,runId:string,spaceId:string):Promise<LiveRun|undefined> {
  const row=(await client.query<LiveRun>(`select r.id,r.connection_id as "connectionId",c.name as "connectionName",c.identity_id as "identityId",c.expires_at as "connectionExpiresAt",
    r.connection_revision as "connectionRevision",r.space_id as "spaceId",r.member_id as "memberId",r.member_joined_at::text as "joinedAt",
    r.policy_revision as "policyRevision",r.space_epoch as "spaceEpoch" from team.agent_runs r join team.agent_connections c on c.id=r.connection_id
    where r.id::text=$1 and r.space_id=$2 and c.revision=r.connection_revision and c.scope='tasks:work' and c.revoked_at is null and c.expires_at>now()`,[runId,spaceId])).rows[0]
  if(!row || !await recheckAgentGrant(client,row.identityId,row))return undefined
  const memberName=await agentMemberName(client,row)
  return memberName===undefined ? undefined : {...row,memberName}
}
