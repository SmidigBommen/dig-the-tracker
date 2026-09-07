import type { BoardFault, BoardView } from '../../api/contracts/board.ts'
import type { Result } from '../../api/modules/shared.ts'
import { describe, expect, it } from 'vitest'
import { BoardSession } from './board-session.ts'
import { MemoryBoardTransport, capturedTask, emptyBoard } from '../test/board-fixtures.ts'

describe('BoardSession', () => {
  it('saves inline edits in order without losing text entered during a save', async () => {
    const transport = new MemoryBoardTransport()
    let release!: () => void
    const firstSave = new Promise<void>((resolve) => { release = resolve })
    transport.change = async (request) => {
      transport.requests.push(request)
      if (transport.requests.length === 1) await firstSave
      if (request.command.kind !== 'revise-task') throw new Error('Expected an edit')
      const task = { ...capturedTask, ...request.command.changes, revision: (transport.requests.length + 1) as never, tags: [] }
      return { ok: true, value: { ...transport.receipt, update: { ...transport.receipt.update,
        sequence: task.revision as never, changes: [{ kind: 'task-upserted', task, placement: { columnId: task.columnId } }] } } }
    }
    const session = new BoardSession(transport, emptyBoard)
    await session.openTask({ kind: 'id', taskId: capturedTask.id })
    session.beginEdit()
    session.updateDraft({ title: 'First edit' })
    const saving = session.saveEdits()
    session.updateDraft({ title: 'Finished title', description: 'Keep typing' })
    expect(session.getSnapshot().draft?.title).toBe('Finished title')
    release()
    expect(await saving).toBe(true)
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[1]).toMatchObject({ command: { task: { expectedRevision: 2 }, changes: { title: 'Finished title', description: 'Keep typing' } } })
    expect(session.getSnapshot().draft?.title).toBe('Finished title')
    expect(session.getSnapshot().detail?.description).toBe('Keep typing')
    expect(session.hasUnsavedEdits()).toBe(false)
    await session.saveEdits()
    expect(transport.requests).toHaveLength(2)
  })
  it('captures from a draft and applies the authoritative receipt to loaded state', async () => {
    const transport = new MemoryBoardTransport()
    const session = new BoardSession(transport, emptyBoard)
    session.beginCapture()
    session.updateDraft({ title: 'My title', description: 'Details' })
    expect(await session.saveDraft()).toBe(true)
    expect(transport.requests[0]).toMatchObject({ command: { kind: 'capture-task', input: { title: 'My title', description: 'Details' } } })
    expect(session.getSnapshot().overview.columns[0].tasks.items).toMatchObject([{ key: 'DIG-1', title: 'Server title' }])
    expect(session.getSnapshot().draft).toBeUndefined()
    expect(session.getSnapshot().detail?.id).toBe('task')
  })
  it('keeps the dialog draft after a lost save and resolves the original request before newer edits', async () => {
    const transport = new MemoryBoardTransport()
    let release!: () => void
    const firstSave = new Promise<void>((resolve) => { release = resolve })
    transport.change = async (request) => {
      transport.requests.push(request)
      if (transport.requests.length === 1) { await firstSave; return { ok: false, fault: { kind: 'temporarily-unavailable' } } }
      if (request.command.kind !== 'revise-task') throw new Error('Expected an edit')
      const task = { ...capturedTask, title: request.command.changes.title!, revision: transport.requests.length as never }
      return { ok: true, value: { ...transport.receipt, update: { ...transport.receipt.update, sequence: task.revision as never,
        changes: [{ kind: 'task-upserted', task, placement: { columnId: task.columnId } }] } } }
    }
    const session = new BoardSession(transport, emptyBoard)
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    session.updateDraft({ title: 'Sent before disconnect' })
    const saving = session.saveEdits()
    session.updateDraft({ title: 'Typed during save' })
    release()
    expect(await saving).toBe(false)
    await session.closeEditor()
    expect(session.getSnapshot().draft?.title).toBe('Typed during save')
    expect(session.getSnapshot().detail?.id).toBe(capturedTask.id)
    session.setConnected(true)
    expect(await session.saveEdits()).toBe(true)
    expect(transport.requests[1]).toEqual(transport.requests[0])
    expect(transport.requests[2]).toMatchObject({ command: { task: { expectedRevision: 2 }, changes: { title: 'Typed during save' } } })
    expect(session.getSnapshot().draft?.title).toBe('Typed during save')
  })
  it('keeps the draft beside current data after a stale edit and requires a deliberate retry', async () => {
    const transport = new MemoryBoardTransport()
    const session = new BoardSession(transport, emptyBoard)
    await session.openTask({ kind: 'id', taskId: capturedTask.id })
    session.beginEdit()
    session.updateDraft({ title: 'My unsaved draft' })
    transport.fault = { kind: 'conflict', reason: 'stale-task', current: { kind: 'task', sequence: 2 as never,
      value: { ...capturedTask, title: 'Teammate change', revision: 2 as never } } }
    expect(await session.saveDraft()).toBe(false)
    expect(session.getSnapshot().draft?.title).toBe('My unsaved draft')
    expect(session.getSnapshot().conflict?.title).toBe('Teammate change')
    expect(await session.saveDraft()).toBe(false)
    expect(transport.requests).toHaveLength(1)
    session.useCurrentRevision()
    transport.fault = undefined
    await session.saveDraft()
    expect(transport.requests[1]).toMatchObject({ command: { task: { expectedRevision: 2 } } })
  })

  it('keeps an uncertain request ID across a disconnect and prevents offline changes', async () => {
    const transport = new MemoryBoardTransport()
    const session = new BoardSession(transport, emptyBoard)
    session.beginCapture()
    session.updateDraft({ title: 'Keep my draft' })
    transport.fault = { kind: 'temporarily-unavailable' }
    expect(await session.saveDraft()).toBe(false)
    const requestId = transport.requests[0].requestId
    expect(session.getSnapshot().connected).toBe(false)
    expect(session.getSnapshot().draft?.title).toBe('Keep my draft')
    expect(await session.saveDraft()).toBe(false)
    session.updateDraft({ title: 'Offline overwrite' })
    expect(session.getSnapshot().draft?.title).toBe('Keep my draft')
    transport.view = { kind: 'overview', sequence: 0 as never, value: emptyBoard }
    await session.refresh()
    transport.fault = undefined
    await session.saveDraft()
    expect(transport.requests[1].requestId).toBe(requestId)
  })

  it('ignores duplicate and older receipts', () => {
    const transport = new MemoryBoardTransport()
    const session = new BoardSession(transport, emptyBoard)
    session.applyUpdate(transport.receipt.update)
    session.applyUpdate(transport.receipt.update)
    session.applyUpdate({ ...transport.receipt.update, sequence: 0 as never })
    expect(session.getSnapshot().overview.columns[0].tasks.items).toHaveLength(1)
    expect(session.getSnapshot().overview.board.changeSequence).toBe(1)
  })

  it('invalidates loaded pages when a large family is represented by a query revision', async () => {
    const transport = new MemoryBoardTransport()
    const board = { ...emptyBoard, columns: [{ ...emptyBoard.columns[0], tasks: { items: Array.from({ length: 201 }, (_, index) =>
      ({ ...capturedTask, id: `task-${index}` as typeof capturedTask.id })) } }] }
    const session = new BoardSession(transport, board)
    session.applyUpdate({ ...transport.receipt.update, changes: [{ kind: 'query-revisions-changed', revisions: { tasks: 1 as never, inbox: 1 as never } }] })
    expect(session.getSnapshot().pagesStale).toBe(true)
    transport.view = { kind: 'overview', sequence: 1 as never, value: { ...emptyBoard, board: { ...emptyBoard.board, changeSequence: 1 as never } } }
    await session.refresh()
    expect(session.getSnapshot().pagesStale).toBe(false)
    expect(session.getSnapshot().overview.columns[0].tasks.items).toEqual([])
  })

  it('serializes Archive continuation requests', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'tasks', sequence: 0 as never, value: { items: [capturedTask], next: 'cursor' as never } }
    const session = new BoardSession(transport, emptyBoard)
    await session.openArchive()
    let resolve!: (value: Result<BoardView, BoardFault>) => void
    const delayed = new Promise<Result<BoardView, BoardFault>>((done) => { resolve = done })
    let reads = 0
    const port = transport as import('./board-session.ts').BoardTransport
    port.read = () => { reads++; return delayed }
    const first = session.openArchive(true)
    const second = session.openArchive(true)
    resolve({ ok: true, value: { kind: 'tasks', sequence: 0 as never, value: { items: [{ ...capturedTask, id: 'second' as never }] } } })
    await Promise.all([first, second])
    expect(reads).toBe(1)
    expect(session.getSnapshot().archive?.items.map((task) => task.id)).toEqual(['task', 'second'])
  })

  it('rejects a delayed overview older than an applied receipt', async () => {
    const transport = new MemoryBoardTransport()
    let resolve!: (value: Result<BoardView, BoardFault>) => void
    const port = transport as import('./board-session.ts').BoardTransport
    port.read = () => new Promise((done) => { resolve = done })
    const session = new BoardSession(transport, emptyBoard)
    const refresh = session.refresh()
    session.applyUpdate(transport.receipt.update)
    resolve({ ok: true, value: { kind: 'overview', sequence: 0 as never, value: emptyBoard } })
    await refresh
    expect(session.getSnapshot().overview.board.changeSequence).toBe(1)
    expect(session.getSnapshot().overview.columns[0].tasks.items[0].key).toBe('DIG-1')
  })

  it('pauses editing when Tag autocomplete loses its connection', async () => {
    const transport = new MemoryBoardTransport()
    const port = transport as import('./board-session.ts').BoardTransport
    port.read = async () => ({ ok: false, fault: { kind: 'temporarily-unavailable' } })
    const session = new BoardSession(transport, emptyBoard)
    session.beginCapture()
    await session.suggestTags('Del')
    expect(session.getSnapshot().connected).toBe(false)
    expect(await session.saveDraft()).toBe(false)
  })

  it('reloads open Task detail after refresh while preserving the draft', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, subtasks: { items: [], next: 'old-cursor' as never } } }
    const session = new BoardSession(transport, emptyBoard)
    await session.openTask({ kind: 'id', taskId: capturedTask.id })
    session.beginEdit()
    session.updateDraft({ title: 'Unsaved draft' })
    const port = transport as import('./board-session.ts').BoardTransport
    port.read = async (query) => query.kind === 'overview'
      ? { ok: true, value: { kind: 'overview', sequence: 2 as never, value: { ...emptyBoard, board: { ...emptyBoard.board, changeSequence: 2 as never } } } }
      : { ok: true, value: { kind: 'task', sequence: 2 as never, value: { ...capturedTask, revision: 2 as never, subtasks: { items: [], next: 'new-cursor' as never } } } }
    await session.refresh()
    expect(session.getSnapshot().detail?.subtasks.next).toBe('new-cursor')
    expect(session.getSnapshot().draft?.title).toBe('Unsaved draft')
  })

})
