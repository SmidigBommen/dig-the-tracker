import { describe,expect,it,vi } from 'vitest'
import type { BoardTransport,BoardFeedObserver } from './board-session.ts'
import { BoardSession } from './board-session.ts'
import { capturedTask,emptyBoard,MemoryBoardTransport } from '../test/board-fixtures.ts'

describe('Space exploration',() => {
  it('makes a directly opened Task editable when the live connection becomes ready',async () => {
    const memory = new MemoryBoardTransport()
    let observer!: BoardFeedObserver
    const session = new BoardSession({ read: memory.read.bind(memory),change: memory.change.bind(memory),
      follow: (_options,next) => { observer=next;return () => {} } },emptyBoard)
    session.startLive()
    try {
      await session.openEditor({ kind: 'key',taskKey: capturedTask.key })
      expect(session.getSnapshot().detail?.id).toBe(capturedTask.id)
      expect(session.getSnapshot().draft).toBeUndefined()
      observer.open()
      expect(session.getSnapshot().draft?.taskId).toBe(capturedTask.id)
      session.updateDraft({ title: 'Local edit' })
      observer.open()
      expect(session.getSnapshot().draft?.title).toBe('Local edit')
    } finally { session.stopLive() }
  })
  it('ignores a late search response after the user changes their search',async () => {
    const memory = new MemoryBoardTransport()
    const pending: Array<(result: Awaited<ReturnType<BoardTransport['read']>>) => void> = []
    const transport: BoardTransport = { follow: memory.follow.bind(memory),change: memory.change.bind(memory),
      read: () => new Promise(resolve => pending.push(resolve)) }
    const session = new BoardSession(transport,emptyBoard)
    const first = session.search('old','open')
    const second = session.search('new','all')
    pending[1]({ ok: true,value: { kind: 'tasks',sequence: 0 as never,value: { items: [capturedTask] } } })
    await second
    pending[0]({ ok: true,value: { kind: 'tasks',sequence: 0 as never,value: { items: [] } } })
    await first
    expect(session.getSnapshot().exploration).toMatchObject({ kind: 'search',text: 'new',include: 'all',results: { items: [capturedTask] } })
    expect(session.getSnapshot().explorationLoading).toBe(false)
  })
  it('refreshes the selected search after live changes without losing its scope',async () => {
    const memory = new MemoryBoardTransport()
    let observer!: BoardFeedObserver
    let sequence = 0
    const port: BoardTransport = {
      change: memory.change.bind(memory),follow: (_options,next) => { observer=next;next.open();return () => {} },
      read: async query => query.kind === 'overview' ? { ok: true,value: { kind: 'overview',sequence: sequence as never,
        value: { ...emptyBoard,board: { ...emptyBoard.board,changeSequence: sequence as never } } } }
        : { ok: true,value: { kind: 'tasks',sequence: sequence as never,value: { items: sequence ? [capturedTask] : [] } } },
    }
    const session = new BoardSession(port,emptyBoard)
    session.startLive()
    try {
      await session.search('work','all')
      sequence=1
      observer.item({ kind: 'update',update: { sequence: 1 as never,occurredAt: '2026-09-09T12:00:00Z' as never,
        changes: [{ kind: 'query-revisions-changed',revisions: { tasks: 1 as never,inbox: 1 as never } }] } })
      await vi.waitFor(() => expect(session.getSnapshot().exploration).toMatchObject({ kind: 'search',text: 'work',include: 'all',results: { items: [capturedTask] } }))
      expect(session.getSnapshot().pagesStale).toBe(false)
    } finally { session.stopLive() }
  })

})
