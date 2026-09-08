import { describe, expect, it } from 'vitest'
import type { CommentView } from '../../api/contracts/board.ts'
import { BoardSession } from './board-session.ts'
import { capturedTask, emptyBoard, MemoryBoardTransport } from '../test/board-fixtures.ts'

const comment = { id: 'comment', text: 'Keep this comment', revision: 1, author: { id: 'member', displayName: 'Ada' },
  createdAt: '2026-09-08T12:00:00Z', editedAt: null, removedAt: null, mentions: [] } as unknown as CommentView

describe('BoardSession discussion', () => {
  it('stops warning about an unsaved new comment when all draft fields are cleared', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: capturedTask }
    const session = new BoardSession(transport, emptyBoard)
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    session.updateCommentDraft({ text: 'Temporary draft', mentions: ['member' as never] })
    expect(session.hasUnsavedComments()).toBe(true)
    session.updateCommentDraft({ text: '' })
    expect(session.hasUnsavedComments()).toBe(true)
    session.updateCommentDraft({ mentions: [] })
    expect(session.hasUnsavedComments()).toBe(false)
  })

  it('retries an uncertain comment exactly once and clears its draft only after success', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, comments: { items: [] } } }
    transport.change = async (request) => {
      transport.requests.push(request)
      if (transport.requests.length === 1) throw new Error('Response lost')
      return { ok: true, value: { result: { kind: 'add-comment', taskId: capturedTask.id, commentId: comment.id }, warnings: [],
        update: { sequence: 1 as never, occurredAt: comment.createdAt, changes: [{ kind: 'comment-upserted', taskId: capturedTask.id, comment }] } } }
    }
    const session = new BoardSession(transport, emptyBoard)
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    session.updateCommentDraft({ text: comment.text })
    expect(await session.saveComment()).toBe(false)
    expect(session.getSnapshot().commentDraft?.text).toBe(comment.text)
    session.setConnected(true)
    transport.view = { kind: 'task', sequence: 1 as never, value: { ...capturedTask, comments: { items: [comment] } } }
    expect(await session.retryPendingChange()).toBe(true)
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[1]).toEqual(transport.requests[0])
    expect(session.getSnapshot().commentDraft?.text).toBe('')
    expect(session.getSnapshot().detail?.comments?.items).toEqual([comment])
  })
  it('loads the personal inbox and marks only its own notification projections read', async () => {
    const transport = new MemoryBoardTransport()
    const notification = { id: 'notice' as never, read: false, kind: 'mention' as const,
      task: { id: capturedTask.id, key: capturedTask.key, title: capturedTask.title }, actor: comment.author,
      createdAt: comment.createdAt, expiresAt: '2026-12-07T12:00:00Z' as never }
    transport.view = { kind: 'inbox', sequence: 0 as never, value: { items: [notification] }, unreadNotifications: 1 }
    const session = new BoardSession(transport, { ...emptyBoard, currentMemberId: 'member' as never })
    await session.openInbox()
    expect(session.getSnapshot().inbox?.items).toEqual([notification])
    expect(session.getSnapshot().overview.unreadNotifications).toBe(1)
    session.applyUpdate({ sequence: 1 as never, occurredAt: comment.createdAt, changes: [
      { kind: 'notifications-read', memberId: 'someone-else' as never, all: true, unreadNotifications: 0 },
    ] })
    expect(session.getSnapshot().inbox?.items[0].read).toBe(false)
    session.applyUpdate({ sequence: 2 as never, occurredAt: comment.createdAt, changes: [
      { kind: 'notifications-read', memberId: 'member' as never, all: true, unreadNotifications: 0 },
    ] })
    expect(session.getSnapshot().inbox?.items[0].read).toBe(true)
    expect(session.getSnapshot().overview.unreadNotifications).toBe(0)
  })

  it('keeps a stale comment draft beside the current comment before an explicit retry', async () => {
    const transport = new MemoryBoardTransport()
    transport.view = { kind: 'task', sequence: 0 as never, value: { ...capturedTask, comments: { items: [comment] } } }
    const session = new BoardSession(transport, emptyBoard)
    await session.openEditor({ kind: 'id', taskId: capturedTask.id })
    session.editComment(comment)
    session.updateCommentDraft({ text: 'My draft' })
    const current = { ...comment, text: 'Someone edited in another tab', revision: 2 as never }
    transport.fault = { kind: 'conflict', reason: 'stale-comment', currentComment: current }
    expect(await session.saveComment()).toBe(false)
    expect(session.getSnapshot().commentDraft?.text).toBe('My draft')
    expect(session.getSnapshot().commentConflict).toEqual(current)
    session.useCurrentCommentRevision()
    expect(session.getSnapshot().commentDraft).toMatchObject({ text: 'My draft', expectedRevision: 2 })
    expect(session.getSnapshot().commentConflict).toBeUndefined()
  })

})
