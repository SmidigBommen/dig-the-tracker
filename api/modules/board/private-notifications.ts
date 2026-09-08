import type { DbClient } from '../../db.js'
import type { BoardProjectionChange, NotificationView, Page } from '../../contracts/board.js'
import type { Instant, MemberId, NotificationId, PageRequest, TaskId, TaskKey } from '../shared.js'
import { BoardRejection, decodeCursor, encodeCursor, pageSize } from './private-cursors.js'

export async function notify(client: DbClient, spaceId: string, actorId: string, taskId: string,
  recipients: Array<{ memberId: string; kind: NotificationView['kind'] }>, commentId?: string) {
  for (const recipient of recipients) {
    if (recipient.memberId === actorId) continue
    const inserted = await client.query(`insert into team.notifications (space_id, recipient_member_id, actor_member_id, task_id, comment_id, kind)
      select $1, id, $3, $4, $5, $6 from team.members where space_id = $1 and id = $2 and ended_at is null`,
    [spaceId, recipient.memberId, actorId, taskId, commentId ?? null, recipient.kind])
    if (inserted.rowCount) await advanceInboxRevision(client, spaceId, recipient.memberId)
  }
}

export async function unreadCount(client: DbClient, spaceId: string, memberId: string): Promise<number> {
  const result = await client.query<{ count: number }>(`select count(*)::int as count from team.notifications
    where space_id = $1 and recipient_member_id = $2 and read_at is null and expires_at > now()`, [spaceId, memberId])
  return result.rows[0].count
}

export async function inboxPage(client: DbClient, spaceId: string, memberId: string, page?: PageRequest): Promise<Page<NotificationView>> {
  const size = pageSize(page?.size)
  const revision = await client.query<{ revision: number }>('select revision from team.member_inboxes where space_id = $1 and member_id = $2', [spaceId, memberId])
  const currentRevision = revision.rows[0]?.revision ?? 0
  const scope = `${spaceId}:inbox:${memberId}`
  const last = decodeCursor(page?.after, scope, currentRevision)
  await client.query('delete from team.notifications where space_id = $1 and recipient_member_id = $2 and expires_at <= now()', [spaceId, memberId])
  const result = await client.query<{
    id: NotificationId; ordering_key: string; task_id: TaskId; key: TaskKey; title: string; kind: NotificationView['kind'];
    actor_member_id: MemberId; display_name: string; created_at: Date; expires_at: Date; read_at: Date | null;
  }>(`select notification.*, task.title, space.space_key || '-' || task.number::text as key, identity.display_name
    from team.notifications notification join team.tasks task on task.space_id = notification.space_id and task.id = notification.task_id
    join team.spaces space on space.id = notification.space_id
    join team.members actor on actor.space_id = notification.space_id and actor.id = notification.actor_member_id
    join team.identities identity on identity.id = actor.identity_id
    where notification.space_id = $1 and notification.recipient_member_id = $2 and notification.expires_at > now()
      ${last ? 'and notification.ordering_key < $4::bigint' : ''} order by notification.ordering_key desc limit $3`,
  [spaceId, memberId, size + 1, ...(last ? [last] : [])])
  const rows = result.rows.slice(0, size)
  return { items: rows.map((row) => ({ id: row.id, kind: row.kind, read: Boolean(row.read_at),
    task: { id: row.task_id, key: row.key, title: row.title }, actor: { id: row.actor_member_id, displayName: row.display_name },
    createdAt: row.created_at.toISOString() as Instant, expiresAt: row.expires_at.toISOString() as Instant })),
  ...(result.rows.length > size ? { next: encodeCursor(scope, currentRevision, rows.at(-1)!.ordering_key) } : {}) }
}

export async function markNotificationsRead(client: DbClient, spaceId: string, memberId: MemberId,
  selection: { notificationId?: NotificationId; taskId?: TaskId }): Promise<BoardProjectionChange | undefined> {
  if (selection.notificationId !== undefined) {
    const found = await client.query('select id from team.notifications where space_id = $1 and recipient_member_id = $2 and id::text = $3 and expires_at > now()', [spaceId, memberId, selection.notificationId])
    if (!found.rows[0]) throw new BoardRejection({ kind: 'not-found' })
  }
  const changed = await client.query(`update team.notifications set read_at = now()
    where space_id = $1 and recipient_member_id = $2 and read_at is null and expires_at > now()
    ${selection.notificationId ? 'and id::text = $3' : selection.taskId ? 'and task_id::text = $3' : ''}`,
  [spaceId, memberId, ...(selection.notificationId || selection.taskId ? [selection.notificationId ?? selection.taskId] : [])])
  if (!changed.rowCount) return
  await advanceInboxRevision(client, spaceId, memberId)
  return { kind: 'notifications-read', memberId, all: !selection.notificationId && !selection.taskId,
    ...(selection.notificationId ? { notificationIds: [selection.notificationId] } : {}),
    ...(selection.taskId ? { taskId: selection.taskId } : {}), unreadNotifications: await unreadCount(client, spaceId, memberId) }
}

async function advanceInboxRevision(client: DbClient, spaceId: string, memberId: string) {
  // Membership rows are locked before the Board. Keep inbox writes after the Board lock.
  await client.query(`insert into team.member_inboxes (space_id, member_id) values ($1, $2)
    on conflict (space_id, member_id) do update set revision = team.member_inboxes.revision + 1`, [spaceId, memberId])
}
