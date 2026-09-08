import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BoardWorkspace } from '../views/BoardWorkspace.tsx'
import { capturedTask, emptyBoard, MemoryBoardTransport } from './board-fixtures.ts'

const active = { ...emptyBoard.columns[0], id: 'active' as never, name: 'In Progress', intake: false, flowRole: 'active' as const, wipLimit: 3, orderRevision: 4 as never }

describe('Board movement', () => {
  it('drags a Task into a Column and shows the committed WIP warning', async () => {
    const transport = new MemoryBoardTransport()
    transport.receipt = { ...transport.receipt, result: { kind: 'place-task', taskId: capturedTask.id },
      warnings: [{ kind: 'wip-limit-exceeded', columnId: active.id, limit: 3, actual: 4, parentTasks: 3, subtasks: 1 }],
      update: { ...transport.receipt.update, changes: [{ kind: 'task-upserted', task: { ...capturedTask, columnId: active.id }, placement: { columnId: active.id } }] } }
    render(<BoardWorkspace initialBoard={{ ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }, active] }} transport={transport} />)
    const card = screen.getByRole('button', { name: /DIG-1/ })
    expect(card).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(card)
    fireEvent.dragOver(screen.getByRole('region', { name: /In Progress/ }))
    fireEvent.drop(screen.getByRole('region', { name: /In Progress/ }))
    await waitFor(() => expect(transport.requests).toHaveLength(1))
    expect(transport.requests[0]).toMatchObject({ command: { kind: 'place-task', task: { taskId: 'task', expectedRevision: 1 }, destination: { columnId: 'active', expectedOrderRevision: 4, place: { kind: 'last' } } } })
    expect(await within(screen.getByRole('region', { name: /In Progress/ })).findByRole('button', { name: /DIG-1/ })).toBeInTheDocument()
    expect(screen.getByText(/The move was saved/)).toHaveTextContent('3 parent Tasks and 1 Subtasks')
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
