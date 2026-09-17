export interface AgentSpaceOption { id: string; key: string; displayName: string; enabled: boolean; revision: number }
export interface AgentConnectionView {
  id: string; name: string; scope: 'tasks:read' | 'tasks:work'; createdAt: string; expiresAt: string; lastUsedAt: string | null
  revokedAt: string | null; revision: number; spaces: Array<{ id: string; key: string; displayName: string; available: boolean }>
}
export type AgentManagementRequest =
  | { kind: 'list' }
  | { kind: 'create'; id: string; name: string; spaceIds: string[]; scope?: 'tasks:read' | 'tasks:work' }
  | { kind: 'revoke'; id: string }
  | { kind: 'replace-token'; id: string; expectedRevision: number }
  | { kind: 'space-settings'; spaceKey: string }
  | { kind: 'set-space-access'; spaceKey: string; enabled: boolean; expectedRevision: number }
export type AgentManagementView =
  | { kind: 'connections'; connections: AgentConnectionView[]; eligibleSpaces: AgentSpaceOption[]; truncated: boolean }
  | { kind: 'issued'; connection: AgentConnectionView; token: string }
  | { kind: 'revoked' }
  | { kind: 'space-settings'; space: AgentSpaceOption }

export interface AgentRunView { id:string;runKey:string;label:string;spaceKey:string;createdAt:string }
export type AgentWorkRequest =
  | {kind:'start-run';spaceKey:string;requestId:string;label:string}
  | {kind:'change';spaceKey:string;runId:string;runKey:string;requestId:string;claimId?:string;command:import('./board.js').BoardCommand}
export type AgentWorkView = {kind:'run';run:AgentRunView} | {kind:'changed';receipt:import('./board.js').ChangeReceipt}
