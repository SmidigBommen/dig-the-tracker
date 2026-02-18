import { useState } from 'react'
import { COLUMNS, type Task, type TaskStatus } from '../types/index.ts'
import { useTaskContext } from '../context/TaskContext.tsx'
import KanbanColumn from './KanbanColumn.tsx'
import TaskModal from './TaskModal.tsx'
import TaskDetailModal from './TaskDetailModal.tsx'
import './KanbanBoard.css'

export default function KanbanBoard() {
  const { state, getFilteredTasks, moveTask } = useTaskContext()
  const [createModalStatus, setCreateModalStatus] = useState<TaskStatus | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  function handleDrop(taskId: string, status: TaskStatus) {
    moveTask(taskId, status)
  }

  return (
    <div className="kanban-board">
      <div className="kanban-columns">
        {COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={getFilteredTasks(column.id)}
            allTasks={state.tasks}
            onDrop={(taskId) => handleDrop(taskId, column.id)}
            onOpenTask={(task) => setSelectedTask(task)}
            onAddTask={() => setCreateModalStatus(column.id)}
          />
        ))}
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
