import type { AgentManagementRequest,AgentManagementView } from '../../api/contracts/agents.ts'
export async function manageAgents(request:AgentManagementRequest,csrfToken:string,signal?:AbortSignal):Promise<AgentManagementView> {
  const settings=request.kind==='space-settings' || request.kind==='set-space-access'
  const read=request.kind==='list' || request.kind==='space-settings'
  const response=await fetch(settings ? `/api/spaces/${encodeURIComponent(request.spaceKey)}/agent-access` : '/api/agent-connections',{
    method:read ? 'GET' : 'POST',credentials:'same-origin',signal,
    ...(!read ? { headers:{ 'content-type':'application/json','x-csrf-token':csrfToken },body:JSON.stringify(request) } : {}),
  })
  const body=await response.json()
  if(!response.ok)throw new Error(body.error ?? 'Could not load connection settings. Try again.')
  return body as AgentManagementView
}
