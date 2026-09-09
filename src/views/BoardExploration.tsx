import { useState } from 'react'
import type { AgedTask, FlowView, TaskSummary } from '../../api/contracts/board.ts'
import type { BoardSession, BoardSessionState, SearchScope } from '../board-session/board-session.ts'
import { Button } from '../ui/Button.tsx'
import './BoardExploration.css'

function duration(milliseconds: number) {
  if (milliseconds < 60000) return 'Under 1 min'
  if (milliseconds < 3600000) return `${Math.floor(milliseconds/60000)} min`
  if (milliseconds < 86400000) return `${(milliseconds/3600000).toFixed(1)} h`
  return `${(milliseconds/86400000).toFixed(1)} days`
}
function dateLabel(date: string) {
  return new Intl.DateTimeFormat('en',{ month: 'short',day: 'numeric',timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

export function BoardExploration({ session,state }: { session: BoardSession; state: BoardSessionState }) {
  const view = state.exploration!
  const moreDisabled = Boolean(state.explorationLoading || state.pagesStale || !state.connected)
  const tasks = (items: TaskSummary[], ages = false) => <TaskLinks items={items} ages={ages} session={session} state={state} />
  return <section className="board-exploration" aria-busy={state.explorationLoading}>
    {view.kind === 'search' && <SearchPanel key="search" session={session} state={state} />}
    {view.kind === 'flow' && <>
      <div className="exploration-heading"><div><h2>Flow</h2><p>See where work is waiting and how it moves through the team.</p></div></div>
      {view.value && <>
        <p className="report-period">{dateLabel(view.value.startDate)} – {dateLabel(view.value.endDate)} · {view.value.timeZone}</p>
        <div className="flow-summary">
          <article><span>Active work</span><strong>{view.value.columns.filter(column => column.flowRole === 'active' && !column.archived).reduce((sum,column) => sum+column.tasks,0)}</strong><p>Tasks across Active Columns</p></article>
          <article><span>Median Cycle time · 30 days</span><strong>{view.value.medianCycleTimeMilliseconds === null ? 'No data yet' : duration(view.value.medianCycleTimeMilliseconds)}</strong><p>{view.value.cycleTimeSampleSize} Closed Tasks with a recorded start</p></article>
        </div>
        <section className="report-section"><h3>Work in progress</h3><div className="wip-columns">
          {view.value.columns.filter(column => column.flowRole === 'active' && !column.archived).map(column => <article key={column.id}>
            <div><strong>{column.name}</strong><span className={column.tasks > column.limit! ? 'over-limit' : ''}>{column.tasks} / {column.limit}</span></div>
            <meter min={0} max={Math.max(column.limit!,column.tasks,1)} value={column.tasks} aria-label={`${column.name}: ${column.tasks} Tasks, limit ${column.limit}`} />
            {column.tasks > column.limit! && <small className="over-limit">{column.tasks-column.limit!} over the limit</small>}
          </article>)}
          {!view.value.columns.some(column => column.flowRole === 'active' && !column.archived) && <p>No Active Columns in this workflow.</p>}
        </div></section>
        <section className="report-section"><h3>Oldest Active Tasks</h3><p>Age is time in the current Column.</p>
          {tasks(view.value.oldest.items,true)}
          {!view.value.oldest.items.length && <p className="exploration-empty">No Active Tasks. Work will appear here when it enters an Active Column.</p>}
          {view.value.oldest.next && <Button disabled={moreDisabled} onClick={() => void session.loadExplorationMore()}>Load more oldest Tasks</Button>}
        </section>
        <Throughput report={view.value} />
        <WipHistory report={view.value} />
        <details className="report-definitions"><summary>How these numbers are calculated</summary>
          <p>WIP and workload include parent Tasks and Subtasks. Column age restarts when a Task enters a Column. Cycle time runs from its first entry into Active work to its latest closure, including rework after reopening.</p>
          <p>The median covers currently Closed Tasks whose latest closure falls in the last 30 local dates, including Archived Tasks. Tasks closed without entering Active work have no Cycle time.</p>
          <p>Throughput counts closure events in 12 Monday-based weeks. Closing a reopened Task counts again. Each event keeps its Outcome at closure; later Outcome edits do not rewrite it. Only Completed represents delivered work.</p>
          <p>WIP history shows Active Tasks at the end of each Space-local date. Today shows the latest snapshot. Archived Columns retain their historical evidence.</p>
        </details>
      </>}
    </>}
    {view.kind === 'workload' && <>
      <div className="exploration-heading"><div><h2>Workload</h2><p>Currently assigned Active work. Members are listed alphabetically.</p></div></div>
      {view.value && <>
        <p className="report-period">{view.value.unassignedActiveTasks} unassigned Active Tasks</p>
        <div className="workload-members">{view.value.members.map(row => <section key={row.member.id} className="workload-member" aria-label={`${row.member.displayName} workload`}>
          <header><h3>{row.member.displayName}</h3><span>{row.activeTasks} Active Tasks</span></header>
          {tasks(row.tasks.items,true)}
          {!row.activeTasks && <p className="exploration-empty">No assigned Active work.</p>}
          {row.tasks.next && <Button disabled={moreDisabled} onClick={() => void session.loadExplorationMore(row.member.id)}>Load more for {row.member.displayName}</Button>}
        </section>)}</div>
      </>}
    </>}
    {state.explorationLoading && <p className="exploration-loading" role="status">Loading…</p>}
  </section>
}

function SearchPanel({ session,state }: { session: BoardSession; state: BoardSessionState }) {
  const view = state.exploration!
  if (view.kind !== 'search') throw new Error('Search view required')
  const [text,setText] = useState(view.text)
  const [include,setInclude] = useState<SearchScope>(view.include)
  return <>
    <div className="exploration-heading"><div><h2>Search this Space</h2><p>Find Tasks by key, title, description, tags, or assignee.</p></div></div>
    <form className="space-search" role="search" onSubmit={event => { event.preventDefault(); void session.search(text,include) }}>
      <label>Search<input type="search" autoFocus value={text} maxLength={200} placeholder="Task key or words…" onChange={event => setText(event.target.value)} /></label>
      <label>Include<select value={include} onChange={event => setInclude(event.target.value as SearchScope)}>
        <option value="open">Open Tasks</option><option value="closed">Closed Tasks</option><option value="archived">Archived Tasks</option><option value="all">All Tasks</option>
      </select></label>
      <Button variant="primary" type="submit" disabled={!state.connected}>Search</Button>
    </form>
    <p className="search-help">Matches words and word beginnings. Comments are not searched.</p>
    {view.results && <>
      <p className="search-result-count" role="status">{view.results.items.length}{view.results.next ? '+' : ''} results{view.text ? ` for “${view.text}”` : ''}</p>
      <TaskLinks items={view.results.items} session={session} state={state} />
      {!view.results.items.length && <p className="exploration-empty">No matching Tasks. Try another word or include Closed and Archived Tasks.</p>}
      {view.results.next && <Button disabled={state.explorationLoading || state.pagesStale || !state.connected} onClick={() => void session.loadExplorationMore()}>Load more results</Button>}
    </>}
  </>
}

function TaskLinks({ items,ages,session,state }: { items: TaskSummary[]; ages?: boolean; session: BoardSession; state: BoardSessionState }) {
  return <ul className="exploration-tasks">{items.map(task => <li key={task.id}>
    <button type="button" disabled={state.busy} onClick={() => void session.openEditor({ kind: 'id',taskId: task.id })}>
      <span className="exploration-task-key">{task.key}</span><span className="exploration-task-body"><strong>{task.title}</strong><span>
        {state.overview.columns.find(column => column.id === task.columnId)?.name ?? 'Archived Column'}
        {task.assignee ? ` · ${task.assignee.displayName}` : ''}{task.archived ? ' · Archived' : task.closedAt ? ' · Closed' : ''}
        {task.tags.map(tag => <span className="exploration-tag" key={tag.id}>{tag.name}</span>)}
      </span></span>
      {ages && <time dateTime={(task as AgedTask).columnEnteredAt} title={`Entered ${new Date((task as AgedTask).columnEnteredAt).toLocaleString()}`}>{duration((task as AgedTask).ageMilliseconds)}</time>}
    </button>
  </li>)}</ul>
}

function Throughput({ report }: { report: FlowView }) {
  const maximum = Math.max(1,...report.throughput.map(week => week.completed+week.rejected+week.cancelled+week.duplicate))
  return <section className="report-section"><h3>Weekly throughput</h3><p>Closure events by Outcome. Completed is delivered work; the current week is partial.</p>
    <div className="report-table-scroll" tabIndex={0} role="region" aria-label="Weekly throughput table"><table><thead><tr><th scope="col">Week of</th><th scope="col">Completed</th><th scope="col">Rejected</th><th scope="col">Cancelled</th><th scope="col">Duplicate</th><th scope="col">Total</th></tr></thead>
      <tbody>{report.throughput.map(week => <tr key={week.startDate}><th scope="row">{dateLabel(week.startDate)}</th><td>{week.completed}</td><td>{week.rejected}</td><td>{week.cancelled}</td><td>{week.duplicate}</td>
        <td><div className="throughput-bar" aria-hidden="true">{(['completed','rejected','cancelled','duplicate'] as const).map(outcome => <span key={outcome} className={`outcome-${outcome}`} style={{ width: `${week[outcome]/maximum*100}%` }} />)}</div><span>{week.completed+week.rejected+week.cancelled+week.duplicate}</span></td>
      </tr>)}</tbody></table></div>
  </section>
}

function WipHistory({ report }: { report: FlowView }) {
  const columns = report.columns.filter(column => column.flowRole === 'active' || report.history.some(day => day.columns.some(point => point.columnId === column.id && point.tasks > 0)))
  return <section className="report-section"><h3>WIP history</h3><p>Active Tasks at each local day’s end. Today shows the latest count.</p>
    <div className="history-charts">{columns.map(column => {
      const values = report.history.map(day => day.columns.find(point => point.columnId === column.id)?.tasks ?? 0)
      const maximum = Math.max(1,...values)
      const points = values.map((value,index) => `${8+index/Math.max(1,values.length-1)*284},${82-value/maximum*68}`).join(' ')
      return <article key={column.id}><h4>{column.name}{column.archived ? ' · Archived' : ''}</h4>
        <svg viewBox="0 0 300 100" role="img" aria-label={`${column.name} WIP over ${values.length} dates; maximum ${Math.max(0,...values)}, latest ${values.at(-1) ?? 0}`}>
          <path d="M8 82H292" className="chart-baseline" /><polyline points={points} className="chart-line" />
          <text x="8" y="10">{Math.max(0,...values)}</text><text x="8" y="97">{dateLabel(report.startDate)}</text><text x="292" y="97" textAnchor="end">{dateLabel(report.endDate)}</text>
        </svg>
      </article>
    })}</div>
    {columns.length > 0 && <details className="report-definitions"><summary>View daily counts</summary><div className="report-table-scroll" tabIndex={0} role="region" aria-label="Daily WIP counts"><table>
      <thead><tr><th scope="col">Date</th>{columns.map(column => <th key={column.id} scope="col">{column.name}</th>)}</tr></thead>
      <tbody>{report.history.map(day => <tr key={day.date}><th scope="row">{dateLabel(day.date)}</th>{columns.map(column => <td key={column.id}>{day.columns.find(point => point.columnId === column.id)?.tasks ?? 0}</td>)}</tr>)}</tbody>
    </table></div></details>}
  </section>
}
