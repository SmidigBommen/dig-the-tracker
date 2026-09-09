import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BoardWorkspace } from '../views/BoardWorkspace.tsx'
import { capturedTask, emptyBoard, MemoryBoardTransport } from './board-fixtures.ts'
import type { BoardTransport } from '../board-session/board-session.ts'

const active = { ...emptyBoard.columns[0], id: 'active' as never, name: 'In Progress', intake: false, flowRole: 'active' as const, wipLimit: 3, orderRevision: 4 as never }

describe('Board movement', () => {
  it('refreshes after a drag without asking the user to refresh the Board', async () => {
    const transport = new MemoryBoardTransport()
    const moved = { ...capturedTask, columnId: active.id }
    transport.receipt = { ...transport.receipt, result: { kind: 'place-task', taskId: capturedTask.id },
      update: { ...transport.receipt.update, changes: [
        { kind: 'task-upserted', task: moved, placement: { columnId: active.id } },
        { kind: 'query-revisions-changed', revisions: { tasks: 1 as never, inbox: 1 as never } },
      ] } }
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let refreshing = false
    const port: BoardTransport = {
      follow: transport.follow.bind(transport), change: transport.change.bind(transport),
      read: async () => {
        refreshing = true
        await waiting
        return { ok: true, value: { kind: 'overview', sequence: 1 as never, value: { ...emptyBoard,
          board: { ...emptyBoard.board, changeSequence: 1 as never },
          columns: [emptyBoard.columns[0], { ...active, tasks: { items: [moved] } }],
        } } }
      },
    }
    render(<BoardWorkspace initialBoard={{ ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }, active] }} transport={port} />)
    fireEvent.dragStart(screen.getByRole('button', { name: /DIG-1/ }))
    fireEvent.drop(screen.getByRole('region', { name: /In Progress/ }))
    try {
      await waitFor(() => expect(refreshing).toBe(true))
      expect(within(screen.getByRole('region', { name: /In Progress/ })).getByRole('button', { name: /DIG-1/ })).toBeInTheDocument()
      expect(screen.queryByText(/Refresh the Board to continue/)).not.toBeInTheDocument()
    } finally { release() }
    await waitFor(() => expect(screen.getByRole('button', { name: 'New Task' })).toBeEnabled())
    expect(within(screen.getByRole('region', { name: /Backlog/ })).queryByRole('button', { name: /DIG-1/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /In Progress/ })).getByRole('button', { name: /DIG-1/ })).toHaveAttribute('draggable', 'true')
  })

  it('drags a Task into a Column and shows the committed WIP warning', async () => {
    const transport = new MemoryBoardTransport()
    transport.receipt = { ...transport.receipt, result: { kind: 'place-task', taskId: capturedTask.id },
      warnings: [{ kind: 'wip-limit-exceeded', columnId: active.id, limit: 3, actual: 4, parentTasks: 3, subtasks: 1 }],
      update: { ...transport.receipt.update, changes: [{ kind: 'task-upserted', task: { ...capturedTask, columnId: active.id }, placement: { columnId: active.id } }] } }
    render(<BoardWorkspace initialBoard={{ ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }, active] }} transport={transport} />)
    const card = screen.getByRole('button', { name: /DIG-1/ })
    const destination = screen.getByRole('region', { name: /In Progress/ })
    const source = screen.getByRole('region', { name: /Backlog/ })
    expect(card).toHaveAttribute('draggable', 'true')
    fireEvent.dragOver(destination)
    expect(destination).not.toHaveClass('drop-target')
    fireEvent.dragStart(card)
    fireEvent.dragOver(source)
    expect(source).toHaveClass('drop-target')
    fireEvent.dragOver(destination)
    expect(destination).toHaveClass('drop-target')
    expect(source).not.toHaveClass('drop-target')
    // jsdom has no DragEvent constructor; MouseEvent preserves its inherited relatedTarget.
    fireEvent(destination, new MouseEvent('dragleave', { bubbles: true, relatedTarget: within(destination).getByText('No Tasks yet') }))
    expect(destination).toHaveClass('drop-target')
    fireEvent(destination, new MouseEvent('dragleave', { bubbles: true, relatedTarget: source }))
    expect(destination).not.toHaveClass('drop-target')
    fireEvent.dragOver(destination)
    fireEvent.dragEnd(card)
    expect(destination).not.toHaveClass('drop-target')
    expect(transport.requests).toHaveLength(0)
    fireEvent.dragStart(card)
    fireEvent.dragOver(destination)
    fireEvent.drop(destination)
    expect(destination).not.toHaveClass('drop-target')
    await waitFor(() => expect(transport.requests).toHaveLength(1))
    expect(transport.requests[0]).toMatchObject({ command: { kind: 'place-task', task: { taskId: 'task', expectedRevision: 1 }, destination: { columnId: 'active', expectedOrderRevision: 4, place: { kind: 'last' } } } })
    expect(await within(screen.getByRole('region', { name: /In Progress/ })).findByRole('button', { name: /DIG-1/ })).toBeInTheDocument()
    expect(screen.getByText(/The move was saved/)).toHaveTextContent('3 parent Tasks and 1 Subtasks')
  })
  it('moves directly from the Column property and keeps secondary actions out of the editor', async () => {
    const transport = new MemoryBoardTransport()
    render(<BoardWorkspace initialBoard={{ ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }, active] }} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    expect(screen.queryByRole('button', { name: 'Move Task' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Close as')).not.toBeInTheDocument()
    await user.selectOptions(await screen.findByLabelText('Column'), active.id)
    await waitFor(() => expect(transport.requests[0]).toMatchObject({ command: { kind: 'place-task',
      destination: { columnId: 'active', expectedOrderRevision: 4, place: { kind: 'last' } } } }))
  })

  it('preserves closure drafts when the actions disclosure closes', async () => {
    const transport = new MemoryBoardTransport()
    render(<BoardWorkspace initialBoard={{ ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }, active] }} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await user.click(screen.getByLabelText('More Task actions'))
    await user.click(screen.getByRole('button', { name: 'Close with outcome…' }))
    await user.selectOptions(screen.getByLabelText('Close as'), 'rejected')
    await user.type(screen.getByLabelText('Closing comment'), 'Outside our scope')
    await user.click(screen.getByLabelText('Title'))
    await user.click(screen.getByLabelText('More Task actions'))
    expect(screen.getByLabelText('Closing comment')).toHaveValue('Outside our scope')
    await user.click(screen.getByLabelText('Closing comment'))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'DIG-1' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('More Task actions'))
    expect(screen.getByLabelText('Closing comment')).toHaveValue('Outside our scope')
    expect(transport.requests).toHaveLength(0)
  })

  it('opens the Task referenced by a Duplicate Outcome', async () => {
    const transport = new MemoryBoardTransport()
    const duplicate = { ...capturedTask, closedAt: '2026-09-08T12:00:00Z' as never,
      outcome: { kind: 'duplicate' as const, taskId: 'original' as never } }
    transport.view = { kind: 'task', sequence: 0 as never, value: duplicate }
    render(<BoardWorkspace initialBoard={{ ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [duplicate] } }] }} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    const link = await screen.findByRole('button', { name: 'Open Duplicate target' })
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, id: 'original' as never, key: 'DIG-2' as never, title: 'Original work' } }
    await user.click(link)
    expect(await screen.findByRole('dialog', { name: 'DIG-2' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Original work')
  })

})
