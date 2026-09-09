import { Button } from '../ui/Button.tsx'
import { CommentComposer } from './CommentComposer.tsx'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'
import { PlainText } from './PlainText.tsx'
import { MemberMention } from './MemberMention.tsx'

export function CommentPanel({ session, state, disabled }: { session: BoardSession; state: BoardSessionState; disabled: boolean }) {
  const detail = state.detail!
  const draft = state.commentDraft
  const administrator = state.overview.members.find((member) => member.id === state.overview.currentMemberId)?.role === 'space-administrator'
  return <section className="task-comments" aria-label="Comments">
    {!detail.archived && draft && <CommentComposer session={session} state={state} disabled={disabled} />}
    {state.commentConflict && <section className="comment-conflict" aria-label="Current comment"><h4>Current comment</h4>
      {state.commentConflict.removedAt ? <p>Comment removed</p> : <PlainText text={state.commentConflict.text} />}
      <Button variant="secondary" disabled={disabled} onClick={() => session.useCurrentCommentRevision()}>{state.commentConflict.removedAt ? 'Keep my draft as a new comment' : 'Keep my draft using this revision'}</Button>
    </section>}
    <ol>{detail.comments?.items.map((comment) => <li key={comment.id}>
      <header><strong>{comment.author.displayName}</strong> <time dateTime={comment.createdAt} title={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
        {comment.editedAt && <span title={comment.editedAt}>Edited</span>}</header>
      {comment.removedAt ? <p>Comment removed</p> : <><PlainText text={comment.text} /><p className="comment-mentions">{comment.mentions.map((member) => <MemberMention key={member.id} member={member} current={state.overview.members.find((current) => current.id === member.id)} />)}</p>
        {comment.author.id === state.overview.currentMemberId && <Button variant="ghost" disabled={disabled || Boolean(draft?.text || draft?.commentId)} onClick={() => session.editComment(comment)}>Edit comment</Button>}
        {(comment.author.id === state.overview.currentMemberId || administrator) && <Button variant="ghost" disabled={disabled || draft?.commentId === comment.id} onClick={() => void session.removeComment(comment)}>Remove comment</Button>}
      </>}
    </li>)}</ol>
    {detail.comments?.next && <Button variant="secondary" disabled={state.busy || state.pagesStale} onClick={() => void session.loadMoreComments()}>Load more comments</Button>}
  </section>
}
