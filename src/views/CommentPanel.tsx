import type { MemberId } from '../../api/modules/shared.ts'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'
import { PlainText } from './PlainText.tsx'
import { MemberMention } from './MemberMention.tsx'

export function CommentPanel({ session, state, disabled }: { session: BoardSession; state: BoardSessionState; disabled: boolean }) {
  const detail = state.detail!
  const draft = state.commentDraft
  const administrator = state.overview.members.find((member) => member.id === state.overview.currentMemberId)?.role === 'space-administrator'
  return <section className="task-comments" aria-label="Comments"><h3>Comments</h3>
    {!detail.archived && draft && <form onSubmit={(event) => { event.preventDefault(); void session.saveComment() }}>
      <fieldset disabled={disabled}><label>Comment<textarea rows={3} value={draft.text} onChange={(event) => session.updateCommentDraft({ text: event.target.value })} /></label>
        <label>Mention Members<select multiple value={draft.mentions} onChange={(event) => session.updateCommentDraft({ mentions: Array.from(event.target.selectedOptions, (option) => option.value as MemberId) })}>
          {state.overview.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
          {draft.mentions.filter((id) => !state.overview.members.some((member) => member.id === id)).map((id) =>
            <option key={id} value={id}>{detail.comments?.items.flatMap((comment) => comment.mentions).find((member) => member.id === id)?.displayName ?? 'Unknown'} (former Member)</option>)}
        </select></label>
        <button className="quiet-button" type="submit" disabled={!draft.text.trim() || Boolean(state.commentConflict)}>{draft.commentId ? 'Save comment' : 'Post comment'}</button>
        {(draft.text || draft.mentions.length > 0 || draft.commentId) && <button className="text-button" type="button" onClick={() => session.cancelComment()}>Discard comment draft</button>}
      </fieldset>
    </form>}
    {state.commentConflict && <section aria-label="Current comment"><h4>Current comment</h4>
      {state.commentConflict.removedAt ? <p>Comment removed</p> : <PlainText text={state.commentConflict.text} />}
      <button className="quiet-button" disabled={disabled} onClick={() => session.useCurrentCommentRevision()}>{state.commentConflict.removedAt ? 'Keep my draft as a new comment' : 'Keep my draft using this revision'}</button>
    </section>}
    <ol>{detail.comments?.items.map((comment) => <li key={comment.id}>
      <header><strong>{comment.author.displayName}</strong> <time dateTime={comment.createdAt} title={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
        {comment.editedAt && <span title={comment.editedAt}>Edited</span>}</header>
      {comment.removedAt ? <p>Comment removed</p> : <><PlainText text={comment.text} /><p className="comment-mentions">{comment.mentions.map((member) => <MemberMention key={member.id} member={member} current={state.overview.members.find((current) => current.id === member.id)} />)}</p>
        {comment.author.id === state.overview.currentMemberId && <button className="text-button" disabled={disabled || Boolean(draft?.text || draft?.commentId)} onClick={() => session.editComment(comment)}>Edit comment</button>}
        {(comment.author.id === state.overview.currentMemberId || administrator) && <button className="text-button" disabled={disabled || draft?.commentId === comment.id} onClick={() => void session.removeComment(comment)}>Remove comment</button>}
      </>}
    </li>)}</ol>
    {detail.comments?.next && <button className="quiet-button" disabled={state.busy || state.pagesStale} onClick={() => void session.loadMoreComments()}>Load more comments</button>}
  </section>
}
