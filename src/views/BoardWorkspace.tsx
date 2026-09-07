import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BoardOverview, TaskSummary } from '../../api/contracts/board.ts'
import type { MemberId } from '../../api/modules/shared.ts'
import { BoardSession, type BoardTransport } from '../board-session/board-session.ts'
import './BoardWorkspace.css'

export function BoardWorkspace({ initialBoard, transport }: { initialBoard: BoardOverview; transport: BoardTransport }) {
  const [session] = useState(() => new BoardSession(transport, initialBoard))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const { overview, draft, detail, busy, connected, conflict, savingEdits } = state
  const readOnly = !connected || overview.space.lifecycle !== 'active'
  const dirty = session.hasUnsavedEdits()

  useEffect(() => {
    const offline = () => session.setConnected(false)
    const online = () => { void session.refresh() }
    const leaving = (event: BeforeUnloadEvent) => {
      if (session.hasUnsavedEdits() || session.getSnapshot().draft && !session.getSnapshot().draft?.taskId) event.preventDefault()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    window.addEventListener('beforeunload', leaving)
    return () => {
      window.removeEventListener('offline', offline); window.removeEventListener('online', online)
      window.removeEventListener('beforeunload', leaving)
    }
  }, [session])

  useEffect(() => {
    if (!draft?.taskId || !dirty || readOnly || busy || conflict || state.error) return
    const timer = window.setTimeout(() => { void session.saveEdits() }, 700)
    return () => window.clearTimeout(timer)
  }, [session, draft, dirty, readOnly, busy, conflict, state.error])

  const card = (task: TaskSummary) => <TaskCard key={task.id} task={task} onOpen={() => void session.openEditor({ kind: 'id', taskId: task.id })} />
  const reconnect = async () => { await session.refresh(); if (!session.getSnapshot().draft) session.beginEdit() }
  const tagEditor = draft && <TagEditor tags={draft.tags} suggestions={state.tagSuggestions.map((tag) => tag.name)}
    onSearch={session.suggestTags} onChange={(tags) => session.updateDraft({ tags })} />
  const assignee = draft && <label className="task-property"><span>Assignee</span><select value={draft.assigneeId ?? ''} onChange={(event) => session.updateDraft({ assigneeId: event.target.value as MemberId || null })}>
    <option value="">Unassigned</option>
    {draft.assigneeId && !overview.members.some((member) => member.id === draft.assigneeId) && <option value={draft.assigneeId}>{detail?.assignee?.displayName ?? 'Former member'}</option>}
    {overview.members.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}
  </select></label>

  return <div className="board-workspace">
    <div className="work-toolbar">
      <button className="primary-button" disabled={readOnly || busy} onClick={() => session.beginCapture()}>New Task</button>
      <button className="quiet-button" disabled={busy} onClick={() => void session.openArchive()}>Task Archive</button>
      <button className="quiet-button" disabled={busy} onClick={() => void reconnect()}>{connected ? 'Refresh Board' : 'Reconnect'}</button>
    </div>
    {state.pagesStale && <p role="status">The loaded pages changed. Refresh the Board to continue.</p>}
    {!connected && !detail && !draft && <p role="status">Connection lost. The Board is readable; editing is paused.</p>}
    {state.error && !detail && !draft && <p role="alert" className="team-error">{state.error}</p>}
    <div className="column-grid" aria-label={`${overview.space.displayName} Board`}>
      {overview.columns.map((column) => <section className={`flow-column flow-${column.flowRole}`} key={column.id} aria-labelledby={`column-${column.id}`}>
        <header><h2 id={`column-${column.id}`}><span className="column-dot" aria-label={column.flowRole} />{column.name}<span className="column-count" title={`${column.counts.parentTasks} parent Tasks, ${column.counts.subtasks} Subtasks`}>{column.counts.tasks}</span></h2>
          {column.wipLimit !== null && <span className="wip-limit">Limit {column.wipLimit}</span>}
        </header>
        <div className="work-cards">{column.tasks.items.map(card)}
          {column.intake ? <QuickCapture label="Add a Task" disabled={readOnly || busy} onCapture={(title) => session.quickCapture(title)} />
            : !column.tasks.items.length && <p className="empty-column">No Tasks yet</p>}
        </div>
        {column.tasks.next && <button className="quiet-button" disabled={busy || state.pagesStale} onClick={() => void session.loadMore(column.id)}>Load more in {column.name}</button>}
      </section>)}
    </div>
    {state.archive && !detail && !draft && <TaskDialog title="Task Archive" onClose={() => session.closeArchive()}>
      {state.archive.items.length ? <div className="work-cards">{state.archive.items.map(card)}</div> : <p>No archived Tasks.</p>}
      {state.archive.next && <button className="quiet-button" disabled={busy || state.pagesStale} onClick={() => void session.openArchive(true)}>Load more archived Tasks</button>}
    </TaskDialog>}
    {detail && (!draft || draft.taskId) && <TaskDialog key={detail.id} title={detail.key} onClose={() => void session.closeEditor()} actions={
      <details className="task-overflow"><summary aria-label="More Task actions">•••</summary><div>
        <button disabled={readOnly || busy || Boolean(conflict)} onClick={() => void session.archiveTask(detail.archived)}>{detail.archived ? 'Restore Task' : 'Archive Task'}</button>
      </div></details>
    }>
      {detail.parentTaskId && <button className="task-breadcrumb" disabled={busy} onClick={() => void session.openEditor({ kind: 'id', taskId: detail.parentTaskId! })}>← Parent Task</button>}
      {detail.archived && <p className="lifecycle-badge">Archived Task</p>}
      <div className={conflict ? 'task-comparison' : undefined}>
        <div>
          {draft ? <fieldset className="inline-task-editor" disabled={readOnly || (busy && !savingEdits)}>
            <input className="task-title-input" name="title" aria-label="Title" value={draft.title} onChange={(event) => session.updateDraft({ title: event.target.value })} />
            <div className="task-properties">{assignee}<div className="task-property"><span>Column</span><span>{overview.columns.find((column) => column.id === detail.columnId)?.name}</span></div>{tagEditor}</div>
            <label className="task-description-label"><span>Description</span><textarea name="description" rows={5} placeholder="Add a description…" value={draft.description} onChange={(event) => session.updateDraft({ description: event.target.value })} /></label>
            <DescriptionLinks text={draft.description} />
          </fieldset> : <><h2 className="task-read-title">{detail.title}</h2><PlainText text={detail.description} /><p>Assignee: {detail.assignee?.displayName ?? 'Unassigned'}</p><Tags tags={detail.tags.map((tag) => tag.name)} /></>}
          <div className="task-save-status" role="status">{savingEdits ? 'Saving…' : dirty ? 'Unsaved changes' : draft ? 'All changes saved' : 'Read-only'}
            {dirty && !busy && !conflict && <button className="text-button" disabled={readOnly} onClick={() => void session.saveEdits()}>{state.error ? 'Retry save' : 'Save now'}</button>}
          </div>
          {state.error && <p role="alert" className="team-error">{state.error}</p>}
          {!connected && <button className="quiet-button" disabled={busy} onClick={() => void reconnect()}>Reconnect</button>}
          {dirty && <button className="text-button discard-draft" disabled={busy} onClick={() => session.closeDetail()}>Discard unsaved changes</button>}
        </div>
        {conflict && <section className="current-task" aria-label="Current version">
          <h3>Current version</h3><h4>{conflict.title}</h4><PlainText text={conflict.description} />
          <p>Assignee: {conflict.assignee?.displayName ?? 'Unassigned'}</p><Tags tags={conflict.tags.map((tag) => tag.name)} />
          <button className="quiet-button" onClick={() => session.useCurrentRevision()}>Keep my draft and edit from this version</button>
          <button className="text-button" onClick={() => session.beginEdit()}>Use current version</button>
        </section>}
      </div>
      {!detail.parentTaskId && <section className="task-subtasks" aria-label="Subtasks"><h3>Subtasks</h3>
        {detail.subtasks.items.map((task) => <button className="subtask-row" key={task.id} disabled={busy} onClick={() => void session.openEditor({ kind: 'id', taskId: task.id })}>
          <span aria-hidden="true">↳</span><strong>{task.title}</strong><span className="work-key">{task.key}</span><AssigneeAvatar task={task} /><span aria-hidden="true">↗</span>
        </button>)}
        {detail.subtasks.next && <button className="quiet-button" disabled={busy || dirty || state.pagesStale} onClick={() => void session.loadMoreSubtasks()}>Load more Subtasks</button>}
        {!detail.archived && <QuickCapture key={detail.id} label="Add a Subtask" disabled={readOnly || busy || Boolean(conflict)} onCapture={(title) => session.quickCapture(title, detail.id)} />}
      </section>}
    </TaskDialog>}
    {draft && !draft.taskId && <TaskDialog title={draft.parentTaskId ? 'New Subtask' : 'New Task'} onClose={() => { if (!busy) session.cancelDraft() }}>
      <form className="task-editor" onSubmit={(event) => { event.preventDefault(); void session.saveDraft().then((saved) => { if (saved) session.beginEdit() }) }}>
        <fieldset disabled={readOnly || busy}>
          <label><span>Title</span><input name="title" value={draft.title} required onChange={(event) => session.updateDraft({ title: event.target.value })} /></label>
          <label><span>Description</span><textarea name="description" rows={5} value={draft.description} onChange={(event) => session.updateDraft({ description: event.target.value })} /></label>
          {assignee}{tagEditor}
        </fieldset>
        {state.error && <p role="alert" className="team-error">{state.error}</p>}
        {!connected && <button type="button" className="quiet-button" onClick={() => void reconnect()}>Reconnect</button>}
        <div className="work-toolbar"><button type="submit" className="primary-button" disabled={readOnly || busy}>Create Task</button>
          <button type="button" className="quiet-button" onClick={() => session.cancelDraft()} disabled={busy}>Cancel</button></div>
      </form>
    </TaskDialog>}
  </div>
}

function AssigneeAvatar({ task }: { task: TaskSummary }) {
  const name = task.assignee?.displayName ?? 'Unassigned'
  return <span className="assignee-avatar" title={name} aria-label={`Assignee: ${name}`}>{task.assignee ? name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('') : '–'}</span>
}

function TaskCard({ task, onOpen }: { task: TaskSummary; onOpen: () => void }) {
  return <button className="work-card" onClick={onOpen}>
    <span className="work-card-top"><span className="work-key">{task.key}{task.parentTaskId ? ' · Subtask' : ''}</span><AssigneeAvatar task={task} /></span>
    <strong>{task.title}</strong><Tags tags={task.tags.map((tag) => tag.name)} />
  </button>
}

function Tags({ tags }: { tags: string[] }) {
  return tags.length > 0 && <span className="work-tags">{tags.map((tag) => <span key={tag}><span className="tag-dot" aria-hidden="true" />{tag}</span>)}</span>
}

function QuickCapture({ label, disabled, onCapture }: { label: string; disabled: boolean; onCapture: (title: string) => Promise<boolean> }) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return <form className="quick-capture" onSubmit={(event) => {
    event.preventDefault()
    if (saving || disabled || !title.trim()) return
    setSaving(true)
    void onCapture(title.trim()).then((saved) => { if (saved) setTitle('') }).finally(() => { setSaving(false); input.current?.focus() })
  }}><input ref={input} aria-label={label} placeholder={`+ ${label}…`} value={title} readOnly={disabled || saving} onChange={(event) => setTitle(event.target.value)} />
    {title && <button type="submit" aria-label={label} disabled={disabled || saving}>{saving ? '…' : '↵'}</button>}</form>
}

