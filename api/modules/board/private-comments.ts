import type { DbClient } from '../../db.js'
import type { BoardCommand, BoardProjectionChange, CommentView, Page } from '../../contracts/board.js'
import type { CommentId, Instant, MemberId, PageRequest, Revision } from '../shared.js'
import { notify } from './private-notifications.js'
import { recordEvent } from './private-history.js'
import { recordCommentModeration } from '../space/private-moderation-audit.js'
import { BoardRejection, decodeCursor, encodeCursor, pageSize } from './private-cursors.js'

interface CommentRow {
  id: CommentId
  ordering_key: string
  task_id: string
  author_member_id: MemberId
  display_name: string
  text: string
  revision: Revision
  created_at: Date
  edited_at: Date | null
  removed_at: Date | null
  mentions: CommentView['mentions']
}

const commentQuery = `select comment.*, identity.display_name,
  coalesce((select jsonb_agg(jsonb_build_object('id', mentioned.id, 'displayName', profile.display_name) order by mentioned.id)
    from team.comment_mentions binding join team.members mentioned on mentioned.space_id = binding.space_id and mentioned.id = binding.member_id
    join team.identities profile on profile.id = mentioned.identity_id
    where binding.space_id = comment.space_id and binding.comment_id = comment.id), '[]'::jsonb) as mentions from team.task_comments comment
  join team.members member on member.space_id = comment.space_id and member.id = comment.author_member_id
  join team.identities identity on identity.id = member.identity_id`

function commentView(row: CommentRow): CommentView {
  return { id: row.id, text: row.text, revision: row.revision, mentions: row.mentions,
    author: { id: row.author_member_id, displayName: row.display_name }, createdAt: row.created_at.toISOString() as Instant,
    editedAt: row.edited_at?.toISOString() as Instant ?? null, removedAt: row.removed_at?.toISOString() as Instant ?? null }
}

export async function commentPage(client: DbClient, spaceId: string, taskId: string, sequence: number, page: PageRequest): Promise<Page<CommentView>> {
  const size = pageSize(page.size)
  const scope = `${spaceId}:comments:${taskId}`
  const last = decodeCursor(page.after, scope, sequence)
  const result = await client.query<CommentRow>(`${commentQuery} where comment.space_id = $1 and comment.task_id = $2
    ${last ? 'and comment.ordering_key < $4::bigint' : ''} order by comment.ordering_key desc limit $3`, [spaceId, taskId, size + 1, ...(last ? [last] : [])])
  const rows = result.rows.slice(0, size)
  return { items: rows.map(commentView), ...(result.rows.length > size ? { next: encodeCursor(scope, sequence, rows.at(-1)!.ordering_key) } : {}) }
}

export async function addComment(client: DbClient, spaceId: string, taskId: string, actorId: string, text: string, mentions: MemberId[] = []): Promise<CommentView> {
  validateCommentText(text)
  const task = await client.query<{ archived_at: Date | null; assignee_id: string | null }>('select archived_at, assignee_id from team.tasks where space_id = $1 and id::text = $2', [spaceId, taskId])
  if (!task.rows[0]) throw new BoardRejection({ kind: 'not-found' })
  if (task.rows[0].archived_at) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'task', message: 'Restore the Task before commenting.' }] })
  await validateMentions(client, spaceId, mentions)
  const created = await client.query<{ id: string }>(`insert into team.task_comments (space_id, task_id, author_member_id, text)
    values ($1,$2,$3,$4) returning id`, [spaceId, taskId, actorId, text])
  await bindMentions(client, spaceId, created.rows[0].id, mentions)
  const recipients: Array<{ memberId: string; kind: 'mention' | 'comment' }> = [...new Set(mentions)].map((memberId) => ({ memberId, kind: 'mention' }))
  if (task.rows[0].assignee_id && !mentions.includes(task.rows[0].assignee_id as MemberId)) recipients.push({ memberId: task.rows[0].assignee_id, kind: 'comment' })
  await notify(client, spaceId, actorId, taskId, recipients, created.rows[0].id)
  const result = await client.query<CommentRow>(`${commentQuery} where comment.space_id = $1 and comment.id = $2`, [spaceId, created.rows[0].id])
  return commentView(result.rows[0])
}

export type CommentCommand = Extract<BoardCommand, { kind: 'add-comment' | 'revise-comment' | 'remove-comment' }>

