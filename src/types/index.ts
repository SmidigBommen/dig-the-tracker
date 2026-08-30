export type TaskStatus = string

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface TaskComment {
  id: string
  task_id: string
  board_id: string
  author_id: string | null
  author_name: string
  text: string
  created_at: string
}

export interface Task {
  id: string
  board_id: string
  number: number
  title: string
  description: string
  column_slug: string
  /** Virtual field mapped from column_slug for component compat */
  status: TaskStatus
  priority: TaskPriority
  position: number
  assignee_name: string
  /** Compat alias for assignee_name */
  assignee: string
  created_by_name: string
  /** Compat alias for created_by_name */
  createdBy: string
  created_by_id: string | null
  assignee_id: string | null
  tags: string[]
  parent_id: string | null
  /** Compat alias for parent_id */
  parentId?: string
  subtask_ids: string[]
  /** Compat alias for subtask_ids */
  subtaskIds: string[]
  due_date: string | null
  completed_at: string | null
  /** Compat alias for completed_at */
  completedAt?: string
  created_at: string
  /** Compat alias for created_at */
  createdAt: string
  updated_at: string
  /** Compat alias for updated_at */
  updatedAt: string
}

export interface Column {
  id: string
  board_id: string
  slug: string
  title: string
  color: string
  icon: string
  position: number
  is_protected: boolean
}

export const PROTECTED_COLUMN_IDS = ['backlog', 'done']

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; icon: string }> = {
  low: { label: 'Low', color: '#6b7280', icon: '○' },
  medium: { label: 'Medium', color: '#3b82f6', icon: '◐' },
  high: { label: 'High', color: '#f59e0b', icon: '●' },
  urgent: { label: 'Urgent', color: '#ef4444', icon: '🔴' },
}

export interface ValidationError {
  field: string
  message: string
}
