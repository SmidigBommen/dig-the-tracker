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
import type { Result,RequestId,SpaceKey } from './shared.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database
function value<T,F>(result: Result<T,F>): T { if (!result.ok) throw new Error(JSON.stringify(result.fault));return result.value }
run('Slice 13 agent handoff',() => {
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

  it('requires an explicit review destination before agent work and preserves human workflow',async()=>{
    const app=await setup()
    const access=value(await app.space.authorize(app.who,{use:'board-read',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const workflow=value(await app.board.read(access,{kind:'workflow'}))
    if(workflow.kind!=='workflow')throw Error('Expected workflow')
    expect(workflow.value.agentWork).toEqual({enabled:false,reviewColumnId:null})
    const write=value(await app.space.authorize(app.who,{use:'board-change',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const review=workflow.value.columns.find(c=>c.flowRole==='active')!
    const saved=value(await app.board.change(write,{requestId:randomUUID() as RequestId,command:{kind:'set-workflow',expectedRevision:workflow.value.revision,desired:{columns:workflow.value.columns,agentWork:{enabled:true,reviewColumnId:review.id}}}}))
    expect(saved.update.changes).toContainEqual(expect.objectContaining({kind:'workflow-replaced',workflow:expect.objectContaining({agentWork:{enabled:true,reviewColumnId:review.id}})}))
  })
  async function working(configure=true) {
    const app=await setup()
    const readAccess=value(await app.space.authorize(app.who,{use:'board-read',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const writeAccess=value(await app.space.authorize(app.who,{use:'board-change',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const initial=value(await app.board.read(readAccess,{kind:'workflow'}))
    if(initial.kind!=='workflow')throw Error('Expected workflow')
    const review=initial.value.columns.find(c=>c.flowRole==='active')!
    if(configure)value(await app.board.change(writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'set-workflow',expectedRevision:initial.value.revision,desired:{columns:initial.value.columns,agentWork:{enabled:true,reviewColumnId:review.id}}}}))
    value(await app.agents.manage(app.who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
    const issued=value(await app.agents.manage(app.who,{kind:'create',id:randomUUID(),name:'Codex',spaceIds:[app.spaceId],scope:'tasks:work'}))
    if(issued.kind!=='issued')throw Error('Expected token')
    const agent=value(await app.agents.authenticate(issued.token))
    const started=value(await app.agents.work(agent,{kind:'start-run',spaceKey:'DIG',requestId:randomUUID(),label:'Handoff check'}))
    if(started.kind!=='run')throw Error('Expected run')
    const change=(command:import('../contracts/board.js').BoardCommand,claimId?:string,requestId=randomUUID())=>app.agents.work(agent,{kind:'change',spaceKey:'DIG',runId:started.run.id,runKey:started.run.runKey,requestId,claimId,command})
    const read=async()=>{const view=value(await app.agents.read(agent,{kind:'task',key:'DIG-1'}));if(view.kind!=='task')throw Error('Expected task');return view.value}
    return {...app,agent,issued,run:started.run,change,read,readAccess,writeAccess,review}
  }
  it('posts a blocker, notifies the delegating person, and releases its claim exactly once',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Blocked work'}}))
    const task=await app.read(),claimId=task.claim!.id,requestId=randomUUID()
    const command={kind:'report-blocker' as const,task:{taskId:task.id,expectedRevision:task.revision},report:{summary:'Missing API credentials',needed:'Please provide a test account'},mentions:[]}
    const receipt=value(await app.change(command,claimId,requestId))
    const blocked=await app.read()
    expect(blocked).toMatchObject({columnId:task.columnId,claim:null,outcome:null,comments:{items:[{reportKind:'blocked',text:expect.stringContaining('Please provide a test account'),agent:{runId:app.run.id}}]}})
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({kind:'inbox',unreadNotifications:1,value:{items:[{kind:'agent-blocked',agent:{connectionName:'Codex'},task:{id:task.id}}]}})
    expect(value(await app.change(command,claimId,requestId))).toEqual(receipt)
    expect((await app.read()).comments!.items).toHaveLength(1)
    expect(await app.change({...command,report:{summary:'New report',needed:'Still blocked'}},claimId)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
  })

  const report={summary:'Implemented the requested change',verification:{outcome:'not-run' as const,details:'Test service was unavailable'},limitations:'Needs staging verification',reference:'commit abc123'}
  async function workflow(app:Awaited<ReturnType<typeof working>>) {
    const view=value(await app.board.read(app.readAccess,{kind:'workflow'}));if(view.kind!=='workflow')throw Error('Expected workflow');return view.value
  }
  it('hands off a report and move atomically, retains truthful verification, and deduplicates a lost response',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Review this'}}))
    const task=await app.read(),current=await workflow(app),claimId=task.claim!.id,requestId=randomUUID()
    const command={kind:'handoff-review' as const,task:{taskId:task.id,expectedRevision:task.revision},expectedWorkflowRevision:current.revision,report,mentions:[]}
    const receipt=value(await app.change(command,claimId,requestId))
    expect(await app.read()).toMatchObject({columnId:app.review.id,claim:null,outcome:null,closedAt:null,comments:{items:[{reportKind:'review',text:expect.stringContaining('Verification: Not run'),agent:{runId:app.run.id}}]}})
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:1,value:{items:[{kind:'agent-review'}]}})
    expect(value(await app.change(command,claimId,requestId))).toEqual(receipt)
    expect((await app.read()).comments!.items).toHaveLength(1)
    expect((await app.read()).history!.items.filter(event=>event.kind==='agent-review')).toHaveLength(1)
  })
  it('rolls back movement, report, notification, and claim release when a later validation fails',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Atomic handoff'}}))
    const before=await app.read(),current=await workflow(app)
    const command={kind:'handoff-review' as const,task:{taskId:before.id,expectedRevision:before.revision},expectedWorkflowRevision:current.revision,report,mentions:[randomUUID() as import('./shared.js').MemberId]}
    expect((await app.change(command,before.claim!.id)).ok).toBe(false)
    expect(await app.read()).toEqual(before)
    expect(await workflow(app)).toEqual(current)
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:0,value:{items:[]}})
  })
  it('rejects stale review settings and direct review moves while allowing a fresh handoff',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Changing workflow'}}))
    const task=await app.read(),current=await workflow(app),claimId=task.claim!.id
    expect(await app.change({kind:'place-task',task:{taskId:task.id,expectedRevision:task.revision},destination:{columnId:app.review.id,expectedOrderRevision:app.review.orderRevision,place:{kind:'last'}}},claimId)).toMatchObject({ok:false,fault:{reason:'review-handoff-required'}})
    const replacement=current.columns.find(column=>column.intake)!
    value(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'set-workflow',expectedRevision:current.revision,desired:{columns:current.columns,agentWork:{enabled:true,reviewColumnId:replacement.id}}}}))
    const command={kind:'handoff-review' as const,task:{taskId:task.id,expectedRevision:task.revision},expectedWorkflowRevision:current.revision,report,mentions:[]}
    expect(await app.change(command,claimId)).toMatchObject({ok:false,fault:{reason:'stale-workflow'}})
    expect(await app.read()).toEqual(task)
    value(await app.change({...command,expectedWorkflowRevision:(await workflow(app)).revision},claimId))
    expect(await app.read()).toMatchObject({columnId:replacement.id,claim:null})
  })
  it('requires replacement or disablement when archiving the review Column and invalidates claims on disable',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Configuration safety'}}))
    const task=await app.read(),current=await workflow(app)
    const desired={columns:current.columns.filter(c=>c.id!==app.review.id)}
    const command={kind:'set-workflow' as const,expectedRevision:current.revision,desired}
    expect(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command})).toMatchObject({ok:false,fault:{kind:'configuration',reason:'review-column-invalid'}})
    expect(await workflow(app)).toEqual(current)
    value(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{...command,desired:{...desired,agentWork:{enabled:false,reviewColumnId:null}}}}))
    expect((await app.read()).claim).toBeNull()
    expect(await app.change({kind:'add-comment',taskId:task.id,text:'Disabled',mentions:[]},task.claim!.id)).toMatchObject({ok:false,fault:{kind:'configuration',reason:'agent-work-disabled'}})
    const disabled=await workflow(app)
    value(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'set-workflow',expectedRevision:disabled.revision,desired:{columns:disabled.columns.filter(c=>!c.archived),agentWork:{enabled:true,reviewColumnId:disabled.columns.find(c=>c.intake)!.id}}}}))
    expect((await app.read()).claim).toBeNull()
    expect(await app.change({kind:'add-comment',taskId:task.id,text:'Old claim',mentions:[]},task.claim!.id)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
  })

  it('accepts every report field at its published maximum without overflowing a comment',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'Bounded report'}}))
    const task=await app.read(),current=await workflow(app)
    const maximum={summary:'S'.repeat(1500),verification:{outcome:'failed' as const,details:'V'.repeat(1500)},limitations:'L'.repeat(1000),reference:'R'.repeat(500)}
    value(await app.change({kind:'handoff-review',task:{taskId:task.id,expectedRevision:task.revision},expectedWorkflowRevision:current.revision,report:maximum,mentions:[]},task.claim!.id))
    const comment=(await app.read()).comments!.items[0]
    expect(comment.text.length).toBeLessThanOrEqual(5000)
    expect(comment.text).toContain('Verification: Failed')
    expect(comment.text).toContain(maximum.reference)
  })

  it('rejects disabled work, Completion mapping, stale edits, expired claims, and revoked credentials',async()=>{
    const app=await working(false)
    expect(await app.change({kind:'capture-task',input:{title:'Disabled'}})).toMatchObject({ok:false,fault:{reason:'agent-work-disabled'}})
    const current=await workflow(app)
    const configure=(reviewColumnId:typeof app.review.id)=>app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'set-workflow',expectedRevision:current.revision,desired:{columns:current.columns,agentWork:{enabled:true,reviewColumnId}}}})
    expect(await configure(current.columns.find(c=>c.completion)!.id)).toMatchObject({ok:false,fault:{reason:'review-column-invalid'}})
    value(await configure(app.review.id))
    value(await app.change({kind:'capture-task',input:{title:'Protected handoff'}}))
    const task=await app.read(),claimId=task.claim!.id
    const command={kind:'handoff-review' as const,task:{taskId:task.id,expectedRevision:task.revision},expectedWorkflowRevision:(await workflow(app)).revision,report,mentions:[]}
    expect(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command})).toMatchObject({ok:false,fault:{kind:'forbidden'}})
    value(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'revise-task',task:command.task,changes:{title:'Human edit'}}}))
    expect(await app.change(command,claimId)).toMatchObject({ok:false,fault:{reason:'stale-task'}})
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:0})
    clock=new Date(Date.now()+3*60*60*1000)
    expect(await app.change({...command,task:{taskId:task.id,expectedRevision:(await app.read()).revision}},claimId)).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    clock=undefined
    value(await app.agents.manage(app.who,{kind:'revoke',id:app.issued.connection.id}))
    expect((await app.change(command,claimId)).ok).toBe(false)
    const detail=value(await app.board.read(app.readAccess,{kind:'task',task:{kind:'id',taskId:task.id}}))
    expect(detail).toMatchObject({kind:'task',value:{title:'Human edit',claim:null}})
  })

  it('serializes concurrent handoffs and replays committed receipts after disabling work',async()=>{
    const app=await working()
    value(await app.change({kind:'capture-task',input:{title:'One handoff'}}))
    const task=await app.read(),current=await workflow(app),id=randomUUID()
    const command={kind:'handoff-review' as const,task:{taskId:task.id,expectedRevision:task.revision},expectedWorkflowRevision:current.revision,report,mentions:[]}
    const [first,retry]=await Promise.all([app.change(command,task.claim!.id,id),app.change(command,task.claim!.id,id)])
    expect(value(first)).toEqual(value(retry))
    const after=await workflow(app)
    value(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'set-workflow',expectedRevision:after.revision,desired:{columns:after.columns,agentWork:{enabled:false,reviewColumnId:app.review.id}}}}))
    expect(value(await app.change(command,task.claim!.id,id))).toEqual(value(first))
    expect((await app.read()).comments!.items).toHaveLength(1)
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:1})
  })

  it('accepts maximum reports through MCP and notifies separately for blocker and review',async()=>{
    const app=await working()
    const server=createTeamServer({...app,exports:new SpaceExportModuleImplementation(db)},loadConfig({ALLOWED_ORIGINS:origin}))
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const client=new Client({name:'handoff-test',version:'1'})
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),{authProvider:{token:async()=>app.issued.token}}))
      value(await app.change({kind:'capture-task',input:{title:'MCP reports'}}))
      const task=await app.read(),base={spaceKey:'DIG',runId:app.run.id,runKey:app.run.runKey,taskId:task.id,expectedRevision:task.revision}
      const blocker={...base,claimId:task.claim!.id,requestId:randomUUID(),report:{summary:'S'.repeat(1500),needed:'N'.repeat(3000)}}
      expect((await client.callTool({name:'dig_report_blocker',arguments:blocker})).structuredContent).toMatchObject({ok:true})
      expect((await app.read()).claim).toBeNull()
      value(await app.change({kind:'claim-task',taskId:task.id}))
      const claimed=await app.read()
      const handoff={...base,expectedRevision:claimed.revision,claimId:claimed.claim!.id,requestId:randomUUID(),expectedWorkflowRevision:(await workflow(app)).revision,report:{summary:'S'.repeat(1500),verification:{outcome:'passed',details:'V'.repeat(1500)},limitations:'L'.repeat(1000),reference:'R'.repeat(500)}}
      const sent=await client.callTool({name:'dig_handoff_review',arguments:handoff})
      expect(sent.structuredContent).toMatchObject({ok:true})
      expect((await client.callTool({name:'dig_handoff_review',arguments:handoff})).structuredContent).toEqual(sent.structuredContent)
      expect((await app.read()).comments!.items).toHaveLength(2)
      expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:2})
      expect((await client.callTool({name:'dig_report_blocker',arguments:{...blocker,mentions:Array.from({length:26},()=>randomUUID())}})).isError).toBe(true)
    } finally {await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
  })

  it('keeps human self-notifications suppressed and sends explicit report mentions to other Members',async()=>{
    const app=await working(),member=await signIn('reviewer')
    const invitation=value(await app.space.change(app.who,{requestId:randomUUID() as RequestId,command:{kind:'issue-invitation',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}}))
    if(invitation.result.kind!=='invitation-issued')throw Error('Expected invitation')
    const accepted=value(await member.space.change(member.who,{requestId:randomUUID() as RequestId,command:{kind:'accept-invitation',invitationSecret:invitation.result.invitationSecret}}))
    if(accepted.session.kind!=='replace')throw Error('Expected session')
    const resolved=value(await member.identity.session({kind:'resolve',use:'read',evidence:{sessionSecret:accepted.session.sessionSecret}}))
    if(resolved.kind!=='resolved')throw Error('Expected identity')
    const memberAccess=value(await member.space.authorize(resolved.identity,{use:'board-read',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    const members=value(await app.space.read(app.who,{kind:'members',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    if(members.kind!=='members')throw Error('Expected members')
    const reviewer=members.members.find(m=>m.displayName==='reviewer')!
    app.readAccess=value(await app.space.authorize(app.who,{use:'board-read',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    app.writeAccess=value(await app.space.authorize(app.who,{use:'board-change',space:{kind:'key',spaceKey:'DIG' as SpaceKey}}))
    value(await app.change({kind:'capture-task',input:{title:'Reviewers'}}))
    const task=await app.read()
    value(await app.board.change(app.writeAccess,{requestId:randomUUID() as RequestId,command:{kind:'add-comment',taskId:task.id,text:'My own progress',mentions:[task.assignee!.id]}}))
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:0})
    value(await app.change({kind:'report-blocker',task:{taskId:task.id,expectedRevision:task.revision},report:{summary:'Need a second opinion',needed:'Please review this decision'},mentions:[reviewer.id,task.assignee!.id]},task.claim!.id))
    expect(value(await app.board.read(app.readAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:1,value:{items:[{kind:'agent-blocked'}]}})
    expect(value(await member.board.read(memberAccess,{kind:'inbox'}))).toMatchObject({unreadNotifications:1,value:{items:[{kind:'mention',agent:{connectionName:'Codex'}}]}})
  })

})