export async function changeComment(client: DbClient, spaceId: string, actorId: string, actorIdentityId: string,
  role: 'member' | 'space-administrator', command: CommentCommand): Promise<{ taskId: import('../shared.js').TaskId; comment: CommentView; changes: BoardProjectionChange[] }> {
  if (command.kind === 'add-comment') {
    const comment = await addComment(client, spaceId, command.taskId, actorId, command.text, command.mentions)
    const event = await recordEvent(client, spaceId, command.taskId, actorId, 'comment-added', {})
    return { taskId: command.taskId, comment, changes: [{ kind: 'comment-upserted', taskId: command.taskId, comment }, { kind: 'history-appended', taskId: command.taskId, entries: [event] }] }
  }
  const found = await client.query<CommentRow>(`${commentQuery} where comment.space_id = $1 and comment.id::text = $2`, [spaceId, command.comment.commentId])
  const current = found.rows[0]
  if (!current) throw new BoardRejection({ kind: 'not-found' })
  const taskId = current.task_id as import('../shared.js').TaskId
  if (current.author_member_id !== actorId && (command.kind === 'revise-comment' || role !== 'space-administrator')) throw new BoardRejection({ kind: 'forbidden' })
  if (current.revision !== command.comment.expectedRevision) throw new BoardRejection({ kind: 'conflict', reason: 'stale-comment', currentComment: commentView(current) })
  if (current.removed_at) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'comment', message: 'This comment was removed.' }] })
  const task = await client.query<{ archived_at: Date | null }>('select archived_at from team.tasks where space_id = $1 and id = $2', [spaceId, taskId])
  if (task.rows[0].archived_at) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'task', message: 'Restore the Task before changing comments.' }] })
  const removing = command.kind === 'remove-comment'
  if (!removing) validateCommentText(command.text)
  if (!removing) await validateMentions(client, spaceId, command.mentions)
  await client.query(`update team.task_comments set text = $3, revision = revision + 1,
    edited_at = case when $4 then edited_at else now() end,
    removed_at = case when $4 then now() else null end, removed_by_member_id = case when $4 then $5::uuid else null end
    where space_id = $1 and id = $2`, [spaceId, current.id, removing ? '' : command.text, removing, actorId])
  await bindMentions(client, spaceId, current.id, removing ? [] : command.mentions)
  if (!removing) await notify(client, spaceId, actorId, taskId,
    [...new Set(command.mentions)].filter((id) => !current.mentions.some((member) => member.id === id)).map((memberId) => ({ memberId, kind: 'mention' })), current.id)
  const revised = await client.query<CommentRow>(`${commentQuery} where comment.space_id = $1 and comment.id = $2`, [spaceId, current.id])
  const comment = commentView(revised.rows[0])
  const moderated = removing && current.author_member_id !== actorId
  if (moderated) await recordCommentModeration(client, spaceId, actorIdentityId, taskId, comment.id)
  const event = await recordEvent(client, spaceId, taskId, actorId, moderated ? 'comment-moderated' : removing ? 'comment-removed' : 'comment-edited', {})
  return { taskId, comment, changes: [
    removing ? { kind: 'comment-removed', taskId, comment: { id: comment.id, removedAt: comment.removedAt!, revision: comment.revision } }
      : { kind: 'comment-upserted', taskId, comment },
    { kind: 'history-appended', taskId, entries: [event] },
  ] }
}

async function validateMentions(client: DbClient, spaceId: string, mentions: MemberId[]) {
  if (!Array.isArray(mentions) || mentions.length > 25 || mentions.some((id) => typeof id !== 'string')) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'mentions', message: 'Choose up to 25 current Members.' }] })
  const members = await client.query<{ id: string }>('select id from team.members where space_id = $1 and id::text = any($2::text[]) and ended_at is null', [spaceId, mentions])
  if (members.rows.length !== new Set(mentions).size) throw new BoardRejection({ kind: 'not-found' })
}

async function bindMentions(client: DbClient, spaceId: string, commentId: string, mentions: MemberId[]) {
  await client.query('delete from team.comment_mentions where space_id = $1 and comment_id = $2', [spaceId, commentId])
  for (const memberId of new Set(mentions)) await client.query('insert into team.comment_mentions (space_id, comment_id, member_id) values ($1,$2,$3)', [spaceId, commentId, memberId])
}

export async function commentForClosure(client: DbClient, spaceId: string, eventId: string): Promise<CommentView | undefined> {
  const result = await client.query<CommentRow>(`${commentQuery} where comment.space_id = $1 and comment.origin_event_id = $2`, [spaceId, eventId])
  return result.rows[0] ? commentView(result.rows[0]) : undefined
}

function validateCommentText(text: string) {
  if (typeof text !== 'string' || !text.trim() || [...text].length > 5000) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'text', message: 'Use a comment of 1 to 5,000 characters.' }] })
}
