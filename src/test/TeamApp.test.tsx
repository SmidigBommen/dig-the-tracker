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
    { id: 'backlog', name: 'Backlog', flowRole: 'queue' as const, intake: true, completion: false, wipLimit: null, position: 0, revision: 1 },
    { id: 'progress', name: 'In Progress', flowRole: 'active' as const, intake: false, completion: false, wipLimit: 3, position: 1000, revision: 1 },
    { id: 'done', name: 'Done', flowRole: 'complete' as const, intake: false, completion: true, wipLimit: null, position: 2000, revision: 1 },
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
    expect(screen.getByText('WIP limit 3')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getAllByText('No Tasks yet')).toHaveLength(3)
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
})
