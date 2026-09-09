import { useEffect, useRef, useState } from 'react'
import type { Outcome, TaskHistoryEntry } from '../../api/contracts/board.ts'
import type { BoardSession, BoardSessionState } from '../board-session/board-session.ts'
import { Tabs } from '../ui/Tabs.tsx'
import { Button } from '../ui/Button.tsx'
import { CommentPanel } from './CommentPanel.tsx'
import { PlainText } from './PlainText.tsx'

export function TaskActivity({ session, state, disabled }: { session: BoardSession; state: BoardSessionState; disabled: boolean }) {
  const [tab, setTab] = useState('Comments')
  const history = state.detail!.history
  const pendingHistory = useRef(false)
  useEffect(() => {
    if (tab !== 'History' || !pendingHistory.current || state.busy) return
    pendingHistory.current = false
    if (!history) void session.loadHistory()
  }, [tab, history, state.busy, session])
  return <section className="task-activity" aria-label="Activity">
    <Tabs label="Task activity" options={['Comments', 'History']} value={tab} onChange={(value) => {
      pendingHistory.current = value === 'History'
      setTab(value)
    }}>
      {tab === 'Comments' ? <CommentPanel session={session} state={state} disabled={disabled} />
        : <div className="task-history">
          {!history ? <Button disabled={state.busy} onClick={() => void session.loadHistory()}>{state.busy ? 'Loading history…' : 'Load history'}</Button>
            : <><ol>{history.items.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}</ol>
              {!history.items.length && <p className="activity-empty">No activity yet.</p>}
              {history.next && <Button disabled={state.busy || state.pagesStale} onClick={() => void session.loadHistory(true)}>Load more history</Button>}</>}
        </div>}
    </Tabs>
  </section>
}

function outcomeName(kind: Outcome['kind']) { return kind[0].toUpperCase() + kind.slice(1) }

function HistoryEntry({ entry }: { entry: TaskHistoryEntry }) {
  return <li><p><strong>{entry.actor.displayName}</strong> {entry.summary}
    {entry.fromColumn && entry.toColumn && <> from {entry.fromColumn.name} to {entry.toColumn.name}</>}
    {entry.outcome && <>: {outcomeName(entry.outcome.kind)}</>}
    {entry.previousOutcome && <> · Previously {outcomeName(entry.previousOutcome.kind)}</>}
  </p><time dateTime={entry.occurredAt} title={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
    {entry.comment && <PlainText text={entry.comment} />}</li>
}
