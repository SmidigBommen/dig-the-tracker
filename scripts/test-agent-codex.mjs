// Disposable, opt-in proof using the installed Codex CLI and its existing login.
// Tokens stay in the child's environment; no production connection is touched.
import { mkdtemp,readFile,writeFile,copyFile,mkdir,cp,rm } from 'node:fs/promises'
import { tmpdir,homedir } from 'node:os'
import { join,resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createDatabase } from '../api-dist/db.js'
import { migrate } from '../api-dist/migrate.js'
import { loadConfig } from '../api-dist/config.js'
import { createTeamServer } from '../api-dist/server.js'
import { IdentityModuleImplementation } from '../api-dist/modules/identity/identity-module.js'
import { SpaceModuleImplementation } from '../api-dist/modules/space/space-module.js'
import { BoardModuleImplementation } from '../api-dist/modules/board/board-module.js'
import { AgentModuleImplementation } from '../api-dist/modules/agent/agent-module.js'
import { SpaceExportModuleImplementation } from '../api-dist/modules/export/export-module.js'
import { MockOidcAdapter } from '../api-dist/adapters/oidc/mock-oidc-adapter.js'
const handoffMode=process.env.DIG_MCP_HANDOFF_TEST==='1'
const workMode=handoffMode || process.env.DIG_MCP_WORK_TEST==='1'
const url=process.env.DIG_MCP_DATABASE_URL
if(!url || new URL(url).pathname!=='/dig_mcp' || !['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Use a disposable loopback dig_mcp database')
const unwrap=result=>{ if(!result.ok)throw Error(`Fixture failed: ${result.fault.kind}`);return result.value }
await migrate(url)
const db=createDatabase(url),temporary=await mkdtemp(join(tmpdir(),'dig-codex-check-'))
let server
try {
  await db.query('truncate team.identities,team.space_key_reservations cascade')
  const origin='http://127.0.0.1:5181',secret='disposable-mcp-session-secret-with-32-bytes',issuer='https://identity.example.test'
  const identity=new IdentityModuleImplementation(db,new MockOidcAdapter({issuer,subject:'codex-check',displayName:'Codex Tester'}),{
    redirectUri:origin+'/api/auth/callback',allowedOrigins:new Set([origin]),installationAdministrators:new Set([issuer+'|codex-check']),sessionHmacSecret:secret,
  })
  const space=new SpaceModuleImplementation(db,{invitationHmacSecret:secret,sessionHmacSecret:secret}),board=new BoardModuleImplementation(db),agents=new AgentModuleImplementation(db,board,{runHmacSecret:secret})
  const begun=unwrap(await identity.signIn({kind:'begin'}))
  const signed=unwrap(await identity.signIn({kind:'complete',attemptSecret:begun.attemptSecret,callback:{code:'accepted-code',state:new URL(begun.authorizationUrl).searchParams.get('state')}}))
  const session=unwrap(await identity.session({kind:'resolve',use:'read',evidence:{sessionSecret:signed.session.sessionSecret}}))
  const created=unwrap(await space.change(session.identity,{requestId:randomUUID(),command:{kind:'create-space',input:{key:'DIG',displayName:'Disposable MCP check',timeZone:'Europe/Oslo'}}}))
  const access=unwrap(await space.authorize(session.identity,{use:'board-change',space:{kind:'key',spaceKey:'DIG'}}))
  if(workMode) {
    const read=unwrap(await space.authorize(session.identity,{use:'board-read',space:{kind:'key',spaceKey:'DIG'}}))
    const workflow=unwrap(await board.read(read,{kind:'workflow'})).value
    unwrap(await board.change(access,{requestId:randomUUID(),command:{kind:'set-workflow',expectedRevision:workflow.revision,desired:{columns:workflow.columns,agentWork:{enabled:true,reviewColumnId:workflow.columns.find(c=>c.flowRole==='active').id}}}}))
  }
  const title=`Read proof ${randomUUID()}`
  unwrap(await board.change(access,{requestId:randomUUID(),command:{kind:'capture-task',input:{title,description:'Disposable local integration fixture.'}}}))
  unwrap(await agents.manage(session.identity,{kind:'set-space-access',spaceKey:'DIG',enabled:true,expectedRevision:1}))
  const issued=unwrap(await agents.manage(session.identity,{kind:'create',id:randomUUID(),name:'Disposable Codex CLI',spaceIds:[created.result.space.id],scope:workMode ? 'tasks:work' : 'tasks:read'}))
  const seen=[]
  server=createTeamServer({identity,space,board,agents:{
    work:async(principal,request)=>{const result=await agents.work(principal,request);seen.push({work:request.kind==='change' ? request.command.kind : request.kind,ok:result.ok});return result},manage:agents.manage.bind(agents),authenticate:agents.authenticate.bind(agents),
    read:async(principal,query)=>{seen.push({tool:query.kind});return agents.read(principal,query)},
  },exports:new SpaceExportModuleImplementation(db)},loadConfig({ALLOWED_ORIGINS:origin}))
  server.on('request',request=>{if(request.url==='/mcp' && request.headers['mcp-protocol-version'])seen.push({protocol:request.headers['mcp-protocol-version']})})
  await new Promise(resolve=>server.listen(5181,'127.0.0.1',resolve))
  const codexHome=join(temporary,'codex'),workspace=join(temporary,'workspace'),output=join(temporary,'answer.txt')
  await mkdir(codexHome,{mode:0o700});await mkdir(workspace,{mode:0o700})
  await copyFile(join(process.env.CODEX_HOME ?? join(homedir(),'.codex'),'auth.json'),join(codexHome,'auth.json'))
  await writeFile(join(codexHome,'config.toml'),`[mcp_servers.dig]\nurl = "${origin}/mcp"\nbearer_token_env_var = "DIG_TOKEN"\n`,{mode:0o600})
  await cp(resolve('skills/dig'),join(workspace,'.agents/skills/dig'),{recursive:true})
  const marker=`Verified work ${randomUUID()}`
  const prompt=handoffMode ? `$dig work DIG-1. This is a disposable local MCP integration check in an empty temporary workspace. Read and claim the Task, set its description to exactly "${marker}", report a blocker explaining test access is missing and asking for a test account. Then simulate the person supplying access: reread and reclaim the Task, and hand it off for human review. Report verification as not-run because this fixture has no code or tests; use "${marker}" as the handoff summary. Report the exact original Task title. No shell commands, code changes, push, or deployment are needed.` : workMode ? `$dig work DIG-1. This is a disposable local MCP integration check in an empty temporary workspace. Read and claim the Task, set its description to exactly "${marker}", add a comment with exactly "${marker}", then release the claim. Report the exact original Task title. No code changes, shell commands, push, or deployment are needed.` : '$dig show DIG-1. Read it through the configured Dig MCP tool and report its exact title. Do not use shell commands or change anything.'
  const child=spawn('codex',['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','-C',workspace,'--output-last-message',output,prompt],{
    env:{...process.env,CODEX_HOME:codexHome,DIG_TOKEN:issued.token},stdio:['ignore','pipe','pipe'],
  })
  let diagnostics=''
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-20000)})
  const timer=setTimeout(()=>child.kill('SIGTERM'),120000)
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
  clearTimeout(timer)
  const answer=await readFile(output,'utf8').catch(()=>'')
  if(code!==0 || !answer.includes(title) || !seen.some(call=>call.tool==='task')) {
    // The CLI may include tool content in diagnostics. Keep disposable credentials out of output.
    console.error(JSON.stringify({event:'codex-protocol-failure',calls:seen}))
    if(!workMode)console.error(diagnostics.replaceAll(issued.token,'[redacted]'))
    throw Error('Codex CLI did not prove a Task read')
  }
  if(workMode) {
    const principal=unwrap(await agents.authenticate(issued.token))
    const task=unwrap(await agents.read(principal,{kind:'task',key:'DIG-1'})).value
    if(task.description!==marker || task.claim!==null || !task.comments.items.some(comment=>(handoffMode ? comment.reportKind==='review' && comment.text.includes(marker) : comment.text===marker) && comment.agent))throw Error('Codex work did not update, attribute, and release the Task')
    if(handoffMode && (!task.comments.items.some(comment=>comment.reportKind==='blocked') || !task.comments.items.some(comment=>comment.text.includes('Verification: Not run'))))throw Error('Missing truthful handoff or blocker report')
    for(const command of ['start-run','claim-task','revise-task',...(handoffMode ? ['report-blocker','handoff-review'] : ['add-comment','release-task-claim'])])if(!seen.some(call=>call.work===command && call.ok))throw Error(`Missing successful work call: ${command}`)
  }
  console.info(JSON.stringify({event:'codex-mcp-proof',passed:true,calls:seen}))
  unwrap(await agents.manage(session.identity,{kind:'revoke',id:issued.connection.id}))
} finally {
  if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  await db.end();await rm(temporary,{recursive:true,force:true})
}
