import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { teamApi, type BoardOverview, type SpaceSummary, type TeamSession } from './team-api.ts'
import './TeamApp.css'

type AppState =
  | { kind: 'loading' }
  | { kind: 'anonymous'; error?: string }
  | {
      kind: 'ready'
      session: TeamSession
      spaces: SpaceSummary[]
      selectedKey?: string
      board?: BoardOverview
      error?: string
    }

const LAST_SPACE_KEY = 'dig:last-space'

export default function TeamApp() {
  const [state, setState] = useState<AppState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  const openBoard = useCallback(async (session: TeamSession, spaces: SpaceSummary[], key: string) => {
    localStorage.setItem(LAST_SPACE_KEY, key)
    setState({ kind: 'ready', session, spaces, selectedKey: key })
    try {
      const board = await teamApi.board(key)
      setState({ kind: 'ready', session, spaces, selectedKey: key, board })
    } catch (error) {
      setState({ kind: 'ready', session, spaces, selectedKey: key, error: message(error) })
    }
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const session = await teamApi.session()
        const result = await teamApi.spaces()
        if (!active) return
        const remembered = localStorage.getItem(LAST_SPACE_KEY)
        const selected = result.spaces.find((space) => space.key === remembered) ?? result.spaces[0]
        if (selected) await openBoard(session, result.spaces, selected.key)
        else setState({ kind: 'ready', session, spaces: [] })
      } catch (error) {
        if (!active) return
        if (status(error) === 401) setState({ kind: 'anonymous' })
        else setState({ kind: 'anonymous', error: message(error) })
      }
    }
    void load()
    return () => { active = false }
  }, [openBoard])

  const signIn = async () => {
    setBusy(true)
    try {
      const result = await teamApi.beginSignIn()
      window.location.assign(result.authorizationUrl)
    } catch (error) {
      setState({ kind: 'anonymous', error: message(error) })
      setBusy(false)
    }
  }

  const signOut = async () => {
    if (state.kind !== 'ready') return
    setBusy(true)
    try {
      await teamApi.signOut(state.session.csrfToken)
      localStorage.removeItem(LAST_SPACE_KEY)
      setState({ kind: 'anonymous' })
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const createSpace = async (input: { displayName: string; key: string; timeZone: string }) => {
    if (state.kind !== 'ready') return
    setBusy(true)
    try {
      const created = await teamApi.createSpace(state.session.csrfToken, input)
      const spaces = [...state.spaces, created]
      await openBoard(state.session, spaces, created.key)
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'loading') {
    return <main className="team-shell team-centered" aria-live="polite">Opening Dig...</main>
  }

  if (state.kind === 'anonymous') {
    return (
      <main className="team-shell team-centered">
        <section className="welcome-panel" aria-labelledby="welcome-title">
          <Logo />
          <p className="eyebrow">Flow-based Kanban for small teams</p>
          <h1 id="welcome-title">See the work. Find the wait.</h1>
          <p className="welcome-copy">Sign in through your team's identity provider to open your Spaces.</p>
          {state.error && <p className="team-error" role="alert">{state.error}</p>}
          <button className="primary-button" onClick={() => void signIn()} disabled={busy}>Sign in</button>
        </section>
      </main>
    )
  }

  return (
    <div className="team-shell">
      <header className="team-header">
        <Logo />
        <div className="header-actions">
          {state.spaces.length > 0 && (
            <label className="space-picker">
              <span>Space</span>
              <select
                value={state.selectedKey ?? ''}
                onChange={(event) => void openBoard(state.session, state.spaces, event.target.value)}
              >
                {state.spaces.map((space) => <option key={space.id} value={space.key}>{space.displayName}</option>)}
              </select>
            </label>
          )}
          <span className="identity-name">{state.session.identity.displayName}</span>
          <button className="quiet-button" onClick={() => void signOut()} disabled={busy}>Sign out</button>
        </div>
      </header>

      {state.error && <p className="team-error page-error" role="alert">{state.error}</p>}
      {state.spaces.length === 0
        ? state.session.identity.installationAdministrator
          ? <CreateSpaceForm busy={busy} onCreate={createSpace} />
          : <NoSpace />
        : state.board
          ? <Board board={state.board} />
          : <main className="team-centered" aria-live="polite">Opening Board...</main>}
    </div>
  )
}

function Logo() {
  return <div className="dig-logo" aria-label="Dig"><span aria-hidden="true">D</span><strong>Dig</strong></div>
}

function CreateSpaceForm({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (input: { displayName: string; key: string; timeZone: string }) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState('')
  const [key, setKey] = useState('')
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onCreate({ displayName: displayName.trim(), key: key.trim().toUpperCase(), timeZone: timeZone.trim() })
  }

  return (
    <main className="team-centered">
      <form className="create-space-panel" onSubmit={submit}>
        <p className="eyebrow">Installation setup</p>
        <h1>Create your first Space</h1>
        <p>A Space contains one Board and the Members who can work in it.</p>
        <label htmlFor="space-name">
          <span>Space name</span>
          <input id="space-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} required autoFocus />
        </label>
        <label htmlFor="space-key">
          <span>Space key</span>
          <input
            id="space-key"
            value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())}
            minLength={2}
            maxLength={10}
            pattern="[A-Za-z][A-Za-z0-9]{1,9}"
            aria-describedby="space-key-help"
            required
          />
          <small id="space-key-help">2 to 10 letters or numbers. This forms Task keys such as DIG-5 and cannot be reused.</small>
        </label>
        <label htmlFor="space-time-zone">
          <span>Time zone</span>
          <input id="space-time-zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} maxLength={100} required />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create Space'}</button>
      </form>
    </main>
  )
}

function NoSpace() {
  return (
    <main className="team-centered">
      <section className="empty-panel">
        <h1>No Spaces yet</h1>
        <p>An installation administrator can create one, or you can accept an invitation when invitations arrive in Slice 2.</p>
      </section>
    </main>
  )
}

function Board({ board }: { board: BoardOverview }) {
  return (
    <main className="board-page">
      <div className="board-heading">
        <div>
          <p className="eyebrow">{board.space.key}</p>
          <h1>{board.space.displayName}</h1>
        </div>
        <p>{board.members.length} {board.members.length === 1 ? 'Member' : 'Members'} · {board.space.timeZone}</p>
      </div>
      <div className="column-grid" aria-label={`${board.space.displayName} Board`}>
        {board.columns.map((column) => (
          <section className={`flow-column flow-${column.flowRole}`} key={column.id} aria-labelledby={`column-${column.id}`}>
            <header>
              <div>
                <p className="flow-role">{column.flowRole}</p>
                <h2 id={`column-${column.id}`}>{column.name}</h2>
              </div>
              {column.wipLimit !== null && <span className="wip-limit">WIP limit {column.wipLimit}</span>}
            </header>
            <div className="empty-column">No Tasks yet</div>
          </section>
        ))}
      </div>
    </main>
  )
}

function status(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}
