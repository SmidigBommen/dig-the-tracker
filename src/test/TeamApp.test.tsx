import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const teamApi = vi.hoisted(() => ({
  session: vi.fn(),
  beginSignIn: vi.fn(),
  signOut: vi.fn(),
  spaces: vi.fn(),
  createSpace: vi.fn(),
  board: vi.fn(),
  issueInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  management: vi.fn(),
  manageSpace: vi.fn(),
}))

vi.mock('../team/team-api.ts', () => ({ teamApi }))

import TeamApp from '../team/TeamApp.tsx'

const session = {
  authenticated: true as const,
  identity: { id: 'identity-1', displayName: 'Ada Admin', installationAdministrator: true },
  csrfToken: 'csrf-token',
  absoluteExpiresAt: '2026-10-04T08:00:00.000Z',
}

const space = {
  id: 'space-1',
  key: 'DIG',
  displayName: 'Delivery',
  timeZone: 'Europe/Oslo',
  lifecycle: 'active' as const,
  revision: 1,
  accessRevision: 1,
  memberRole: 'space-administrator' as const,
}

const board = {
  space: {
    id: 'space-1', key: 'DIG', displayName: 'Delivery', timeZone: 'Europe/Oslo', lifecycle: 'active' as const, revision: 1,
  },
  board: { id: 'board-1', changeSequence: 0, workflowRevision: 1 },
  columns: [
    { id: 'backlog', name: 'Backlog', flowRole: 'queue' as const, intake: true, completion: false, wipLimit: null, position: 0, revision: 1, tasks: { items: [] }, counts: { tasks: 0, parentTasks: 0, subtasks: 0 } },
    { id: 'progress', name: 'In Progress', flowRole: 'active' as const, intake: false, completion: false, wipLimit: 3, position: 1000, revision: 1, tasks: { items: [] }, counts: { tasks: 0, parentTasks: 0, subtasks: 0 } },
    { id: 'done', name: 'Done', flowRole: 'complete' as const, intake: false, completion: true, wipLimit: null, position: 2000, revision: 1, tasks: { items: [] }, counts: { tasks: 0, parentTasks: 0, subtasks: 0 } },
  ],
  members: [{ id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const }],
  tasks: { items: [] },
  unreadNotifications: 0,
}

