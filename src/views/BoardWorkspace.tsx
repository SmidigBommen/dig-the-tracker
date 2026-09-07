import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import type { BoardOverview, TaskSummary } from '../../api/contracts/board.ts'
import type { MemberId } from '../../api/modules/shared.ts'
import { BoardSession, type BoardTransport } from '../board-session/board-session.ts'
import './BoardWorkspace.css'

export function BoardWorkspace({ initialBoard, transport }: { initialBoard: BoardOverview; transport: BoardTransport }) {
  const [session] = useState(() => new BoardSession(transport, initialBoard))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const { overview, draft, detail, busy, connected, conflict } = state
  const readOnly = !connected || overview.space.lifecycle !== 'active'

  useEffect(() => {
    const offline = () => session.setConnected(false)
    const online = () => { void session.refresh() }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [session])

  const card = (task: TaskSummary) => (
    <button className="work-card" key={task.id} onClick={() => void session.openTask({ kind: 'id', taskId: task.id })}>
      <span className="work-key">{task.key}{task.parentTaskId ? ' · Subtask' : ''}</span>
      <strong>{task.title}</strong>
      <span>{task.assignee?.displayName ?? 'Unassigned'}</span>
      {task.tags.length > 0 && <span className="work-tags">{task.tags.map((tag) => <span key={tag.id}>{tag.name}</span>)}</span>}
    </button>
  )

  return <div className="board-workspace">
    <div className="work-toolbar">
      <button className="primary-button" disabled={readOnly || busy} onClick={() => session.beginCapture()}>New Task</button>
      <button className="quiet-button" disabled={busy} onClick={() => void session.openArchive()}>Task Archive</button>
      <button className="quiet-button" disabled={busy} onClick={() => void session.refresh()}>{connected ? 'Refresh Board' : 'Reconnect'}</button>
    </div>
    {state.pagesStale && <p role="status">The loaded pages changed. Refresh the Board to continue.</p>}
    {!connected && <p role="status">Connection lost. The Board is readable; editing is paused.</p>}
    {state.error && <p role="alert" className="team-error">{state.error}</p>}
    <div className="column-grid" aria-label={`${overview.space.displayName} Board`}>
      {overview.columns.map((column) => <section className={`flow-column flow-${column.flowRole}`} key={column.id} aria-labelledby={`column-${column.id}`}>
        <header><div><p className="flow-role">{column.flowRole}</p><h2 id={`column-${column.id}`}>{column.name}</h2><p className="work-key">{column.counts.tasks} Tasks · {column.counts.subtasks} Subtasks</p></div>
          {column.wipLimit !== null && <span className="wip-limit">WIP limit {column.wipLimit}</span>}
        </header>
        <div className="work-cards">{column.tasks.items.length ? column.tasks.items.map(card) : <div className="empty-column">No Tasks yet</div>}</div>
        {column.tasks.next && <button className="quiet-button" disabled={busy || state.pagesStale} onClick={() => void session.loadMore(column.id)}>Load more in {column.name}</button>}
      </section>)}
    </div>
    {state.archive && !detail && !draft && <TaskDialog title="Task Archive" onClose={() => session.closeArchive()}>
      {state.archive.items.length ? state.archive.items.map(card) : <p>No archived Tasks.</p>}
      {state.archive.next && <button className="quiet-button" disabled={busy || state.pagesStale} onClick={() => void session.openArchive(true)}>Load more archived Tasks</button>}
    </TaskDialog>}
    {detail && !draft && <TaskDialog title={`${detail.key} · ${detail.title}`} onClose={() => session.closeDetail()}>
      {detail.archived && <p className="lifecycle-badge">Archived Task</p>}
      <PlainText text={detail.description} />
      <p>Assignee: {detail.assignee?.displayName ?? 'Unassigned'}</p>
      <div className="work-tags">{detail.tags.map((tag) => <span key={tag.id}>{tag.name}</span>)}</div>
      {detail.parentTaskId && <button className="quiet-button" onClick={() => void session.openTask({ kind: 'id', taskId: detail.parentTaskId! })}>Open parent Task</button>}
      <div className="work-toolbar">
        {!detail.archived && <button className="primary-button" disabled={readOnly || busy} onClick={() => session.beginEdit()}>Edit Task</button>}
        {!detail.parentTaskId && !detail.archived && <button className="quiet-button" disabled={readOnly || busy} onClick={() => session.beginCapture(detail.id)}>Add Subtask</button>}
        <button className="quiet-button" disabled={readOnly || busy} onClick={() => void session.archiveTask(detail.archived)}>{detail.archived ? 'Restore Task' : 'Archive Task'}</button>
      </div>
      {detail.subtasks.items.length > 0 && <section aria-label="Subtasks"><h3>Subtasks</h3>{detail.subtasks.items.map(card)}</section>}
      {detail.subtasks.next && <button className="quiet-button" disabled={busy || state.pagesStale} onClick={() => void session.loadMoreSubtasks()}>Load more Subtasks</button>}
    </TaskDialog>}
    {draft && <TaskDialog title={draft.taskId ? 'Edit Task' : draft.parentTaskId ? 'New Subtask' : 'New Task'} onClose={() => session.cancelDraft()}>
      <div className={conflict ? 'task-comparison' : undefined}>
        <form className="task-editor" onSubmit={(event: FormEvent) => { event.preventDefault(); void session.saveDraft() }}>
          {conflict && <h3>Your draft</h3>}
          <fieldset disabled={readOnly || busy}>
            <label><span>Title</span><input name="title" value={draft.title} required onChange={(event) => session.updateDraft({ title: event.target.value })} /></label>
            <label><span>Description</span><textarea name="description" rows={7} value={draft.description} onChange={(event) => session.updateDraft({ description: event.target.value })} /></label>
            <label><span>Assignee</span><select value={draft.assigneeId ?? ''} onChange={(event) => session.updateDraft({ assigneeId: event.target.value as MemberId || null })}>
              <option value="">Unassigned</option>
              {overview.members.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}
            </select></label>
            <TagEditor tags={draft.tags} suggestions={state.tagSuggestions.map((tag) => tag.name)} onSearch={session.suggestTags}
              onChange={(tags) => session.updateDraft({ tags })} />
          </fieldset>
          <p className="input-help">Title up to 200 characters. Description up to 20,000. Up to 20 Tags, each up to 40 characters.</p>
          {state.error && <p role="alert">{state.error}</p>}
          <div className="work-toolbar">
            <button type="submit" className="primary-button" disabled={readOnly || busy || Boolean(conflict)}>{draft.taskId ? 'Save changes' : 'Create Task'}</button>
            <button type="button" className="quiet-button" onClick={() => session.cancelDraft()} disabled={busy}>Cancel</button>
          </div>
        </form>
        {conflict && <section className="current-task" aria-label="Current version">
          <h3>Current version</h3><h4>{conflict.title}</h4><PlainText text={conflict.description} />
          <p>Assignee: {conflict.assignee?.displayName ?? 'Unassigned'}</p>
          <p>Tags: {conflict.tags.map((tag) => tag.name).join(', ') || 'None'}</p>
          <button className="quiet-button" onClick={(event) => {
            const title = event.currentTarget.closest('.task-dialog')?.querySelector<HTMLInputElement>('[name="title"]')
            session.useCurrentRevision(); title?.focus()
          }}>Keep my draft and edit from this version</button>
        </section>}
      </div>
    </TaskDialog>}
  </div>
}

function TagEditor({ tags, suggestions, onChange, onSearch }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void; onSearch: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const add = () => {
    if (!text.trim()) return
    if (!tags.some((tag) => tag.toLowerCase() === text.trim().toLowerCase())) onChange([...tags, text.trim()])
    setText('')
  }
  return <div>
    <label><span>Add Tag</span><input list="task-tag-suggestions" value={text} onFocus={() => void onSearch(text)} onChange={(event) => { setText(event.target.value); void onSearch(event.target.value) }} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); add() }
    }} /></label>
    <datalist id="task-tag-suggestions">{suggestions.map((name) => <option key={name} value={name} />)}</datalist>
    <button type="button" className="quiet-button" onClick={add}>Add Tag</button>
    <div className="work-tags">{tags.map((tag) => <button type="button" key={tag} aria-label={`Remove Tag ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}>{tag} ×</button>)}</div>
  </div>
}

function TaskDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = element.current!
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'))
      .filter((element) => !element.closest('fieldset:disabled'))
    const initial = dialog.querySelector<HTMLElement>('[name="title"]') ?? focusable()[0]
    initial?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key === 'Tab') {
        const targets = focusable()
        const first = targets[0], last = targets.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    dialog.addEventListener('keydown', keydown)
    return () => { dialog.removeEventListener('keydown', keydown); previous?.focus() }
  }, [])
  return <div className="task-overlay"><div ref={element} role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" className="task-dialog">
    <header><h2 id="task-dialog-title">{title}</h2><button className="quiet-button" aria-label="Close Task dialog" onClick={onClose}>Close</button></header>
    {children}
  </div></div>
}

function PlainText({ text }: { text: string }) {
  return <p className="task-description">{text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : part)}</p>
}
