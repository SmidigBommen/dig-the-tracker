import { useState, type DragEvent } from 'react'
import type { Task } from '../types/index.ts'
import { PRIORITY_CONFIG } from '../types/index.ts'
import { useTaskContext } from '../context/TaskContext.tsx'
import { formatTaskKey } from '../context/taskUtils.ts'
import './TaskCard.css'

interface TaskCardProps {
  task: Task
  parentTitle?: string
  onOpen: (task: Task) => void
}

export default function TaskCard({ task, parentTitle, onOpen }: TaskCardProps) {
  const { state } = useTaskContext()
  const [isDragging, setIsDragging] = useState(false)
  const priority = PRIORITY_CONFIG[task.priority]
  const timeAgo = getTimeAgo(task.updatedAt)

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
  }

  function handleDragEnd() {
    setIsDragging(false)
  }

  return (
    <div
      className={`task-card ${isDragging ? 'dragging' : ''} ${task.parentId ? 'is-subtask' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(task) }}
      aria-label={`Task: ${task.title}`}
    >
      <div className="task-card-header">
        <span
          className="task-priority-badge"
          style={{ backgroundColor: `${priority.color}18`, color: priority.color, borderColor: `${priority.color}40` }}
        >
          {priority.icon} {priority.label}
        </span>
        <div className="task-card-header-right">
          {task.comments.length > 0 && (
            <span className="task-comment-count" title={`${task.comments.length} comment(s)`}>
              💬 {task.comments.length}
            </span>
          )}
          <span className="task-key-badge">{formatTaskKey(task.number)}</span>
        </div>
      </div>

      {parentTitle && (
        <span className="task-card-parent">↳ {parentTitle}</span>
      )}
      <h3 className="task-card-title">{task.title}</h3>

      {task.description && (
        <p className="task-card-description">{task.description.slice(0, 80)}{task.description.length > 80 ? '...' : ''}</p>
      )}

      <div className="task-card-footer">
        <div className="task-tags">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="task-tag">{tag}</span>
          ))}
        </div>
        <div className="task-card-meta">
          {task.assignee && (
            <span
              className="task-assignee"
              title={task.assignee}
              style={{ background: state.profile.avatarColor }}
            >
              {task.assignee.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="task-time">{timeAgo}</span>
        </div>
      </div>
    </div>
  )
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}
