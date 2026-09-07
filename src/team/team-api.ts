import type { BoardOverview } from '../../api/contracts/board.ts'
export interface TeamSession {
  authenticated: true
  identity: {
    id: string
    displayName: string
    installationAdministrator: boolean
  }
  csrfToken: string
  absoluteExpiresAt: string
}

export interface SpaceSummary {
  id: string
  key: string
  displayName: string
  timeZone: string
  lifecycle: 'active' | 'archived' | 'deletion_scheduled'
  revision: number
  accessRevision: number
  memberRole: 'member' | 'space-administrator'
  deletionScheduledFor?: string
}

export type { BoardOverview } from '../../api/contracts/board.ts'

export interface SpaceMember {
  id: string
  displayName: string
  role: 'member' | 'space-administrator'
  revision: number
  joinedAt: string
}

export interface SpaceInvitation {
  id: string
  issuedAt: string
  expiresAt: string
  state: 'pending' | 'accepted' | 'revoked' | 'expired'
}

export interface SpaceAuditEntry {
  id: string
  action: string
  actorDisplayName: string
  subjectMemberId?: string
  invitationId?: string
  occurredAt: string
}

export interface SpaceManagement {
  space: SpaceSummary
  members: SpaceMember[]
  invitations: SpaceInvitation[]
  audit: SpaceAuditEntry[]
  next?: {
    members?: string
    invitations?: string
    audit?: string
  }
}

export interface SpaceManagementPage {
  membersAfter?: string
  invitationsAfter?: string
  auditAfter?: string
}

export type SpaceManagementChange =
  | { action: 'set-member-role'; memberId: string; expectedRevision: number; role: SpaceMember['role'] }
  | { action: 'remove-member'; memberId: string; expectedRevision: number }
  | { action: 'revoke-invitation'; invitationId: string }
  | { action: 'leave-space' }
  | { action: 'revise-space'; expectedRevision: number; displayName?: string; timeZone?: string }
  | { action: 'archive-space' | 'restore-space' | 'schedule-space-deletion' | 'cancel-space-deletion'; expectedRevision: number }

export class TeamApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body
      ? { 'content-type': 'application/json', ...init.headers }
      : init?.headers,
  })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new TeamApiError(response.status, result.error ?? `Request failed (${response.status})`)
  return result as T
}

function requestId(): string {
  return crypto.randomUUID()
}

export const teamApi = {
  session: () => request<TeamSession>('/api/session'),
  beginSignIn: (returnTo = '/') => request<{ authorizationUrl: string }>('/api/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify({ returnTo }),
  }),
  signOut: (csrfToken: string) => request<void>('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken, 'x-request-id': requestId() },
  }),
  spaces: (include: 'active' | 'archived' = 'active') => request<{ spaces: SpaceSummary[]; next?: string }>(
    `/api/spaces?include=${include}`,
  ),
  createSpace: (
    csrfToken: string,
    input: { displayName: string; key: string; timeZone: string },
  ) => request<SpaceSummary>('/api/spaces', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    body: JSON.stringify({ requestId: requestId(), ...input }),
  }),
  board: (spaceKey: string) => request<BoardOverview>(`/api/spaces/${encodeURIComponent(spaceKey)}/board`),
  issueInvitation: (csrfToken: string, spaceKey: string) => request<{ invitationPath: string }>(
    `/api/spaces/${encodeURIComponent(spaceKey)}/invitations`,
    {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      body: JSON.stringify({ requestId: requestId() }),
    },
  ),
  acceptInvitation: (csrfToken: string, invitationSecret: string) => request<{
    space: SpaceSummary
    csrfToken?: string
    absoluteExpiresAt?: string
  }>(`/api/invitations/${encodeURIComponent(invitationSecret)}/accept`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    body: JSON.stringify({ requestId: requestId() }),
  }),
  management: (spaceKey: string, page: SpaceManagementPage = {}) => {
    const search = new URLSearchParams()
    if (page.membersAfter) search.set('membersAfter', page.membersAfter)
    if (page.invitationsAfter) search.set('invitationsAfter', page.invitationsAfter)
    if (page.auditAfter) search.set('auditAfter', page.auditAfter)
    const query = search.size > 0 ? `?${search.toString()}` : ''
    return request<SpaceManagement>(`/api/spaces/${encodeURIComponent(spaceKey)}/management${query}`)
  },
  manageSpace: (csrfToken: string, spaceKey: string, change: SpaceManagementChange) => request<{
    result: Record<string, unknown>
    csrfToken?: string
    absoluteExpiresAt?: string
    signedOut?: boolean
  }>(`/api/spaces/${encodeURIComponent(spaceKey)}/management`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    body: JSON.stringify({ requestId: requestId(), ...change }),
  }),
}
