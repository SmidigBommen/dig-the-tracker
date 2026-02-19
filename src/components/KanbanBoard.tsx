import { useState } from 'react'
import { PROTECTED_COLUMN_IDS, type Task, type TaskStatus } from '../types/index.ts'
import { useTaskContext } from '../context/TaskContext.tsx'
import KanbanColumn from './KanbanColumn.tsx'
import TaskModal from './TaskModal.tsx'
import TaskDetailModal from './TaskDetailModal.tsx'
import './KanbanBoard.css'

const COLOR_SWATCHES = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#ef4444', '#06b6d4', '#6b7280',
]

export default function KanbanBoard() {
  const { state, getFilteredTasks, moveTask, reorderTask, addColumn, removeColumn } = useTaskContext()
  const [createModalStatus, setCreateModalStatus] = useState<TaskStatus | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColTitle, setNewColTitle] = useState('')
  const [newColColor, setNewColColor] = useState(COLOR_SWATCHES[0])
  const [newColIcon, setNewColIcon] = useState('📌')
  const defaultPosition = state.columns.length >= 2 ? state.columns[state.columns.length - 2].id : state.columns[state.columns.length - 1]?.id ?? ''
  const [newColPosition, setNewColPosition] = useState(defaultPosition)

  function handleDrop(taskId: string, status: TaskStatus) {
    moveTask(taskId, status)
  }

  function handleAddColumn() {
    if (!newColTitle.trim()) return
    addColumn(newColTitle, newColColor, newColIcon, newColPosition || undefined)
    setNewColTitle('')
    setNewColColor(COLOR_SWATCHES[0])
    setNewColIcon('📌')
    setNewColPosition(defaultPosition)
    setShowAddColumn(false)
  }

  return (
    <div className="kanban-board">
      <div className="kanban-columns">
        {state.columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={getFilteredTasks(column.id)}
            allTasks={state.tasks}
            onDrop={(taskId) => handleDrop(taskId, column.id)}
            onReorder={(taskId, targetIndex) => reorderTask(taskId, column.id, targetIndex)}
            onOpenTask={(task) => setSelectedTask(task)}
            onAddTask={() => setCreateModalStatus(column.id)}
            onRemoveColumn={!PROTECTED_COLUMN_IDS.includes(column.id) ? () => removeColumn(column.id) : undefined}
          />
        ))}

        <div className="add-column-wrapper">
          {showAddColumn ? (
            <div className="add-column-form">
              <h3 className="add-column-form-title">New Column</h3>
              <div className="add-column-field">
                <label htmlFor="new-col-title">Title</label>
                <input
                  id="new-col-title"
                  type="text"
                  value={newColTitle}
                  onChange={(e) => setNewColTitle(e.target.value)}
                  placeholder="Column name..."
                  autoFocus
                  maxLength={30}
                />
              </div>
              <div className="add-column-field">
                <label htmlFor="new-col-icon">Icon</label>
                <input
                  id="new-col-icon"
                  type="text"
                  value={newColIcon}
                  onChange={(e) => setNewColIcon(e.target.value)}
                  placeholder="Emoji..."
                  maxLength={2}
                  className="icon-input"
                />
              </div>
              <div className="add-column-field">
                <label>Color</label>
                <div className="color-swatches">
                  {COLOR_SWATCHES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-swatch ${newColColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewColColor(color)}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="add-column-field">
                <label htmlFor="new-col-position">Insert after</label>
                <select
                  id="new-col-position"
                  value={newColPosition}
                  onChange={(e) => setNewColPosition(e.target.value)}
                >
                  {state.columns.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.icon} {col.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="add-column-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAddColumn(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleAddColumn} disabled={!newColTitle.trim()}>Add</button>
              </div>
            </div>
          ) : (
            <button
              className="add-column-btn"
              onClick={() => setShowAddColumn(true)}
              aria-label="Add column"
            >
              + Add Column
            </button>
          )}
        </div>
      </div>

      {createModalStatus && (
        <TaskModal
          defaultStatus={createModalStatus}
          onClose={() => setCreateModalStatus(null)}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          taskId={selectedTask.id}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
