import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    expect(await screen.findByRole('heading', { name: 'DIG-1 · Server title' })).toBeInTheDocument()
    screen.getByRole('button', { name: 'Edit Task' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Title')).toHaveValue('Server title')
    await user.clear(screen.getByLabelText('Title'))
    await user.keyboard('Edited')
    screen.getByRole('button', { name: 'Save changes' }).focus()
    await user.keyboard('{Enter}')
    expect(transport.requests[0]).toMatchObject({ command: { input: { title: 'My title', description: 'Details' } } })
    expect(transport.requests[1]).toMatchObject({ command: { kind: 'revise-task', changes: { title: 'Edited' }, task: { taskId: 'task', expectedRevision: 1 } } })
  })
  it('shows the stale draft beside current text and keeps focus in the editor', async () => {
    const user = userEvent.setup()
    const transport = new MemoryBoardTransport()
    const board = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }] }
    render(<BoardWorkspace initialBoard={board} transport={transport} />)
    await user.click(screen.getByRole('button', { name: /DIG-1/ }))
    await user.click(await screen.findByRole('button', { name: 'Edit Task' }))
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'My draft')
    transport.fault = { kind: 'conflict', reason: 'stale-task', current: { kind: 'task', sequence: 2 as never,
      value: { ...capturedTask, title: 'Current title', description: 'Current description', revision: 2 as never } } }
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const current = await screen.findByRole('region', { name: 'Current version' })
    expect(within(current).getByText('Current title')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('My draft')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Keep my draft and edit from this version' }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  })

})
