import { useCallback,useSyncExternalStore } from 'react'
import type { TaskClaim } from '../../api/contracts/board.ts'
import { Button } from '../ui/Button.tsx'
import './agents.css'

function useActiveClaim(claim:TaskClaim|null|undefined) {
  const subscribe=useCallback((notify:()=>void)=>{
    if(!claim)return ()=>{}
    const remaining=Date.parse(claim.expiresAt)-Date.now()
    const timer=setTimeout(notify,Math.max(0,Math.min(remaining+5,2147483647)))
    return ()=>clearTimeout(timer)
  },[claim])
  const snapshot=useCallback(()=>claim && Date.parse(claim.expiresAt)>Date.now() ? claim : null,[claim])
  return useSyncExternalStore(subscribe,snapshot,()=>null)
}
export function TaskClaimBadge({claim}:{claim:TaskClaim|null|undefined}) {
  const active=useActiveClaim(claim)
  return active && <span className="agent-claim-badge" title={`${active.member.displayName} via ${active.connectionName}. Claim expires ${new Date(active.expiresAt).toLocaleString()}.`}>Agent claim · {active.connectionName}</span>
}
export function TaskClaimDetails({claim,canRelease,disabled,onRelease}:{claim:TaskClaim|null|undefined;canRelease:boolean;disabled:boolean;onRelease:()=>void}) {
  const active=useActiveClaim(claim)
  return active && <section className="agent-claim-details" aria-label="Agent claim">
    <div><strong>{active.member.displayName} via {active.connectionName}</strong><span>Claim expires <time dateTime={active.expiresAt}>{new Date(active.expiresAt).toLocaleTimeString()}</time></span></div>
    <p>Last check-in {new Date(active.lastCheckInAt).toLocaleTimeString()}. You can keep editing while this Task is claimed.</p>
    {canRelease && <><Button disabled={disabled} onClick={onRelease}>Release claim</Button><p className="agent-note">Release stops further Dig updates. It cannot stop an external coding session.</p></>}
  </section>
}
