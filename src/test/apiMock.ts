let tasks: Record<string, unknown>[] = []
let comments: Record<string, unknown>[] = []
let columns: Record<string, unknown>[] = []
let counter = 1
let actor = { id: 'test-user', display_name: 'Test User', avatar_color: '#6366f1' }

export function resetMockData() {
  tasks = []
  comments = []
  columns = [
    { id: 'backlog-id', slug: 'backlog', board_id: 'test-board', title: 'Backlog', color: '#6b7280', icon: '📋', position: 0, is_protected: true },
    { id: 'todo-id', slug: 'todo', board_id: 'test-board', title: 'To Do', color: '#3b82f6', icon: '📝', position: 1000, is_protected: false },
    { id: 'progress-id', slug: 'in-progress', board_id: 'test-board', title: 'In Progress', color: '#f59e0b', icon: '⚡', position: 2000, is_protected: false },
    { id: 'review-id', slug: 'review', board_id: 'test-board', title: 'Review', color: '#8b5cf6', icon: '🔍', position: 3000, is_protected: false },
    { id: 'done-id', slug: 'done', board_id: 'test-board', title: 'Done', color: '#10b981', icon: '✅', position: 4000, is_protected: true },
  ]
  counter = 1
  actor = { id: 'test-user', display_name: 'Test User', avatar_color: '#6366f1' }
}

resetMockData()

export function setMockTasks(value: Record<string, unknown>[]) {
  tasks = structuredClone(value)
  counter = Math.max(0, ...tasks.map((task) => Number(task.number ?? 0))) + 1
}

function taskRow(input: Record<string, unknown>) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), board_id: 'test-board', number: counter++, title: input.title,
    description: input.description ?? '', column_slug: input.columnSlug ?? 'backlog', priority: input.priority ?? 'medium',
    position: tasks.length * 1000 + 1000, assignee_name: input.assigneeName ?? '', created_by_name: actor.display_name,
    created_by_id: actor.id, tags: input.tags ?? [], parent_id: input.parentId ?? null, subtask_ids: [],
    due_date: null, completed_at: null, created_at: now, updated_at: now,
  }
}

export const mockApi = {
  async bootstrap() { return { actor: { ...actor }, board: { id: 'test-board', name: 'Dig Tracker' }, columns: structuredClone(columns), tasks: structuredClone(tasks), comments: structuredClone(comments) } },
  async updateProfile(displayName: string, avatarColor: string) { actor = { ...actor, display_name: displayName, avatar_color: avatarColor }; return { ...actor } },
  async createTask(input: Record<string, unknown>) { const row = taskRow(input); tasks.push(row); return structuredClone(row) },
  async updateTask(id: string, input: Record<string, unknown>) {
    const index = tasks.findIndex((task) => task.id === id)
    if (index < 0) throw new Error('Task not found')
    const current = tasks[index]
    tasks[index] = { ...current, title: input.title ?? current.title, description: input.description ?? current.description, priority: input.priority ?? current.priority, assignee_name: input.assigneeName ?? current.assignee_name, tags: input.tags ?? current.tags, column_slug: input.columnSlug ?? current.column_slug, completed_at: input.columnSlug === 'done' ? new Date().toISOString() : current.completed_at, updated_at: new Date().toISOString() }
    return structuredClone(tasks[index])
  },
  async deleteTask(id: string) { const ids = tasks.filter((task) => task.id === id || task.parent_id === id).map((task) => String(task.id)); tasks = tasks.filter((task) => !ids.includes(String(task.id))); return { deletedIds: ids } },
  async createComment(taskId: string, text: string) { const row = { id: crypto.randomUUID(), task_id: taskId, board_id: 'test-board', author_id: actor.id, author_name: actor.display_name, text, created_at: new Date().toISOString() }; comments.push(row); return { ...row } },
  async deleteComment(_taskId: string, commentId: string) { comments = comments.filter((comment) => comment.id !== commentId); return { deletedId: commentId } },
  async createColumn(input: Record<string, unknown>) { const slug = String(input.title).toLowerCase().replace(/\s+/g, '-'); const row = { id: crypto.randomUUID(), board_id: 'test-board', slug, title: input.title, color: input.color, icon: input.icon, position: columns.length * 1000, is_protected: false }; columns.push(row); return { ...row } },
  async deleteColumn(slug: string) { columns = columns.filter((column) => column.slug !== slug); return { deletedSlug: slug } },
  async reorderColumns(slugs: string[]) { columns = slugs.map((slug, index) => ({ ...columns.find((column) => column.slug === slug)!, position: index * 1000 })); return structuredClone(columns) },
}
