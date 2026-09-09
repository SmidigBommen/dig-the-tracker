import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { BoardMemberView } from '../../api/contracts/board.ts'
import type { MemberId } from '../../api/modules/shared.ts'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'
import { Button } from '../ui/Button.tsx'

export function CommentComposer({ session, state, disabled }: { session: BoardSession; state: BoardSessionState; disabled: boolean }) {
  const draft = state.commentDraft!
  const input = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return
    input.current?.focus()
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = undefined
  }, [draft.text])
  const listId = useId()
  const hintId = useId()
  const [query, setQuery] = useState<{ start: number; end: number; text: string }>()
  const [selected, setSelected] = useState(0)
  const names = new Map([
    ...state.detail!.comments?.items.flatMap((comment) => comment.mentions).map((member) => [member.id, member.displayName] as const) ?? [],
    ...state.overview.members.map((member) => [member.id, member.displayName] as const),
  ])
  const matches = query && !disabled ? state.overview.members.filter((member) =>
    !draft.mentions.includes(member.id) && member.displayName.toLocaleLowerCase().includes(query.text.toLocaleLowerCase())).slice(0, 8) : []
  const active = Math.min(selected, matches.length - 1)
  const findQuery = (text: string, caret: number) => {
    const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(text.slice(0, caret))
    const alreadyInserted = match && draft.mentions.some((id) => match[1].startsWith(`${names.get(id)} `))
    setQuery(match && !alreadyInserted ? { start: caret - match[1].length - 1, end: caret, text: match[1] } : undefined)
    setSelected(0)
  }
  const choose = (member: BoardMemberView) => {
    if (!query || disabled) return
    const inserted = `@${member.displayName} `
    pendingCaret.current = query.start + inserted.length
    session.updateCommentDraft({ text: draft.text.slice(0, query.start) + inserted + draft.text.slice(query.end), mentions: [...draft.mentions, member.id] })
    setQuery(undefined)
  }
  const removeMention = (id: MemberId) => session.updateCommentDraft({ mentions: draft.mentions.filter((member) => member !== id) })
  return <form className="comment-composer" onSubmit={(event) => { event.preventDefault(); setQuery(undefined); void session.saveComment() }}>
    <fieldset disabled={disabled}>
      <div className="mention-input">
        <textarea ref={input} aria-label="Comment" aria-describedby={hintId} placeholder={draft.commentId ? 'Edit your comment…' : 'Write a comment…'} rows={2}
          aria-autocomplete="list" aria-controls={matches.length ? listId : undefined}
          aria-activedescendant={matches.length ? `${listId}-${matches[active].id}` : undefined}
          value={draft.text} onSelect={(event) => findQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
          onChange={(event) => {
            const text = event.target.value
            session.updateCommentDraft({ text })
            findQuery(text, event.target.selectionStart)
          }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !matches.length) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setSelected((active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
            } else if (event.key === 'Enter') { event.preventDefault(); choose(matches[active]) }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setQuery(undefined) }
          }} />
        {matches.length > 0 && <div id={listId} role="listbox" aria-label="Mention Members" className="mention-options">
          {matches.map((member, index) => <button key={member.id} id={`${listId}-${member.id}`} type="button" role="option"
            aria-selected={index === active} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(member)}>
            <span className="assignee-avatar" aria-hidden="true">{member.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>{member.displayName}
          </button>)}
        </div>}
      </div>
      {draft.mentions.length > 0 && <div className="mention-recipients" aria-label="Mention recipients"><span>Notifying</span>
        {draft.mentions.map((id) => <button key={id} type="button" aria-label={`Remove mention ${names.get(id) ?? 'Unknown'}`} onClick={() => removeMention(id)}>{names.get(id) ?? 'Unknown'} ×</button>)}
      </div>}
      <div className="comment-composer-footer"><span id={hintId}>Type @ to mention someone</span><div>
        {(draft.text || draft.mentions.length > 0 || draft.commentId) && <Button variant="ghost" aria-label="Discard comment draft" onClick={() => { session.cancelComment(); setQuery(undefined) }}>Discard</Button>}
        <Button variant="primary" type="submit" disabled={disabled || !draft.text.trim() || Boolean(state.commentConflict)}>{draft.commentId ? 'Save comment' : 'Post comment'}</Button>
      </div></div>
    </fieldset>
  </form>
}
