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

/** Map a raw Supabase task row to a Task with compat fields */
export function mapTask(row: Record<string, unknown>): Task {
  const t = row as Record<string, unknown>
  return {
    id: t.id as string,
    board_id: t.board_id as string,
    number: t.number as number,
    title: t.title as string,
    description: (t.description as string) ?? '',
    column_slug: t.column_slug as string,
    status: t.column_slug as string,
    priority: t.priority as TaskPriority,
    position: t.position as number,
    assignee_name: (t.assignee_name as string) ?? '',
    assignee: (t.assignee_name as string) ?? '',
    created_by_name: (t.created_by_name as string) ?? '',
    createdBy: (t.created_by_name as string) ?? '',
    created_by_id: (t.created_by_id as string) ?? null,
    assignee_id: (t.assignee_id as string) ?? null,
    tags: (t.tags as string[]) ?? [],
    parent_id: (t.parent_id as string) ?? null,
    parentId: (t.parent_id as string) ?? undefined,
    subtask_ids: (t.subtask_ids as string[]) ?? [],
    subtaskIds: (t.subtask_ids as string[]) ?? [],
    due_date: (t.due_date as string) ?? null,
    completed_at: (t.completed_at as string) ?? null,
    completedAt: (t.completed_at as string) ?? undefined,
    created_at: (t.created_at as string) ?? '',
    createdAt: (t.created_at as string) ?? '',
    updated_at: (t.updated_at as string) ?? '',
    updatedAt: (t.updated_at as string) ?? '',
  }
}

/** Map a raw Supabase column row to a Column */
export function mapColumn(row: Record<string, unknown>): Column {
  const c = row as Record<string, unknown>
  return {
    id: c.slug as string, // Keep id = slug for component compat
    board_id: c.board_id as string,
    slug: c.slug as string,
    title: c.title as string,
    color: (c.color as string) ?? '#6b7280',
    icon: (c.icon as string) ?? '',
    position: c.position as number,
    is_protected: (c.is_protected as boolean) ?? false,
  }
}

export const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog', board_id: '', slug: 'backlog', title: 'Backlog', color: '#6b7280', icon: '📋', position: 0, is_protected: true },
  { id: 'todo', board_id: '', slug: 'todo', title: 'To Do', color: '#3b82f6', icon: '📝', position: 1000, is_protected: false },
  { id: 'in-progress', board_id: '', slug: 'in-progress', title: 'In Progress', color: '#f59e0b', icon: '⚡', position: 2000, is_protected: false },
  { id: 'review', board_id: '', slug: 'review', title: 'Review', color: '#8b5cf6', icon: '🔍', position: 3000, is_protected: false },
  { id: 'done', board_id: '', slug: 'done', title: 'Done', color: '#10b981', icon: '✅', position: 4000, is_protected: true },
]

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
