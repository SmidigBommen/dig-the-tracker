export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Comment {
  id: string
  text: string
  author: string
  createdAt: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  tags: string[]
  comments: Comment[]
  createdAt: string
  updatedAt: string
  parentId?: string
  subtaskIds: string[]
  dueDate?: string
  completedAt?: string
}

export interface Column {
  id: TaskStatus
  title: string
  color: string
  icon: string
}

export const COLUMNS: Column[] = [
  { id: 'backlog', title: 'Backlog', color: '#6b7280', icon: '📋' },
  { id: 'todo', title: 'To Do', color: '#3b82f6', icon: '📝' },
  { id: 'in-progress', title: 'In Progress', color: '#f59e0b', icon: '⚡' },
  { id: 'review', title: 'Review', color: '#8b5cf6', icon: '🔍' },
  { id: 'done', title: 'Done', color: '#10b981', icon: '✅' },
]

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