function TagEditor({ tags, suggestions, onChange, onSearch }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void; onSearch: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const listId = useId()
  const add = () => {
    if (!text.trim()) return
    if (!tags.some((tag) => tag.toLowerCase() === text.trim().toLowerCase())) onChange([...tags, text.trim()])
    setText('')
  }
  return <div className="task-property"><span>Tags</span><div className="tag-editor">
    <div className="work-tags">{tags.map((tag) => <button type="button" key={tag} aria-label={`Remove Tag ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}><span className="tag-dot" aria-hidden="true" />{tag} ×</button>)}</div>
    <div className="tag-entry"><input aria-label="Add Tag" placeholder="+ Add Tag" list={listId} value={text} onFocus={() => void onSearch(text)} onChange={(event) => { setText(event.target.value); void onSearch(event.target.value) }} onBlur={add} onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); add() }
    }} />{text && <button type="button" className="text-button" onClick={add} aria-label="Add Tag">↵</button>}</div>
    <datalist id={listId}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist>
  </div></div>
}

function TaskDialog({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const titleId = useId()
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = element.current!
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary'))
      .filter((element) => !element.closest('fieldset:disabled') && !element.closest('details:not([open]) > div'))
    const initial = dialog.querySelector<HTMLElement>('[name="title"]:not(:disabled)') ?? focusable()[0]
    initial?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
      if (event.key === 'Tab') {
        const targets = focusable(), first = targets[0], last = targets.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const focusin = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      dialog.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin)
      document.body.style.overflow = previousOverflow; previous?.focus()
    }
  }, [])
  return <div className="task-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={element} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="task-dialog">
    <header><h2 id={titleId}>{title}</h2><div className="task-dialog-actions">{actions}<button className="text-button" aria-label="Close Task dialog" onClick={onClose}>×</button></div></header>
    {children}
  </div></div>
}

function DescriptionLinks({ text }: { text: string }) {
  const links = [...new Set(text.match(/https?:\/\/[^\s<>]+/g) ?? [])]
  return links.length > 0 && <div className="description-links" aria-label="Description links">{links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer noopener">↗ {link}</a>)}</div>
}

function PlainText({ text }: { text: string }) {
  return <p className="task-description">{text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : part)}</p>
}
