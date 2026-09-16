export interface AgentSpaceOption { id: string; key: string; displayName: string; enabled: boolean; revision: number }
export interface AgentConnectionView {
  id: string; name: string; scope: 'tasks:read'; createdAt: string; expiresAt: string; lastUsedAt: string | null
  revokedAt: string | null; revision: number; spaces: Array<{ id: string; key: string; displayName: string; available: boolean }>
}
export type AgentManagementRequest =
  | { kind: 'list' }
  | { kind: 'create'; id: string; name: string; spaceIds: string[] }
  | { kind: 'revoke'; id: string }
  | { kind: 'replace-token'; id: string; expectedRevision: number }
  | { kind: 'space-settings'; spaceKey: string }
  | { kind: 'set-space-access'; spaceKey: string; enabled: boolean; expectedRevision: number }
export type AgentManagementView =
  | { kind: 'connections'; connections: AgentConnectionView[]; eligibleSpaces: AgentSpaceOption[]; truncated: boolean }
  | { kind: 'issued'; connection: AgentConnectionView; token: string }
  | { kind: 'revoked' }
  | { kind: 'space-settings'; space: AgentSpaceOption }
