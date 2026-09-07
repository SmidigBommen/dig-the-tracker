import type { BoardFault, BoardQuery, BoardView, ChangeReceipt, ChangeRequest } from '../../../api/contracts/board.ts'
import type { Result } from '../../../api/modules/shared.ts'
import type { BoardTransport } from '../../board-session/board-session.ts'

export class HttpBoardTransport implements BoardTransport {
  private readonly path: string
  private readonly csrfToken: string

  constructor(spaceKey: string, csrfToken: string) {
    this.path = `/api/spaces/${encodeURIComponent(spaceKey)}/board`
    this.csrfToken = csrfToken
  }

  read(query: BoardQuery) {
    return this.request<BoardView>(`${this.path}/views?query=${encodeURIComponent(JSON.stringify(query))}`)
  }

  change(request: ChangeRequest) {
    return this.request<ChangeReceipt>(`${this.path}/changes`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrfToken }, body: JSON.stringify(request) })
  }

  private async request<T>(path: string, init?: RequestInit): Promise<Result<T, BoardFault>> {
    try {
      const response = await fetch(path, { credentials: 'same-origin', ...init })
      const body = await response.json()
      if (response.ok) return { ok: true, value: body as T }
      if (response.status === 401 || response.status === 403) return { ok: false, fault: { kind: 'forbidden' } }
      return { ok: false, fault: body.fault ?? { kind: 'temporarily-unavailable' } }
    } catch { return { ok: false, fault: { kind: 'temporarily-unavailable' } } }
  }
}
