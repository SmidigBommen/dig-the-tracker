import { useState } from 'react'
import type { WorkflowColumnPlan } from '../../api/contracts/board.ts'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import './WorkflowEditor.css'

type DraftColumn = WorkflowColumnPlan & { key: string; taskCount: number }

export function WorkflowEditor({ session, state }: { session: BoardSession; state: BoardSessionState }) {
  const workflow = state.workflow!
  const [columns, setColumns] = useState<DraftColumn[]>(() => workflow.columns.filter((column) => !column.archived).map((column) => ({ ...column, key: column.id })))
  const administrator = state.overview.members.find((member) => member.id === state.overview.currentMemberId)?.role === 'space-administrator'
  const disabled = state.busy || !state.connected || Boolean(state.pendingAction) || !administrator || state.overview.space.lifecycle !== 'active'
  const stale = workflow.revision !== state.overview.board.workflowRevision
  const valid = columns.filter((column) => column.intake).length === 1 && columns.filter((column) => column.completion).length === 1
    && columns.every((column) => column.name.trim() && (column.flowRole !== 'active' || column.wipLimit !== null && column.wipLimit > 0))
  const archived = workflow.columns.filter((column) => !columns.some((current) => current.id === column.id))
  const patch = (key: string, changes: Partial<DraftColumn>) => setColumns((items) => items.map((column) => column.key === key ? { ...column, ...changes } : column))
  const move = (index: number, direction: number) => setColumns((items) => {
    const next = [...items]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    return next
  })
  return <Dialog title="Workflow" onClose={() => session.closeWorkflow()}>
    <form className="workflow-editor" onSubmit={(event) => {
      event.preventDefault()
      if (disabled || !valid || stale) return
      void session.saveWorkflow(workflow.revision, { columns: columns.map(({ id, name, flowRole, intake, completion, wipLimit }) => ({ id, name, flowRole, intake, completion, wipLimit })) })
    }}>
      <h2>Shape your workflow</h2>
      <p className="workflow-intro">Changes apply together when you save. Empty a Column before changing its role, Intake status, or archiving it.</p>
      <fieldset disabled={disabled}>
        <ol className="workflow-columns">{columns.map((column, index) => <li key={column.key}>
          <div className="workflow-column-heading"><span>Column {index + 1}{column.taskCount > 0 ? ` · ${column.taskCount} Tasks` : ''}</span><div>
            <Button variant="ghost" disabled={index === 0} aria-label={`Move ${column.name || 'Column'} earlier`} onClick={() => move(index, -1)}>↑</Button>
            <Button variant="ghost" disabled={index === columns.length - 1} aria-label={`Move ${column.name || 'Column'} later`} onClick={() => move(index, 1)}>↓</Button>
            <Button variant="ghost" disabled={column.taskCount > 0} onClick={() => setColumns((items) => items.filter((item) => item.key !== column.key))} aria-label={`Archive ${column.name || 'Column'}`}>Archive</Button>
          </div></div>
          <div className="workflow-column-fields">
            <label>Name<input aria-label={`Column name ${index + 1}`} required value={column.name} onChange={(event) => patch(column.key, { name: event.target.value })} /></label>
            <label>Flow role<select aria-label={`Flow role ${index + 1}`} value={column.flowRole} disabled={column.taskCount > 0} onChange={(event) => {
              const flowRole = event.target.value as WorkflowColumnPlan['flowRole']
              patch(column.key, { flowRole, completion: flowRole === 'complete', intake: flowRole === 'queue' && column.intake, wipLimit: flowRole === 'active' ? 3 : null })
            }}><option value="queue">Queue</option><option value="active">Active</option><option value="complete">Complete</option></select></label>
            <label>WIP limit<input aria-label={`WIP limit ${index + 1}`} type="number" min={1} max={2147483647} required={column.flowRole === 'active'} disabled={column.flowRole !== 'active'}
              value={column.wipLimit ?? ''} placeholder="—" onChange={(event) => patch(column.key, { wipLimit: event.target.value ? Number(event.target.value) : null })} /></label>
            <label className="workflow-intake"><input type="checkbox" aria-label={`Intake ${index + 1}`} checked={column.intake} disabled={column.flowRole !== 'queue' || column.taskCount > 0}
              onChange={(event) => patch(column.key, { intake: event.target.checked })} />Intake</label>
          </div>
        </li>)}</ol>
        <Button variant="secondary" disabled={columns.length >= 200} onClick={() => setColumns((items) => [...items, {
          key: crypto.randomUUID(), name: '', flowRole: 'active', intake: false, completion: false, wipLimit: 3, taskCount: 0,
        }])}>Add Column</Button>
        {archived.length > 0 && <details className="workflow-archive"><summary>Archived Columns ({archived.length})</summary>
          <ul>{archived.map((column) => <li key={column.id}><div><strong>{column.name}</strong><span>{column.flowRole}{column.wipLimit ? ` · WIP limit ${column.wipLimit}` : ''}{!column.archived ? ' · Archive on save' : ''}</span></div>
            <Button onClick={() => setColumns((items) => [...items, { ...column, key: column.id }])} aria-label={`Restore Column ${column.name}`}>Restore</Button>
          </li>)}</ul></details>}
      </fieldset>
      {!valid && <p className="workflow-help" role="status">Choose exactly one Queue Column as Intake and one Complete Column. Name every Column and set a positive limit for each Active Column.</p>}
      {stale && <p className="workflow-help" role="status">The workflow changed while you were editing. Reload the current workflow to continue.</p>}
      {state.error && <p className="team-error" role="alert">{state.error}</p>}
      <div className="workflow-footer">
        <Button variant="ghost" disabled={state.busy || Boolean(state.pendingAction)} onClick={() => session.closeWorkflow()}>Cancel</Button>
        {(stale || state.error) && <Button disabled={state.busy || Boolean(state.pendingAction)} onClick={() => void session.openWorkflow()}>Reload current workflow</Button>}
        {state.pendingAction ? <Button disabled={!state.connected || state.busy} onClick={() => void session.retryPendingChange()}>Retry pending change</Button>
          : <Button variant="primary" type="submit" disabled={disabled || !valid || stale}>{state.busy ? 'Saving…' : 'Save workflow'}</Button>}
      </div>
    </form>
  </Dialog>
}