describe('TeamApp Slice 1 shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    })
    window.history.replaceState({}, '', '/')
  })

  it('offers sign-in when there is no session', async () => {
    teamApi.session.mockRejectedValueOnce(Object.assign(new Error('Sign in required'), { status: 401 }))
    render(<TeamApp />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('lets an installation administrator create and open a Space', async () => {
    const user = userEvent.setup()
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [] })
    teamApi.createSpace.mockResolvedValueOnce(space)
    teamApi.board.mockResolvedValueOnce(board)

    render(<TeamApp />)
    expect(await screen.findByRole('heading', { name: 'Create your first Space' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Space name'), 'Delivery')
    await user.type(screen.getByLabelText(/Space key/), 'dig')
    await user.clear(screen.getByLabelText('Time zone'))
    await user.type(screen.getByLabelText('Time zone'), 'Europe/Oslo')
    await user.click(screen.getByRole('button', { name: 'Create Space' }))

    expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeInTheDocument()
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Limit 3')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getAllByText('No Tasks yet')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Add a Task' })).toBeInTheDocument()
    expect(teamApi.createSpace).toHaveBeenCalledWith('csrf-token', expect.objectContaining({
      displayName: 'Delivery', key: 'DIG', timeZone: 'Europe/Oslo',
    }))
  })

  it('reopens the last accessible Space after session reload', async () => {
    localStorage.setItem('dig:last-space', 'DIG')
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [space] })
    teamApi.board.mockResolvedValueOnce(board)

    render(<TeamApp />)
    await waitFor(() => expect(teamApi.board).toHaveBeenCalledWith('DIG'))
    expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeInTheDocument()
  })

  it('marks an archived Space as read-only when reopened', async () => {
    const user = userEvent.setup()
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces
      .mockResolvedValueOnce({ spaces: [] })
      .mockResolvedValueOnce({ spaces: [{ ...space, lifecycle: 'archived' }] })
    teamApi.board.mockResolvedValueOnce({
      ...board, space: { ...board.space, lifecycle: 'archived' as const },
    })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Archived Spaces' }))
    expect(teamApi.spaces).toHaveBeenLastCalledWith('archived')
    expect(await screen.findByText('Archived · read-only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave Space' })).not.toBeInTheDocument()
  })

  it('lets an administrator issue a shareable invitation', async () => {
    const user = userEvent.setup()
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [space] })
    teamApi.board.mockResolvedValueOnce(board)
    teamApi.issueInvitation.mockResolvedValueOnce({ invitationPath: '/invitations/invitation-secret' })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Invite teammate' }))
    expect(teamApi.issueInvitation).toHaveBeenCalledWith('csrf-token', 'DIG')
    expect(await screen.findByRole('textbox', { name: 'Invitation link' })).toHaveValue(
      'http://localhost:3000/invitations/invitation-secret',
    )
  })

  it('lets an authenticated invitation recipient join and open the Board', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/invitations/invitation-secret')
    teamApi.session.mockResolvedValueOnce({
      ...session,
      identity: { ...session.identity, displayName: 'Mira Member', installationAdministrator: false },
    })
    teamApi.spaces.mockResolvedValueOnce({ spaces: [] })
    teamApi.acceptInvitation.mockResolvedValueOnce({ space: { ...space, memberRole: 'member' }, csrfToken: 'rotated-csrf' })
    teamApi.board.mockResolvedValueOnce({
      ...board,
      members: [...board.members, { id: 'member-2', displayName: 'Mira Member', role: 'member' as const }],
    })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Join Space' }))
    expect(teamApi.acceptInvitation).toHaveBeenCalledWith('csrf-token', 'invitation-secret')
    expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeInTheDocument()
    expect(screen.getByText('2 Members · Europe/Oslo')).toBeInTheDocument()
  })

  it('lets an administrator inspect Members and promote one', async () => {
    const user = userEvent.setup()
    const member = {
      id: 'member-2', displayName: 'Mira Member', role: 'member' as const, revision: 1,
      joinedAt: '2026-09-04T12:00:00.000Z',
    }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [space] })
    teamApi.board.mockResolvedValueOnce({
      ...board,
      members: [...board.members, { id: member.id, displayName: member.displayName, role: member.role }],
    })
    teamApi.management
      .mockResolvedValueOnce({ space, members: [{ ...member, id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' }, member], invitations: [], audit: [] })
      .mockResolvedValueOnce({ space, members: [{ ...member, id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' }, { ...member, role: 'space-administrator', revision: 2 }], invitations: [], audit: [] })
      .mockResolvedValueOnce({ space, members: [{ ...member, id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' }], invitations: [], audit: [] })
    teamApi.manageSpace
      .mockResolvedValueOnce({ result: { kind: 'member-role-changed', member: { ...member, role: 'space-administrator', revision: 2 } } })
      .mockResolvedValueOnce({ result: { kind: 'member-removed', memberId: member.id } })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Promote Mira Member' }))

    expect(teamApi.manageSpace).toHaveBeenCalledWith('csrf-token', 'DIG', {
      action: 'set-member-role',
      memberId: 'member-2',
      expectedRevision: 1,
      role: 'space-administrator',
    })
    expect(await screen.findByText('Space administrator', { selector: '[data-member="member-2"] *' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Mira Member' }))
    expect(teamApi.manageSpace).toHaveBeenLastCalledWith('csrf-token', 'DIG', {
      action: 'remove-member', memberId: 'member-2', expectedRevision: 2,
    })
    await waitFor(() => expect(screen.queryByText('Mira Member')).not.toBeInTheDocument())
  })

  it('returns a Member to sign-in after leaving their only Space', async () => {
    const user = userEvent.setup()
    const memberSession = {
      ...session,
      identity: { ...session.identity, displayName: 'Mira Member', installationAdministrator: false },
    }
    const memberSpace = { ...space, memberRole: 'member' as const }
    teamApi.session.mockResolvedValueOnce(memberSession)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [memberSpace] })
    teamApi.board.mockResolvedValueOnce({
      ...board,
      members: [{ id: 'member-2', displayName: 'Mira Member', role: 'member' as const }],
    })
    teamApi.manageSpace.mockResolvedValueOnce({
      result: { kind: 'member-left', memberId: 'member-2' }, signedOut: true,
    })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Leave Space' }))

    expect(teamApi.manageSpace).toHaveBeenCalledWith('csrf-token', 'DIG', { action: 'leave-space' })
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows access audit and lets an administrator revoke a pending invitation', async () => {
    const user = userEvent.setup()
    const administrator = {
      id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const,
      revision: 1, joinedAt: '2026-09-04T08:00:00.000Z',
    }
    const invitation = {
      id: 'invitation-1', issuedAt: '2026-09-04T09:00:00.000Z',
      expiresAt: '2026-09-11T09:00:00.000Z', state: 'pending' as const,
    }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [space] })
    teamApi.board.mockResolvedValueOnce(board)
    teamApi.management
      .mockResolvedValueOnce({
        space, members: [administrator], invitations: [invitation],
        audit: [{
          id: 'audit-1', action: 'invitation-issued', actorDisplayName: 'Ada Admin',
          invitationId: invitation.id, occurredAt: invitation.issuedAt,
        }],
      })
      .mockResolvedValueOnce({
        space, members: [administrator], invitations: [{ ...invitation, state: 'revoked' }],
        audit: [{
          id: 'audit-2', action: 'invitation-revoked', actorDisplayName: 'Ada Admin',
          invitationId: invitation.id, occurredAt: '2026-09-04T10:00:00.000Z',
        }],
      })
    teamApi.manageSpace.mockResolvedValueOnce({ result: { kind: 'invitation-revoked' } })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    expect(await screen.findByRole('heading', { name: 'Invitations' })).toBeInTheDocument()
    expect(screen.getByText('Invitation issued by Ada Admin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }))

    expect(teamApi.manageSpace).toHaveBeenLastCalledWith('csrf-token', 'DIG', {
      action: 'revoke-invitation', invitationId: 'invitation-1',
    })
    expect(await screen.findByText('Revoked')).toBeInTheDocument()
  })

  it('loads the next administrative audit page from its opaque cursor', async () => {
    const user = userEvent.setup()
    const administrator = {
      id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const,
      revision: 1, joinedAt: '2026-09-04T08:00:00.000Z',
    }
    const newest = {
      id: 'audit-2', action: 'invitation-revoked', actorDisplayName: 'Ada Admin',
      occurredAt: '2026-09-04T10:00:00.000Z',
    }
    const older = {
      id: 'audit-1', action: 'invitation-issued', actorDisplayName: 'Ada Admin',
      occurredAt: '2026-09-04T09:00:00.000Z',
    }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [space] })
    teamApi.board.mockResolvedValueOnce(board)
    teamApi.management
      .mockResolvedValueOnce({
        space, members: [administrator], invitations: [], audit: [newest], next: { audit: 'audit-cursor' },
      })
      .mockResolvedValueOnce({
        space, members: [administrator], invitations: [], audit: [older], next: {},
      })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    await user.click(await screen.findByRole('button', { name: 'Load more audit entries' }))

    expect(teamApi.management).toHaveBeenLastCalledWith('DIG', { auditAfter: 'audit-cursor' })
    expect(screen.getByText('Invitation revoked by Ada Admin')).toBeInTheDocument()
    expect(await screen.findByText('Invitation issued by Ada Admin')).toBeInTheDocument()
  })

  it('removes an archived Space from the active picker when management closes', async () => {
    const user = userEvent.setup()
    const administrator = {
      id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const,
      revision: 1, joinedAt: '2026-09-04T08:00:00.000Z',
    }
    const archived = { ...space, lifecycle: 'archived' as const, revision: 2 }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces
      .mockResolvedValueOnce({ spaces: [space] })
      .mockResolvedValueOnce({ spaces: [] })
    teamApi.board.mockResolvedValueOnce(board)
    teamApi.management
      .mockResolvedValueOnce({ space, members: [administrator], invitations: [], audit: [] })
      .mockResolvedValueOnce({ space: archived, members: [administrator], invitations: [], audit: [] })
    teamApi.manageSpace.mockResolvedValueOnce({ result: { kind: 'space-archived', space: archived } })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    await user.click(await screen.findByRole('button', { name: 'Archive Space' }))
    await user.click(await screen.findByRole('button', { name: 'Back to Board' }))

    expect(teamApi.spaces).toHaveBeenLastCalledWith('active')
    expect(await screen.findByRole('heading', { name: 'Create your first Space' })).toBeInTheDocument()
  })

  it('removes a restored Space from the archived picker when management closes', async () => {
    const user = userEvent.setup()
    const administrator = {
      id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const,
      revision: 1, joinedAt: '2026-09-04T08:00:00.000Z',
    }
    const archived = { ...space, lifecycle: 'archived' as const, revision: 2 }
    const archivedBoard = { ...board, space: { ...board.space, lifecycle: 'archived' as const, revision: 2 } }
    const restored = { ...space, revision: 3 }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces
      .mockResolvedValueOnce({ spaces: [] })
      .mockResolvedValueOnce({ spaces: [archived] })
      .mockResolvedValueOnce({ spaces: [] })
    teamApi.board.mockResolvedValueOnce(archivedBoard)
    teamApi.management
      .mockResolvedValueOnce({ space: archived, members: [administrator], invitations: [], audit: [] })
      .mockResolvedValueOnce({ space: restored, members: [administrator], invitations: [], audit: [] })
    teamApi.manageSpace.mockResolvedValueOnce({ result: { kind: 'space-restored', space: restored } })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Archived Spaces' }))
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    await user.click(await screen.findByRole('button', { name: 'Restore Space' }))
    await user.click(await screen.findByRole('button', { name: 'Back to Board' }))

    expect(teamApi.spaces).toHaveBeenLastCalledWith('archived')
    expect(await screen.findByRole('heading', { name: 'No archived Spaces' })).toBeInTheDocument()
  })

  it('lets an administrator revise and move a Space through its lifecycle', async () => {
    const user = userEvent.setup()
    const administrator = {
      id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const,
      revision: 1, joinedAt: '2026-09-04T08:00:00.000Z',
    }
    const view = (currentSpace: Omit<typeof space, 'lifecycle'> & {
      lifecycle: 'active' | 'archived' | 'deletion_scheduled'
      deletionScheduledFor?: string
    }) => ({
      space: currentSpace, members: [administrator], invitations: [], audit: [],
    })
    const revised = { ...space, displayName: 'Product Flow', timeZone: 'America/Toronto', revision: 2 }
    const archived = { ...revised, lifecycle: 'archived' as const, revision: 3 }
    const scheduled = {
      ...archived, lifecycle: 'deletion_scheduled' as const, revision: 4,
      deletionScheduledFor: '2026-09-11T08:00:00.000Z',
    }
    const cancelled = { ...archived, revision: 5 }
    const restored = { ...revised, revision: 6 }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces
      .mockResolvedValueOnce({ spaces: [space] })
      .mockResolvedValueOnce({ spaces: [restored] })
    teamApi.board
      .mockResolvedValueOnce(board)
      .mockResolvedValueOnce({ ...board, space: { ...board.space, displayName: 'Product Flow', revision: 6 } })
    teamApi.management
      .mockResolvedValueOnce(view(space))
      .mockResolvedValueOnce(view(revised))
      .mockResolvedValueOnce(view(archived))
      .mockResolvedValueOnce(view(scheduled))
      .mockResolvedValueOnce(view(cancelled))
      .mockResolvedValueOnce(view(restored))
    teamApi.manageSpace.mockResolvedValue({ result: {} })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    await user.clear(await screen.findByLabelText('Space name'))
    await user.type(screen.getByLabelText('Space name'), 'Product Flow')
    await user.clear(screen.getByLabelText('Time zone'))
    await user.type(screen.getByLabelText('Time zone'), 'America/Toronto')
    await user.click(screen.getByRole('button', { name: 'Save Space settings' }))
    expect(teamApi.manageSpace).toHaveBeenLastCalledWith('csrf-token', 'DIG', {
      action: 'revise-space', expectedRevision: 1,
      displayName: 'Product Flow', timeZone: 'America/Toronto',
    })

    await user.click(await screen.findByRole('button', { name: 'Archive Space' }))
    expect(teamApi.manageSpace).toHaveBeenLastCalledWith('csrf-token', 'DIG', {
      action: 'archive-space', expectedRevision: 2,
    })
    await user.click(await screen.findByRole('button', { name: 'Schedule deletion' }))
    expect(await screen.findByText('Deletion scheduled for Sep 11, 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel deletion' }))
    await user.click(await screen.findByRole('button', { name: 'Restore Space' }))

    expect(teamApi.manageSpace).toHaveBeenNthCalledWith(5, 'csrf-token', 'DIG', {
      action: 'restore-space', expectedRevision: 5,
    })
    await user.click(screen.getByRole('button', { name: 'Back to Board' }))
    expect(await screen.findByRole('heading', { name: 'Product Flow' })).toBeInTheDocument()
  })

  it('adopts the replacement session after the current administrator is demoted', async () => {
    const user = userEvent.setup()
    const current = {
      id: 'member-1', displayName: 'Ada Admin', role: 'space-administrator' as const,
      revision: 1, joinedAt: '2026-09-04T08:00:00.000Z',
    }
    const other = {
      id: 'member-2', displayName: 'Mira Admin', role: 'space-administrator' as const,
      revision: 2, joinedAt: '2026-09-04T09:00:00.000Z',
    }
    teamApi.session.mockResolvedValueOnce(session)
    teamApi.spaces.mockResolvedValueOnce({ spaces: [space] })
    teamApi.board.mockResolvedValue(board)
    teamApi.management.mockResolvedValueOnce({ space, members: [current, other], invitations: [], audit: [] })
    teamApi.manageSpace
      .mockResolvedValueOnce({
        result: { kind: 'member-role-changed', member: { ...current, role: 'member', revision: 2 } },
        csrfToken: 'rotated-csrf',
      })
      .mockResolvedValueOnce({ result: { kind: 'member-left' }, signedOut: true })

    render(<TeamApp />)
    await user.click(await screen.findByRole('button', { name: 'Manage Space' }))
    await user.click(await screen.findByRole('button', { name: 'Make Ada Admin a Member' }))
    expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage Space' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Leave Space' }))
    expect(teamApi.manageSpace).toHaveBeenLastCalledWith('rotated-csrf', 'DIG', { action: 'leave-space' })
  })
})
