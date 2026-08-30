import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from 'react'
import type { Column, Task, TaskComment, TaskPriority, TaskStatus } from '../types/index.ts'
import { PROTECTED_COLUMN_IDS } from '../types/index.ts'
import { api, mapApiTask, type LocalActor } from '../lib/api.ts'
import { formatTaskKey } from './taskUtils.ts'

interface MemberProfile { display_name: string; avatar_color: string }

export interface TaskState {
  tasks: Task[]
  columns: Column[]
  commentsByTask: Record<string, TaskComment[]>
  memberProfiles: Record<string, MemberProfile>
  actor: LocalActor | null
  boardId: string | null
  loading: boolean
  error: string | null
  toast: string | null
  searchQuery: string
  filterPriority: TaskPriority | 'all'
  currentView: 'board' | 'reports' | 'profile'
  showSubtasksOnBoard: boolean
}

type Action =
  | { type: 'SET_INITIAL'; actor: LocalActor; boardId: string; tasks: Task[]; columns: Column[]; comments: TaskComment[] }
  | { type: 'SET_ACTOR'; actor: LocalActor }
  | { type: 'UPSERT_TASK'; task: Task }
  | { type: 'DELETE_TASKS'; ids: string[] }
  | { type: 'ADD_COMMENT'; comment: TaskComment }
  | { type: 'DELETE_COMMENT'; taskId: string; commentId: string }
  | { type: 'ADD_COLUMN'; column: Column }
  | { type: 'DELETE_COLUMN'; slug: string }
  | { type: 'SET_COLUMNS'; columns: Column[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_TOAST'; toast: string | null }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_FILTER'; priority: TaskPriority | 'all' }
  | { type: 'SET_VIEW'; view: TaskState['currentView'] }
  | { type: 'TOGGLE_SUBTASKS' }

function withRelations(tasks: Task[]): Task[] {
  const children = new Map<string, string[]>()
  for (const task of tasks) {
    if (task.parentId) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task.id])
  }
  return tasks.map((task) => {
    const subtaskIds = children.get(task.id) ?? []
    return { ...task, subtask_ids: subtaskIds, subtaskIds }
  })
}

function groupComments(comments: TaskComment[]): Record<string, TaskComment[]> {
  const result: Record<string, TaskComment[]> = {}
  for (const comment of comments) result[comment.task_id] = [...(result[comment.task_id] ?? []), comment]
  return result
}

function normalizeColumn(column: Column): Column { return { ...column, id: column.slug } }

function reducer(state: TaskState, action: Action): TaskState {
  switch (action.type) {
    case 'SET_INITIAL':
      return {
        ...state, actor: action.actor, boardId: action.boardId, tasks: withRelations(action.tasks),
        columns: action.columns.map(normalizeColumn).sort((a, b) => a.position - b.position),
        commentsByTask: groupComments(action.comments), memberProfiles: { [action.actor.id]: action.actor },
        loading: false, error: null,
      }
    case 'SET_ACTOR': return { ...state, actor: action.actor, memberProfiles: { [action.actor.id]: action.actor } }
    case 'UPSERT_TASK': {
      const exists = state.tasks.some((task) => task.id === action.task.id)
      const tasks = exists ? state.tasks.map((task) => task.id === action.task.id ? action.task : task) : [...state.tasks, action.task]
      return { ...state, tasks: withRelations(tasks) }
    }
    case 'DELETE_TASKS': {
      const ids = new Set(action.ids)
      const commentsByTask = { ...state.commentsByTask }
      for (const id of ids) delete commentsByTask[id]
      return { ...state, tasks: withRelations(state.tasks.filter((task) => !ids.has(task.id))), commentsByTask }
    }
    case 'ADD_COMMENT': {
      const existing = state.commentsByTask[action.comment.task_id] ?? []
      return { ...state, commentsByTask: { ...state.commentsByTask, [action.comment.task_id]: [...existing, action.comment] } }
    }
    case 'DELETE_COMMENT':
      return { ...state, commentsByTask: { ...state.commentsByTask, [action.taskId]: (state.commentsByTask[action.taskId] ?? []).filter((comment) => comment.id !== action.commentId) } }
    case 'ADD_COLUMN': return { ...state, columns: [...state.columns, normalizeColumn(action.column)].sort((a, b) => a.position - b.position) }
    case 'DELETE_COLUMN': return { ...state, columns: state.columns.filter((column) => column.slug !== action.slug) }
    case 'SET_COLUMNS': return { ...state, columns: action.columns.map(normalizeColumn).sort((a, b) => a.position - b.position) }
    case 'SET_LOADING': return { ...state, loading: action.loading }
    case 'SET_ERROR': return { ...state, error: action.error, loading: false }
    case 'SET_TOAST': return { ...state, toast: action.toast }
    case 'SET_SEARCH': return { ...state, searchQuery: action.query }
    case 'SET_FILTER': return { ...state, filterPriority: action.priority }
    case 'SET_VIEW': return { ...state, currentView: action.view }
    case 'TOGGLE_SUBTASKS': return { ...state, showSubtasksOnBoard: !state.showSubtasksOnBoard }
  }
}

