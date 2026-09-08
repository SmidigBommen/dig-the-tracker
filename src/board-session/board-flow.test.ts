import { describe, expect, it } from 'vitest'
import { BoardSession } from './board-session.ts'
import { capturedTask, emptyBoard, MemoryBoardTransport } from '../test/board-fixtures.ts'

const destination = { columnId: 'complete' as never, expectedOrderRevision: 1 as never, place: { kind: 'last' as const } }

describe('BoardSession flow', () => {
  it('retries an uncertain move with its original request after reconnecting to newer state', async () => {
    const transport = new MemoryBoardTransport()
    transport.change = async (request) => {
      transport.requests.push(request)
      if (transport.requests.length === 1) throw new Error('Response lost after commit')
      return { ok: true, value: transport.receipt }
    }
    const session = new BoardSession(transport, emptyBoard)
    expect(await session.moveTask(capturedTask, destination)).toBe(false)
    expect(session.getSnapshot().connected).toBe(false)
    transport.view = { kind: 'overview', sequence: 2 as never, value: { ...emptyBoard, board: { ...emptyBoard.board, changeSequence: 2 as never } } }
    await session.refresh()
    expect(await session.retryPendingChange()).toBe(true)
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[1]).toEqual(transport.requests[0])
  })
  it('reduces placement, order revisions and history once from authoritative updates', async () => {
    const transport = new MemoryBoardTransport()
    const second = { ...capturedTask, id: 'second' as never, title: 'Second' }
    const session = new BoardSession(transport, { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask, second] } }] })
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, history: { items: [] } } }
    await session.openTask({ kind: 'id', taskId: capturedTask.id })
    const entry = { id: 'event', kind: 'closed', occurredAt: '2026-09-08T12:00:00Z' as never,
      summary: 'Closed Task', actor: { id: 'member' as never, displayName: 'Ada' }, outcome: { kind: 'completed' as const } }
    const update = { sequence: 1 as never, occurredAt: entry.occurredAt, changes: [
      { kind: 'task-upserted' as const, task: second, placement: { columnId: second.columnId, beforeTaskId: capturedTask.id } },
      { kind: 'column-order-revised' as const, columnId: second.columnId, revision: 3 as never },
      { kind: 'history-appended' as const, taskId: capturedTask.id, entries: [entry] },
    ] }
    session.applyUpdate(update)
    session.applyUpdate(update)
    expect(session.getSnapshot().overview.columns[0].tasks.items.map((task) => task.id)).toEqual(['second', 'task'])
    expect(session.getSnapshot().overview.columns[0].orderRevision).toBe(3)
    expect(session.getSnapshot().detail?.history?.items).toEqual([entry])
  })

  it('keeps editing paused until a moved Task detail has finished reloading', async () => {
    const transport = new MemoryBoardTransport()
    const session = new BoardSession(transport, emptyBoard)
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    let release!: () => void
    let started!: () => void
    const loading = new Promise<void>((resolve) => { started = resolve })
    const response = new Promise<void>((resolve) => { release = resolve })
    transport.read = async () => { started(); await response; return { ok: true, value: transport.view } }
    const moved = session.moveTask(capturedTask, destination)
    await loading
    expect(session.getSnapshot().busy).toBe(true)
    session.updateDraft({ title: 'Typing while movement reloads' })
    expect(session.getSnapshot().draft?.title).toBe('Server title')
    release()
    expect(await moved).toBe(true)
    expect(session.getSnapshot().busy).toBe(false)
  })

  it('preserves independently loaded history when appending Subtasks', async () => {
    const transport = new MemoryBoardTransport()
    const history = { items: [{ id: 'created', kind: 'capture-task', summary: 'Created Task',
      occurredAt: '2026-09-08T12:00:00Z' as never, actor: { id: 'member' as never, displayName: 'Ada' } }] }
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, history,
      subtasks: { items: [capturedTask], next: 'next-subtask' as never } } }
    const session = new BoardSession(transport, emptyBoard)
    await session.openTask({ kind: 'id', taskId: capturedTask.id })
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask,
      subtasks: { items: [{ ...capturedTask, id: 'child-two' as never }] } } }
    await session.loadMoreSubtasks()
    expect(session.getSnapshot().detail?.history).toEqual(history)
    expect(session.getSnapshot().detail?.subtasks.items).toHaveLength(2)
  })

})
