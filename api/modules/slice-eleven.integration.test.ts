import { mkdtemp,copyFile,readdir,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from '../migrate.js'
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createTeamServer } from '../server.js'
import { loadConfig } from '../config.js'
import { SpaceExportModuleImplementation } from './export/export-module.js'
import type { AddressInfo } from 'node:net'
// @vitest-environment node
import { beforeEach,afterEach,describe,it,expect } from 'vitest'
import { createHash,randomUUID } from 'node:crypto'
import { createDatabase,type Database } from '../db.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { SpaceModuleImplementation } from './space/space-module.js'
import { BoardModuleImplementation } from './board/board-module.js'
import { AgentModuleImplementation } from './agent/agent-module.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import type { Result,RequestId,SpaceKey,TaskKey } from './shared.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database
function value<T,F>(result: Result<T,F>): T { if (!result.ok) throw new Error(JSON.stringify(result.fault));return result.value }
run('Slice 11 agent connections',() => {
  beforeEach(async () => { db=createDatabase(process.env.DATABASE_URL!);await db.query('truncate team.identities,team.space_key_reservations cascade') })
  afterEach(async () => { await db.end() })
  async function signIn(subject='admin') {
    const identity=new IdentityModuleImplementation(db,new MockOidcAdapter({ issuer: 'https://identity.example.test',subject,displayName: subject }),{
      redirectUri: origin+'/api/auth/callback',allowedOrigins: new Set([origin]),installationAdministrators: new Set(['https://identity.example.test|admin']),sessionHmacSecret: 'test-session-secret-with-more-than-32-bytes',
    })
    const begun=value(await identity.signIn({ kind: 'begin' }))
    if(begun.kind!=='redirect')throw Error('Expected redirect')
    const signed=value(await identity.signIn({ kind: 'complete',attemptSecret: begun.attemptSecret,callback: { code: 'accepted-code',state: new URL(begun.authorizationUrl).searchParams.get('state')! } }))
    if(signed.kind!=='established')throw Error('Expected session')
    const resolved=value(await identity.session({ kind: 'resolve',use: 'read',evidence: { sessionSecret: signed.session.sessionSecret } }))
    if(resolved.kind!=='resolved')throw Error('Expected identity')
    const space=new SpaceModuleImplementation(db,{ invitationHmacSecret: 'test-session-secret-with-more-than-32-bytes',sessionHmacSecret: 'test-session-secret-with-more-than-32-bytes' })
    const board=new BoardModuleImplementation(db)
    return { identity,space,board,agents: new AgentModuleImplementation(db,board),who: resolved.identity,session: signed.session }
  }
  async function setup() {
    const app=await signIn()
    const created=value(await app.space.change(app.who,{ requestId: randomUUID() as RequestId,command: { kind: 'create-space',input: { key: 'DIG',displayName: 'Agent test',timeZone: 'Europe/Oslo' } } }))
    if(created.result.kind!=='space-created')throw Error('Expected Space')
    return { ...app,spaceId: created.result.space.id }
  }
  async function invite(app:Awaited<ReturnType<typeof setup>>,subject='member') {
    const invitation=value(await app.space.change(app.who,{ requestId:randomUUID() as RequestId,command:{ kind:'issue-invitation',space:{kind:'key',spaceKey:'DIG' as SpaceKey} } }))
    if(invitation.result.kind!=='invitation-issued')throw Error('Expected invitation')
    const member=await signIn(subject)
    const accepted=value(await member.space.change(member.who,{requestId:randomUUID() as RequestId,command:{kind:'accept-invitation',invitationSecret:invitation.result.invitationSecret}}))
    if(accepted.session.kind!=='replace')throw Error('Expected replacement')
    const session=value(await member.identity.session({kind:'resolve',use:'read',evidence:{sessionSecret:accepted.session.sessionSecret}}))
    if(session.kind!=='resolved')throw Error('Expected session')
    return {...member,who:session.identity}
  }
  it('creates a scoped read token only after administrator enablement, and revokes it immediately',async () => {
    const app=await setup()
    const id=randomUUID()
    const create={ kind: 'create' as const,id,name: 'Codex on my Mac',spaceIds: [app.spaceId] }
    expect(await app.agents.manage(app.who,create)).toMatchObject({ ok: false,fault: { kind: 'forbidden' } })
    const settings=value(await app.agents.manage(app.who,{ kind: 'space-settings',spaceKey: 'DIG' }))
    if(settings.kind!=='space-settings')throw Error('Expected settings')
    expect(settings.space.enabled).toBe(false)
    value(await app.agents.manage(app.who,{ kind: 'set-space-access',spaceKey: 'DIG',enabled: true,expectedRevision: settings.space.revision }))
    const issued=value(await app.agents.manage(app.who,create))
    if(issued.kind!=='issued')throw Error('Expected token')
    expect(issued.token).toMatch(/^dig_agent_[A-Za-z0-9_-]{43}$/)
    expect(issued.connection.scope).toBe('tasks:read')
    expect(Date.parse(issued.connection.expiresAt)-Date.parse(issued.connection.createdAt)).toBe(30*24*60*60*1000)
    expect((await app.agents.authenticate(issued.token)).ok).toBe(true)
    const listed=value(await app.agents.manage(app.who,{ kind: 'list' }))
    expect(JSON.stringify(listed)).not.toContain(issued.token)
    expect(await app.agents.manage(app.who,create)).toMatchObject({ ok: false,fault: { kind: 'conflict' } })
    value(await app.agents.manage(app.who,{ kind: 'revoke',id }))
    expect(await app.agents.authenticate(issued.token)).toMatchObject({ ok: false,fault: { kind: 'not-authenticated' } })
  })
  it('rechecks read capabilities after token replacement and Space policy changes',async () => {
    const app=await setup()
    value(await app.agents.manage(app.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1 }))
    const issued=value(await app.agents.manage(app.who,{ kind:'create',id:randomUUID(),name:'Codex',spaceIds:[app.spaceId] }))
    if(issued.kind!=='issued')throw Error('Expected token')
    const principal=value(await app.agents.authenticate(issued.token))
    expect(value(await app.agents.read(principal,{ kind:'spaces' }))).toMatchObject({ kind:'spaces',spaces:[{ key:'DIG' }] })
    expect(value(await app.agents.read(principal,{ kind:'space',spaceKey:'DIG' }))).toMatchObject({ kind:'overview',value:{ space:{ key:'DIG' } } })
    expect(JSON.stringify(value(await app.agents.read(principal,{ kind:'space',spaceKey:'DIG' })))).not.toContain('unreadNotifications')
    expect(await app.agents.read(principal,{ kind:'space',spaceKey:'OTHER' })).toMatchObject({ ok:false,fault:{ kind:'not-found' } })
    value(await app.agents.manage(app.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:false,expectedRevision:2 }))
    expect(await app.agents.read(principal,{ kind:'space',spaceKey:'DIG' })).toMatchObject({ ok:false,fault:{ kind:'forbidden' } })
    value(await app.agents.manage(app.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:3 }))
    expect(value(await app.agents.read(principal,{ kind:'spaces' }))).toMatchObject({ spaces:[] })
    value(await app.agents.manage(app.who,{ kind:'replace-token',id:issued.connection.id,expectedRevision:1 }))
    expect(await app.agents.read(principal,{ kind:'spaces' })).toMatchObject({ ok:false,fault:{ kind:'not-authenticated' } })
  })

  it.each(['auto','legacy'] as const)('serves read-only MCP tools to an independent %s client and authenticates every request',async mode => {
    const app=await setup()
    value(await app.agents.manage(app.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1 }))
    const issued=value(await app.agents.manage(app.who,{ kind:'create',id:randomUUID(),name:'Client',spaceIds:[app.spaceId] }))
    if(issued.kind!=='issued')throw Error('Expected token')
    const server=createTeamServer({ ...app,exports:new SpaceExportModuleImplementation(db) },loadConfig({ ALLOWED_ORIGINS:origin }))
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const url=new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)
    const client=new Client({ name:'dig-integration',version:'1' },{ versionNegotiation:{ mode } })
    try {
      expect((await fetch(url,{ method:'POST',headers:{ cookie:`dig_session=${app.session.sessionSecret}` },body:'{}' })).status).toBe(401)
      const initialize=await fetch(url,{ method:'POST',headers:{authorization:`Bearer ${issued.token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{elicitation:{form:{},url:{}}},clientInfo:{name:'codex-mcp-client',title:'Codex',version:'0.154.0'}}}) })
      expect(await initialize.text()).not.toContain('error')
      expect(initialize.status).toBe(200)
      await client.connect(new StreamableHTTPClientTransport(url,{ authProvider:{ token:async()=>issued.token } }))
      const listed=await client.listTools()
      expect(listed.tools.map(t=>t.name)).toEqual(['dig_list_spaces','dig_get_space','dig_search_tasks','dig_get_task','dig_list_tags','dig_get_workflow'])
      expect(listed.tools.every(t=>t.annotations?.readOnlyHint===true)).toBe(true)
      const result=await client.callTool({ name:'dig_get_space',arguments:{ spaceKey:'DIG' } })
      expect(result.structuredContent).toMatchObject({ ok:true,value:{ kind:'overview',value:{ space:{ key:'DIG' } } } })
      expect(JSON.stringify(result)).not.toContain('unreadNotifications')
      value(await app.agents.manage(app.who,{ kind:'revoke',id:issued.connection.id }))
      await expect(client.callTool({ name:'dig_list_spaces',arguments:{} })).rejects.toThrow()
    } finally { await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve())) }
  })

  it('reads current Task discussion with cursor pages without consuming the human inbox',async()=>{
    const app=await setup()
    const space={ kind:'key' as const,spaceKey:'DIG' as SpaceKey }
    const access=value(await app.space.authorize(app.who,{ use:'board-change',space }))
    for(const title of ['First task','Second task','Third task'])value(await app.board.change(access,{ requestId:randomUUID() as RequestId,command:{ kind:'capture-task',input:{ title,tags:['MCP'] } } }))
    value(await app.agents.manage(app.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1 }))
    const issued=value(await app.agents.manage(app.who,{ kind:'create',id:randomUUID(),name:'Reader',spaceIds:[app.spaceId] }))
    if(issued.kind!=='issued')throw Error('Expected token')
    const agent=value(await app.agents.authenticate(issued.token))
    const member=await invite(app)
    const memberAccess=value(await member.space.authorize(member.who,{use:'board-change',space}))
    const read=value(await app.space.authorize(app.who,{use:'board-read',space}))
    const overview=value(await app.board.read(read,{kind:'overview'}))
    if(overview.kind!=='overview')throw Error('Expected Board')
    const target=value(await app.board.read(read,{kind:'task',task:{kind:'key',taskKey:'DIG-1' as TaskKey}}))
    if(target.kind!=='task')throw Error('Expected Task')
    value(await member.board.change(memberAccess,{requestId:randomUUID() as RequestId,command:{kind:'add-comment',taskId:target.value.id,text:'Please review this context',mentions:[overview.value.currentMemberId]}}))
    const before=value(await app.board.read(read,{ kind:'inbox' }))
    expect(before).toMatchObject({kind:'inbox',unreadNotifications:1})
    const task=value(await app.agents.read(agent,{ kind:'task',key:'DIG-1' }))
    expect(task).toMatchObject({ kind:'task',value:{ key:'DIG-1',title:'First task',tags:[{ name:'MCP' }],comments:{ items:[{text:'Please review this context'}] } } })
    const first=value(await app.agents.read(agent,{ kind:'search',spaceKey:'DIG',text:'task',page:{ size:1 } }))
    if(first.kind!=='tasks')throw Error('Expected Tasks')
    expect(first.value.items).toHaveLength(1)
    expect(first.value.next).toBeDefined()
    const second=value(await app.agents.read(agent,{ kind:'search',spaceKey:'DIG',text:'task',page:{ size:1,after:first.value.next } }))
    if(second.kind!=='tasks')throw Error('Expected Tasks')
    expect(second.value.items[0].id).not.toBe(first.value.items[0].id)
    expect(value(await app.board.read(read,{ kind:'inbox' }))).toEqual(before)
    const malformed={ kind:'task',key:'DIG-1',markNotificationsRead:true } as const
    value(await app.agents.read(agent,malformed))
    expect(value(await app.board.read(read,{ kind:'inbox' }))).toEqual(before)
    expect(value(await app.board.read(read,{ kind:'task',task:{ kind:'key',taskKey:'DIG-1' as TaskKey } }))).toMatchObject({ kind:'task',value:{ revision:1 } })
    expect(await app.agents.read({} as never,{ kind:'spaces' })).toMatchObject({ ok:false,fault:{ kind:'not-authenticated' } })
    expect(await app.agents.read(agent,{ kind:'inbox' } as never)).toMatchObject({ ok:false,fault:{ kind:'invalid' } })
  })

  it('isolates connection owners and rejects expired credentials without any connected watcher',async()=>{
    const app=await setup(),other=await signIn('someone-else')
    value(await app.agents.manage(app.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1 }))
    expect(await other.agents.manage(other.who,{ kind:'set-space-access',spaceKey:'DIG',enabled:false,expectedRevision:2 })).toMatchObject({ ok:false,fault:{ kind:'not-found' } })
    const old=new AgentModuleImplementation(db,app.board,{ now:()=>new Date(Date.now()-31*24*60*60*1000) })
    const issued=value(await old.manage(app.who,{ kind:'create',id:randomUUID(),name:'Old',spaceIds:[app.spaceId] }))
    if(issued.kind!=='issued')throw Error('Expected token')
    expect(await app.agents.authenticate(issued.token)).toMatchObject({ ok:false,fault:{ kind:'not-authenticated' } })
    expect(value(await other.agents.manage(other.who,{ kind:'list' }))).toMatchObject({ connections:[] })
    expect(await other.agents.manage(other.who,{ kind:'revoke',id:issued.connection.id })).toMatchObject({ ok:false,fault:{ kind:'not-found' } })
    const replaced=value(await app.agents.manage(app.who,{ kind:'replace-token',id:issued.connection.id,expectedRevision:1 }))
    if(replaced.kind!=='issued')throw Error('Expected token')
    expect((await app.agents.authenticate(replaced.token)).ok).toBe(true)
    expect((await app.agents.authenticate(issued.token)).ok).toBe(false)
  })

  it('does not revive a removed Member grant after accepting a new invitation',async()=>{
    const app=await setup(),member=await invite(app)
    value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
    expect(await member.agents.manage(member.who,{kind:'set-space-access',spaceKey:'DIG',enabled:false,expectedRevision:2})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
    const issued=value(await member.agents.manage(member.who,{kind:'create',id:randomUUID(),name:'Member connection',spaceIds:[app.spaceId]}))
    if(issued.kind!=='issued')throw Error('Expected token')
    const agent=value(await app.agents.authenticate(issued.token))
    const members=value(await app.space.read(app.who,{kind:'members',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    if(members.kind!=='members')throw Error('Expected Members')
    const current=members.members.find(person=>person.displayName==='member')!
    value(await app.space.change(app.who,{requestId:randomUUID() as RequestId,command:{kind:'remove-member',space:{kind:'key',spaceKey:'DIG' as SpaceKey},member:{memberId:current.id,expectedRevision:current.revision}}}))
    expect((await app.agents.read(agent,{kind:'task',key:'DIG-1'})).ok).toBe(false)
    await invite(app)
    expect(value(await app.agents.read(agent,{kind:'spaces'}))).toMatchObject({spaces:[]})
    expect(await app.agents.read(agent,{kind:'space',spaceKey:'DIG'})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
  })

  it('shares a request budget across connections owned by the same person',async()=>{
    const app=await setup()
    value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
    const tokens=[]
    for(let i=0;i<3;i++) {
      const issued=value(await app.agents.manage(app.who,{kind:'create',id:randomUUID(),name:`Reader ${i}`,spaceIds:[app.spaceId]}))
      if(issued.kind!=='issued')throw Error('Expected token')
      tokens.push(issued.token)
    }
    for(let i=0;i<120;i++)expect((await app.agents.authenticate(tokens[i%3])).ok).toBe(true)
    expect(await app.agents.authenticate(tokens[2])).toMatchObject({ok:false,fault:{kind:'rate-limited',retryAfterSeconds:expect.any(Number)}})
  })

  it('migrates existing human work and sessions with agent access disabled',async()=>{
    const root=db,name=`dig_agent_migration_${randomUUID().replaceAll('-','')}`
    const url=new URL(process.env.DATABASE_URL!);url.pathname=`/${name}`
    const directory=await mkdtemp(join(tmpdir(),'dig-agent-migration-'))
    await root.query(`create database ${name}`)
    db=createDatabase(url.toString())
    try {
      for(const file of await readdir('db/migrations'))if(file.endsWith('.sql') && file<'202609160002_agent_connections.sql')await copyFile(join('db/migrations',file),join(directory,file))
      await migrate(url.toString(),'up',directory)
      const app=await setup()
      const space={kind:'key' as const,spaceKey:'DIG' as SpaceKey}
      // Seed the historical schema directly. Current Board code needs the new
      // claim tables and cannot act as the pre-migration application.
      await db.query(`insert into team.tasks(space_id,number,column_id,title,description,created_by_member_id)
        select s.id,1,c.id,'Preserve me','Existing human work',m.id from team.spaces s
        join team.board_columns c on c.space_id=s.id and c.is_intake
        join team.members m on m.space_id=s.id where s.id=$1`,[app.spaceId])
      await copyFile('db/migrations/202609160002_agent_connections.sql',join(directory,'202609160002_agent_connections.sql'))
      await migrate(url.toString(),'up',directory)
      const legacyToken='dig_agent_'+ 'a'.repeat(43)
      await db.query(`insert into team.agent_connections(id,identity_id,name,secret_hash,created_at,expires_at)
        select $1,identity_id,'Existing read connection',$2,now(),now()+interval '30 days' from team.members where space_id=$3`,[randomUUID(),createHash('sha256').update(legacyToken).digest('hex'),app.spaceId])
      await migrate(url.toString())
      const legacy=value(await app.agents.authenticate(legacyToken))
      expect(legacy.scope).toBe('tasks:read')
      expect(await app.agents.work(legacy,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'No silent upgrade'})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
      const read=value(await app.space.authorize(app.who,{use:'board-read',space}))
      expect(value(await app.board.read(read,{kind:'task',task:{kind:'key',taskKey:'DIG-1' as TaskKey},history:{size:10}})))
        .toMatchObject({kind:'task',value:{title:'Preserve me',description:'Existing human work',claim:null}})
      expect((await app.identity.session({kind:'resolve',use:'read',evidence:{sessionSecret:app.session.sessionSecret}})).ok).toBe(true)
      expect(value(await app.agents.manage(app.who,{kind:'space-settings',spaceKey:'DIG'}))).toMatchObject({space:{enabled:false,revision:1}})
    } finally {await db.end();db=root;await root.query(`drop database ${name}`);await rm(directory,{recursive:true,force:true})}
  })

})
