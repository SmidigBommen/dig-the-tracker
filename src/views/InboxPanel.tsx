import { Button } from '../ui/Button.tsx'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'

export function InboxPanel({ session, state, readOnly }: { session: BoardSession; state: BoardSessionState; readOnly: boolean }) {
  const reasons = { assignment: 'assigned you', mention: 'mentioned you', comment: 'commented on your Task' }
  return <section className="notification-inbox" aria-label="Notifications">
    <Button variant="secondary" disabled={state.busy || readOnly || state.overview.unreadNotifications === 0} onClick={() => void session.markNotificationRead()}>Mark all read</Button>
    {!state.inbox?.items.length && <p>No notifications.</p>}
    <ol>{state.inbox?.items.map((notification) => <li key={notification.id}>
      <p>{notification.actor.displayName} {reasons[notification.kind]}{!notification.read && <span className="unread-notification">Unread</span>}</p>
      <Button variant="ghost" disabled={state.busy} onClick={() => void session.openEditor({ kind: 'id', taskId: notification.task.id })}>Open {notification.task.key}: {notification.task.title}</Button>
      <time dateTime={notification.createdAt} title={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
      {!notification.read && <Button variant="ghost" disabled={state.busy || readOnly} onClick={() => void session.markNotificationRead(notification.id)}>Mark {notification.task.key} read</Button>}
    </li>)}</ol>
    {state.inbox?.next && <Button variant="secondary" disabled={state.busy || state.pagesStale} onClick={() => void session.openInbox(true)}>Load more notifications</Button>}
  </section>
}