interface TaskContextValue {
  state: TaskState
  addTask: (task: { title: string; description: string; status: TaskStatus; priority: TaskPriority; assignee: string; createdBy: string; tags: string[]; parentId?: string; subtaskIds: string[] }) => Promise<boolean>
  updateTask: (id: string, updates: Partial<Task>) => Promise<boolean>
  deleteTask: (id: string) => Promise<boolean>
  moveTask: (id: string, status: TaskStatus) => Promise<void>
  reorderTask: (taskId: string, status: TaskStatus, targetIndex: number) => Promise<void>
  addComment: (taskId: string, text: string, author: string) => Promise<boolean>
  deleteComment: (taskId: string, commentId: string) => Promise<void>
  updateProfile: (displayName: string, avatarColor: string) => Promise<boolean>
  setSearch: (query: string) => void
  setFilterPriority: (priority: TaskPriority | 'all') => void
  setView: (view: TaskState['currentView']) => void
  toggleSubtasksOnBoard: () => void
  clearToast: () => void
  getFilteredTasks: (status: TaskStatus) => Task[]
  getCommentCount: (taskId: string) => number
  getComments: (taskId: string) => TaskComment[]
  addColumn: (title: string, color: string, icon: string, afterColumnId?: string) => Promise<boolean>
  removeColumn: (columnId: string) => Promise<void>
  reorderColumns: (columns: Column[]) => Promise<void>
}

const TaskContext = createContext<TaskContextValue | null>(null)
const UI_STORAGE_KEY = 'dig-tracker-ui'

