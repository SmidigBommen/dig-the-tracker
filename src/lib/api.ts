import type { Column, Task, TaskComment } from '../types/index.ts'

export interface LocalActor {
  id: string
  display_name: string
  avatar_color: string
}

export interface BoardSummary {
  id: string
  name: string
}

export interface BootstrapData {
  actor: LocalActor
  board: BoardSummary
  columns: Column[]
  tasks: Array<Record<string, unknown>>
  comments: TaskComment[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
  return result as T
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) }
}

export const api = {
  bootstrap: () => request<BootstrapData>('/api/bootstrap'),
  updateProfile: (displayName: string, avatarColor: string) =>
    request<LocalActor>('/api/profile', json('PATCH', { displayName, avatarColor })),
  createTask: (input: unknown) => request<Record<string, unknown>>('/api/tasks', json('POST', input)),
  updateTask: (id: string, input: unknown) => request<Record<string, unknown>>(`/api/tasks/${encodeURIComponent(id)}`, json('PATCH', input)),
  deleteTask: (id: string) => request<{ deletedIds: string[] }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createComment: (taskId: string, text: string) =>
    request<TaskComment>(`/api/tasks/${encodeURIComponent(taskId)}/comments`, json('POST', { text })),
  deleteComment: (taskId: string, commentId: string) =>
    request<{ deletedId: string }>(`/api/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
  createColumn: (input: unknown) => request<Column>('/api/columns', json('POST', input)),
  deleteColumn: (slug: string) => request<{ deletedSlug: string }>(`/api/columns/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  reorderColumns: (slugs: string[]) => request<Column[]>('/api/columns/order', json('PUT', { slugs })),
}

export function mapApiTask(row: Record<string, unknown>): Task {
  const columnSlug = row.column_slug as string
  const createdAt = String(row.created_at ?? '')
  const updatedAt = String(row.updated_at ?? '')
  const completedAt = row.completed_at ? String(row.completed_at) : null
  const parentId = row.parent_id ? String(row.parent_id) : null
  const subtaskIds = (row.subtask_ids as string[] | undefined) ?? []
  return {
    id: row.id as string,
    board_id: row.board_id as string,
    number: row.number as number,
    title: row.title as string,
    description: String(row.description ?? ''),
    column_slug: columnSlug,
    status: columnSlug,
    priority: row.priority as Task['priority'],
    position: row.position as number,
    assignee_name: String(row.assignee_name ?? ''),
    assignee: String(row.assignee_name ?? ''),
    created_by_name: String(row.created_by_name ?? ''),
    createdBy: String(row.created_by_name ?? ''),
    created_by_id: row.created_by_id ? String(row.created_by_id) : null,
    assignee_id: null,
    tags: (row.tags as string[] | undefined) ?? [],
    parent_id: parentId,
    parentId: parentId ?? undefined,
    subtask_ids: subtaskIds,
    subtaskIds,
    due_date: row.due_date ? String(row.due_date) : null,
    completed_at: completedAt,
    completedAt: completedAt ?? undefined,
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
  }
}
