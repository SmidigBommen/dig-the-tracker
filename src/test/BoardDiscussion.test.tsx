import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoardWorkspace } from '../views/BoardWorkspace.tsx'
import { capturedTask, emptyBoard, MemoryBoardTransport } from './board-fixtures.ts'

const board = { ...emptyBoard, currentMemberId: 'member' as never,
  columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }],
  members: [...emptyBoard.members, { id: 'bob' as never, displayName: 'Bob', role: 'member' as const }] }

describe('discussion and inbox in the browser', () => {
  it('lets an author remove a former Member mention before saving an edit', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, comments: { items: [{
      id: 'comment' as never, text: 'Please review', revision: 1 as never,
      author: { id: 'member' as never, displayName: 'Ada' }, mentions: [{ id: 'former' as never, displayName: 'Former teammate' }],
      createdAt: '2026-09-08T12:00:00Z' as never, editedAt: null, removedAt: null,
    }] } } }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await user.click(await screen.findByRole('link', { name: '@Former teammate' }))
    expect(screen.getByRole('region', { name: 'Former teammate' })).toHaveTextContent('Former Member')
    await user.click(await screen.findByRole('button', { name: 'Edit comment' }))
    await user.click(screen.getByRole('button', { name: 'Remove mention Former teammate' }))
    await user.click(screen.getByRole('button', { name: 'Save comment' }))
    await waitFor(() => expect(transport.requests[0]?.command).toMatchObject({ kind: 'revise-comment', mentions: [] }))
  })

  it('selects mentions by Member ID in the comment editor', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, comments: { items: [] } } }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await user.type(await screen.findByLabelText('Comment'), '@Bo')
    await user.keyboard('{Enter}Please review')
    await user.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(transport.requests[0]?.command).toMatchObject({ kind: 'add-comment', text: '@Bob Please review', mentions: ['bob'] }))
  })

  it('keeps recipient selections by ID when comment text changes', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, comments: { items: [] } } }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await user.type(await screen.findByLabelText('Comment'), '@Bo')
    await user.keyboard('{Enter}')
    await user.clear(screen.getByLabelText('Comment'))
    await user.type(screen.getByLabelText('Comment'), 'Please review')
    expect(screen.getByRole('button', { name: 'Remove mention Bob' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Post comment' }))
    await waitFor(() => expect(transport.requests[0]?.command).toMatchObject({ kind: 'add-comment', text: 'Please review', mentions: ['bob'] }))
  })

  it('dismisses mention suggestions without closing the Task and preserves the draft across activity tabs', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, comments: { items: [] }, history: { items: [] } } }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await user.type(await screen.findByLabelText('Comment'), '@Bo')
    expect(screen.getByRole('listbox', { name: 'Mention Members' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'DIG-1' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('tabpanel', { name: 'History' })).toHaveFocus()
    await user.tab({ shift: true })
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveFocus()
    expect(screen.getByLabelText('Comment')).toHaveValue('@Bo')
    expect(transport.requests).toHaveLength(0)
  })

  it('opens the personal inbox and follows a notification to its Task', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'inbox', sequence: 0 as never, unreadNotifications: 1, value: { items: [{
      id: 'notice' as never, read: false, kind: 'mention', task: { id: capturedTask.id, key: capturedTask.key, title: capturedTask.title },
      actor: { id: 'bob' as never, displayName: 'Bob' }, createdAt: '2026-09-08T12:00:00Z' as never, expiresAt: '2026-12-07T12:00:00Z' as never,
    }] } }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Inbox/ }))
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeInTheDocument()
    expect(screen.getByText('Bob mentioned you')).toBeInTheDocument()
    transport.view = { kind: 'task', sequence: 0 as never, unreadNotifications: 0, value: { ...capturedTask, comments: { items: [] } } }
    await user.click(screen.getByRole('button', { name: /Open DIG-1/ }))
    expect(await screen.findByRole('dialog', { name: 'DIG-1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close Task dialog' }))
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeInTheDocument()
    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
  })
})
