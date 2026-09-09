import { describe,expect,it } from 'vitest'
import { render,screen,within,waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoardWorkspace } from '../views/BoardWorkspace.tsx'
import type { BoardTransport } from '../board-session/board-session.ts'
import { capturedTask,emptyBoard,MemoryBoardTransport } from './board-fixtures.ts'

describe('Space search',() => {
  it('searches with the keyboard, opens a result, and restores Board dragging when leaving search',async () => {
    const memory = new MemoryBoardTransport()
    const queries: unknown[] = []
    const port: BoardTransport = { change: memory.change.bind(memory),follow: memory.follow.bind(memory),read: async query => {
      queries.push(query)
      return query.kind === 'tasks' ? { ok: true,value: { kind: 'tasks',sequence: 0 as never,value: { items: [capturedTask] } } }
        : { ok: true,value: { kind: 'task',sequence: 0 as never,value: capturedTask } }
    } }
    const user = userEvent.setup()
    render(<BoardWorkspace initialBoard={{ ...emptyBoard,columns: [{ ...emptyBoard.columns[0],tasks: { items: [capturedTask] } }] }} transport={port} />)
    await user.click(screen.getByRole('tab',{ name: 'Search' }))
    await user.type(screen.getByRole('searchbox'),'latency{Enter}')
    await waitFor(() => expect(queries).toContainEqual({ kind: 'tasks',selection: { kind: 'search',text: 'latency',include: 'open' },page: {} }))
    const result = await within(screen.getByRole('tabpanel')).findByRole('button',{ name: /DIG-1/ })
    expect(result).not.toHaveAttribute('draggable','true')
    await user.click(result)
    await screen.findByRole('dialog',{ name: 'DIG-1' })
    await user.click(screen.getByRole('button',{ name: 'Close Task dialog' }))
    expect(screen.getByRole('searchbox')).toHaveValue('latency')
    await user.click(screen.getByRole('tab',{ name: 'Board' }))
    expect(screen.getByRole('button',{ name: /DIG-1/ })).toHaveAttribute('draggable','true')
  })
})
