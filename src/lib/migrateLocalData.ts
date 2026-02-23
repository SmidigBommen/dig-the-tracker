import { supabase } from './supabase.ts'

const OLD_STORAGE_KEY = 'dig-tracker-state'

interface OldComment {
  id: string
  text: string
  author: string
  createdAt: string
}

interface OldTask {
  id: string
  number?: number
  title: string
  description: string
  status: string
  priority: string
  assignee: string
  createdBy: string
  tags: string[]
  comments: OldComment[]
  createdAt: string
  updatedAt: string
  parentId?: string
  subtaskIds: string[]
  dueDate?: string
  completedAt?: string
}

interface OldState {
  tasks: OldTask[]
}

export function hasLocalData(): boolean {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as OldState
    return Array.isArray(parsed.tasks) && parsed.tasks.length > 0
  } catch {
    return false
  }
}

export async function migrateLocalData(boardId: string, userId: string): Promise<{ migrated: number; error: string | null }> {
  try {
    const raw = localStorage.getItem(OLD_STORAGE_KEY)
    if (!raw) return { migrated: 0, error: null }

    const parsed = JSON.parse(raw) as OldState
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      return { migrated: 0, error: null }
    }

    // Map old task IDs to new UUIDs
    const idMap = new Map<string, string>()
    const tasks = parsed.tasks.map((t) => {
      const newId = crypto.randomUUID()
      idMap.set(t.id, newId)
      return { ...t, _newId: newId }
    })

    // Insert tasks
    const taskRows = tasks.map((t, i) => ({
      id: t._newId,
      board_id: boardId,
      number: t.number ?? i + 1,
      title: t.title,
      description: t.description || '',
      column_slug: t.status,
      priority: t.priority || 'medium',
      position: i * 1000,
      assignee_name: t.assignee || '',
      created_by_name: t.createdBy || '',
      created_by_id: userId,
      tags: t.tags || [],
      parent_id: t.parentId ? idMap.get(t.parentId) ?? null : null,
      subtask_ids: (t.subtaskIds || []).map((sid) => idMap.get(sid) ?? sid),
      completed_at: t.completedAt || null,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    }))

    const { error: taskError } = await supabase.from('tasks').insert(taskRows)
    if (taskError) return { migrated: 0, error: taskError.message }

    // Insert comments
    const commentRows: Array<{
      task_id: string; board_id: string; author_id: string
      author_name: string; text: string; created_at: string
    }> = []

    for (const t of tasks) {
      for (const c of (t.comments || [])) {
        commentRows.push({
          task_id: t._newId,
          board_id: boardId,
          author_id: userId,
          author_name: c.author || '',
          text: c.text,
          created_at: c.createdAt,
        })
      }
    }

    if (commentRows.length > 0) {
      await supabase.from('task_comments').insert(commentRows)
    }

    // Clear old localStorage
    localStorage.removeItem(OLD_STORAGE_KEY)

    return { migrated: tasks.length, error: null }
  } catch (err) {
    return { migrated: 0, error: (err as Error).message }
  }
}
