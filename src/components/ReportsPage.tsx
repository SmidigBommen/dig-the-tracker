import { useMemo } from 'react'
import { PRIORITY_CONFIG, type TaskPriority } from '../types/index.ts'
import { useTaskContext } from '../context/TaskContext.tsx'
import './ReportsPage.css'

export default function ReportsPage() {
  const { state } = useTaskContext()
  const { tasks, columns } = state

  const stats = useMemo(() => {
    const topLevel = tasks.filter((t) => !t.parentId)
    const subtasks = tasks.filter((t) => t.parentId)
    const completed = topLevel.filter((t) => t.status === 'done')
    const completedSubtasks = subtasks.filter((t) => t.status === 'done')

    // Status distribution
    const statusCounts: Record<string, number> = {}
    columns.forEach((c) => { statusCounts[c.id] = 0 })
    topLevel.forEach((t) => { if (t.status in statusCounts) statusCounts[t.status]++ })

    // Priority distribution
    const priorityCounts: Record<TaskPriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0,
    }
    topLevel.forEach((t) => { priorityCounts[t.priority]++ })

    // Avg completion time (for completed tasks with completedAt)
    const completionTimes = completed
      .filter((t) => t.completedAt)
      .map((t) => new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime())
    const avgCompletionMs = completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : 0
    const avgCompletionDays = Math.round(avgCompletionMs / 86400000 * 10) / 10

    // Assignee workload
    const assigneeMap = new Map<string, { total: number; done: number }>()
    topLevel.forEach((t) => {
      const name = t.assignee || 'Unassigned'
      const entry = assigneeMap.get(name) || { total: 0, done: 0 }
      entry.total++
      if (t.status === 'done') entry.done++
      assigneeMap.set(name, entry)
    })

    // Tag distribution
    const tagMap = new Map<string, number>()
    topLevel.forEach((t) => {
      t.tags.forEach((tag) => {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
      })
    })

    // Recent activity (tasks updated in last 24h)
    const oneDayAgo = Date.now() - 86400000
    const recentlyActive = tasks.filter((t) => new Date(t.updatedAt).getTime() > oneDayAgo)

    // Tasks with most comments
    const mostCommented = [...topLevel].sort((a, b) => b.comments.length - a.comments.length).slice(0, 5)

    // Overdue-like: tasks older than 7 days not done
    const sevenDaysAgo = Date.now() - 7 * 86400000
    const aging = topLevel.filter(
      (t) => t.status !== 'done' && new Date(t.createdAt).getTime() < sevenDaysAgo
    )

    return {
      totalTasks: topLevel.length,
      totalSubtasks: subtasks.length,
      completed: completed.length,
      completedSubtasks: completedSubtasks.length,
      completionRate: topLevel.length > 0 ? Math.round((completed.length / topLevel.length) * 100) : 0,
      statusCounts,
      priorityCounts,
      avgCompletionDays,
      assigneeMap,
      tagMap,
      recentlyActive: recentlyActive.length,
      mostCommented,
      aging,
      totalComments: tasks.reduce((sum, t) => sum + t.comments.length, 0),
    }
  }, [tasks, columns])

  const maxStatusCount = Math.max(...Object.values(stats.statusCounts), 1)
  const maxPriorityCount = Math.max(...Object.values(stats.priorityCounts), 1)

  return (
    <div className="reports-page">
      <div className="reports-header">
        <h2>Reports & Analytics</h2>
        <p className="reports-subtitle">Overview of your project's progress and health</p>
      </div>

      {/* Summary cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-icon" style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>T</div>
          <div className="summary-info">
            <span className="summary-value">{stats.totalTasks}</span>
            <span className="summary-label">Total Tasks</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>D</div>
          <div className="summary-info">
            <span className="summary-value">{stats.completed}</span>
            <span className="summary-label">Completed</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>%</div>
          <div className="summary-info">
            <span className="summary-value">{stats.completionRate}%</span>
            <span className="summary-label">Completion Rate</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>S</div>
          <div className="summary-info">
            <span className="summary-value">{stats.totalSubtasks}</span>
            <span className="summary-label">Subtasks</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon" style={{ background: 'linear-gradient(135deg, #ec4899, #be185d)' }}>C</div>
          <div className="summary-info">
            <span className="summary-value">{stats.totalComments}</span>
            <span className="summary-label">Comments</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon" style={{ background: 'linear-gradient(135deg, #14b8a6, #0d9488)' }}>A</div>
          <div className="summary-info">
            <span className="summary-value">{stats.avgCompletionDays}d</span>
            <span className="summary-label">Avg. Completion</span>
          </div>
        </div>
      </div>

      <div className="reports-grid">
        {/* Status Distribution */}
        <div className="report-card">
          <h3>Status Distribution</h3>
          <div className="bar-chart">
            {columns.map((col) => (
              <div key={col.id} className="bar-row">
                <span className="bar-label">{col.icon} {col.title}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${((stats.statusCounts[col.id] ?? 0) / maxStatusCount) * 100}%`,
                      backgroundColor: col.color,
                    }}
                  />
                </div>
                <span className="bar-value">{stats.statusCounts[col.id] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Distribution */}
        <div className="report-card">
          <h3>Priority Distribution</h3>
          <div className="bar-chart">
            {(Object.entries(PRIORITY_CONFIG) as [TaskPriority, typeof PRIORITY_CONFIG[TaskPriority]][]).map(([key, config]) => (
              <div key={key} className="bar-row">
                <span className="bar-label">{config.icon} {config.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(stats.priorityCounts[key] / maxPriorityCount) * 100}%`,
                      backgroundColor: config.color,
                    }}
                  />
                </div>
                <span className="bar-value">{stats.priorityCounts[key]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Team Workload */}
        <div className="report-card">
          <h3>Team Workload</h3>
          <div className="team-list">
            {Array.from(stats.assigneeMap.entries())
              .sort((a, b) => b[1].total - a[1].total)
              .map(([name, data]) => (
                <div key={name} className="team-member">
                  <div className="team-avatar">{name.charAt(0).toUpperCase()}</div>
                  <div className="team-info">
                    <span className="team-name">{name}</span>
                    <div className="team-progress-track">
                      <div
                        className="team-progress-fill"
                        style={{ width: `${data.total > 0 ? (data.done / data.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <span className="team-count">{data.done}/{data.total}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Tags */}
        <div className="report-card">
          <h3>Tags</h3>
          <div className="tag-cloud">
            {Array.from(stats.tagMap.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => (
                <span key={tag} className="report-tag" style={{ fontSize: `${Math.max(0.75, Math.min(1.4, 0.7 + count * 0.2))}rem` }}>
                  {tag} <span className="tag-count">{count}</span>
                </span>
              ))}
            {stats.tagMap.size === 0 && <p className="empty-state">No tags yet</p>}
          </div>
        </div>

        {/* Most Commented */}
        <div className="report-card">
          <h3>Most Discussed</h3>
          <div className="discussed-list">
            {stats.mostCommented.filter(t => t.comments.length > 0).map((task) => (
              <div key={task.id} className="discussed-item">
                <span className="discussed-title">{task.title}</span>
                <span className="discussed-count">💬 {task.comments.length}</span>
              </div>
            ))}
            {stats.mostCommented.filter(t => t.comments.length > 0).length === 0 && (
              <p className="empty-state">No comments yet</p>
            )}
          </div>
        </div>

        {/* Aging Tasks */}
        <div className="report-card">
          <h3>Aging Tasks ({'>'}7 days)</h3>
          <div className="aging-list">
            {stats.aging.map((task) => {
              const age = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86400000)
              return (
                <div key={task.id} className="aging-item">
                  <div className="aging-info">
                    <span className="aging-title">{task.title}</span>
                    <span className="aging-status">{columns.find(c => c.id === task.status)?.icon} {columns.find(c => c.id === task.status)?.title}</span>
                  </div>
                  <span className="aging-days">{age}d</span>
                </div>
              )
            })}
            {stats.aging.length === 0 && <p className="empty-state">No aging tasks</p>}
          </div>
        </div>
      </div>

      {/* Recent activity summary */}
      <div className="report-card activity-card">
        <h3>Activity Summary</h3>
        <div className="activity-stats">
          <div className="activity-stat">
            <span className="activity-number">{stats.recentlyActive}</span>
            <span className="activity-label">Active in last 24h</span>
          </div>
          <div className="activity-stat">
            <span className="activity-number">{stats.completedSubtasks}/{stats.totalSubtasks}</span>
            <span className="activity-label">Subtasks completed</span>
          </div>
          <div className="activity-stat">
            <span className="activity-number">
              {tasks.filter(t => t.status === 'in-progress' && !t.parentId).length}
            </span>
            <span className="activity-label">In progress now</span>
          </div>
        </div>
      </div>
    </div>
  )
}
