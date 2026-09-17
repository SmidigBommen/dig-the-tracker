// @vitest-environment node
import { beforeEach,afterEach,describe,it,expect } from 'vitest'
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createTeamServer } from '../server.js'
import { loadConfig } from '../config.js'
import { SpaceExportModuleImplementation } from './export/export-module.js'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
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
run('Slice 12 agent work',() => {
  beforeEach(async () => { clock=undefined;db=createDatabase(process.env.DATABASE_URL!);await db.query('truncate team.identities,team.space_key_reservations cascade') })
  afterEach(async () => { await db.end() })
  let clock:Date|undefined
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
    const board=new BoardModuleImplementation(db,{now:()=>clock ?? new Date()})
    return { identity,space,board,agents: new AgentModuleImplementation(db,board,{runHmacSecret:"test-run-secret-with-more-than-32-bytes"}),who: resolved.identity,session: signed.session }
  }
  async function setup() {
    const app=await signIn()
    const created=value(await app.space.change(app.who,{ requestId: randomUUID() as RequestId,command: { kind: 'create-space',input: { key: 'DIG',displayName: 'Agent test',timeZone: 'Europe/Oslo' } } }))
    if(created.result.kind!=='space-created')throw Error('Expected Space')
    return { ...app,spaceId: created.result.space.id }
  }

  it('requires explicit work consent and gives competing runs only one claim',async()=>{
    const app=await setup()
    value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
    const issue=async(scope:'tasks:read'|'tasks:work')=>{
      const issued=value(await app.agents.manage(app.who,{kind:'create',id:randomUUID(),name:'Codex',spaceIds:[app.spaceId],scope}))
      if(issued.kind!=='issued')throw Error('Expected token')
      return value(await app.agents.authenticate(issued.token))
    }
    const readonly=await issue('tasks:read')
    expect(await app.agents.work(readonly,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'Read attempt'})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
    const agent=await issue('tasks:work')
    const access=value(await app.space.authorize(app.who,{use:'board-change',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const captured=value(await app.board.change(access,{requestId:randomUUID() as RequestId,command:{kind:'capture-task',input:{title:'Claim me'}}}))
    const taskId=captured.result.taskId!
    const first=value(await app.agents.work(agent,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'First run'}))
    const second=value(await app.agents.work(agent,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'Second run'}))
    if(first.kind!=='run' || second.kind!=='run')throw Error('Expected runs')
    const results=await Promise.all([first,second].map(run=>app.agents.work(agent,{kind:'change',spaceKey:'DIG',runId:run.run.id,runKey:run.run.runKey,requestId:randomUUID(),command:{kind:'claim-task',taskId}})))
    expect(results.filter(result=>result.ok)).toHaveLength(1)
    expect(results.find(result=>!result.ok)).toMatchObject({ok:false,fault:{kind:'conflict',reason:'task-claimed'}})
    const detail=value(await app.agents.read(agent,{kind:'task',key:'DIG-1'}))
    expect(detail).toMatchObject({kind:'task',value:{assignee:{displayName:'admin'},claim:{connectionName:'Codex'}}})
  })
  async function working(tokenAge=0) {
    const app=await setup()
    value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
    const issuer=new AgentModuleImplementation(db,app.board,{now:()=>new Date(Date.now()-tokenAge)})
    const issued=value(await issuer.manage(app.who,{kind:'create',id:randomUUID(),name:'Codex',spaceIds:[app.spaceId],scope:'tasks:work'}))
    if(issued.kind!=='issued')throw Error('Expected token')
    const agent=value(await app.agents.authenticate(issued.token))
    const run=value(await app.agents.work(agent,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'Implement requested work'}))
    if(run.kind!=='run')throw Error('Expected run')
    const change=(command:import('../contracts/board.js').BoardCommand,claimId?:string,requestId=randomUUID())=>app.agents.work(agent,{kind:'change',spaceKey:'DIG',runId:run.run.id,runKey:run.run.runKey,claimId,requestId,command})
    const read=async()=>{const view=value(await app.agents.read(agent,{kind:'task',key:'DIG-1'}));if(view.kind!=='task')throw Error('Expected Task');return view.value}
    return {...app,agent,run:run.run,issued,change,read}
  }
  it('creates and edits claimed work atomically, preserves human revisions, and replays committed results after release',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Agent Task'}}))
    const task=await app.read()
    expect(task.claim?.runId).toBe(app.run.id)
    const claimId=task.claim!.id
    const human=value(await app.space.authorize(app.who,{use:'board-change',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    value(await app.board.change(human,{requestId:randomUUID() as RequestId,command:{kind:'revise-task',task:{taskId:task.id,expectedRevision:task.revision},changes:{title:'Human edit'}}}))
    expect(await app.change({kind:'revise-task',task:{taskId:task.id,expectedRevision:task.revision},changes:{title:'Stale agent edit'}},claimId)).toMatchObject({ok:false,fault:{kind:'conflict',reason:'stale-task'}})
    const latest=await app.read()
    const requestId=randomUUID(),command={kind:'revise-task' as const,task:{taskId:task.id,expectedRevision:latest.revision},changes:{description:'Verified agent change'}}
    const receipt=value(await app.change(command,claimId,requestId))
    value(await app.change({kind:'add-comment',taskId:task.id,text:'Progress update',mentions:[]},claimId))
    const attributed=await app.read()
    expect(attributed.history?.items[0].agent).toMatchObject({runId:app.run.id,connectionName:'Codex'})
    expect(attributed.comments?.items[0].agent).toMatchObject({runId:app.run.id,connectionName:'Codex'})
    expect(JSON.stringify(attributed)).not.toContain(app.run.runKey)
    value(await app.change({kind:'release-task-claim',taskId:task.id,claimId}))
    expect(value(await app.change(command,claimId,requestId))).toEqual(receipt)
    expect(await app.change({kind:'add-comment',taskId:task.id,text:'Too late',mentions:[]},claimId)).toMatchObject({ok:false,fault:{kind:'conflict',reason:'claim-lost'}})
    expect(await app.read()).toMatchObject({title:'Human edit',description:'Verified agent change',claim:null})
  })

  async function human(app:Awaited<ReturnType<typeof setup>>) {
    const access=value(await app.space.authorize(app.who,{use:'board-change',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    return (command:import('../contracts/board.js').BoardCommand)=>app.board.change(access,{requestId:randomUUID() as RequestId,command})
  }
  async function humanTask(app:Awaited<ReturnType<typeof setup>>) {
    const access=value(await app.space.authorize(app.who,{use:'board-read',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const view=value(await app.board.read(access,{kind:'task',task:{kind:'key',taskKey:'DIG-1' as TaskKey}}))
    if(view.kind!=='task')throw Error('Expected Task')
    return view.value
  }
  it('expires without a listener, renews without heartbeat history, and rejects old claim IDs after reacquisition',async()=>{
    clock=new Date()
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Timed claim'}}))
    const task=await app.read(),claim=task.claim!
    expect(Date.parse(claim.expiresAt)-Date.parse(claim.startedAt)).toBe(7200000)
    const history=task.history!.items
    clock=new Date(Date.parse(claim.startedAt)+3600000)
    value(await app.change({kind:'renew-task-claim',taskId:task.id,claimId:claim.id},claim.id))
    const renewed=await app.read()
    expect(renewed.history!.items).toEqual(history)
    expect(Date.parse(renewed.claim!.expiresAt)).toBe(clock.getTime()+7200000)
    clock=new Date(renewed.claim!.expiresAt)
    expect((await app.read()).claim).toBeNull()
    expect(await app.change({kind:'renew-task-claim',taskId:task.id,claimId:claim.id},claim.id)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    value(await app.change({kind:'claim-task',taskId:task.id}))
    expect((await app.read()).claim!.id).not.toBe(claim.id)
    expect(await app.change({kind:'add-comment',taskId:task.id,text:'Old authority',mentions:[]},claim.id)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
  })
  it('isolates child claims and never creates an orphan when the parent claim is missing',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Parent'}}))
    const parent=await app.read()
    const create={kind:'capture-task' as const,input:{title:'Child',parentTaskId:parent.id}}
    expect(await app.change(create)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    value(await app.change(create,parent.claim!.id))
    const view=value(await app.agents.read(app.agent,{kind:'task',key:'DIG-2'}))
    if(view.kind!=='task')throw Error('Expected child')
    const child=view.value
    expect(child.parentTaskId).toBe(parent.id)
    expect(child.claim!.id).not.toBe(parent.claim!.id)
    expect(await app.change({kind:'add-comment',taskId:child.id,text:'Wrong claim',mentions:[]},parent.claim!.id)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    value(await app.change({kind:'add-comment',taskId:child.id,text:'Own claim',mentions:[]},child.claim!.id))
    const change=await human(app)
    value(await change({kind:'archive-task',task:{taskId:parent.id,expectedRevision:parent.revision}}))
    const archived=value(await app.agents.read(app.agent,{kind:'task',key:'DIG-2'}))
    expect(archived).toMatchObject({value:{claim:null}})
    expect(await app.change({kind:'add-comment',taskId:child.id,text:'Archived',mentions:[]},child.claim!.id)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
  })
  it('allows human release and clears claims permanently on unassignment',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Human control'}}))
    let task=await app.read()
    const change=await human(app),original=task.claim!.id
    value(await change({kind:'release-task-claim',taskId:task.id,claimId:original}))
    expect((await app.read()).claim).toBeNull()
    value(await app.change({kind:'claim-task',taskId:task.id}))
    task=await app.read()
    value(await change({kind:'revise-task',task:{taskId:task.id,expectedRevision:task.revision},changes:{assigneeId:null}}))
    expect((await app.read()).claim).toBeNull()
    const latest=await app.read()
    value(await change({kind:'revise-task',task:{taskId:task.id,expectedRevision:latest.revision},changes:{assigneeId:task.assignee!.id}}))
    expect((await app.read()).claim).toBeNull()
  })
  it.each(['revoke','replace','policy','space'] as const)('invalidates claims on %s and does not revive their runs',async kind=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Invalidation'}}))
    const task=await app.read()
    let principal=app.agent
    if(kind==='revoke')value(await app.agents.manage(app.who,{kind:'revoke',id:app.issued.connection.id}))
    if(kind==='replace') {
      const issued=value(await app.agents.manage(app.who,{kind:'replace-token',id:app.issued.connection.id,expectedRevision:1}))
      if(issued.kind!=='issued')throw Error('Expected token')
      principal=value(await app.agents.authenticate(issued.token))
    }
    if(kind==='policy') {
      value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:false,expectedRevision:2}))
      value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:3}))
    }
    if(kind==='space') {
      const archived=value(await app.space.change(app.who,{requestId:randomUUID() as RequestId,command:{kind:'archive-space',space:{spaceId:app.spaceId,expectedRevision:1}}}))
      if(archived.result.kind!=='space-archived')throw Error('Expected archive')
      value(await app.space.change(app.who,{requestId:randomUUID() as RequestId,command:{kind:'restore-space',space:{spaceId:app.spaceId,expectedRevision:archived.result.space.revision}}}))
    }
    expect((await humanTask(app)).claim).toBeNull()
    expect((await app.agents.work(principal,{kind:'change',spaceKey:'DIG',runId:app.run.id,runKey:app.run.runKey,requestId:randomUUID(),claimId:task.claim!.id,command:{kind:'add-comment',taskId:task.id,text:'Invalid',mentions:[]}})).ok).toBe(false)
  })
  it('forbids completion, archival, assignment, and comment moderation even for an administrator connection',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Restricted'}}))
    const task=await app.read(),version={taskId:task.id,expectedRevision:task.revision}
    const workflow=value(await app.agents.read(app.agent,{kind:'workflow',spaceKey:'DIG'}))
    if(workflow.kind!=='workflow')throw Error('Expected workflow')
    const complete=workflow.value.columns.find(column=>column.flowRole==='complete')!
    for(const command of [
      {kind:'archive-task',task:version},
      {kind:'restore-task',task:version},
      {kind:'revise-task',task:version,changes:{assigneeId:null}},
      {kind:'place-task',task:version,destination:{columnId:complete.id,expectedOrderRevision:1,place:{kind:'last'}}},
      {kind:'mark-all-notifications-read'},
    ] as import('../contracts/board.js').BoardCommand[])expect(await app.change(command,task.claim!.id)).toMatchObject({ok:false,fault:{kind:'forbidden'}})
    value(await app.change({kind:'add-comment',taskId:task.id,text:'Original',mentions:[]},task.claim!.id))
    const comment=(await app.read()).comments!.items[0]
    expect(await app.change({kind:'remove-comment',comment:{commentId:comment.id,expectedRevision:comment.revision}},task.claim!.id)).toMatchObject({ok:false,fault:{kind:'forbidden'}})
  })

  async function invite(app:Awaited<ReturnType<typeof setup>>,subject='member') {
    const invitation=value(await app.space.change(app.who,{requestId:randomUUID() as RequestId,command:{kind:'issue-invitation',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}}))
    if(invitation.result.kind!=='invitation-issued')throw Error('Expected invitation')
    const member=await signIn(subject)
    const accepted=value(await member.space.change(member.who,{requestId:randomUUID() as RequestId,command:{kind:'accept-invitation',invitationSecret:invitation.result.invitationSecret}}))
    if(accepted.session.kind!=='replace')throw Error('Expected replacement')
    const resolved=value(await member.identity.session({kind:'resolve',use:'read',evidence:{sessionSecret:accepted.session.sessionSecret}}))
    if(resolved.kind!=='resolved')throw Error('Expected identity')
    return {...member,who:resolved.identity,spaceId:app.spaceId}
  }
  it('preserves other Members assignments, restricts human release, and invalidates a removed Member forever',async()=>{
    const app=await working(),member=await invite(app),other=await invite(app,'other')
    const issued=value(await member.agents.manage(member.who,{kind:'create',id:randomUUID(),name:'Member Codex',spaceIds:[app.spaceId],scope:'tasks:work'}))
    if(issued.kind!=='issued')throw Error('Expected token')
    const agent=value(await app.agents.authenticate(issued.token))
    const started=value(await app.agents.work(agent,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'Member run'}))
    if(started.kind!=='run')throw Error('Expected run')
    value(await app.agents.work(agent,{kind:'change',spaceKey:'DIG',requestId:randomUUID(),runId:started.run.id,runKey:started.run.runKey,command:{kind:'capture-task',input:{title:'Member assigned'}}}))
    const task=await app.read(),claimId=task.claim!.id
    expect(await app.change({kind:'claim-task',taskId:task.id})).toMatchObject({ok:false,fault:{reason:'assigned-to-another-member'}})
    expect(await (await human(other))({kind:'release-task-claim',taskId:task.id,claimId})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
    value(await (await human(app))({kind:'release-task-claim',taskId:task.id,claimId}))
    value(await app.agents.work(agent,{kind:'change',spaceKey:'DIG',requestId:randomUUID(),runId:started.run.id,runKey:started.run.runKey,command:{kind:'claim-task',taskId:task.id}}))
    const members=value(await app.space.read(app.who,{kind:'members',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    if(members.kind!=='members')throw Error('Expected members')
    const target=members.members.find(m=>m.id===task.assignee!.id)!
    value(await app.space.change(app.who,{requestId:randomUUID() as RequestId,command:{kind:'remove-member',space:{kind:'key',spaceKey:'DIG' as SpaceKey},member:{memberId:target.id,expectedRevision:target.revision}}}))
    await invite(app)
    expect((await app.read()).claim).toBeNull()
    expect((await app.agents.work(agent,{kind:'change',spaceKey:'DIG',requestId:randomUUID(),runId:started.run.id,runKey:started.run.runKey,command:{kind:'claim-task',taskId:task.id}})).ok).toBe(false)
  })
  it('preserves separate run identity and deduplicates concurrent creation and reconnect retries',async()=>{
    const app=await working()
    const request={kind:'start-run' as const,spaceKey:'DIG',requestId:randomUUID(),label:'Reconnect'}
    expect(await app.agents.work(app.agent,{...request,requestId:'start-DIG-1'})).toMatchObject({ok:false,fault:{kind:'invalid'}})
    const first=value(await app.agents.work(app.agent,request))
    expect(value(await app.agents.work(app.agent,request))).toEqual(first)
    expect(await app.agents.work(app.agent,{...request,label:'Different'})).toMatchObject({ok:false,fault:{kind:'conflict'}})
    const id=randomUUID(),command={kind:'capture-task' as const,input:{title:'Exactly once'}}
    const [one,two]=await Promise.all([app.change(command,undefined,id),app.change(command,undefined,id)])
    expect(value(one)).toEqual(value(two))
    expect(await app.change({...command,input:{title:'Changed retry'}},undefined,id)).toMatchObject({ok:false,fault:{reason:'request-id-reused'}})
    const task=await app.read()
    if(first.kind!=='run')throw Error('Expected run')
    expect(await app.agents.work(app.agent,{kind:'change',spaceKey:'DIG',requestId:randomUUID(),runId:first.run.id,runKey:first.run.runKey,claimId:task.claim!.id,command:{kind:'add-comment',taskId:task.id,text:'Different run',mentions:[]}})).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    expect(await app.agents.work(app.agent,{kind:'change',spaceKey:'DIG',requestId:randomUUID(),runId:task.claim!.runId,runKey:first.run.runKey,claimId:task.claim!.id,command:{kind:'add-comment',taskId:task.id,text:'Copied public IDs',mentions:[]}})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
    expect(JSON.stringify(task)).not.toContain(app.run.runKey)
    const issued=value(await app.agents.manage(app.who,{kind:'create',id:randomUUID(),name:'Another connection',spaceIds:[app.spaceId],scope:'tasks:work'}))
    if(issued.kind!=='issued')throw Error('Expected token')
    const other=value(await app.agents.authenticate(issued.token))
    expect(await app.agents.work(other,{kind:'change',spaceKey:'DIG',requestId:randomUUID(),runId:app.run.id,runKey:app.run.runKey,claimId:task.claim!.id,command:{kind:'add-comment',taskId:task.id,text:'Foreign run',mentions:[]}})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
  })
  it('serves work tools through a real MCP client and clears claims on human completion',async()=>{
    const app=await working()
    const server=createTeamServer({...app,exports:new SpaceExportModuleImplementation(db)},loadConfig({ALLOWED_ORIGINS:origin}))
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const client=new Client({name:'work-test',version:'1'})
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),{authProvider:{token:async()=>app.issued.token}}))
      expect((await client.listTools()).tools).toHaveLength(14)
      const result=await client.callTool({name:'dig_create_task',arguments:{spaceKey:'DIG',runId:app.run.id,runKey:app.run.runKey,requestId:randomUUID(),title:'MCP write'}})
      expect(result.structuredContent).toMatchObject({ok:true,value:{kind:'changed'}})
      const task=await app.read()
      expect((await client.callTool({name:'dig_update_task',arguments:{spaceKey:'DIG',runId:app.run.id,runKey:app.run.runKey,requestId:randomUUID(),claimId:task.claim!.id,taskId:task.id,expectedRevision:task.revision,description:'MCP edit'}})).structuredContent).toMatchObject({ok:true})
      const access=value(await app.space.authorize(app.who,{use:'board-read',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
      const overview=value(await app.board.read(access,{kind:'overview'}))
      if(overview.kind!=='overview')throw Error('Expected overview')
      const done=overview.value.columns.find(c=>c.completion)!,active=overview.value.columns.find(c=>c.flowRole==='active')!
      const latest=await app.read()
      expect((await client.callTool({name:'dig_move_task',arguments:{spaceKey:'DIG',runId:app.run.id,runKey:app.run.runKey,requestId:randomUUID(),claimId:task.claim!.id,taskId:task.id,expectedRevision:latest.revision,columnId:active.id,expectedOrderRevision:active.orderRevision,place:{kind:'last'}}})).structuredContent).toMatchObject({ok:true})
      const moved=await app.read()
      value(await (await human(app))({kind:'place-task',task:{taskId:task.id,expectedRevision:moved.revision},destination:{columnId:done.id,expectedOrderRevision:done.orderRevision,place:{kind:'last'}},closure:{outcome:{kind:'completed'}}}))
      expect((await app.read()).claim).toBeNull()
      const afterClose=value(await app.board.read(access,{kind:'overview'}))
      if(afterClose.kind!=='overview')throw Error('Expected overview')
      const reopenColumn=afterClose.value.columns.find(c=>c.id===active.id)!
      const closed=await app.read()
      value(await (await human(app))({kind:'place-task',task:{taskId:task.id,expectedRevision:closed.revision},destination:{columnId:active.id,expectedOrderRevision:reopenColumn.orderRevision,place:{kind:'last'}}}))
      expect((await app.read()).claim).toBeNull()
      expect((await client.callTool({name:'dig_add_comment',arguments:{spaceKey:'DIG',runId:app.run.id,runKey:app.run.runKey,requestId:randomUUID(),claimId:task.claim!.id,taskId:task.id,text:'Closed'}})).structuredContent).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    } finally {await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
  })

  it('caps the visible claim deadline at credential expiry without a listener',async()=>{
    const app=await working(30*24*60*60*1000-30*60*1000)
    value(await app.change({kind:'capture-task',input:{title:'Expiring connection'}}))
    const task=await app.read()
    expect(task.claim!.expiresAt).toBe(app.issued.connection.expiresAt)
    expect(Date.parse(task.claim!.expiresAt)-Date.parse(task.claim!.startedAt)).toBeLessThan(31*60*1000)
  })

})
