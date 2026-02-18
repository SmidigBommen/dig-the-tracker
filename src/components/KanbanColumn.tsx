import { useState, type DragEvent } from 'react'
import type { Task, Column } from '../types/index.ts'
import TaskCard from './TaskCard.tsx'
import './KanbanColumn.css'

interface KanbanColumnProps {
  column: Column
  tasks: Task[]
  allTasks: Task[]
  onDrop: (taskId: string) => void
  onOpenTask: (task: Task) => void
  onAddTask: () => void
}

export default function KanbanColumn({ column, tasks, allTasks, onDrop, onOpenTask, onAddTask }: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    if (taskId) onDrop(taskId)
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
        <button
          className="column-add-btn"
          onClick={onAddTask}
          title={`Add task to ${column.title}`}
          aria-label={`Add task to ${column.title}`}
        >
          +
        </button>
      </div>

      <div className="column-tasks">
        {tasks.map((task) => {
          const parentTitle = task.parentId
            ? allTasks.find((t) => t.id === task.parentId)?.title
            : undefined
          return (
            <TaskCard key={task.id} task={task} parentTitle={parentTitle} onOpen={onOpenTask} />
          )
        })}
        {tasks.length === 0 && (
          <div className="column-empty">
            <p>No tasks</p>
          </div>
        )}
      </div>
    </div>
  )
}
