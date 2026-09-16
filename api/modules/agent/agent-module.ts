import type { BoardQuery,BoardView,BoardOverview } from '../../contracts/board.js'
import { createHash,randomBytes } from 'node:crypto'
import type { Database,DbClient } from '../../db.js'
import type { AuthenticatedIdentity } from '../identity/identity-module.js'
import { inspectAuthenticatedIdentity,makeAuthorizedSpace } from '../private-capabilities.js'
import { lockBrowserAccess } from '../identity/private-browser-access.js'
import { lockAgentSpace,lockGrantSpaces,eligibleAgentSpaces,changeAgentPolicy,describeAgentGrants,recheckAgentGrant } from '../space/private-agent-access.js'
import { AgentRejected,authenticateClaims,connectionGrants,inspectAgent,lockAgentCredential } from './private-access.js'
import type { AgentManagementRequest,AgentManagementView,AgentConnectionView } from '../../contracts/agents.js'
import type { BoardModule } from '../board/board-module.js'
import { isDatabaseError,type Result,type SpaceId,type MemberId,type IdentityId,type AccessRevision,type TaskKey,type PageRequest } from '../shared.js'
export type AgentFault = { kind: 'not-authenticated' | 'forbidden' | 'not-found' | 'invalid' | 'conflict' | 'cursor-expired' | 'rate-limited' | 'temporarily-unavailable'; message?: string; retryAfterSeconds?:number }
declare const agentBrand: unique symbol
export interface AuthenticatedAgent { readonly [agentBrand]: true }
export type AgentRead =
  | { kind:'spaces' }
  | { kind:'space';spaceKey:string }
  | { kind:'search';spaceKey:string;text:string;include?:'open'|'closed'|'archived'|'all';page?:PageRequest }
  | { kind:'task';key:string;comments?:PageRequest;history?:PageRequest;subtasks?:PageRequest }
  | { kind:'tags';spaceKey:string;text?:string;page?:PageRequest }
  | { kind:'workflow';spaceKey:string }
