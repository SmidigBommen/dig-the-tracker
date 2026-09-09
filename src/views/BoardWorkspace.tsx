import { WorkflowEditor } from './WorkflowEditor.tsx'
import { Button } from '../ui/Button.tsx'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import type { BoardOverview, BoardWarning, Outcome, TaskSummary } from '../../api/contracts/board.ts'
import type { ColumnId, MemberId } from '../../api/modules/shared.ts'
import { BoardSession, type BoardTransport } from '../board-session/board-session.ts'
import { InboxPanel } from './InboxPanel.tsx'
import { PlainText } from './PlainText.tsx'
import { Dialog as TaskDialog } from '../ui/Dialog.tsx'
import { AutoTextarea } from '../ui/AutoTextarea.tsx'
import { TaskActions } from './TaskActions.tsx'
import { TaskActivity } from './TaskActivity.tsx'
import '../ui/design-system.css'
import './BoardWorkspace.css'

export function BoardWorkspace({ initialBoard, transport }: { initialBoard: BoardOverview; transport: BoardTransport }) {
  const [session] = useState(() => new BoardSession(transport, initialBoard))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const { overview, draft, detail, busy, connected, conflict, savingEdits } = state
  const readOnly = !connected || overview.space.lifecycle !== 'active' || Boolean(state.pendingAction)
  const dirty = session.hasUnsavedEdits()
  const dragged = useRef<TaskSummary | null>(null)
  const [hoveredColumn, setHoveredColumn] = useState<ColumnId | null>(null)
  const canDrag = !readOnly && !busy && !detail && !draft && !state.archive && !state.inbox && !state.workflow

  useEffect(() => {
    session.startLive()
    const offline = () => session.setConnected(false)
    const online = () => { void session.reconnect() }
    const leaving = (event: BeforeUnloadEvent) => {
      if (session.hasUnsavedComments() || session.hasUnsavedEdits() || session.getSnapshot().draft && !session.getSnapshot().draft?.taskId) event.preventDefault()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    window.addEventListener('beforeunload', leaving)
    return () => {
      session.stopLive()
      window.removeEventListener('offline', offline); window.removeEventListener('online', online)
      window.removeEventListener('beforeunload', leaving)
    }
  }, [session])

  useEffect(() => {
    if (!draft?.taskId || !dirty || readOnly || busy || conflict || state.error) return
    const timer = window.setTimeout(() => { void session.saveEdits() }, 700)
    return () => window.clearTimeout(timer)
  }, [session, draft, dirty, readOnly, busy, conflict, state.error])

  const drop = (event: DragEvent, columnId: ColumnId, anchor?: TaskSummary) => {
    setHoveredColumn(null)
    if (!canDrag || !dragged.current) return
    event.preventDefault(); event.stopPropagation()
    const task = dragged.current
    dragged.current = null
    if (task.id === anchor?.id) return
    const column = overview.columns.find((column) => column.id === columnId)!
    void session.moveTask(task, { columnId, expectedOrderRevision: column.orderRevision,
      place: anchor ? { kind: event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2 ? 'after' : 'before', taskId: anchor.id } : { kind: 'last' } })
  }
  const card = (task: TaskSummary) => <TaskCard key={task.id} task={task}
    draggable={canDrag && !task.archived} onDragStart={(event) => {
      if (!canDrag) { event.preventDefault(); return }
      dragged.current = task
      setHoveredColumn(null)
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id) }
    }} onDragEnd={() => { dragged.current = null; setHoveredColumn(null) }} onDrop={(event) => drop(event, task.columnId, task)}
    onOpen={() => void session.openEditor({ kind: 'id', taskId: task.id })} />
  const reconnect = async () => {
    if (!connected) await session.reconnect()
    else await session.refresh()
    if (!session.getSnapshot().draft) session.beginEdit()
  }
  const tagEditor = draft && <TagEditor tags={draft.tags} suggestions={state.tagSuggestions.map((tag) => tag.name)}
    onSearch={session.suggestTags} onChange={(tags) => session.updateDraft({ tags })} />
  const assignee = draft && <label className="task-property"><span>Assignee</span><select value={draft.assigneeId ?? ''} onChange={(event) => session.updateDraft({ assigneeId: event.target.value as MemberId || null })}>
    <option value="">Unassigned</option>
    {draft.assigneeId && !overview.members.some((member) => member.id === draft.assigneeId) && <option value={draft.assigneeId}>{detail?.assignee?.displayName ?? 'Former member'}</option>}
    {overview.members.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}
  </select></label>

  return <div className="board-workspace">
    <div className="work-toolbar">
      <Button variant="primary" disabled={readOnly || busy} onClick={() => session.beginCapture()}>New Task</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void session.openInbox()}>Inbox {overview.unreadNotifications > 0 ? `(${overview.unreadNotifications})` : ''}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void session.openArchive()}>Task Archive</Button>
      {overview.members.find((member) => member.id === overview.currentMemberId)?.role === 'space-administrator' &&
        <Button variant="secondary" disabled={busy || readOnly} onClick={() => void session.openWorkflow()}>Workflow settings</Button>}
      <Button variant="secondary" disabled={busy} onClick={() => void reconnect()}>{connected ? 'Refresh Board' : 'Reconnect'}</Button>
    </div>
    {!detail && <Warnings warnings={state.warnings} overview={overview} />}
    {!detail && state.pendingAction && <Button variant="secondary" disabled={!connected || busy} onClick={() => void session.retryPendingChange()}>Retry pending change</Button>}
    {state.pagesStale && <p role="status">The loaded pages changed. Refresh the Board to continue.</p>}
    {!connected && !detail && !draft && <p role="status">Connection lost. The Board is readable; editing is paused.</p>}
    {state.error && !detail && !draft && <p role="alert" className="team-error">{state.error}</p>}
    <div className="column-grid" aria-label={`${overview.space.displayName} Board`}>
      {overview.columns.map((column) => <section className={`flow-column flow-${column.flowRole}${canDrag && hoveredColumn === column.id ? ' drop-target' : ''}`} key={column.id}
        onDragOver={(event) => {
          if (!canDrag || !dragged.current) return
          event.preventDefault()
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
          setHoveredColumn(column.id)
        }} onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setHoveredColumn((current) => current === column.id ? null : current)
        }} onDrop={(event) => drop(event, column.id)} aria-labelledby={`column-${column.id}`}>
        <header><h2 id={`column-${column.id}`}><span className="column-dot" aria-label={column.flowRole} />{column.name}<span className="column-count" title={`${column.counts.parentTasks} parent Tasks, ${column.counts.subtasks} Subtasks`}>{column.counts.tasks}</span></h2>
          {column.wipLimit !== null && <span className={`wip-limit${column.counts.tasks > column.wipLimit ? ' exceeded' : ''}`}>Limit {column.wipLimit}</span>}
        </header>
        <div className="work-cards">{column.tasks.items.map(card)}
          {column.intake ? <QuickCapture label="Add a Task" disabled={readOnly || busy} onCapture={(title) => session.quickCapture(title)} />
            : !column.tasks.items.length && <p className="empty-column">No Tasks yet</p>}
        </div>
        {column.tasks.next && <Button variant="secondary" disabled={busy || state.pagesStale} onClick={() => void session.loadMore(column.id)}>Load more in {column.name}</Button>}
      </section>)}
    </div>
    {state.workflow && !detail && !draft && <WorkflowEditor key={state.workflowLoad} session={session} state={state} />}
    {state.inbox && !detail && !draft && <TaskDialog title="Inbox" onClose={() => session.closeInbox()}><InboxPanel session={session} state={state} readOnly={readOnly} /></TaskDialog>}
    {state.archive && !state.inbox && !detail && !draft && <TaskDialog title="Task Archive" onClose={() => session.closeArchive()}>
      {state.archive.items.length ? <div className="work-cards">{state.archive.items.map(card)}</div> : <p>No archived Tasks.</p>}
      {state.archive.next && <Button variant="secondary" disabled={busy || state.pagesStale} onClick={() => void session.openArchive(true)}>Load more archived Tasks</Button>}
    </TaskDialog>}
    {detail && (!draft || draft.taskId) && <TaskDialog key={detail.id} title={detail.key} onClose={() => void session.closeEditor()} actions={
      <TaskActions key={detail.id} session={session} state={state} disabled={readOnly || busy || Boolean(conflict)} />
    }>
      {detail.parentTaskId && <button className="task-breadcrumb" disabled={busy} onClick={() => void session.openEditor({ kind: 'id', taskId: detail.parentTaskId! })}>← Parent Task</button>}
      <Warnings warnings={state.warnings} overview={overview} />
      {state.pendingAction && <Button variant="secondary" disabled={!connected || busy} onClick={() => void session.retryPendingChange()}>Retry pending change</Button>}
      {detail.outcome && <p className="lifecycle-badge">Outcome: {outcomeName(detail.outcome.kind)}</p>}
      {detail.outcome?.kind === 'duplicate' && <Button variant="ghost" disabled={busy}
        onClick={() => { if (detail.outcome?.kind === 'duplicate') void session.openEditor({ kind: 'id', taskId: detail.outcome.taskId }) }}>Open Duplicate target</Button>}
      {detail.archived && <p className="lifecycle-badge">Archived Task</p>}
      <div className={conflict ? 'task-comparison' : undefined}>
        <div>
          {draft ? <fieldset className="inline-task-editor" disabled={readOnly || detail.archived || (busy && !savingEdits)}>
            <AutoTextarea className="task-title-input" rows={1} name="title" aria-label="Title" value={draft.title}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }}
              onChange={(event) => session.updateDraft({ title: event.target.value.replace(/\r?\n/g, ' ') })} />
            <div className="task-properties">{assignee}<label className="task-property"><span>Column</span><select value={detail.columnId} disabled={busy || Boolean(conflict)} onChange={(event) => {
              const column = overview.columns.find((column) => column.id === event.target.value)!
              void session.moveTask(detail, { columnId: column.id, expectedOrderRevision: column.orderRevision, place: { kind: 'last' } })
            }}>{overview.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>{tagEditor}</div>
            <label className="task-description-label"><span>Description</span><AutoTextarea name="description" rows={2} placeholder="Add a description…" value={draft.description} onChange={(event) => session.updateDraft({ description: event.target.value })} /></label>
            <DescriptionLinks text={draft.description} />
          </fieldset> : <><h2 className="task-read-title">{detail.title}</h2>
            <div className="task-properties"><div className="task-property"><span>Assignee</span><span>{detail.assignee?.displayName ?? 'Unassigned'}</span></div>
              <div className="task-property"><span>Column</span><span>{overview.columns.find((column) => column.id === detail.columnId)?.name}</span></div>
              <div className="task-property"><span>Tags</span><Tags tags={detail.tags.map((tag) => tag.name)} /></div></div>
            <div className="task-description-label"><span>Description</span></div><PlainText text={detail.description || 'No description.'} /></>}
          <div className="task-save-status" role="status">{savingEdits ? 'Saving…' : dirty ? 'Unsaved changes' : draft ? 'All changes saved' : 'Read-only'}
            {dirty && !busy && !conflict && <Button variant="ghost" disabled={readOnly} onClick={() => void session.saveEdits()}>{state.error ? 'Retry save' : 'Save now'}</Button>}
          </div>
          {state.error && <p role="alert" className="team-error">{state.error}</p>}
          {!connected && <Button variant="secondary" disabled={busy} onClick={() => void reconnect()}>Reconnect</Button>}
          {dirty && <button className="text-button discard-draft" disabled={busy} onClick={() => session.closeDetail()}>Discard unsaved changes</button>}
        </div>
        {conflict && <section className="current-task" aria-label="Current version">
          <h3>Current version</h3><h4>{conflict.title}</h4><PlainText text={conflict.description} />
          <p>Assignee: {conflict.assignee?.displayName ?? 'Unassigned'}</p><Tags tags={conflict.tags.map((tag) => tag.name)} />
          <Button variant="secondary" disabled={readOnly || detail.archived} onClick={() => session.useCurrentRevision()}>Keep my draft and edit from this version</Button>
          <Button variant="ghost" onClick={() => { session.cancelDraft(); session.beginEdit() }}>Use current version</Button>
        </section>}
      </div>
      {!detail.parentTaskId && <section className="task-subtasks" aria-label="Subtasks"><h3>Subtasks</h3>
        {detail.subtasks.items.map((task) => <button className="subtask-row" key={task.id} disabled={busy} onClick={() => void session.openEditor({ kind: 'id', taskId: task.id })}>
          <span aria-hidden="true">↳</span><strong>{task.title}</strong><span className="work-key">{task.key}</span><AssigneeAvatar task={task} /><span aria-hidden="true">↗</span>
        </button>)}
        {detail.subtasks.next && <Button variant="secondary" disabled={busy || dirty || state.pagesStale} onClick={() => void session.loadMoreSubtasks()}>Load more Subtasks</Button>}
        {!detail.archived && <QuickCapture key={detail.id} label="Add a Subtask" disabled={readOnly || busy || Boolean(conflict)} onCapture={(title) => session.quickCapture(title, detail.id)} />}
      </section>}
      <TaskActivity key={detail.id} session={session} state={state} disabled={readOnly || busy || detail.archived} />
    </TaskDialog>}
    {draft && !draft.taskId && <TaskDialog title={draft.parentTaskId ? 'New Subtask' : 'New Task'} focusTitle onClose={() => { if (!busy) session.cancelDraft() }}>
      <form className="task-editor" onSubmit={(event) => { event.preventDefault(); void session.saveDraft().then((saved) => { if (saved) session.beginEdit() }) }}>
        <fieldset disabled={readOnly || busy}>
          <label><span>Title</span><input name="title" value={draft.title} required onChange={(event) => session.updateDraft({ title: event.target.value })} /></label>
          <label><span>Description</span><AutoTextarea name="description" rows={2} value={draft.description} onChange={(event) => session.updateDraft({ description: event.target.value })} /></label>
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

function TaskCard({ task, onOpen, draggable, onDragStart, onDragEnd, onDrop }: { task: TaskSummary; onOpen: () => void;
  draggable: boolean; onDragStart: (event: DragEvent) => void; onDragEnd: () => void; onDrop: (event: DragEvent) => void }) {
  return <button className="work-card" onClick={onOpen} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}>
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

function DescriptionLinks({ text }: { text: string }) {
  const links = [...new Set(text.match(/https?:\/\/[^\s<>]+/g) ?? [])]
  return links.length > 0 && <div className="description-links" aria-label="Description links">{links.map((link) => <a key={link} href={link} target="_blank" rel="noreferrer noopener">↗ {link}</a>)}</div>
}


function outcomeName(kind: Outcome['kind']) { return kind[0].toUpperCase() + kind.slice(1) }

function Warnings({ warnings, overview }: { warnings: BoardWarning[]; overview: BoardOverview }) {
  return warnings.length > 0 && <div className="board-warnings" role="status">{warnings.map((warning) => <p key={warning.kind}>
    {warning.kind === 'open-subtasks' ? `Task closed with ${warning.count} open Subtasks. Their Columns are unchanged.`
      : `${overview.columns.find((column) => column.id === warning.columnId)?.name}: ${warning.actual} Tasks exceed the limit of ${warning.limit}, including ${warning.parentTasks} parent Tasks and ${warning.subtasks} Subtasks. The move was saved.`}
  </p>)}</div>
}
