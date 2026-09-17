// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createServer,type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {createDatabase,type Database} from '../db.js'
import {createTeamServer} from '../server.js'
import {loadConfig} from '../config.js'
import {IdentityModuleImplementation} from './identity/identity-module.js'
import {SpaceModuleImplementation} from './space/space-module.js'
import {BoardModuleImplementation} from './board/board-module.js'
import {AgentModuleImplementation} from './agent/agent-module.js'
import {SpaceExportModuleImplementation} from './export/export-module.js'
import {MockOidcAdapter} from '../adapters/oidc/mock-oidc-adapter.js'
import type {Result,RequestId,SpaceKey} from './shared.js'
import type {AgentWorkView,AgentRunView} from '../contracts/agents.js'
import type {AgentReadView} from './agent/agent-module.js'
import type {BoardCommand,TaskDetail} from '../contracts/board.js'

const run=process.env.DIG_DATABASE_TESTS==='1' ? describe : describe.skip
const origin='http://127.0.0.1',secret='disposable-recovery-secret-with-32-bytes'
function value<T,F>(result:Result<T,F>):T {if(!result.ok)throw Error(JSON.stringify(result.fault));return result.value}
run('Slice 14 disconnected work recovery',()=>{
  let db:Database,clock:Date|undefined
  let closeResources:Array<()=>Promise<void>>
  beforeEach(async()=>{clock=undefined;closeResources=[];db=createDatabase(process.env.DATABASE_URL!);await db.query('truncate team.identities,team.space_key_reservations cascade')})
  afterEach(async()=>{for(const close of closeResources.reverse())await close();await db.end()})
  function modules(){
    const identity=new IdentityModuleImplementation(db,new MockOidcAdapter({issuer:'https://identity.example.test',subject:'admin',displayName:'Admin',email:null}),{
      redirectUri:origin+'/api/auth/callback',allowedOrigins:new Set([origin]),installationAdministrators:new Set(['https://identity.example.test|admin']),sessionHmacSecret:secret,
    })
    const space=new SpaceModuleImplementation(db,{invitationHmacSecret:secret,sessionHmacSecret:secret})
    const board=new BoardModuleImplementation(db,{now:()=>clock ?? new Date()})
    return {identity,space,board,agents:new AgentModuleImplementation(db,board,{runHmacSecret:secret}),exports:new SpaceExportModuleImplementation(db)}
  }
  async function fixture(){
    const app=modules()
    const begun=value(await app.identity.signIn({kind:'begin'}));if(begun.kind!=='redirect')throw Error('Expected redirect')
    const signed=value(await app.identity.signIn({kind:'complete',attemptSecret:begun.attemptSecret,callback:{code:'accepted-code',state:new URL(begun.authorizationUrl).searchParams.get('state')!}}));if(signed.kind!=='established')throw Error('Expected session')
    const resolved=value(await app.identity.session({kind:'resolve',use:'read',evidence:{sessionSecret:signed.session.sessionSecret}}));if(resolved.kind!=='resolved')throw Error('Expected identity')
    const who=resolved.identity
    const created=value(await app.space.change(who,{requestId:randomUUID() as RequestId,command:{kind:'create-space',input:{key:'DIG',displayName:'Recovery',timeZone:'Europe/Oslo'}}}));if(created.result.kind!=='space-created')throw Error('Expected Space')
    const selection={kind:'key' as const,spaceKey:'DIG' as SpaceKey}
    const access=value(await app.space.authorize(who,{use:'board-read',space:selection}))
    const initial=value(await app.board.read(access,{kind:'workflow'}));if(initial.kind!=='workflow')throw Error('Expected workflow')
    const change=async(command:BoardCommand)=>app.board.change(value(await app.space.authorize(who,{use:'board-change',space:selection})),{requestId:randomUUID() as RequestId,command})
    const review=initial.value.columns.find(c=>c.flowRole==='active')!
    value(await change({kind:'set-workflow',expectedRevision:initial.value.revision,desired:{columns:initial.value.columns,agentWork:{enabled:true,reviewColumnId:review.id}}}))
    value(await app.agents.manage(who,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
    const issued=value(await app.agents.manage(who,{kind:'create',id:randomUUID(),name:'Recovery client',spaceIds:[created.result.space.id],scope:'tasks:work'}));if(issued.kind!=='issued')throw Error('Expected token')
    const inbox=async()=>app.board.read(value(await app.space.authorize(who,{use:'board-read',space:selection})),{kind:'inbox'})
    return {...app,who,issued,change,inbox,review}
  }
  async function listen(server:Server){
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    let closed=false
    const stop=async()=>{if(closed)return;closed=true;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
    closeResources.push(stop)
    return {url:new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`),stop}
  }
  const host=()=>listen(createTeamServer(modules(),loadConfig({ALLOWED_ORIGINS:origin})))
  async function connect(url:URL,token:string){
    const client=new Client({name:'recovery-client',version:'1'})
    await client.connect(new StreamableHTTPClientTransport(url,{authProvider:{token:async()=>token}}))
    let closed=false
    const close=async()=>{if(!closed){closed=true;await client.close()}}
    closeResources.push(close)
    return {client,close}
  }
  async function call(client:Client,name:string,args:Record<string,unknown>){
    const result=await client.callTool({name,arguments:args})
    return result.structuredContent as unknown as Result<AgentReadView|AgentWorkView,{kind:string;reason?:string}>
  }
  async function readTask(client:Client):Promise<TaskDetail>{
    const result=value(await call(client,'dig_get_task',{key:'DIG-1'}));if(result.kind!=='task')throw Error('Expected Task');return result.value
  }
  async function begin(client:Client){
    const result=value(await call(client,'dig_start_run',{spaceKey:'DIG',requestId:randomUUID(),label:'Recover work'}));if(result.kind!=='run')throw Error('Expected run');return result.run
  }
  const runArgs=(run:AgentRunView)=>({spaceKey:'DIG',runId:run.id,runKey:run.runKey})
  async function capture(client:Client,run:AgentRunView,requestId=randomUUID()){
    const result=value(await call(client,'dig_create_task',{...runArgs(run),requestId,title:'Preserve this work'}));if(result.kind!=='changed')throw Error('Expected receipt')
    const task=result.receipt.update.changes.find(c=>c.kind==='task-upserted');if(task?.kind!=='task-upserted')throw Error('Expected Task projection');return task.task
  }

  it('resumes a live claim after reconnect while preserving intervening human edits and discussion',async()=>{
    const app=await fixture(),server=await host(),first=await connect(server.url,app.issued.token)
    const run=await begin(first.client),task=await capture(first.client,run)
    await first.close()
    value(await app.change({kind:'revise-task',task:{taskId:task.id,expectedRevision:task.revision},changes:{description:'Human clarification while Codex was closed'}}))
    value(await app.change({kind:'add-comment',taskId:task.id,text:'Keep the revised requirements',mentions:[]}))
    const returned=await connect(server.url,app.issued.token)
    const current=await readTask(returned.client)
    expect(current).toMatchObject({description:'Human clarification while Codex was closed',claim:{id:task.claim!.id},comments:{items:[{text:'Keep the revised requirements'}]}})
    const edit={...runArgs(run),taskId:task.id,claimId:task.claim!.id,expectedRevision:task.revision,title:'Agent title'}
    expect(await call(returned.client,'dig_update_task',{...edit,requestId:randomUUID()})).toMatchObject({ok:false,fault:{reason:'stale-task'}})
    value(await call(returned.client,'dig_update_task',{...edit,expectedRevision:current.revision,requestId:randomUUID()}))
    expect(await readTask(returned.client)).toMatchObject({title:'Agent title',description:'Human clarification while Codex was closed',claim:{id:task.claim!.id}})
    expect((await readTask(returned.client)).claim).toEqual(task.claim)
  })
  it('returns after simulated multi-day absence with current context and requires a fresh claim',async()=>{
    const app=await fixture(),server=await host(),first=await connect(server.url,app.issued.token)
    const run=await begin(first.client)
    // Issue the reservation three days in the past through the existing clock seam.
    // Real elapsed-time observation is a separate manual release gate.
    clock=new Date(Date.now()-3*24*60*60*1000)
    const task=await capture(first.client,run)
    expect(task.claim).not.toBeNull()
    await first.close();await server.stop();clock=undefined
    value(await app.change({kind:'revise-task',task:{taskId:task.id,expectedRevision:task.revision},changes:{description:'Changed scope during absence'}}))
    value(await app.change({kind:'add-comment',taskId:task.id,text:'Read this before resuming',mentions:[]}))
    const freshServer=await host(),returned=await connect(freshServer.url,app.issued.token)
    const current=await readTask(returned.client)
    expect(current).toMatchObject({claim:null,description:'Changed scope during absence',comments:{items:[{text:'Read this before resuming'}]}})
    const old={...runArgs(run),taskId:task.id,claimId:task.claim!.id}
    expect(await call(returned.client,'dig_add_comment',{...old,requestId:randomUUID(),text:'Stale agent progress'})).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    value(await call(returned.client,'dig_claim_task',{...runArgs(run),taskId:task.id,requestId:randomUUID()}))
    const reclaimed=await readTask(returned.client)
    expect(reclaimed.claim!.id).not.toBe(task.claim!.id)
    expect(reclaimed.claim!.runId).toBe(run.id)
    value(await call(returned.client,'dig_update_task',{...old,claimId:reclaimed.claim!.id,requestId:randomUUID(),expectedRevision:reclaimed.revision,title:'Resumed with current context'}))
    const final=await readTask(returned.client)
    expect(final).toMatchObject({title:'Resumed with current context',description:'Changed scope during absence',comments:{items:[{text:'Read this before resuming'}]}})
    expect(final.comments!.items).toHaveLength(1)
  })

  it('recovers a discarded handoff response through fresh server and client instances exactly once',async()=>{
    const app=await fixture(),server=await host(),first=await connect(server.url,app.issued.token)
    const run=await begin(first.client),task=await capture(first.client,run)
    const workflow=value(await call(first.client,'dig_get_workflow',{spaceKey:'DIG'}));if(workflow.kind!=='workflow')throw Error('Expected workflow')
    const handoff={...runArgs(run),taskId:task.id,claimId:task.claim!.id,expectedRevision:task.revision,expectedWorkflowRevision:workflow.value.revision,requestId:randomUUID(),report:{summary:'Prepared for review',verification:{outcome:'not-run',details:'This test exercises transport recovery'},limitations:'Human review still required'}}
    let discardedResponses=0
    // Drop a real upstream response at the network boundary after its body arrives.
    // Domain Modules and PostgreSQL remain unchanged and are never mocked.
    const proxy=await listen(createServer(async(request,response)=>{
      try {
        const chunks:Buffer[]=[]
        for await(const chunk of request)chunks.push(Buffer.from(chunk))
        const body=Buffer.concat(chunks).toString('utf8')
        const headers:Record<string,string>={}
        for(const name of ['authorization','content-type','accept','mcp-protocol-version'])if(typeof request.headers[name]==='string')headers[name]=request.headers[name]
        const upstream=await fetch(server.url,{method:request.method,headers,...(body ? {body} : {})})
        const text=await upstream.text()
        if(body && JSON.parse(body).params?.name==='dig_handoff_review'){
          discardedResponses++;response.destroy();return
        }
        response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type') ?? 'application/json'});response.end(text)
      }catch{response.destroy()}
    }))
    const interrupted=await connect(proxy.url,app.issued.token)
    await expect(call(interrupted.client,'dig_handoff_review',handoff)).rejects.toThrow()
    expect(discardedResponses).toBeGreaterThan(0)
    const committed=await readTask(first.client)
    expect(committed).toMatchObject({claim:null,columnId:app.review.id,comments:{items:[{reportKind:'review'}]}})
    expect(committed.comments!.items).toHaveLength(1)
    expect(value(await app.inbox())).toMatchObject({unreadNotifications:1,value:{items:[{kind:'agent-review'}]}})
    await interrupted.close();await proxy.stop();await first.close();await server.stop()
    const restarted=await host(),returned=await connect(restarted.url,app.issued.token)
    const receipt=value(await call(returned.client,'dig_handoff_review',handoff))
    expect(receipt).toMatchObject({kind:'changed',receipt:{result:{kind:'handoff-review'}}})
    expect(value(await call(returned.client,'dig_handoff_review',handoff))).toEqual(receipt)
    expect(await call(returned.client,'dig_handoff_review',{...handoff,report:{...handoff.report,summary:'Changed retry'}})).toMatchObject({ok:false,fault:{reason:'request-id-reused'}})
    expect(await call(returned.client,'dig_handoff_review',{...handoff,requestId:randomUUID()})).toMatchObject({ok:false,fault:{reason:'claim-lost'}})
    const final=await readTask(returned.client)
    expect(final).toMatchObject({claim:null,columnId:app.review.id,outcome:null,comments:{items:[{reportKind:'review',agent:{runId:run.id}}]}})
    expect(final.comments!.items).toHaveLength(1)
    expect(final.comments!.items[0].id).toBe(committed.comments!.items[0].id)
    expect(final.history!.items.filter(e=>e.kind==='agent-review')).toHaveLength(1)
    expect(value(await app.inbox())).toMatchObject({unreadNotifications:1,value:{items:[{kind:'agent-review'}]}})
    value(await app.agents.manage(app.who,{kind:'revoke',id:app.issued.connection.id}))
    await expect(call(returned.client,'dig_handoff_review',handoff)).rejects.toThrow()
    expect(value(await app.inbox())).toMatchObject({unreadNotifications:1})
  })

  it('requires a new run and claim after credential replacement without losing Task context',async()=>{
    const app=await fixture(),server=await host(),first=await connect(server.url,app.issued.token)
    const run=await begin(first.client),task=await capture(first.client,run)
    const comment={...runArgs(run),taskId:task.id,claimId:task.claim!.id,requestId:randomUUID(),text:'Work preserved before replacement'}
    value(await call(first.client,'dig_add_comment',comment))
    await first.close();await server.stop()
    const replaced=value(await app.agents.manage(app.who,{kind:'replace-token',id:app.issued.connection.id,expectedRevision:app.issued.connection.revision}));if(replaced.kind!=='issued')throw Error('Expected replacement')
    const restarted=await host(),returned=await connect(restarted.url,replaced.token)
    expect(await readTask(returned.client)).toMatchObject({claim:null,comments:{items:[{text:'Work preserved before replacement'}]}})
    expect(await call(returned.client,'dig_add_comment',{...comment,requestId:randomUUID(),text:'Old run write'})).toMatchObject({ok:false,fault:{reason:'run-invalid'}})
    const denied=await fetch(restarted.url,{method:'POST',headers:{authorization:`Bearer ${app.issued.token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'dig_add_comment',arguments:comment}})})
    expect(denied.status).toBe(401)
    const newRun=await begin(returned.client)
    value(await call(returned.client,'dig_claim_task',{...runArgs(newRun),taskId:task.id,requestId:randomUUID()}))
    const current=await readTask(returned.client)
    expect(current.claim!.id).not.toBe(task.claim!.id)
    expect(current.claim!.runId).toBe(newRun.id)
    expect(current.comments!.items).toHaveLength(1)
  })

  it('replays capture after fresh server instances without another Task or renewed claim',async()=>{
    const app=await fixture(),server=await host(),first=await connect(server.url,app.issued.token)
    const run=await begin(first.client),requestId=randomUUID(),task=await capture(first.client,run,requestId)
    value(await call(first.client,'dig_release_claim',{...runArgs(run),taskId:task.id,claimId:task.claim!.id,requestId:randomUUID()}))
    await first.close();await server.stop()
    const restarted=await host(),returned=await connect(restarted.url,app.issued.token)
    expect(await capture(returned.client,run,requestId)).toEqual(task)
    expect((await readTask(returned.client)).claim).toBeNull()
    const search=value(await call(returned.client,'dig_search_tasks',{spaceKey:'DIG',text:'',page:{size:50}}))
    expect(search).toMatchObject({kind:'tasks',value:{items:[{id:task.id}]}})
    if(search.kind!=='tasks')throw Error('Expected Tasks')
    expect(search.value.items).toHaveLength(1)
  })

})