export type AgentReadView = Exclude<BoardView,{kind:'overview'}> | {kind:'overview';sequence:number;value:Omit<BoardOverview,'unreadNotifications'>} | { kind:'spaces';spaces:Array<{ id:string;key:string;displayName:string }> }
export interface AgentModule {
  read(agent:AuthenticatedAgent,query:AgentRead):Promise<Result<AgentReadView,AgentFault>>
  manage(identity: AuthenticatedIdentity,request: AgentManagementRequest): Promise<Result<AgentManagementView,AgentFault>>
  authenticate(token: string): Promise<Result<AuthenticatedAgent,AgentFault>>
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash=(token: string)=>createHash('sha256').update(token).digest('hex')
const connectionFields=`id,name,scope,created_at as "createdAt",expires_at as "expiresAt",last_used_at as "lastUsedAt",revoked_at as "revokedAt",revision`
type ConnectionRow=Omit<AgentConnectionView,'spaces'|'createdAt'|'expiresAt'|'lastUsedAt'|'revokedAt'> & { createdAt: Date; expiresAt: Date; lastUsedAt: Date|null; revokedAt: Date|null }
function reject(kind: AgentFault['kind'],message?: string): never { throw new AgentRejected({ kind,...(message ? { message } : {}) }) }
export class AgentModuleImplementation implements AgentModule {
  private readonly budgets=new Map<string,{ count:number;until:number }>()
  private consumeBudget(connectionId:string,identityId:string):number {
    const now=Date.now()
    for(const [key,budget] of this.budgets)if(budget.until<=now)this.budgets.delete(key)
    if(this.budgets.size>=10_000)return 60
    let retry=0
    for(const [key,limit] of [[`connection:${connectionId}`,60],[`identity:${identityId}`,120]] as const) {
      const budget=this.budgets.get(key) ?? { count:0,until:now+60_000 }
      budget.count++;this.budgets.set(key,budget)
      if(budget.count>limit)retry=Math.max(retry,Math.ceil((budget.until-now)/1000))
    }
    return retry
  }
  constructor(private readonly db: Database,private readonly board: BoardModule,private readonly config: { now?: () => Date } = {}) {}
  private async transaction<T>(work: (client: DbClient)=>Promise<T>): Promise<Result<T,AgentFault>> {
    let client: DbClient
    try { client=await this.db.connect() } catch { return { ok:false,fault:{ kind:'temporarily-unavailable' } } }
    try {
      await client.query('begin')
      await client.query("set local statement_timeout='5s'")
      await client.query("set local lock_timeout='3s'")
      const value=await work(client)
      await client.query('commit')
      return { ok:true,value }
    } catch(error) {
      await client.query('rollback').catch(()=>undefined)
      if(error instanceof AgentRejected)return { ok:false,fault:error.fault }
      if(isDatabaseError(error))return { ok:false,fault:{ kind:'temporarily-unavailable' } }
      throw error
    } finally { client.release() }
  }
  private async view(client: DbClient,row: ConnectionRow,identityId: string): Promise<AgentConnectionView> {
    return { ...row,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),lastUsedAt:row.lastUsedAt?.toISOString() ?? null,
      revokedAt:row.revokedAt?.toISOString() ?? null,spaces:await describeAgentGrants(client,identityId,await connectionGrants(client,row.id)) }
  }
  async manage(identity: AuthenticatedIdentity,request: AgentManagementRequest): Promise<Result<AgentManagementView,AgentFault>> {
    const claims=inspectAuthenticatedIdentity(identity)
    if(!claims)return { ok:false,fault:{ kind:'not-authenticated' } }
    return this.transaction(async client=>{
      if(!request || typeof request.kind!=='string')reject('invalid')
      if(request.kind==='space-settings' || request.kind==='set-space-access') {
        if(typeof request.spaceKey!=='string' || !/^[A-Z][A-Z0-9]{1,9}$/.test(request.spaceKey))reject('invalid')
        const space=await lockAgentSpace(client,claims.identityId,request.spaceKey,request.kind==='set-space-access')
        if(!space)reject('not-found')
        if(space.role!=='space-administrator')reject('forbidden')
        if(!await lockBrowserAccess(client,claims))reject('not-authenticated')
        if(request.kind==='set-space-access') {
          if(typeof request.enabled!=='boolean' || !Number.isSafeInteger(request.expectedRevision))reject('invalid')
          if(space.lifecycle!=='active')reject('forbidden','Restore this Space before changing agent access.')
          if(space.revision!==request.expectedRevision)reject('conflict','Agent settings changed. Reload and try again.')
          const next=space.enabled===request.enabled ? space : await changeAgentPolicy(client,space.id,request.enabled)
          return { kind:'space-settings',space:{ id:next.id,key:next.key,displayName:next.displayName,enabled:next.enabled,revision:next.revision } }
        }
        return { kind:'space-settings',space:{ id:space.id,key:space.key,displayName:space.displayName,enabled:space.enabled,revision:space.revision } }
      }
      let grants: Awaited<ReturnType<typeof lockGrantSpaces>>
      if(request.kind==='create') {
        if(!uuid.test(request.id) || typeof request.name!=='string' || !request.name.trim() || [...request.name.trim()].length>80
          || !Array.isArray(request.spaceIds) || request.spaceIds.length<1 || request.spaceIds.length>20 || request.spaceIds.some(id=>typeof id!=='string' || !uuid.test(id))
          || new Set(request.spaceIds).size!==request.spaceIds.length)reject('invalid','Choose a name and 1 to 20 enabled Spaces.')
        grants=await lockGrantSpaces(client,claims.identityId,request.spaceIds)
        if(!grants)reject('forbidden','Choose Spaces where an administrator has enabled agent access.')
      }
      if(!await lockBrowserAccess(client,claims))reject('not-authenticated')
      if(request.kind==='list') {
        const rows=(await client.query<ConnectionRow>(`select ${connectionFields} from team.agent_connections where identity_id=$1
          order by (revoked_at is null and expires_at>now()) desc,created_at desc,id limit 101`,[claims.identityId])).rows
        return { kind:'connections',connections:await Promise.all(rows.slice(0,100).map(row=>this.view(client,row,claims.identityId))),eligibleSpaces:await eligibleAgentSpaces(client,claims.identityId),truncated:rows.length>100 }
      }
      // Serialize connection management for one identity, without taking another
      // Space/Member lock after the session lock.
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`agent-connections:${claims.identityId}`])
      if(request.kind==='create') {
        const exists=await client.query('select id from team.agent_connections where id=$1',[request.id])
        if(exists.rowCount)reject('conflict','This connection was already created. Replace its token if the original response was lost.')
        const count=await client.query("select count(*)::int as count from team.agent_connections where identity_id=$1 and revoked_at is null and expires_at>now()",[claims.identityId])
        if(count.rows[0].count>=20)reject('invalid','Revoke an unused connection before creating another. The limit is 20 active connections.')
        const token=`dig_agent_${randomBytes(32).toString('base64url')}`
        const now=this.config.now?.() ?? new Date(),expires=new Date(now.getTime()+30*24*60*60*1000)
        const row=(await client.query<ConnectionRow>(`insert into team.agent_connections(id,identity_id,name,secret_hash,created_at,expires_at)
          values($1,$2,$3,$4,$5,$6) returning ${connectionFields}`,[request.id,claims.identityId,request.name.trim(),hash(token),now,expires])).rows[0]
        for(const grant of grants!)await client.query(`insert into team.agent_space_grants(connection_id,space_id,member_id,member_joined_at,policy_revision)
          values($1,$2,$3,$4,$5)`,[row.id,grant.spaceId,grant.memberId,grant.joinedAt,grant.policyRevision])
        return { kind:'issued',connection:await this.view(client,row,claims.identityId),token }
      }
      if(request.kind!=='revoke' && request.kind!=='replace-token')reject('invalid')
      if(typeof request.id!=='string' || !uuid.test(request.id))reject('invalid')
      const row=(await client.query<ConnectionRow>(`select ${connectionFields} from team.agent_connections where id=$1 and identity_id=$2 for update`,[request.id,claims.identityId])).rows[0]
      if(!row)reject('not-found')
      if(request.kind==='revoke') {
        await client.query('update team.agent_connections set revoked_at=coalesce(revoked_at,now()),revision=revision+1 where id=$1',[row.id])
        return { kind:'revoked' }
      }
      if(!Number.isSafeInteger(request.expectedRevision) || row.revision!==request.expectedRevision)reject('conflict','The token changed. Reload before replacing it.')
      if(row.revokedAt)reject('forbidden','Create a new connection after revocation.')
      const token=`dig_agent_${randomBytes(32).toString('base64url')}`
      const expires=new Date((this.config.now?.() ?? new Date()).getTime()+30*24*60*60*1000)
      const next=(await client.query<ConnectionRow>(`update team.agent_connections set secret_hash=$2,expires_at=$3,revision=revision+1
        where id=$1 returning ${connectionFields}`,[row.id,hash(token),expires])).rows[0]
      return { kind:'issued',connection:await this.view(client,next,claims.identityId),token }
    })
  }
  async read(agent:AuthenticatedAgent,query:AgentRead):Promise<Result<AgentReadView,AgentFault>> {
    const claims=inspectAgent(agent)
    if(!claims)return { ok:false,fault:{ kind:'not-authenticated' } }
    if(!query || !['spaces','space','search','task','tags','workflow'].includes(query.kind))return { ok:false,fault:{ kind:'invalid' } }
    if(query.kind==='spaces')return this.transaction(async client=>{
      // Grants are immutable. Lock all their Spaces before locking the credential.
      const grants=await connectionGrants(client,claims.connectionId)
      const candidates=await describeAgentGrants(client,claims.identityId,grants)
      const spaces=[]
      for(const candidate of candidates) {
        if(!candidate.key)continue
        const space=await lockAgentSpace(client,claims.identityId,candidate.key)
        const grant=grants.find(g=>g.spaceId===space?.id)
        if(space && grant && await recheckAgentGrant(client,claims.identityId,grant))spaces.push({ id:space.id,key:space.key,displayName:space.displayName })
      }
      if(!await lockAgentCredential(client,claims))reject('not-authenticated')
      return { kind:'spaces' as const,spaces }
    })
    const key=query.kind==='task' ? query.key?.match(/^([A-Z][A-Z0-9]{1,9})-[1-9][0-9]*$/)?.[1] : query.spaceKey
    if(typeof key!=='string' || !/^[A-Z][A-Z0-9]{1,9}$/.test(key))return { ok:false,fault:{ kind:'invalid' } }
    const access=await this.transaction(async client=>{
      const space=await lockAgentSpace(client,claims.identityId,key)
      if(!space)reject('not-found')
      if(!await lockAgentCredential(client,claims))reject('not-authenticated')
      const grant=(await connectionGrants(client,claims.connectionId)).find(g=>g.spaceId===space.id)
      if(!grant || !await recheckAgentGrant(client,claims.identityId,grant))reject('forbidden')
      return makeAuthorizedSpace<'board-read'>({ agent:claims,identityId:claims.identityId as IdentityId,spaceId:space.id as SpaceId,
        memberId:space.memberId as MemberId,accessRevision:space.accessRevision as AccessRevision,use:'board-read' })
    })
    if(!access.ok)return access
    const page=(value:PageRequest|undefined):PageRequest=>({ ...value,size:Math.min(50,Math.max(1,value?.size ?? 10)) })
    const boardQuery:BoardQuery=query.kind==='space' ? { kind:'overview',firstPageSize:1 }
      : query.kind==='search' ? { kind:'tasks',selection:{ kind:'search',text:query.text,include:query.include },page:page(query.page) }
      : query.kind==='task' ? { kind:'task',task:{ kind:'key',taskKey:query.key as TaskKey },comments:page(query.comments),history:page(query.history),subtasks:page(query.subtasks) }
      : query.kind==='tags' ? { kind:'tags',text:query.text,page:page(query.page) } : { kind:'workflow' }
    const result=await this.board.read(access.value,boardQuery)
    if(!result.ok)return { ok:false,fault:{ kind:['invalid','not-found','forbidden','cursor-expired'].includes(result.fault.kind) ? result.fault.kind as AgentFault['kind'] : 'temporarily-unavailable' } }
    if(result.value.kind==='overview') {
      const value={ ...result.value.value } as Omit<BoardOverview,'unreadNotifications'> & {unreadNotifications?:number}
      delete value.unreadNotifications
      return { ok:true,value:{ ...result.value,value } }
    }
    if(result.value.kind==='task') {
      const value={ ...result.value }
      delete value.unreadNotifications
      return { ok:true,value }
    }
    return result
  }
  async authenticate(token: string): Promise<Result<AuthenticatedAgent,AgentFault>> {
    if(typeof token!=='string' || !/^dig_agent_[A-Za-z0-9_-]{43}$/.test(token))return { ok:false,fault:{ kind:'not-authenticated' } }
    return this.transaction(async client=>{
      const row=(await client.query<{ id: string; identity_id: string; revision: number }>(`update team.agent_connections set last_used_at=$2
        where secret_hash=$1 and revoked_at is null and expires_at>$2 and scope='tasks:read' returning id,identity_id,revision`,[hash(token),this.config.now?.() ?? new Date()])).rows[0]
      if(!row)reject('not-authenticated')
      const retryAfterSeconds=this.consumeBudget(row.id,row.identity_id)
      if(retryAfterSeconds)throw new AgentRejected({ kind:'rate-limited',retryAfterSeconds })
      return authenticateClaims({ connectionId:row.id,identityId:row.identity_id,revision:row.revision })
    })
  }
}
