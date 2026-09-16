import type { DbClient } from '../../db.js'
import type { AgentFault } from './agent-module.js'
import type { AuthenticatedAgent } from './agent-module.js'
import type { AgentGrant } from '../space/private-agent-access.js'
export interface AgentClaims { connectionId: string; identityId: string; revision: number }
const authenticated=new WeakMap<AuthenticatedAgent,AgentClaims>()
export function authenticateClaims(claims: AgentClaims): AuthenticatedAgent { const value=Object.freeze({}) as AuthenticatedAgent;authenticated.set(value,claims);return value }
export function inspectAgent(value: AuthenticatedAgent): AgentClaims | undefined { return authenticated.get(value) }
export class AgentRejected extends Error { constructor(readonly fault: AgentFault) { super(fault.kind) } }
export async function connectionGrants(client: DbClient,id: string): Promise<AgentGrant[]> {
  return (await client.query<AgentGrant>(`select space_id as "spaceId",member_id as "memberId",member_joined_at::text as "joinedAt",policy_revision as "policyRevision"
    from team.agent_space_grants where connection_id=$1 order by space_id`,[id])).rows
}
export async function lockAgentCredential(client: DbClient,claims: AgentClaims): Promise<boolean> {
  return (await client.query(`select id from team.agent_connections where id=$1 and identity_id=$2 and revision=$3
    and scope='tasks:read' and revoked_at is null and expires_at>now() for share`,[claims.connectionId,claims.identityId,claims.revision])).rowCount===1
}
