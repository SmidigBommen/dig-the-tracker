import { defaultAppearance, isAppearancePreference, type AppearancePreference, type AppearanceView } from '../../api/contracts/appearance.ts'

export interface AppearanceTransport {
  read(): Promise<AppearanceView>
  save(preference: AppearancePreference, expectedRevision: number, csrfToken: string): Promise<AppearanceView>
}
export class AppearanceConflict extends Error {
  readonly current: AppearanceView
  constructor(current: AppearanceView) { super('Appearance changed in another session. Retry to use your selection.');this.current=current }
}
type State = AppearancePreference & { ready: boolean; saving: boolean; error?: string }
type Message = { order: number; operation: string; view: AppearanceView; saving: boolean; error?: string }
const lastKey = 'dig:appearance:last'
const accountKey = (id: string) => `dig:appearance:account:${id}`
const cacheKey = (id: string) => `dig:appearance:cached:${id}`
const preferenceOf = (value: AppearancePreference): AppearancePreference => ({ palette: value.palette,mode: value.mode })

function stored(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key,JSON.stringify(value)) } catch { /* Account persistence still works when browser storage is unavailable. */ }
}
function message(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false
  const item = value as Message
  return Number.isSafeInteger(item.order) && item.order >= 0 && typeof item.operation === 'string' && typeof item.saving === 'boolean' && (item.error === undefined || typeof item.error === 'string')
    && !!item.view && typeof item.view.identityId === 'string' && Number.isSafeInteger(item.view.revision) && item.view.revision >= 0
    && isAppearancePreference(preferenceOf(item.view))
}

