import { useState, useRef, type DragEvent } from 'react'
import type { Task, Column } from '../types/index.ts'
import TaskCard from './TaskCard.tsx'
import './KanbanColumn.css'

interface KanbanColumnProps {
  column: Column
  tasks: Task[]
  allTasks: Task[]
  onDrop: (taskId: string) => void
  onReorder: (taskId: string, targetIndex: number) => void
  onOpenTask: (task: Task) => void
  onAddTask: () => void
  onRemoveColumn?: () => void
}

export default function KanbanColumn({ column, tasks, allTasks, onDrop: _onDrop, onReorder, onOpenTask, onAddTask, onRemoveColumn }: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const tasksRef = useRef<HTMLDivElement>(null)

  function getDropIndex(e: DragEvent<HTMLDivElement>): number {
    const container = tasksRef.current
    if (!container) return tasks.length
    const cards = Array.from(container.querySelectorAll('.task-card'))
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      if (e.clientY < midY) return i
    }
    return tasks.length
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
    setDropIndex(getDropIndex(e))
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
    setDropIndex(null)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId) return
    const idx = getDropIndex(e)
    setDropIndex(null)
    onReorder(taskId, idx)
  }

  return (
    <div
      className={`kanban-column ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="column-header">
        <div className="column-header-left">
          <span className="column-icon">{column.icon}</span>
          <h2 className="column-title">{column.title}</h2>
          <span className="column-count" style={{ backgroundColor: `${column.color}20`, color: column.color }}>
            {tasks.length}
          </span>
        </div>
        <div className="column-header-right">
          {onRemoveColumn && (
            <button
              className="column-remove-btn"
              onClick={onRemoveColumn}
              disabled={tasks.length > 0}
              title={tasks.length > 0 ? 'Remove all tasks before deleting this column' : `Remove ${column.title} column`}
              aria-label={`Remove ${column.title} column`}
            >
              ×
            </button>
          )}
          <button
            className="column-add-btn"
            onClick={onAddTask}
            title={`Add task to ${column.title}`}
            aria-label={`Add task to ${column.title}`}
          >
            +
          </button>
        </div>
      </div>

      <div className="column-tasks" ref={tasksRef}>
        {tasks.map((task, i) => {
          const parentTitle = task.parentId
            ? allTasks.find((t) => t.id === task.parentId)?.title
            : undefined
          return (
            <div key={task.id}>
              {isDragOver && dropIndex === i && <div className="drop-indicator" />}
              <TaskCard task={task} parentTitle={parentTitle} onOpen={onOpenTask} />
            </div>
          )
        })}
        {isDragOver && dropIndex === tasks.length && <div className="drop-indicator" />}
        {tasks.length === 0 && !isDragOver && (
          <div className="column-empty">
            <p>No tasks</p>
          </div>
        )}
      </div>
    </div>
  )
}
