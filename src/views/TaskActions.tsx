import { useEffect, useRef, useState } from 'react'
import type { BoardOverview, Outcome, TaskDestination, TaskSummary } from '../../api/contracts/board.ts'
import type { ColumnId } from '../../api/modules/shared.ts'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'
import { Button } from '../ui/Button.tsx'

type ClosureDraft = { kind: Outcome['kind']; duplicateKey: string; comment: string }

export function TaskActions({ session, state, disabled }: { session: BoardSession; state: BoardSessionState; disabled: boolean }) {
  const task = state.detail!
  const menu = useRef<HTMLDetailsElement>(null)
  const [panel, setPanel] = useState<'move' | 'closure'>()
  const [closureDraft, setClosureDraft] = useState<ClosureDraft>({ kind: task.outcome?.kind ?? 'completed', duplicateKey: '', comment: '' })
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute('open')
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => { if (panel) menu.current?.querySelector('select')?.focus() }, [panel])
  const finish = async (result: Promise<boolean>) => {
    const saved = await result
    if (saved) { menu.current?.removeAttribute('open'); menu.current?.querySelector('summary')?.focus(); setPanel(undefined) }
    return saved
  }
  return <>
    {!task.archived && !task.closedAt && state.overview.columns.some((column) => column.completion) &&
      <Button disabled={disabled} onClick={() => void session.chooseOutcome('completed', '')}>Mark complete</Button>}
    <details className="task-overflow" ref={menu} onKeyDown={(event) => {
      if (event.key === 'Escape' && menu.current?.open) {
        event.preventDefault(); event.stopPropagation(); menu.current.removeAttribute('open'); menu.current.querySelector('summary')?.focus()
      }
    }}><summary aria-label="More Task actions" title="More Task actions">•••</summary><div className="task-actions-popover">
      {!panel || task.archived ? <>
        {!task.archived && <>
          <Button variant="ghost" disabled={disabled} onClick={() => {
            if (!closureDraft.comment && !closureDraft.duplicateKey) setClosureDraft({ ...closureDraft, kind: task.outcome?.kind ?? 'completed' })
            setPanel('closure')
          }}>{task.closedAt ? 'Change Outcome…' : 'Close with outcome…'}</Button>
          <Button variant="ghost" disabled={disabled} onClick={() => setPanel('move')}>Reorder Task…</Button>
        </>}
        <Button variant={task.archived ? 'ghost' : 'danger'} disabled={disabled} onClick={() => void finish(session.archiveTask(task.archived).then(() => session.getSnapshot().detail?.archived !== task.archived))}>{task.archived ? 'Restore Task' : 'Archive Task'}</Button>
      </> : <>
        <div className="task-actions-heading"><strong>{panel === 'move' ? 'Reorder Task' : task.closedAt ? 'Change Outcome' : 'Close Task'}</strong>
          <Button variant="ghost" aria-label="Back to Task actions" onClick={() => setPanel(undefined)}>←</Button></div>
        {panel === 'move' ? <TaskMove task={task} overview={state.overview} disabled={disabled}
          onMove={(destination) => finish(session.moveTask(task, destination))} />
          : <TaskClosure closed={Boolean(task.closedAt)} draft={closureDraft} onDraftChange={setClosureDraft}
            disabled={disabled} onSave={(kind, key, comment) => finish(session.chooseOutcome(kind, key, comment))} />}
      </>}
    </div></details>
  </>
}

function TaskMove({ task, overview, disabled, onMove }: { task: TaskSummary; overview: BoardOverview; disabled: boolean; onMove: (destination: TaskDestination) => Promise<boolean> }) {
  const [columnId, setColumnId] = useState(task.columnId)
  const [position, setPosition] = useState('last')
  const column = overview.columns.find((column) => column.id === columnId)!
  return <form className="task-move" onSubmit={(event) => {
    event.preventDefault()
    const place: TaskDestination['place'] = position === 'first' || position === 'last' ? { kind: position }
      : { kind: 'before', taskId: position as TaskSummary['id'] }
    void onMove({ columnId, expectedOrderRevision: column.orderRevision, place })
  }}><fieldset disabled={disabled}>
    <label>Move to Column<select value={columnId} onChange={(event) => { setColumnId(event.target.value as ColumnId); setPosition('last') }}>
      {overview.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
    </select></label>
    <label>Position<select value={position} onChange={(event) => setPosition(event.target.value)}>
      <option value="first">First</option><option value="last">Last</option>
      {column.tasks.items.filter((item) => item.id !== task.id).map((item) => <option key={item.id} value={item.id}>Before {item.key}: {item.title}</option>)}
    </select></label>
    <button className="dig-button dig-button-primary" type="submit">Move Task</button>
  </fieldset></form>
}

function outcomeName(kind: Outcome['kind']) { return kind[0].toUpperCase() + kind.slice(1) }

function TaskClosure({ closed, draft, onDraftChange, disabled, onSave }: { closed: boolean; draft: ClosureDraft; onDraftChange: (draft: ClosureDraft) => void; disabled: boolean;
  onSave: (kind: Outcome['kind'], duplicateKey: string, comment?: string) => Promise<boolean> }) {
  const { kind, duplicateKey, comment } = draft
  return <form className="task-closure" onSubmit={(event) => { event.preventDefault(); void onSave(kind, duplicateKey, !closed && (kind === 'rejected' || kind === 'cancelled') ? comment : undefined).then((saved) => { if (saved) onDraftChange({ ...draft, duplicateKey: '', comment: '' }) }) }}>
    <fieldset disabled={disabled}>
      <label>{closed ? 'Outcome' : 'Close as'}<select value={kind} onChange={(event) => { onDraftChange({ ...draft, kind: event.target.value as Outcome['kind'] }) }}>
        {(['completed', 'rejected', 'duplicate', 'cancelled'] as const).map((outcome) => <option key={outcome} value={outcome}>{outcomeName(outcome)}</option>)}
      </select></label>
      {kind === 'duplicate' && <label>Duplicate of Task key<input required placeholder="DIG-123" value={duplicateKey} onChange={(event) => onDraftChange({ ...draft, duplicateKey: event.target.value })} /></label>}
      {!closed && (kind === 'rejected' || kind === 'cancelled') && <label>Closing comment<textarea value={comment} onChange={(event) => onDraftChange({ ...draft, comment: event.target.value })} /></label>}
      <button className="dig-button dig-button-primary" type="submit">{closed ? 'Change Outcome' : 'Close Task'}</button>
    </fieldset>
  </form>
}
