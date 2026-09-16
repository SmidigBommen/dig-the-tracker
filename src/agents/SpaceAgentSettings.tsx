import { useEffect,useState } from 'react'
import type { AgentSpaceOption } from '../../api/contracts/agents.ts'
import { Button } from '../ui/Button.tsx'
import { manageAgents } from './agent-api.ts'
import './agents.css'
export function SpaceAgentSettings({ spaceKey,csrfToken }:{spaceKey:string;csrfToken:string}) {
  const [settings,setSettings]=useState<AgentSpaceOption>()
  const [error,setError]=useState<string>()
  const [busy,setBusy]=useState(false)
  const [confirm,setConfirm]=useState(false)
  const [reload,setReload]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    void manageAgents({ kind:'space-settings',spaceKey },csrfToken,controller.signal).then(result=>{ if(result.kind==='space-settings') { setSettings(result.space);setError(undefined) } }).catch(failure=>{ if(!controller.signal.aborted)setError(failure.message) })
    return ()=>controller.abort()
  },[spaceKey,csrfToken,reload])
  const change=async()=>{
    if(!settings)return
    setBusy(true);setError(undefined)
    try {
      const result=await manageAgents({ kind:'set-space-access',spaceKey,enabled:!settings.enabled,expectedRevision:settings.revision },csrfToken)
      if(result.kind==='space-settings')setSettings(result.space)
      setConfirm(false)
    } catch(failure) { setError(failure instanceof Error ? failure.message : 'Could not change access.') }
    finally { setBusy(false) }
  }
  return <section className="space-settings" aria-labelledby="space-agent-title">
    <h2 id="space-agent-title">Agent access</h2>
    <p>Allow Members to create personal, read-only connections for this Space. Agents are optional and do not run inside Dig.</p>
    <p role="status">{settings ? `Agent access is ${settings.enabled ? 'enabled' : 'disabled'}.` : 'Loading agent settings…'}</p>
    {settings && (confirm ? <div className="agent-confirm"><p>Disable agent access? Existing connections will lose access to this Space immediately. Re-enabling requires Members to create new connections.</p><div className="agent-actions"><Button variant="danger" disabled={busy} onClick={()=>void change()}>Confirm disable</Button><Button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button></div></div>
      : <Button disabled={busy} onClick={()=>settings.enabled ? setConfirm(true) : void change()}>{settings.enabled ? 'Disable agent access' : 'Enable agent access'}</Button>)}
    {error && <p role="alert" className="team-error">{error} <Button variant="ghost" onClick={()=>setReload(value=>value+1)}>Reload settings</Button></p>}
  </section>
}