// Owns appearance only; changing its snapshot never recreates a BoardSession.
export class AppearanceSession {
  private state: State
  private listeners = new Set<() => void>()
  private identityId?: string
  private csrfToken = ''
  private revision = 0
  private generation = 0
  private operation = ''
  private order = 0
  private pending = false
  private saveLoopRunning = false
  private media?: MediaQueryList
  private readonly transport: AppearanceTransport
  constructor(transport: AppearanceTransport) {
    this.transport=transport
    const cached = stored(lastKey)
    this.state = { ...(isAppearancePreference(cached) ? cached : defaultAppearance), ready: false,saving: false }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener);return () => { this.listeners.delete(listener) } }

  connect(identityId?: string, csrfToken = '') {
    this.csrfToken = csrfToken
    if (this.identityId === identityId && this.media) return
    this.stop()
    this.identityId = identityId
    this.media = window.matchMedia?.('(prefers-color-scheme: dark)')
    this.media?.addEventListener('change',this.systemChanged)
    window.addEventListener('storage',this.receive)
    if (!identityId) { this.set({ ready: false,saving: false,error: undefined });return }
    const cached = stored(cacheKey(identityId))
    this.revision = 0
    this.set({ ...(message(cached) && cached.view.identityId === identityId ? preferenceOf(cached.view) : defaultAppearance),ready: false,saving: false,error: undefined })
    void this.load()
  }
  stop() {
    this.generation++
    this.media?.removeEventListener('change',this.systemChanged)
    window.removeEventListener('storage',this.receive)
    this.media = undefined
    this.identityId = undefined
    this.pending = false
    this.saveLoopRunning = false
    this.operation = ''
    this.order = 0
  }
  choose(preference: AppearancePreference) {
    if (!this.identityId || !this.state.ready || !isAppearancePreference(preference)) return
    this.operation = crypto.randomUUID()
    this.order = Math.max(Date.now(),this.order+1)
    this.pending = true
    this.set({ ...preference,saving: true,error: undefined })
    this.publish()
    void this.save()
  }
  retry() { if (this.state.ready) this.choose(preferenceOf(this.state));else void this.load() }

  private async load() {
    const identityId = this.identityId, generation = this.generation, operation = this.operation
    if (!identityId) return
    this.set({ error: undefined })
    try {
      const view = await this.transport.read()
      if (generation !== this.generation) return
      if (view.identityId !== identityId) throw new Error('Your account changed. Reload Dig before changing appearance.')
      this.revision = Math.max(this.revision,view.revision)
      if (this.operation === operation) {
        this.operation = crypto.randomUUID()
        this.set({ ...preferenceOf(view),ready: true,saving: false,error: undefined })
        // Reading a preference is never a write back to the account or other tabs.
        store(cacheKey(identityId),{ order: this.order,operation: this.operation,view,saving: false })
      } else this.set({ ready: true })
    } catch (error) {
      if (generation === this.generation) this.set({ error: error instanceof Error ? error.message : 'Could not load appearance. Try again.' })
    }
  }
  private async save() {
    if (this.saveLoopRunning || !this.identityId) return
    this.saveLoopRunning = true
    const generation = this.generation, identityId = this.identityId
    try {
      while (this.pending && generation === this.generation) {
        this.pending = false
        const operation = this.operation, preference = preferenceOf(this.state)
        try {
          const view = await this.transport.save(preference,this.revision,this.csrfToken)
          if (generation !== this.generation) return
          if (view.identityId !== identityId) throw new Error('Your account changed. Reload Dig before changing appearance.')
          this.revision = Math.max(this.revision,view.revision)
          if (operation === this.operation) { this.set({ saving: false,error: undefined });this.publish() }
        } catch (error) {
          if (generation !== this.generation) return
          if (error instanceof AppearanceConflict && error.current.identityId === identityId) this.revision = Math.max(this.revision,error.current.revision)
          if (operation === this.operation) {
            this.set({ saving: false,error: error instanceof AppearanceConflict ? error.message : 'Appearance is applied here but could not be saved. Retry when connected.' })
            this.publish()
          }
        }
      }
    } finally { if (generation === this.generation) this.saveLoopRunning = false }
  }
  private publish() {
    if (!this.identityId) return
    const value = { order: this.order,operation: this.operation,
      view: { ...preferenceOf(this.state),identityId: this.identityId,revision: this.revision },saving: this.state.saving,error: this.state.error }
    store(cacheKey(this.identityId),value)
    store(accountKey(this.identityId),value)
  }
  private receive = (event: StorageEvent) => {
    if (!this.identityId || event.key !== accountKey(this.identityId) || !event.newValue) return
    let incoming: unknown
    try { incoming = JSON.parse(event.newValue) } catch { return }
    if (!message(incoming) || incoming.view.identityId !== this.identityId) return
    // A stale completed write must not replace a newer account read. Pending
    // choices and their failures still matter, even before they have a revision.
    if (incoming.view.revision < this.revision && incoming.operation !== this.operation && !incoming.saving && !incoming.error) return
    this.revision = Math.max(this.revision,incoming.view.revision)
    // Revision orders persisted writes; the logical clock also orders concurrent
    // choices made before either tab has received a save response.
    if (incoming.order < this.order || (incoming.order === this.order && incoming.operation < this.operation)) return
    this.operation = incoming.operation
    this.order = incoming.order
    this.pending = false
    this.set({ ...preferenceOf(incoming.view),saving: incoming.saving,error: incoming.error })
    store(cacheKey(this.identityId),incoming)
  }
  private set(changes: Partial<State>) {
    this.state = { ...this.state,...changes }
    this.apply()
    store(lastKey,preferenceOf(this.state))
    for (const listener of this.listeners) listener()
  }
  private apply = () => {
    const root = document.documentElement
    root.dataset.palette = this.state.palette
    root.dataset.scheme = this.state.mode === 'system' ? this.media?.matches ? 'dark' : 'light' : this.state.mode
    const canvas = getComputedStyle(root).getPropertyValue('--dig-canvas').trim()
    if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute('content',canvas)
  }
  private systemChanged = () => { this.set({}) }
}
