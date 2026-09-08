// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db.js'
import { MockOidcAdapter } from '../adapters/oidc/mock-oidc-adapter.js'
import { IdentityModuleImplementation } from './identity/identity-module.js'
import { SpaceModuleImplementation, type SpaceUse } from './space/space-module.js'
import { BoardModuleImplementation, type BoardCommand } from './board/board-module.js'
import type { RequestId, SpaceKey } from './shared.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const origin = 'https://dig.example.test'
let db: Database

run('Slice 5 discuss and notify', () => {
  beforeAll(() => { db = createDatabase(process.env.DATABASE_URL!) })
  beforeEach(async () => {
    await db.query('truncate team.identities, team.space_key_reservations cascade')
  })
  afterAll(async () => { await db.end() })

  async function signIn(subject = 'admin') {
    const identity = new IdentityModuleImplementation(db, new MockOidcAdapter({
      issuer: 'https://identity.example.test', subject, displayName: subject,
    }), {
      redirectUri: `${origin}/api/auth/callback`, allowedOrigins: new Set([origin]),
      installationAdministrators: new Set(['https://identity.example.test|admin']),
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
    })
    const space = new SpaceModuleImplementation(db, {
      invitationHmacSecret: 'test-invitation-hmac-secret-with-32-bytes',
      sessionHmacSecret: 'test-session-hmac-secret-with-32-bytes',
    })
    const begun = await identity.signIn({ kind: 'begin', returnTo: '/' as never })
    if (!begun.ok || begun.value.kind !== 'redirect') throw new Error('Sign-in failed')
    const completed = await identity.signIn({ kind: 'complete', attemptSecret: begun.value.attemptSecret,
      callback: { code: 'accepted-code', state: new URL(begun.value.authorizationUrl).searchParams.get('state')! } })
    if (!completed.ok || completed.value.kind !== 'established') throw new Error('Sign-in failed')
    const session = await identity.session({ kind: 'resolve', use: 'change', evidence: {
      sessionSecret: completed.value.session.sessionSecret, csrfToken: completed.value.session.csrfToken, origin,
    } })
    if (!session.ok || session.value.kind !== 'resolved') throw new Error('Session failed')
    return { identity, space, board: new BoardModuleImplementation(db), session: session.value,
      browserSession: completed.value.session }
  }

  async function setup(key = 'DIG') {
    const app = await signIn()
    const created = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'create-space', input: { key, displayName: key, timeZone: 'Europe/Oslo' } } })
    if (!created.ok || created.value.result.kind !== 'space-created') throw new Error('Space failed')
    return { ...app, created: created.value.result.space }
  }

  async function access<P extends SpaceUse>(app: Awaited<ReturnType<typeof signIn>>, use: P, key = 'DIG') {
    const result = await app.space.authorize(app.session.identity, {
      space: { kind: 'key', spaceKey: key as SpaceKey }, use,
    })
    if (!result.ok) throw new Error(`Authorization failed: ${JSON.stringify(result.fault)}`)
    return result.value
  }

  async function change(app: Awaited<ReturnType<typeof signIn>>, command: BoardCommand, key = 'DIG') {
    return app.board.change(await access(app, 'board-change', key), { requestId: randomUUID() as RequestId, command })
  }

  async function overview(app: Awaited<ReturnType<typeof setup>>) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'overview' })
    if (!result.ok || result.value.kind !== 'overview') throw new Error(JSON.stringify(result))
    return result.value.value
  }

  async function capture(app: Awaited<ReturnType<typeof signIn>>) {
    const result = await change(app, { kind: 'capture-task', input: { title: 'Discuss this work' } })
    if (!result.ok || !result.value.result.taskId) throw new Error('Capture failed')
    return result.value.result.taskId
  }

  async function detail(app: Awaited<ReturnType<typeof signIn>>, taskId: import('./shared.js').TaskId) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'task', task: { kind: 'id', taskId }, markNotificationsRead: true, comments: { size: 200 }, history: { size: 200 } })
    if (!result.ok || result.value.kind !== 'task') throw new Error(JSON.stringify(result))
    return result.value.value
  }

  async function invite(app: Awaited<ReturnType<typeof signIn>>, subject = 'member') {
    const invitation = await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'issue-invitation', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } } })
    if (!invitation.ok || invitation.value.result.kind !== 'invitation-issued') throw new Error('Invitation failed')
    const member = await signIn(subject)
    const accepted = await member.space.change(member.session.identity, { requestId: randomUUID() as RequestId,
      command: { kind: 'accept-invitation', invitationSecret: invitation.value.result.invitationSecret } })
    if (!accepted.ok || accepted.value.session.kind !== 'replace') throw new Error('Acceptance failed')
    const resolved = await member.identity.session({ kind: 'resolve', use: 'read', evidence: { sessionSecret: accepted.value.session.sessionSecret } })
    if (!resolved.ok || resolved.value.kind !== 'resolved') throw new Error('Replacement failed')
    return { ...member, session: resolved.value }
  }

  it('adds and independently pages authored plain-text comments with idempotent receipts', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const permission = await access(app, 'board-change')
    const request = { requestId: randomUUID() as RequestId, command: { kind: 'add-comment' as const, taskId, text: 'First line\nhttps://example.test', mentions: [] } }
    const result = await app.board.change(permission, request)
    expect(result.ok).toBe(true)
    expect(await app.board.change(permission, request)).toEqual(result)
    const task = await detail(app, taskId)
    expect(task.comments!.items).toHaveLength(1)
    expect(task.comments!.items[0]).toMatchObject({ text: 'First line\nhttps://example.test', revision: 1, author: { displayName: 'admin' }, removedAt: null, editedAt: null })
    expect(task.revision).toBe(1)
    expect(task.comments!.items[0].createdAt).toEqual(expect.any(String))
    expect((await overview(app)).board.changeSequence).toBe(2)
  })
  it('restricts editing to authors and records administrator removal as a tombstone and audit entry', async () => {
    const app = await setup()
    const author = await invite(app, 'author')
    const teammate = await invite(app, 'teammate')
    const taskId = await capture(app)
    expect((await change(author, { kind: 'add-comment', taskId, text: 'Original comment', mentions: [] })).ok).toBe(true)
    const original = (await detail(app, taskId)).comments!.items[0]
    const comment = { commentId: original.id, expectedRevision: original.revision }
    expect(await change(teammate, { kind: 'revise-comment', comment, text: 'Changed by someone else', mentions: [] })).toMatchObject({ ok: false, fault: { kind: 'forbidden' } })
    expect(await change(app, { kind: 'revise-comment', comment, text: 'Changed by administrator', mentions: [] })).toMatchObject({ ok: false, fault: { kind: 'forbidden' } })
    expect((await change(author, { kind: 'revise-comment', comment, text: 'Edited by author', mentions: [] })).ok).toBe(true)
    const edited = (await detail(app, taskId)).comments!.items[0]
    expect(edited.editedAt).toEqual(expect.any(String))
    expect(edited.revision).toBe(2)
    expect(await change(author, { kind: 'revise-comment', comment, text: 'Stale draft', mentions: [] })).toMatchObject({ ok: false, fault: { kind: 'conflict', reason: 'stale-comment' } })
    expect(await change(teammate, { kind: 'remove-comment', comment: { commentId: edited.id, expectedRevision: edited.revision } })).toMatchObject({ ok: false, fault: { kind: 'forbidden' } })
    expect((await change(app, { kind: 'remove-comment', comment: { commentId: edited.id, expectedRevision: edited.revision } })).ok).toBe(true)
    const removed = (await detail(app, taskId)).comments!.items[0]
    expect(removed).toMatchObject({ text: '', revision: 3, author: { displayName: 'author' } })
    expect(removed.removedAt).toEqual(expect.any(String))
    const audit = await app.space.read(app.session.identity, { kind: 'audit', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } })
    if (!audit.ok || audit.value.kind !== 'audit') throw new Error('Audit failed')
    expect(audit.value.entries.map((entry) => entry.action)).toContain('comment-moderated')
    expect((await detail(app, taskId)).history!.items.map((entry) => entry.kind)).toContain('comment-moderated')
  })

  it('binds mentions to current same-Space Members and only notifies other mentioned Members', async () => {
    const app = await setup()
    const author = await invite(app, 'author')
    const recipient = await invite(app, 'recipient')
    const board = await overview(app)
    const authorId = board.members.find((member) => member.displayName === 'author')!.id
    const recipientId = board.members.find((member) => member.displayName === 'recipient')!.id
    const taskId = await capture(app)
    const result = await change(author, { kind: 'add-comment', taskId, text: 'Please review', mentions: [recipientId, authorId, recipientId] })
    expect(result.ok).toBe(true)
    const comments = (await detail(author, taskId)).comments!.items
    expect(comments[0].mentions.map((member) => member.id).sort()).toEqual([authorId, recipientId].sort())
    const inbox = await recipient.board.read(await access(recipient, 'board-read'), { kind: 'inbox' })
    if (!inbox.ok || inbox.value.kind !== 'inbox') throw new Error(JSON.stringify(inbox))
    expect(inbox.value.value.items).toHaveLength(1)
    expect(inbox.value.value.items[0]).toMatchObject({ kind: 'mention', task: { id: taskId, key: 'DIG-1' }, actor: { displayName: 'author' }, read: false })
    const own = await author.board.read(await access(author, 'board-read'), { kind: 'inbox' })
    if (!own.ok || own.value.kind !== 'inbox') throw new Error('Inbox failed')
    expect(own.value.value.items).toHaveLength(0)
    expect((await overview({ ...recipient, created: app.created })).unreadNotifications).toBe(1)
  })

  async function inbox(app: Awaited<ReturnType<typeof signIn>>) {
    const result = await app.board.read(await access(app, 'board-read'), { kind: 'inbox' })
    if (!result.ok || result.value.kind !== 'inbox') throw new Error(JSON.stringify(result))
    return result.value.value
  }

  it('commits simultaneous comments mentioning each other without membership-lock deadlocks', async () => {
    const app = await setup()
    const colleague = await invite(app, 'colleague')
    const board = await overview(app)
    const adminId = board.members.find((member) => member.displayName === 'admin')!.id
    const colleagueId = board.members.find((member) => member.displayName === 'colleague')!.id
    const taskId = await capture(app)
    const adminAccess = await access(app, 'board-change')
    const colleagueAccess = await access(colleague, 'board-change')
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => {
      const author = index % 2 === 0 ? app : colleague
      return author.board.change(index % 2 === 0 ? adminAccess : colleagueAccess, {
        requestId: randomUUID() as RequestId, command: { kind: 'add-comment', taskId,
          text: `Concurrent comment ${index}`, mentions: [index % 2 === 0 ? colleagueId : adminId] },
      })
    }))
    expect(results.map((result) => result.ok)).toEqual(Array(6).fill(true))
    expect((await inbox(app)).items).toHaveLength(3)
    expect((await inbox(colleague)).items).toHaveLength(3)
  }, 15000)

  it('rolls back a notification-bearing comment when receipt persistence fails, then replays it once', async () => {
    const app = await setup()
    const recipient = await invite(app, 'recipient')
    const before = await overview(app)
    const recipientId = before.members.find((member) => member.displayName === 'recipient')!.id
    const taskId = await capture(app)
    const original = await detail(app, taskId)
    const permission = await access(app, 'board-change')
    const request = { requestId: randomUUID() as RequestId,
      command: { kind: 'add-comment' as const, taskId, text: 'Atomic mention', mentions: [recipientId] } }
    await db.query(`create function team.test_reject_comment_receipt() returns trigger language plpgsql as $$
      begin raise exception 'test receipt failure'; end $$;
      create trigger test_reject_comment_receipt before insert on team.board_request_receipts
        for each statement execute function team.test_reject_comment_receipt()`)
    try {
      expect(await app.board.change(permission, request)).toEqual({ ok: false, fault: { kind: 'temporarily-unavailable' } })
      expect(await detail(app, taskId)).toEqual(original)
      expect((await inbox(recipient)).items).toEqual([])
      expect((await overview(app)).board.changeSequence).toBe(1)
    } finally {
      await db.query('drop trigger test_reject_comment_receipt on team.board_request_receipts')
      await db.query('drop function team.test_reject_comment_receipt()')
    }
    const committed = await app.board.change(permission, request)
    expect(committed.ok).toBe(true)
    expect(await app.board.change(permission, request)).toEqual(committed)
    const after = await detail(app, taskId)
    expect(after.comments!.items).toHaveLength(1)
    expect(after.history!.items.map((entry) => entry.kind)).toEqual(['comment-added', 'capture-task'])
    expect((await inbox(recipient)).items).toHaveLength(1)
    expect((await overview(app)).board.changeSequence).toBe(2)
  })

  it('notifies new Assignees and assigned-Task comments, and marks only the opener\'s Task notifications read', async () => {
    const app = await setup()
    const assignee = await invite(app, 'assignee')
    const colleague = await invite(app, 'colleague')
    const board = await overview(app)
    const assigneeId = board.members.find((member) => member.displayName === 'assignee')!.id
    const colleagueId = board.members.find((member) => member.displayName === 'colleague')!.id
    const taskId = await capture(app)
    let task = await detail(app, taskId)
    await change(app, { kind: 'revise-task', task: { taskId, expectedRevision: task.revision }, changes: { assigneeId } })
    expect((await inbox(assignee)).items.map((notification) => notification.kind)).toEqual(['assignment'])
    task = await detail(app, taskId)
    await change(app, { kind: 'revise-task', task: { taskId, expectedRevision: task.revision }, changes: { assigneeId } })
    expect((await inbox(assignee)).items).toHaveLength(1)
    await change(colleague, { kind: 'add-comment', taskId, text: 'Please check', mentions: [] })
    expect((await inbox(assignee)).items.map((notification) => notification.kind)).toEqual(['comment', 'assignment'])
    await change(app, { kind: 'add-comment', taskId, text: 'Both of you', mentions: [assigneeId, colleagueId] })
    expect((await inbox(assignee)).items.map((notification) => notification.kind)).toEqual(['mention', 'comment', 'assignment'])
    expect(await change(assignee, { kind: 'mark-notification-read', notificationId: '' as never })).toMatchObject({ ok: false, fault: { kind: 'not-found' } })
    expect((await inbox(assignee)).items.every((notification) => !notification.read)).toBe(true)
    const lookup = await assignee.board.read(await access(assignee, 'board-read'), { kind: 'task', task: { kind: 'key', taskKey: 'DIG-1' as never } })
    expect(lookup.ok).toBe(true)
    expect((await inbox(assignee)).items.every((notification) => !notification.read)).toBe(true)
    await detail(assignee, taskId)
    expect((await inbox(assignee)).items.every((notification) => notification.read)).toBe(true)
    expect((await inbox(colleague)).items[0].read).toBe(false)
    expect(await change(colleague, { kind: 'mark-notification-read', notificationId: (await inbox(assignee)).items[0].id })).toMatchObject({ ok: false, fault: { kind: 'not-found' } })
    expect((await change(colleague, { kind: 'mark-all-notifications-read' })).ok).toBe(true)
    expect((await inbox(colleague)).items.every((notification) => notification.read)).toBe(true)
  })

  it('treats closing comments as editable comments without duplicating closure history', async () => {
    const app = await setup()
    const taskId = await capture(app)
    const task = await detail(app, taskId)
    const complete = (await overview(app)).columns.find((column) => column.completion)!
    expect((await change(app, { kind: 'place-task', task: { taskId, expectedRevision: task.revision },
      destination: { columnId: complete.id, expectedOrderRevision: complete.orderRevision, place: { kind: 'last' } },
      closure: { outcome: { kind: 'rejected' }, comment: 'Outside our scope' } })).ok).toBe(true)
    const closed = await detail(app, taskId)
    expect(closed.comments!.items).toHaveLength(1)
    expect(closed.comments!.items[0].text).toBe('Outside our scope')
    expect(closed.history!.items.map((entry) => entry.kind)).toEqual(['closed', 'column-transition', 'capture-task'])
    const comment = closed.comments!.items[0]
    expect((await change(app, { kind: 'remove-comment', comment: { commentId: comment.id, expectedRevision: comment.revision } })).ok).toBe(true)
    const removed = await detail(app, taskId)
    expect(removed.comments!.items[0].text).toBe('')
    expect(removed.history!.items.find((entry) => entry.kind === 'closed')?.comment).toBeUndefined()
    expect(removed.closedAt).toBe(closed.closedAt)
  })

  it('expires notifications after 90 days and keeps inbox paging private and revision-aware', async () => {
    const app = await setup()
    const recipient = await invite(app, 'recipient')
    const recipientId = (await overview(app)).members.find((member) => member.displayName === 'recipient')!.id
    const taskId = await capture(app)
    for (const text of ['One', 'Two', 'Three']) await change(app, { kind: 'add-comment', taskId, text, mentions: [recipientId] })
    const read = await access(recipient, 'board-read')
    const first = await recipient.board.read(read, { kind: 'inbox', page: { size: 1 } })
    if (!first.ok || first.value.kind !== 'inbox') throw new Error('Inbox failed')
    expect(first.value.value.items).toHaveLength(1)
    const notice = first.value.value.items[0]
    expect(new Date(notice.expiresAt).getTime() - new Date(notice.createdAt).getTime()).toBe(90 * 24 * 60 * 60 * 1000)
    expect(await app.board.read(await access(app, 'board-read'), { kind: 'inbox', page: { after: first.value.value.next } })).toMatchObject({ ok: false, fault: { kind: 'cursor-expired' } })
    const second = await recipient.board.read(read, { kind: 'inbox', page: { size: 1, after: first.value.value.next } })
    if (!second.ok || second.value.kind !== 'inbox') throw new Error('Inbox failed')
    expect(second.value.value.items[0].id).not.toBe(notice.id)
    expect((await change(recipient, { kind: 'mark-notification-read', notificationId: notice.id })).ok).toBe(true)
    expect(await recipient.board.read(read, { kind: 'inbox', page: { after: first.value.value.next } })).toMatchObject({ ok: false, fault: { kind: 'cursor-expired' } })
    // Time fixture: all notifications have passed their retention deadline.
    await db.query("update team.notifications set expires_at = now() - interval '1 second' where space_id = $1", [app.created.id])
    expect((await inbox(recipient)).items).toHaveLength(0)
    expect((await overview({ ...recipient, created: app.created })).unreadNotifications).toBe(0)
  })

  it('rejects invalid and foreign mentions, preserves former-Member authorship, and pages tombstones', async () => {
    const app = await setup()
    const author = await invite(app, 'author')
    const taskId = await capture(app)
    expect(await change(author, { kind: 'add-comment', taskId, text: 'x'.repeat(5001), mentions: [] })).toMatchObject({ ok: false, fault: { kind: 'invalid' } })
    expect(await change(author, { kind: 'add-comment', taskId, text: 'No foreign mentions', mentions: [randomUUID() as never] })).toMatchObject({ ok: false, fault: { kind: 'not-found' } })
    for (const text of ['First', 'Second', 'Third']) expect((await change(author, { kind: 'add-comment', taskId, text, mentions: [] })).ok).toBe(true)
    const last = (await detail(author, taskId)).comments!.items[0]
    expect((await change(author, { kind: 'remove-comment', comment: { commentId: last.id, expectedRevision: last.revision } })).ok).toBe(true)
    const read = await access(app, 'board-read')
    const page = await app.board.read(read, { kind: 'task', task: { kind: 'id', taskId }, comments: { size: 1 }, history: { size: 1 } })
    if (!page.ok || page.value.kind !== 'task') throw new Error('Detail failed')
    expect(page.value.value.comments!.items[0].removedAt).toEqual(expect.any(String))
    const next = await app.board.read(read, { kind: 'task', task: { kind: 'id', taskId }, comments: { size: 1, after: page.value.value.comments!.next } })
    if (!next.ok || next.value.kind !== 'task') throw new Error('Detail failed')
    expect(next.value.value.comments!.items[0].text).toBe('Second')
    const members = await app.space.read(app.session.identity, { kind: 'members', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey } })
    if (!members.ok || members.value.kind !== 'members') throw new Error('Members failed')
    const member = members.value.members.find((member) => member.displayName === 'author')!
    expect((await app.space.change(app.session.identity, { requestId: randomUUID() as RequestId, command: {
      kind: 'remove-member', space: { kind: 'key', spaceKey: 'DIG' as SpaceKey }, member: { memberId: member.id, expectedRevision: member.revision },
    } })).ok).toBe(true)
    const remaining = await detail(app, taskId)
    expect(remaining.comments!.items.every((comment) => comment.author.displayName === 'author')).toBe(true)
    expect(await change(app, { kind: 'add-comment', taskId, text: 'Former mention', mentions: [member.id] })).toMatchObject({ ok: false, fault: { kind: 'not-found' } })
  })

})
