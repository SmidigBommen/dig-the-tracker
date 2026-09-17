import { useEffect,useRef,useState } from 'react'
import type { AgentManagementRequest,AgentManagementView } from '../../api/contracts/agents.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { manageAgents } from './agent-api.ts'
import './agents.css'

type Connections=Extract<AgentManagementView,{kind:'connections'}>
type Issued=Extract<AgentManagementView,{kind:'issued'}>
export function ConnectionsDialog({ csrfToken,onClose }:{ csrfToken:string;onClose:()=>void }) {
  const [data,setData]=useState<Connections>()
  const [issued,setIssued]=useState<Issued>()
  const [name,setName]=useState('Codex')
  const [scope,setScope]=useState<'tasks:read'|'tasks:work'>('tasks:read')
  const [spaces,setSpaces]=useState<string[]>([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string>()
  const [copied,setCopied]=useState(false)
  const [confirm,setConfirm]=useState<{ id:string;action:'revoke'|'replace-token';revision:number }>()
  const creationId=useRef(crypto.randomUUID())
  const controller=useRef<AbortController|null>(null)
  const tokenField=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    const abort=new AbortController();controller.current=abort
    void manageAgents({ kind:'list' },csrfToken,abort.signal).then(result=>{ if(result.kind==='connections')setData(result) }).catch(failure=>{ if(!abort.signal.aborted)setError(failure.message) })
    return ()=>{ abort.abort();controller.current=null }
  },[csrfToken])
  const change=async(request:AgentManagementRequest)=>{
    setBusy(true);setError(undefined);setConfirm(undefined)
    const signal=controller.current?.signal
    try {
      const result=await manageAgents(request,csrfToken,signal)
      if(signal?.aborted)return
      if(result.kind==='issued') { setIssued(result);setCopied(false);creationId.current=crypto.randomUUID() }
      const listed=await manageAgents({ kind:'list' },csrfToken,signal)
      if(!signal?.aborted && listed.kind==='connections')setData(listed)
    } catch(failure) { if(!signal?.aborted)setError(failure instanceof Error ? failure.message : 'Could not save the connection.') }
    finally { if(!signal?.aborted)setBusy(false) }
  }
  const copy=async()=>{
    if(!issued)return
    try { await navigator.clipboard.writeText(issued.token);setCopied(true) }
    catch { tokenField.current?.focus();tokenField.current?.select();setError('Copy the selected token manually.') }
  }
  return <Dialog title="Agent connections" closeLabel="Close connections dialog" onClose={onClose}>
    <div className="agent-connections">
      <p>Connect Codex to selected Spaces as you. Choose read access or explicitly allow claim-protected work. Connections cannot close Tasks, administer Spaces, or read your inbox. Agents only connect when you use them.</p>
      {error && <p role="alert" className="team-error">{error} <Button variant="ghost" disabled={busy} onClick={()=>void change({ kind:'list' })}>Reload</Button></p>}
      {issued ? <section className="agent-token" aria-labelledby="agent-token-title">
        <h3 id="agent-token-title">Save your token</h3>
        <p>Shown once. Save it in your password manager before closing. It expires {new Date(issued.connection.expiresAt).toLocaleDateString()}.</p>
        <label>Connection token<input ref={tokenField} readOnly value={issued.token} autoComplete="off" spellCheck={false} onFocus={event=>event.currentTarget.select()} /></label>
        <div className="agent-actions"><Button onClick={()=>void copy()}>{copied ? 'Copied' : 'Copy token'}</Button><Button variant="primary" onClick={()=>setIssued(undefined)}>I saved the token</Button></div>
      </section> : <form className="agent-create" onSubmit={event=>{ event.preventDefault();void change({ kind:'create',id:creationId.current,name,spaceIds:spaces,scope }) }}>
        <h3>New connection</h3>
        <fieldset disabled={busy}><legend>Permission</legend>
          <label className="agent-space-choice"><input type="radio" name="agent-scope" checked={scope==='tasks:read'} onChange={()=>setScope('tasks:read')} />Read only</label>
          <label className="agent-space-choice"><input type="radio" name="agent-scope" checked={scope==='tasks:work'} onChange={()=>setScope('tasks:work')} />Allow agent work</label>
          {scope==='tasks:work' && <p>Allows creating and claiming Tasks, editing claimed work, posting comments, and moving progress. Human review and completion stay with you.</p>}
        </fieldset>
        <label>Connection name<input value={name} maxLength={80} required onChange={event=>setName(event.target.value)} placeholder="Codex on my Mac" /></label>
        <fieldset disabled={busy}><legend>Spaces this connection can access</legend>
          {data?.eligibleSpaces.map(space=><label className="agent-space-choice" key={space.id}><input type="checkbox" checked={spaces.includes(space.id)} onChange={event=>setSpaces(previous=>event.target.checked ? [...previous,space.id] : previous.filter(id=>id!==space.id))} />{space.key} · {space.displayName}</label>)}
          {data && data.eligibleSpaces.length===0 && <p>A Space administrator must enable agent access in Manage Space first.</p>}
        </fieldset>
        <p className="agent-note">{scope==='tasks:read' ? 'Read access only' : 'Claim-protected work'} · Expires after 30 days · Up to 20 Spaces</p>
        <Button variant="primary" type="submit" disabled={busy || !name.trim() || !spaces.length || spaces.length>20}>{busy ? 'Saving…' : 'Create connection'}</Button>
      </form>}
      <details className="agent-setup"><summary>Connect Codex</summary><div>
        <p>Set <code>DIG_TOKEN</code> in the environment that launches Codex. Enter the token through a hidden prompt, so it stays out of shell history.</p>
        <pre><code>{"# zsh on macOS\nread -rs 'DIG_TOKEN?Dig token: '; echo\nexport DIG_TOKEN"}</code></pre>
        <p>Add this MCP server in Codex CLI, using the token environment variable:</p>
        <pre><code>{`codex mcp add dig --url ${window.location.origin}/mcp --bearer-token-env-var DIG_TOKEN`}</code></pre>
        <p>For the desktop app, add the same URL and token environment variable in MCP settings. The app must receive that variable when it starts. A launch from Finder usually does not inherit terminal variables.</p>
        <p>Ask Codex to show a Task by key. Optional local skill setup and credential storage instructions are in the repository's agent setup guide.</p>
      </div></details>
      <section aria-labelledby="agent-existing-title"><h3 id="agent-existing-title">Your connections</h3>
        {!data && <p role="status">Loading connections…</p>}
        {data?.connections.length===0 && <p>No connections yet.</p>}
        {data?.connections.map(connection=>{
          const active=!connection.revokedAt && Date.parse(connection.expiresAt)>Date.now()
          return <article className="agent-connection" key={connection.id}>
            <div><strong>{connection.name}</strong><span className="agent-note">{connection.revokedAt ? 'Revoked' : active ? `Expires ${new Date(connection.expiresAt).toLocaleDateString()}` : 'Expired'}</span></div>
            <p className="agent-note">{connection.scope==='tasks:work' ? 'Agent work allowed' : 'Read only'}</p>
            <p>{connection.spaces.map(space=>`${space.key || space.displayName}${space.available ? '' : ' (unavailable)'}`).join(', ')}</p>
            <p className="agent-note">Created {new Date(connection.createdAt).toLocaleDateString()}. Last used {connection.lastUsedAt ? new Date(connection.lastUsedAt).toLocaleString() : 'never'}. This does not indicate whether an agent is online.</p>
            {connection.spaces.some(space=>!space.available) && <p className="agent-note">Create a new connection to grant access again after a Space or membership change.</p>}
            {!connection.revokedAt && (confirm?.id===connection.id ? <div className="agent-confirm">
              <p>{confirm.action==='revoke' ? 'Revoke this connection? Its token will stop working immediately.' : 'Replace the token? The old token will stop working immediately. Save the new one and update Codex.'}</p>
              <div className="agent-actions"><Button variant="danger" disabled={busy} onClick={()=>void change(confirm.action==='revoke' ? { kind:'revoke',id:connection.id } : { kind:'replace-token',id:connection.id,expectedRevision:confirm.revision })}>{confirm.action==='revoke' ? 'Confirm revoke' : 'Confirm replacement'}</Button><Button disabled={busy} onClick={()=>setConfirm(undefined)}>Cancel</Button></div>
            </div> : <div className="agent-actions"><Button disabled={busy || Boolean(issued)} onClick={()=>setConfirm({ id:connection.id,action:'replace-token',revision:connection.revision })}>Replace token</Button><Button variant="danger" disabled={busy} onClick={()=>setConfirm({ id:connection.id,action:'revoke',revision:connection.revision })}>Revoke</Button></div>)}
          </article>
        })}
        {data?.truncated && <p>Showing the 100 most recent connections, with active connections first.</p>}
      </section>
    </div>
  </Dialog>
}
