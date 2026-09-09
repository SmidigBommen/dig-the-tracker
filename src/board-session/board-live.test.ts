import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardQuery, BoardView } from '../../api/contracts/board.ts'
import { BoardSession, type BoardFeedObserver, type BoardTransport } from './board-session.ts'
import { capturedTask, emptyBoard, MemoryBoardTransport } from '../test/board-fixtures.ts'

class LiveTransport extends MemoryBoardTransport {
  observer?: BoardFeedObserver
  overview = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: [capturedTask] } }] }
  task = capturedTask
  follow(_options: unknown, observer: BoardFeedObserver) { this.observer = observer; observer.open(); return () => { this.observer = undefined } }
}

afterEach(() => vi.useRealTimers())

describe('live BoardSession', () => {
  it('recovers a failed save even when the feed stayed healthy and retains the exact retry', async () => {
    vi.useFakeTimers()
    const transport = new LiveTransport()
    const port: BoardTransport = transport
    port.read = async (query) => ({ ok: true, value: query.kind === 'overview'
      ? { kind: 'overview', sequence: 0 as never, value: transport.overview }
      : { kind: 'task', sequence: 1 as never, value: capturedTask } })
    const session = new BoardSession(port, transport.overview)
    session.startLive()
    session.beginCapture()
    session.updateDraft({ title: 'Retained capture' })
    transport.fault = { kind: 'temporarily-unavailable' }
    expect(await session.saveDraft()).toBe(false)
    expect(session.getSnapshot().connected).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.getSnapshot().connected).toBe(true)
    expect(session.getSnapshot().draft?.title).toBe('Retained capture')
    transport.fault = undefined
    expect(await session.saveDraft()).toBe(true)
    expect(transport.requests[1]).toEqual(transport.requests[0])
    session.stopLive()
  })

  it('updates an open Task automatically without overwriting its unsaved draft', async () => {
    const transport = new LiveTransport()
    const port: BoardTransport = transport
    port.read = async (query: BoardQuery) => ({ ok: true, value: query.kind === 'overview'
      ? { kind: 'overview', sequence: transport.overview.board.changeSequence, value: transport.overview }
      : { kind: 'task', sequence: transport.overview.board.changeSequence, value: transport.task } })
    const session = new BoardSession(port, transport.overview)
    session.startLive()
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    session.updateDraft({ title: 'My unsaved title' })
    transport.task = { ...capturedTask, title: 'Teammate title', description: 'New description', revision: 2 as never }
    transport.overview = { ...transport.overview, board: { ...transport.overview.board, changeSequence: 1 as never } }
    transport.observer!.item({ kind: 'update', update: { sequence: 1 as never, occurredAt: '2026-09-09T10:00:00Z' as never,
      changes: [{ kind: 'task-upserted', task: transport.task, placement: { columnId: capturedTask.columnId } }] } })
    await vi.waitFor(() => expect(session.getSnapshot().conflict?.title).toBe('Teammate title'))
    expect(session.getSnapshot().detail?.description).toBe('New description')
    expect(session.getSnapshot().draft?.title).toBe('My unsaved title')
    expect(session.getSnapshot().conflict?.title).toBe('Teammate title')
    session.stopLive()
  })

  it('keeps changes paused until reconnect loads a current snapshot and opens its feed', async () => {
    vi.useFakeTimers()
    const transport = new LiveTransport()
    const port: BoardTransport = transport
    let finish!: (value: { ok: true; value: BoardView }) => void
    port.read = async () => new Promise((resolve) => { finish = resolve })
    const session = new BoardSession(port, transport.overview)
    session.startLive()
    transport.observer!.disconnected()
    expect(session.getSnapshot().connected).toBe(false)
    session.beginCapture()
    expect(session.getSnapshot().draft).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.getSnapshot().connected).toBe(false)
    finish({ ok: true, value: { kind: 'overview', sequence: 2 as never, value: {
      ...transport.overview, board: { ...transport.overview.board, changeSequence: 2 as never }, unreadNotifications: 1,
    } } })
    await vi.advanceTimersByTimeAsync(0)
    expect(session.getSnapshot().connected).toBe(true)
    expect(session.getSnapshot().overview.unreadNotifications).toBe(1)
    session.stopLive()
  })

  it('recovers a missing sequence and ignores duplicate, older, and abandoned-feed updates', async () => {
    vi.useFakeTimers()
    const transport = new LiveTransport()
    const port: BoardTransport = transport
    const latest = { ...transport.overview, board: { ...transport.overview.board, changeSequence: 2 as never }, unreadNotifications: 2 }
    port.read = async () => ({ ok: true, value: { kind: 'overview', sequence: 2 as never, value: latest } })
    const session = new BoardSession(port, transport.overview)
    session.startLive()
    const old = transport.observer!
    const skipped = { kind: 'update' as const, update: { sequence: 2 as never, occurredAt: '2026-09-09T10:00:00Z' as never, changes: [] } }
    old.item(skipped)
    expect(session.getSnapshot().connected).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(session.getSnapshot().connected).toBe(true)
    expect(session.getSnapshot().overview.unreadNotifications).toBe(2)
    transport.observer!.item(skipped)
    transport.observer!.item({ ...skipped, update: { ...skipped.update, sequence: 1 as never } })
    old.disconnected()
    old.item({ ...skipped, update: { ...skipped.update, sequence: 99 as never } })
    expect(session.getSnapshot().overview.board.changeSequence).toBe(2)
    expect(session.getSnapshot().connected).toBe(true)
    session.stopLive()
  })

  it('updates clean editable fields and the open inbox after a teammate change', async () => {
    const transport = new LiveTransport()
    const port: BoardTransport = transport
    port.read = async (query) => ({ ok: true, value: query.kind === 'overview'
      ? { kind: 'overview', sequence: transport.overview.board.changeSequence, value: transport.overview }
      : query.kind === 'inbox' ? { kind: 'inbox', sequence: transport.overview.board.changeSequence, value: { items: [] }, unreadNotifications: 0 }
      : { kind: 'task', sequence: transport.overview.board.changeSequence, value: transport.task } })
    const session = new BoardSession(port, transport.overview)
    session.startLive()
    await session.openInbox()
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    transport.task = { ...capturedTask, title: 'Updated title', description: 'Updated text', revision: 2 as never }
    transport.overview = { ...transport.overview, board: { ...transport.overview.board, changeSequence: 1 as never } }
    transport.observer!.item({ kind: 'update', update: { sequence: 1 as never, occurredAt: '2026-09-09T10:00:00Z' as never,
      changes: [{ kind: 'task-upserted', task: transport.task, placement: { columnId: capturedTask.columnId } }] } })
    await vi.waitFor(() => expect(session.getSnapshot().draft?.title).toBe('Updated title'))
    expect(session.getSnapshot().draft?.description).toBe('Updated text')
    expect(session.getSnapshot().conflict).toBeUndefined()
    expect(session.hasUnsavedEdits()).toBe(false)
    session.stopLive()
  })

  it('retains a draft but refuses further edits after someone archives its Task', async () => {
    const transport = new LiveTransport()
    const port: BoardTransport = transport
    port.read = async (query) => ({ ok: true, value: query.kind === 'overview'
      ? { kind: 'overview', sequence: transport.overview.board.changeSequence, value: transport.overview }
      : { kind: 'task', sequence: transport.overview.board.changeSequence, value: transport.task } })
    const session = new BoardSession(port, transport.overview)
    session.startLive()
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    session.updateDraft({ title: 'Retained before archive' })
    transport.task = { ...capturedTask, archived: true, revision: 2 as never }
    transport.overview = { ...transport.overview, board: { ...transport.overview.board, changeSequence: 1 as never } }
    transport.observer!.item({ kind: 'update', update: { sequence: 1 as never, occurredAt: '2026-09-09T10:00:00Z' as never,
      changes: [{ kind: 'tasks-archived', taskIds: [capturedTask.id] }] } })
    await vi.waitFor(() => expect(session.getSnapshot().conflict?.archived).toBe(true))
    session.updateDraft({ title: 'Forbidden edit' })
    session.useCurrentRevision()
    expect(await session.saveEdits()).toBe(false)
    expect(session.getSnapshot().draft?.title).toBe('Retained before archive')
    expect(transport.requests).toHaveLength(0)
    session.stopLive()
  })
})
