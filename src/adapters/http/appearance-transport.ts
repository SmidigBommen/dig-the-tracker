import type { AppearancePreference, AppearanceView } from '../../../api/contracts/appearance.ts'
import { AppearanceConflict, type AppearanceTransport } from '../../appearance/appearance-session.ts'

export class HttpAppearanceTransport implements AppearanceTransport {
  read() { return this.request() }
  save(preference: AppearancePreference, expectedRevision: number, csrfToken: string) {
    return this.request({ method: 'POST',headers: { 'content-type': 'application/json','x-csrf-token': csrfToken },
      body: JSON.stringify({ preference,expectedRevision }) })
  }
  private async request(init?: RequestInit): Promise<AppearanceView> {
    const response = await fetch('/api/appearance',{ credentials: 'same-origin',...init })
    const body = await response.json()
    if (!response.ok) {
      if (body.fault?.kind === 'appearance-conflict') throw new AppearanceConflict(body.fault.current)
      throw new Error(response.status === 401 || response.status === 403 ? 'Sign in again to save appearance.' : 'Could not load appearance. Try again.')
    }
    return body as AppearanceView
  }
}