function loadSubtaskPreference(): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) ?? '{}') as { showSubtasksOnBoard?: boolean }
    return value.showSubtasksOnBoard ?? false
  } catch { return false }
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    tasks: [], columns: [], commentsByTask: {}, memberProfiles: {}, actor: null, boardId: null,
    loading: true, error: null, toast: null, searchQuery: '', filterPriority: 'all', currentView: 'board',
    showSubtasksOnBoard: loadSubtaskPreference(),
  })

  const refresh = useCallback(async (background = false) => {
    if (!background) dispatch({ type: 'SET_LOADING', loading: true })
    try {
      const data = await api.bootstrap()
      dispatch({ type: 'SET_INITIAL', actor: data.actor, boardId: data.board.id, tasks: data.tasks.map(mapApiTask), columns: data.columns, comments: data.comments })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load local workspace'
      dispatch(background ? { type: 'SET_TOAST', toast: message } : { type: 'SET_ERROR', error: message })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const onFocus = () => { void refresh(true) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
  useEffect(() => {
    try { localStorage?.setItem(UI_STORAGE_KEY, JSON.stringify({ showSubtasksOnBoard: state.showSubtasksOnBoard })) }
    catch { /* storage is optional */ }
  }, [state.showSubtasksOnBoard])

  const failure = useCallback((error: unknown) => dispatch({ type: 'SET_TOAST', toast: error instanceof Error ? error.message : 'Request failed' }), [])

  const addTask: TaskContextValue['addTask'] = useCallback(async (task) => {
    try {
      const created = await api.createTask({ title: task.title, description: task.description, columnSlug: task.status, priority: task.priority, assigneeName: task.assignee, tags: task.tags, parentId: task.parentId })
      dispatch({ type: 'UPSERT_TASK', task: mapApiTask(created) })
      return true
    } catch (error) { failure(error); return false }
  }, [failure])

  const updateTask: TaskContextValue['updateTask'] = useCallback(async (id, updates) => {
    try {
      const updated = await api.updateTask(id, { title: updates.title, description: updates.description, priority: updates.priority, assigneeName: updates.assignee ?? updates.assignee_name, tags: updates.tags, columnSlug: updates.status ?? updates.column_slug })
      dispatch({ type: 'UPSERT_TASK', task: mapApiTask(updated) })
      return true
    } catch (error) { failure(error); return false }
  }, [failure])

  const deleteTask = useCallback(async (id: string) => {
    try { dispatch({ type: 'DELETE_TASKS', ids: (await api.deleteTask(id)).deletedIds }); return true }
    catch (error) { failure(error); return false }
  }, [failure])

  const moveTask = useCallback(async (id: string, status: TaskStatus) => {
    try { dispatch({ type: 'UPSERT_TASK', task: mapApiTask(await api.updateTask(id, { columnSlug: status })) }) }
    catch (error) { failure(error) }
  }, [failure])

  const reorderTask = useCallback(async (taskId: string, status: TaskStatus, targetIndex: number) => {
    try { dispatch({ type: 'UPSERT_TASK', task: mapApiTask(await api.updateTask(taskId, { columnSlug: status, targetIndex })) }) }
    catch (error) { failure(error) }
  }, [failure])

  const addComment = useCallback(async (taskId: string, text: string, author: string) => {
    void author
    try { dispatch({ type: 'ADD_COMMENT', comment: await api.createComment(taskId, text) }); return true }
    catch (error) { failure(error); return false }
  }, [failure])

  const deleteComment = useCallback(async (taskId: string, commentId: string) => {
    try { await api.deleteComment(taskId, commentId); dispatch({ type: 'DELETE_COMMENT', taskId, commentId }) }
    catch (error) { failure(error) }
  }, [failure])

  const updateProfile = useCallback(async (displayName: string, avatarColor: string) => {
    try { dispatch({ type: 'SET_ACTOR', actor: await api.updateProfile(displayName, avatarColor) }); return true }
    catch (error) { failure(error); return false }
  }, [failure])

  const addColumn = useCallback(async (title: string, color: string, icon: string, afterColumnId?: string) => {
    try { dispatch({ type: 'ADD_COLUMN', column: await api.createColumn({ title, color, icon, afterColumnSlug: afterColumnId }) }); return true }
    catch (error) { failure(error); return false }
  }, [failure])

  const removeColumn = useCallback(async (columnId: string) => {
    if (PROTECTED_COLUMN_IDS.includes(columnId) || state.tasks.some((task) => task.status === columnId)) return
    try { await api.deleteColumn(columnId); dispatch({ type: 'DELETE_COLUMN', slug: columnId }) }
    catch (error) { failure(error) }
  }, [failure, state.tasks])

  const reorderColumns = useCallback(async (columns: Column[]) => {
    try { dispatch({ type: 'SET_COLUMNS', columns: await api.reorderColumns(columns.map((column) => column.slug)) }) }
    catch (error) { failure(error) }
  }, [failure])

  const getFilteredTasks = useCallback((status: TaskStatus) => state.tasks.filter((task) => {
    if (task.status !== status || (task.parentId && !state.showSubtasksOnBoard)) return false
    if (state.filterPriority !== 'all' && task.priority !== state.filterPriority) return false
    if (!state.searchQuery) return true
    const query = state.searchQuery.toLowerCase()
    return task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query) || formatTaskKey(task.number).toLowerCase().includes(query)
  }).sort((a, b) => a.position - b.position), [state.tasks, state.showSubtasksOnBoard, state.filterPriority, state.searchQuery])

  const value: TaskContextValue = {
    state, addTask, updateTask, deleteTask, moveTask, reorderTask, addComment, deleteComment, updateProfile,
    setSearch: (query) => dispatch({ type: 'SET_SEARCH', query }),
    setFilterPriority: (priority) => dispatch({ type: 'SET_FILTER', priority }),
    setView: (view) => dispatch({ type: 'SET_VIEW', view }),
    toggleSubtasksOnBoard: () => dispatch({ type: 'TOGGLE_SUBTASKS' }),
    clearToast: () => dispatch({ type: 'SET_TOAST', toast: null }),
    getFilteredTasks, getCommentCount: (taskId) => (state.commentsByTask[taskId] ?? []).length,
    getComments: (taskId) => state.commentsByTask[taskId] ?? [], addColumn, removeColumn, reorderColumns,
  }

  return <TaskContext.Provider value={value}>
    {state.loading ? <div className="app-loading"><div className="loading-spinner" /><p>Loading local workspace...</p></div>
      : state.error ? <div className="app-error"><p>Error: {state.error}</p><button onClick={() => void refresh()}>Retry</button></div> : children}
  </TaskContext.Provider>
}

export function useTaskContext(): TaskContextValue {
  const context = useContext(TaskContext)
  if (!context) throw new Error('useTaskContext must be used within a TaskProvider')
  return context
}
