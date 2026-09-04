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
}

export interface BoardOverview {
  space: {
    id: string
    key: string
    displayName: string
    timeZone: string
    lifecycle: 'active' | 'archived' | 'deletion_scheduled'
    revision: number
  }
  board: { id: string; changeSequence: number; workflowRevision: number }
  columns: Array<{
    id: string
    name: string
    flowRole: 'queue' | 'active' | 'complete'
    intake: boolean
    completion: boolean
    wipLimit: number | null
    position: number
    revision: number
  }>
  members: Array<{
    id: string
    displayName: string
    role: 'member' | 'space-administrator'
  }>
  tasks: { items: []; next?: string }
  unreadNotifications: number
}

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
  beginSignIn: () => request<{ authorizationUrl: string }>('/api/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify({ returnTo: '/' }),
  }),
  signOut: (csrfToken: string) => request<void>('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken, 'x-request-id': requestId() },
  }),
  spaces: () => request<{ spaces: SpaceSummary[]; next?: string }>('/api/spaces'),
  createSpace: (
    csrfToken: string,
    input: { displayName: string; key: string; timeZone: string },
  ) => request<SpaceSummary>('/api/spaces', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    body: JSON.stringify({ requestId: requestId(), ...input }),
  }),
  board: (spaceKey: string) => request<BoardOverview>(`/api/spaces/${encodeURIComponent(spaceKey)}/board`),
}
