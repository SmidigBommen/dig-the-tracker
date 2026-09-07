import { BoardWorkspace } from '../views/BoardWorkspace.tsx'
import { HttpBoardTransport } from '../adapters/http/board-transport.ts'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  teamApi,
  type BoardOverview,
  type SpaceManagement,
  type SpaceManagementChange,
  type SpaceMember,
  type SpaceSummary,
  type TeamSession,
} from './team-api.ts'
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
  const [invitationLink, setInvitationLink] = useState<string>()
  const [management, setManagement] = useState<SpaceManagement>()
  const [showingArchived, setShowingArchived] = useState(false)
  const invitationSecret = invitationSecretFromPath(window.location.pathname)

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
        const result = await teamApi.spaces('active')
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
      const result = await teamApi.beginSignIn(window.location.pathname)
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

  const switchSpaceList = async () => {
    if (state.kind !== 'ready') return
    const include = showingArchived ? 'active' : 'archived'
    setBusy(true)
    try {
      const result = await teamApi.spaces(include)
      setShowingArchived(include === 'archived')
      setManagement(undefined)
      const selected = result.spaces[0]
      if (selected) await openBoard(state.session, result.spaces, selected.key)
      else setState({ kind: 'ready', session: state.session, spaces: [] })
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

  const issueInvitation = async () => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      const result = await teamApi.issueInvitation(state.session.csrfToken, state.selectedKey)
      setInvitationLink(new URL(result.invitationPath, window.location.origin).toString())
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const openManagement = async () => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      setManagement(await teamApi.management(state.selectedKey))
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const loadMoreManagement = async (kind: 'members' | 'invitations' | 'audit') => {
    if (state.kind !== 'ready' || !state.selectedKey || !management) return
    const cursor = management.next?.[kind]
    if (!cursor) return
    setBusy(true)
    try {
      const page = await teamApi.management(state.selectedKey, {
        [kind === 'members' ? 'membersAfter' : kind === 'invitations' ? 'invitationsAfter' : 'auditAfter']: cursor,
      })
      const next = { ...management.next, [kind]: page.next?.[kind] }
      if (kind === 'members') {
        setManagement({ ...management, members: [...management.members, ...page.members], next })
      } else if (kind === 'invitations') {
        setManagement({ ...management, invitations: [...management.invitations, ...page.invitations], next })
      } else {
        setManagement({ ...management, audit: [...management.audit, ...page.audit], next })
      }
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const setMemberRole = async (member: SpaceMember, role: SpaceMember['role']) => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      const result = await teamApi.manageSpace(state.session.csrfToken, state.selectedKey, {
        action: 'set-member-role',
        memberId: member.id,
        expectedRevision: member.revision,
        role,
      })
      if (result.csrfToken) {
        const session = {
          ...state.session,
          csrfToken: result.csrfToken,
          absoluteExpiresAt: result.absoluteExpiresAt ?? state.session.absoluteExpiresAt,
        }
        const spaces = state.spaces.map((space) => space.key === state.selectedKey
          ? { ...space, memberRole: role }
          : space)
        setManagement(undefined)
        await openBoard(session, spaces, state.selectedKey)
        return
      }
      setManagement(await teamApi.management(state.selectedKey))
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (member: SpaceMember) => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      const result = await teamApi.manageSpace(state.session.csrfToken, state.selectedKey, {
        action: 'remove-member', memberId: member.id, expectedRevision: member.revision,
      })
      if (result.signedOut) {
        localStorage.removeItem(LAST_SPACE_KEY)
        setState({ kind: 'anonymous' })
        setManagement(undefined)
        return
      }
      if (result.csrfToken) {
        const session = {
          ...state.session,
          csrfToken: result.csrfToken,
          absoluteExpiresAt: result.absoluteExpiresAt ?? state.session.absoluteExpiresAt,
        }
        const spaces = state.spaces.filter((space) => space.key !== state.selectedKey)
        setManagement(undefined)
        if (spaces[0]) await openBoard(session, spaces, spaces[0].key)
        else setState({ kind: 'ready', session, spaces })
        return
      }
      setManagement(await teamApi.management(state.selectedKey))
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const revokeInvitation = async (invitationId: string) => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      await teamApi.manageSpace(state.session.csrfToken, state.selectedKey, {
        action: 'revoke-invitation', invitationId,
      })
      setManagement(await teamApi.management(state.selectedKey))
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const reviseSpace = async (displayName: string, timeZone: string, expectedRevision: number) => {
    await changeManagedSpace({ action: 'revise-space', expectedRevision, displayName, timeZone })
  }

  const changeSpaceLifecycle = async (
    action: Extract<SpaceManagementChange, { expectedRevision: number }>['action'],
    expectedRevision: number,
  ) => {
    await changeManagedSpace({ action, expectedRevision } as SpaceManagementChange)
  }

  const changeManagedSpace = async (change: SpaceManagementChange) => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      await teamApi.manageSpace(state.session.csrfToken, state.selectedKey, change)
      setManagement(await teamApi.management(state.selectedKey))
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const closeManagement = async () => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      const include = showingArchived ? 'archived' : 'active'
      const result = await teamApi.spaces(include)
      const selected = result.spaces.find((space) => space.key === state.selectedKey) ?? result.spaces[0]
      setManagement(undefined)
      if (selected) {
        await openBoard(state.session, result.spaces, selected.key)
      } else {
        localStorage.removeItem(LAST_SPACE_KEY)
        setState({ kind: 'ready', session: state.session, spaces: [] })
      }
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const acceptInvitation = async () => {
    if (state.kind !== 'ready' || !invitationSecret) return
    setBusy(true)
    try {
      const result = await teamApi.acceptInvitation(state.session.csrfToken, invitationSecret)
      const session = {
        ...state.session,
        csrfToken: result.csrfToken ?? state.session.csrfToken,
        absoluteExpiresAt: result.absoluteExpiresAt ?? state.session.absoluteExpiresAt,
      }
      const spaces = [...state.spaces.filter((space) => space.id !== result.space.id), result.space]
      window.history.replaceState({}, '', '/')
      await openBoard(session, spaces, result.space.key)
    } catch (error) {
      setState({ ...state, error: message(error) })
    } finally {
      setBusy(false)
    }
  }

  const leaveSpace = async () => {
    if (state.kind !== 'ready' || !state.selectedKey) return
    setBusy(true)
    try {
      const result = await teamApi.manageSpace(state.session.csrfToken, state.selectedKey, { action: 'leave-space' })
      localStorage.removeItem(LAST_SPACE_KEY)
      if (result.signedOut) {
        setState({ kind: 'anonymous' })
        return
      }
      const session = {
        ...state.session,
        csrfToken: result.csrfToken ?? state.session.csrfToken,
        absoluteExpiresAt: result.absoluteExpiresAt ?? state.session.absoluteExpiresAt,
      }
      const spaces = state.spaces.filter((space) => space.key !== state.selectedKey)
      if (spaces[0]) await openBoard(session, spaces, spaces[0].key)
      else setState({ kind: 'ready', session, spaces })
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
          <button className="quiet-button" onClick={() => void switchSpaceList()} disabled={busy}>
            {showingArchived ? 'Active Spaces' : 'Archived Spaces'}
          </button>
          <span className="identity-name">{state.session.identity.displayName}</span>
          <button className="quiet-button" onClick={() => void signOut()} disabled={busy}>Sign out</button>
        </div>
      </header>

      {state.error && <p className="team-error page-error" role="alert">{state.error}</p>}
      {invitationSecret
        ? <InvitationPanel busy={busy} onAccept={acceptInvitation} />
        : management
          ? <SpaceManagementPanel
              management={management}
              busy={busy}
              onSetMemberRole={setMemberRole}
              onRemoveMember={removeMember}
              onRevokeInvitation={revokeInvitation}
              onReviseSpace={reviseSpace}
              onChangeLifecycle={changeSpaceLifecycle}
              onLoadMore={loadMoreManagement}
              onClose={closeManagement}
            />
          : state.spaces.length === 0
            ? showingArchived
              ? <NoArchivedSpaces />
              : state.session.identity.installationAdministrator
                ? <CreateSpaceForm busy={busy} onCreate={createSpace} />
                : <NoSpace />
            : state.board
          ? <Board
              board={state.board}
              csrfToken={state.session.csrfToken}
              canAdminister={state.spaces.find((space) => space.key === state.selectedKey)?.memberRole === 'space-administrator'}
              busy={busy}
              invitationLink={invitationLink}
              onIssueInvitation={issueInvitation}
              onOpenManagement={openManagement}
              onLeaveSpace={leaveSpace}
            />
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
        <p>An installation administrator can create one, or you can join through an invitation link.</p>
      </section>
    </main>
  )
}

function NoArchivedSpaces() {
  return (
    <main className="team-centered">
      <section className="empty-panel">
        <h1>No archived Spaces</h1>
        <p>Archived Spaces appear here until an administrator restores them or their deletion window ends.</p>
      </section>
    </main>
  )
}

function InvitationPanel({ busy, onAccept }: { busy: boolean; onAccept: () => Promise<void> }) {
  return (
    <main className="team-centered">
      <section className="empty-panel">
        <p className="eyebrow">Space invitation</p>
        <h1>Join this Space</h1>
        <p>Accept the invitation to open its Board.</p>
        <button className="primary-button" onClick={() => void onAccept()} disabled={busy}>
          {busy ? 'Joining...' : 'Join Space'}
        </button>
      </section>
    </main>
  )
}

function Board({
  board,
  csrfToken,
  canAdminister,
  busy,
  invitationLink,
  onIssueInvitation,
  onOpenManagement,
  onLeaveSpace,
}: {
  board: BoardOverview
  csrfToken: string
  canAdminister: boolean
  busy: boolean
  invitationLink?: string
  onIssueInvitation: () => Promise<void>
  onOpenManagement: () => Promise<void>
  onLeaveSpace: () => Promise<void>
}) {
  const transport = useMemo(() => new HttpBoardTransport(board.space.key, csrfToken), [board.space.key, csrfToken])
  return (
    <main className="board-page">
      <div className="board-heading">
        <div>
          <p className="eyebrow">{board.space.key}</p>
          <h1>{board.space.displayName}</h1>
          {board.space.lifecycle !== 'active' && (
            <p className="lifecycle-badge">
              {board.space.lifecycle === 'archived' ? 'Archived · read-only' : 'Deletion scheduled · read-only'}
            </p>
          )}
        </div>
        <div className="board-actions">
          <p>{board.members.length} {board.members.length === 1 ? 'Member' : 'Members'} · {board.space.timeZone}</p>
          {board.space.lifecycle === 'active' && (
            <button className="danger-button" onClick={() => void onLeaveSpace()} disabled={busy}>Leave Space</button>
          )}
          {canAdminister && (
            <>
              <button className="quiet-button" onClick={() => void onOpenManagement()} disabled={busy}>
                Manage Space
              </button>
              {board.space.lifecycle === 'active' && (
                <button className="quiet-button" onClick={() => void onIssueInvitation()} disabled={busy}>
                  Invite teammate
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {invitationLink && (
        <label className="invitation-link">
          <span>Invitation link</span>
          <input aria-label="Invitation link" value={invitationLink} readOnly onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      <BoardWorkspace key={`${board.board.id}:${csrfToken}`} initialBoard={board} transport={transport} />
    </main>
  )
}

function SpaceManagementPanel({
  management,
  busy,
  onSetMemberRole,
  onRemoveMember,
  onRevokeInvitation,
  onReviseSpace,
  onChangeLifecycle,
  onLoadMore,
  onClose,
}: {
  management: SpaceManagement
  busy: boolean
  onSetMemberRole: (member: SpaceMember, role: SpaceMember['role']) => Promise<void>
  onRemoveMember: (member: SpaceMember) => Promise<void>
  onRevokeInvitation: (invitationId: string) => Promise<void>
  onReviseSpace: (displayName: string, timeZone: string, expectedRevision: number) => Promise<void>
  onChangeLifecycle: (
    action: 'archive-space' | 'restore-space' | 'schedule-space-deletion' | 'cancel-space-deletion',
    expectedRevision: number,
  ) => Promise<void>
  onLoadMore: (kind: 'members' | 'invitations' | 'audit') => Promise<void>
  onClose: () => Promise<void>
}) {
  return (
    <main className="management-page">
      <div className="management-heading">
        <div>
          <p className="eyebrow">{management.space.key} settings</p>
          <h1>Members</h1>
        </div>
        <button className="quiet-button" onClick={() => void onClose()}>Back to Board</button>
      </div>
      <SpaceSettingsForm management={management} busy={busy} onRevise={onReviseSpace} onLifecycle={onChangeLifecycle} />
      <section className="management-panel" aria-label="Space Members">
        {management.members.map((member) => (
          <div className="member-row" data-member={member.id} key={member.id}>
            <div>
              <strong>{member.displayName}</strong>
              <span>{member.role === 'space-administrator' ? 'Space administrator' : 'Member'}</span>
            </div>
            <div className="member-actions">
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() => void onSetMemberRole(
                  member,
                  member.role === 'member' ? 'space-administrator' : 'member',
                )}
              >
                {member.role === 'member' ? `Promote ${member.displayName}` : `Make ${member.displayName} a Member`}
              </button>
              <button className="danger-button" disabled={busy} onClick={() => void onRemoveMember(member)}>
                Remove {member.displayName}
              </button>
            </div>
          </div>
        ))}
        {management.next?.members && (
          <button className="quiet-button" disabled={busy} onClick={() => void onLoadMore('members')}>
            Load more Members
          </button>
        )}
      </section>
      <h2 className="management-section-title">Invitations</h2>
      <section className="management-panel" aria-label="Space invitations">
        {management.invitations.length === 0 && <p className="management-empty">No invitations issued.</p>}
        {management.invitations.map((invitation) => (
          <div className="member-row" key={invitation.id}>
            <div>
              <strong>{invitation.state === 'pending' ? 'Pending invitation' : invitationState(invitation.state)}</strong>
              <span>Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
            </div>
            {invitation.state === 'pending' && (
              <button className="danger-button" disabled={busy} onClick={() => void onRevokeInvitation(invitation.id)}>
                Revoke invitation
              </button>
            )}
          </div>
        ))}
        {management.next?.invitations && (
          <button className="quiet-button" disabled={busy} onClick={() => void onLoadMore('invitations')}>
            Load more invitations
          </button>
        )}
      </section>
      <h2 className="management-section-title">Access audit</h2>
      <section className="management-panel" aria-label="Access audit">
        {management.audit.length === 0 && <p className="management-empty">No access changes recorded.</p>}
        {management.audit.map((entry) => (
          <div className="audit-row" key={entry.id}>
            <strong>{auditAction(entry.action)} by {entry.actorDisplayName}</strong>
            <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
          </div>
        ))}
        {management.next?.audit && (
          <button className="quiet-button" disabled={busy} onClick={() => void onLoadMore('audit')}>
            Load more audit entries
          </button>
        )}
      </section>
    </main>
  )
}

function SpaceSettingsForm({
  management,
  busy,
  onRevise,
  onLifecycle,
}: {
  management: SpaceManagement
  busy: boolean
  onRevise: (displayName: string, timeZone: string, expectedRevision: number) => Promise<void>
  onLifecycle: (
    action: 'archive-space' | 'restore-space' | 'schedule-space-deletion' | 'cancel-space-deletion',
    expectedRevision: number,
  ) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(management.space.displayName)
  const [timeZone, setTimeZone] = useState(management.space.timeZone)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onRevise(displayName.trim(), timeZone.trim(), management.space.revision)
  }

  return (
    <section className="space-settings" aria-label="Space settings">
      <form onSubmit={submit}>
        <label>
          <span>Space name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} required />
        </label>
        <label>
          <span>Time zone</span>
          <input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} maxLength={100} required />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>Save Space settings</button>
      </form>
      <div className="lifecycle-actions">
        {management.space.lifecycle === 'active' && (
          <button className="danger-button" disabled={busy} onClick={() => void onLifecycle('archive-space', management.space.revision)}>
            Archive Space
          </button>
        )}
        {management.space.lifecycle === 'archived' && (
          <>
            <button className="quiet-button" disabled={busy} onClick={() => void onLifecycle('restore-space', management.space.revision)}>
              Restore Space
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void onLifecycle('schedule-space-deletion', management.space.revision)}>
              Schedule deletion
            </button>
          </>
        )}
        {management.space.lifecycle === 'deletion_scheduled' && (
          <>
            {management.space.deletionScheduledFor && <p>Deletion scheduled for {formatDate(management.space.deletionScheduledFor)}</p>}
            <button className="quiet-button" disabled={busy} onClick={() => void onLifecycle('cancel-space-deletion', management.space.revision)}>
              Cancel deletion
            </button>
          </>
        )}
      </div>
    </section>
  )
}

function invitationState(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function auditAction(action: string): string {
  return action.split('-').map((word, index) => index === 0
    ? word.charAt(0).toUpperCase() + word.slice(1)
    : word).join(' ')
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(value))
}

function invitationSecretFromPath(pathname: string): string | undefined {
  const match = /^\/invitations\/([^/]+)$/.exec(pathname)
  if (!match) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return undefined
  }
}

function status(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}
