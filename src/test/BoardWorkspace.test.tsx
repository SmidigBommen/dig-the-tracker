import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoardWorkspace } from '../views/BoardWorkspace.tsx'
import { capturedTask, emptyBoard, MemoryBoardTransport } from './board-fixtures.ts'

describe('capture and edit Tasks in the browser', () => {
  it('creates a Task using the keyboard, opens its detail, and edits it', async () => {
    const user = userEvent.setup()
    const transport = new MemoryBoardTransport()
    render(<BoardWorkspace initialBoard={emptyBoard} transport={transport} />)
    screen.getByRole('button', { name: 'New Task' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Title')).toHaveFocus()
    await user.keyboard('My title{Tab}Details')
    screen.getByRole('button', { name: 'Create Task' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: /DIG-1/ })).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Edit Task' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Server title')
    expect(screen.getByLabelText('Title')).not.toHaveFocus()
    await user.clear(screen.getByLabelText('Title'))
    await user.keyboard('Edited')
    await screen.findByText('All changes saved')
    expect(transport.requests[0]).toMatchObject({ command: { input: { title: 'My title', description: 'Details' } } })
    expect(transport.requests[1]).toMatchObject({ command: { kind: 'revise-task', changes: { title: 'Edited' }, task: { taskId: 'task', expectedRevision: 1 } } })
  })
  it('shows the stale draft beside current text and keeps focus in the editor', async () => {
    const user = userEvent.setup()
    const transport = new MemoryBoardTransport()
    const board = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }] }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await screen.findByLabelText('Title')
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'My draft')
    transport.fault = { kind: 'conflict', reason: 'stale-task', current: { kind: 'task', sequence: 2 as never,
      value: { ...capturedTask, title: 'Current title', description: 'Current description', revision: 2 as never } } }
    await user.click(screen.getByRole('button', { name: 'Save now' }))
    const current = await screen.findByRole('region', { name: 'Current version' })
    expect(within(current).getByText('Current title')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('My draft')
    expect(screen.queryByRole('button', { name: 'Save now' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep my draft and edit from this version' }))
    await user.click(screen.getByRole('button', { name: 'Discard unsaved changes' }))
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  })

  it('flushes edits on Escape and returns focus to the card', async () => {
    const user = userEvent.setup()
    const transport = new MemoryBoardTransport()
    const board = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }] }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const card = screen.getByRole('button', { name: /DIG-1/ })
    await user.click(card)
    const title = await screen.findByLabelText('Title')
    expect(screen.getByRole('dialog', { name: /DIG-1/ })).toHaveFocus()
    expect(title).not.toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await user.clear(title)
    await user.type(screen.getByLabelText('Title'), 'Save before closing{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(transport.requests[0]).toMatchObject({ command: { kind: 'revise-task', changes: { title: 'Save before closing' } } })
    expect(card).toHaveFocus()
  })

  it('keeps title focus when Enter confirms an IME composition', async () => {
    const transport = new MemoryBoardTransport()
    const board = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }] }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    const title = await screen.findByLabelText('Title')
    await user.click(title)
    fireEvent.keyDown(title, { key: 'Enter', isComposing: true })
    expect(title).toHaveFocus()
    expect(transport.requests).toHaveLength(0)
  })

  it('opens archived Tasks without an editable draft', async () => {
    const user = userEvent.setup()
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 1 as never, value: { ...capturedTask, archived: true } }
    const board = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }] }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await screen.findByText('Archived Task')
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(transport.requests).toHaveLength(0)
  })

})
