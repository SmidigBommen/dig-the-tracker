import { createContext, useContext, useReducer, useCallback, useEffect, type ReactNode } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task, TaskStatus, TaskPriority, Column } from '../types/index.ts'
import { DEFAULT_COLUMNS, PROTECTED_COLUMN_IDS } from '../types/index.ts'
import { formatTaskKey } from './taskUtils.ts'

export interface UserProfile {
  username: string
  email: string
  displayName: string
  avatarColor: string
}

interface TaskState {
  tasks: Task[]
  columns: Column[]
  nextTaskNumber: number
  searchQuery: string
  filterPriority: TaskPriority | 'all'
  currentView: 'board' | 'reports' | 'profile'
  showSubtasksOnBoard: boolean
  profile: UserProfile
}

type TaskAction =
  | { type: 'ADD_TASK'; payload: Omit<Task, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'comments'> }
  | { type: 'UPDATE_TASK'; payload: { id: string; updates: Partial<Task> } }
  | { type: 'DELETE_TASK'; payload: string }
  | { type: 'MOVE_TASK'; payload: { id: string; status: TaskStatus } }
  | { type: 'ADD_COMMENT'; payload: { taskId: string; text: string; author: string } }
  | { type: 'DELETE_COMMENT'; payload: { taskId: string; commentId: string } }
  | { type: 'REORDER_TASK'; payload: { taskId: string; status: TaskStatus; targetIndex: number } }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_FILTER_PRIORITY'; payload: TaskPriority | 'all' }
  | { type: 'SET_VIEW'; payload: 'board' | 'reports' | 'profile' }
  | { type: 'TOGGLE_SUBTASKS_ON_BOARD' }
  | { type: 'UPDATE_PROFILE'; payload: Partial<UserProfile> }
  | { type: 'ADD_COLUMN'; payload: { title: string; color: string; icon: string; afterColumnId?: string } }
  | { type: 'REMOVE_COLUMN'; payload: string }
  | { type: 'REORDER_COLUMNS'; payload: Column[] }

const now = () => new Date().toISOString()

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case 'ADD_TASK': {
      const newId = uuidv4()
      const taskNumber = state.nextTaskNumber
      const newTask: Task = {
        ...action.payload,
        id: newId,
        number: taskNumber,
        comments: [],
        subtaskIds: action.payload.subtaskIds ?? [],
        createdAt: now(),
        updatedAt: now(),
      }
      let tasks = [...state.tasks, newTask]
      // If has parentId, add this task's id to parent's subtaskIds
      if (action.payload.parentId) {
        tasks = tasks.map((t) =>
          t.id === action.payload.parentId
            ? { ...t, subtaskIds: [...t.subtaskIds, newId], updatedAt: now() }
            : t
        )
      }
      return { ...state, tasks, nextTaskNumber: taskNumber + 1 }
    }
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.payload.id
            ? { ...t, ...action.payload.updates, updatedAt: now() }
            : t
        ),
      }
    case 'DELETE_TASK': {
      const taskToDelete = state.tasks.find((t) => t.id === action.payload)
      let tasks = state.tasks.filter((t) => t.id !== action.payload)
      // Remove from parent's subtaskIds
      if (taskToDelete?.parentId) {
        tasks = tasks.map((t) =>
          t.id === taskToDelete.parentId
            ? { ...t, subtaskIds: t.subtaskIds.filter((id) => id !== action.payload) }
            : t
        )
      }
      // Also delete child subtasks
      if (taskToDelete) {
        const childIds = new Set(taskToDelete.subtaskIds)
        tasks = tasks.filter((t) => !childIds.has(t.id))
      }
      return { ...state, tasks }
    }
    case 'MOVE_TASK': {
      const completedAt = action.payload.status === 'done' ? now() : undefined
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.payload.id
            ? {
                ...t,
                status: action.payload.status,
                updatedAt: now(),
                completedAt: action.payload.status === 'done' ? (t.completedAt ?? completedAt) : undefined,
              }
            : t
        ),
      }
    }
    case 'ADD_COMMENT':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.payload.taskId
            ? {
                ...t,
                comments: [
                  ...t.comments,
                  {
                    id: uuidv4(),
                    text: action.payload.text,
                    author: action.payload.author,
                    createdAt: now(),
                  },
                ],
                updatedAt: now(),
              }
            : t
        ),
      }
    case 'DELETE_COMMENT':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.payload.taskId
            ? {
                ...t,
                comments: t.comments.filter((c) => c.id !== action.payload.commentId),
                updatedAt: now(),
              }
            : t
        ),
      }
    case 'REORDER_TASK': {
      const { taskId, status, targetIndex } = action.payload
      const task = state.tasks.find((t) => t.id === taskId)
      if (!task) return state
      // Remove task from current position
      const remaining = state.tasks.filter((t) => t.id !== taskId)
      const updatedTask = { ...task, status, updatedAt: now(), completedAt: status === 'done' ? (task.completedAt ?? now()) : undefined }
      // Get tasks in the target status to find the insertion point
      const tasksInStatus = remaining.filter((t) => t.status === status)
      const clampedIndex = Math.min(targetIndex, tasksInStatus.length)
      // Find the actual index in the full array to insert at
      let insertAt: number
      if (clampedIndex >= tasksInStatus.length) {
        // Insert after the last task in this status
        const lastInStatus = tasksInStatus[tasksInStatus.length - 1]
        insertAt = lastInStatus ? remaining.indexOf(lastInStatus) + 1 : remaining.length
      } else {
        // Insert before the task at clampedIndex
        insertAt = remaining.indexOf(tasksInStatus[clampedIndex])
      }
      const tasks = [...remaining.slice(0, insertAt), updatedTask, ...remaining.slice(insertAt)]
      return { ...state, tasks }
    }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.payload }
    case 'SET_FILTER_PRIORITY':
      return { ...state, filterPriority: action.payload }
    case 'SET_VIEW':
      return { ...state, currentView: action.payload }
    case 'TOGGLE_SUBTASKS_ON_BOARD':
      return { ...state, showSubtasksOnBoard: !state.showSubtasksOnBoard }
    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.payload } }
    case 'ADD_COLUMN': {
      const id = slugify(action.payload.title)
      if (!id || state.columns.some((c) => c.id === id)) return state
      const newColumn: Column = { id, title: action.payload.title.trim(), color: action.payload.color, icon: action.payload.icon }
      let insertAt: number
      if (action.payload.afterColumnId) {
        const afterIndex = state.columns.findIndex((c) => c.id === action.payload.afterColumnId)
        insertAt = afterIndex >= 0 ? afterIndex + 1 : state.columns.length
      } else {
        // Default: insert before Done
        const doneIndex = state.columns.findIndex((c) => c.id === 'done')
        insertAt = doneIndex >= 0 ? doneIndex : state.columns.length
      }
      const columns = [...state.columns.slice(0, insertAt), newColumn, ...state.columns.slice(insertAt)]
      return { ...state, columns }
    }
    case 'REMOVE_COLUMN': {
      const colId = action.payload
      if (PROTECTED_COLUMN_IDS.includes(colId)) return state
      if (state.tasks.some((t) => t.status === colId)) return state
      return { ...state, columns: state.columns.filter((c) => c.id !== colId) }
    }
    case 'REORDER_COLUMNS':
      return { ...state, columns: action.payload }
    default:
      return state
  }
}

const STORAGE_KEY = 'dig-tracker-state'

interface PersistedState {
  tasks: Task[]
  columns?: Column[]
  nextTaskNumber?: number
  profile: UserProfile
  showSubtasksOnBoard: boolean
}

function loadState(): PersistedState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedState
    if (!Array.isArray(parsed.tasks)) return undefined
    // Migrate tasks missing the `number` field
    let maxNumber = 0
    const needsMigration = parsed.tasks.some((t) => t.number == null)
    if (needsMigration) {
      parsed.tasks = parsed.tasks.map((t, i) => {
        if (t.number == null) {
          const num = i + 1
          if (num > maxNumber) maxNumber = num
          return { ...t, number: num }
        }
        if (t.number > maxNumber) maxNumber = t.number
        return t
      })
      if (parsed.nextTaskNumber == null || parsed.nextTaskNumber <= maxNumber) {
        parsed.nextTaskNumber = maxNumber + 1
      }
    }
    return parsed
  } catch {
    return undefined
  }
}

function saveState(state: TaskState): void {
  try {
    const persisted: PersistedState = {
      tasks: state.tasks,
      columns: state.columns,
      nextTaskNumber: state.nextTaskNumber,
      profile: state.profile,
      showSubtasksOnBoard: state.showSubtasksOnBoard,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

const SAMPLE_TASKS: Task[] = [
  {
    id: 'task-1',
    number: 1,
    title: 'Design new landing page',
    description: 'Create a modern, responsive landing page with hero section, features grid, and testimonials.',
    status: 'in-progress',
    priority: 'high',
    assignee: 'Alice',
    createdBy: 'Alice',
    tags: ['design', 'frontend'],
    comments: [
      { id: 'c1', text: 'Started the wireframes, looking great!', author: 'Bob', createdAt: new Date(Date.now() - 86400000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    subtaskIds: ['task-1a', 'task-1b'],
  },
  {
    id: 'task-1a',
    number: 2,
    title: 'Create hero section mockup',
    description: 'Design the hero section with gradient background and CTA.',
    status: 'done',
    priority: 'medium',
    assignee: 'Alice',
    createdBy: 'Alice',
    tags: ['design'],
    comments: [],
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    completedAt: new Date(Date.now() - 86400000).toISOString(),
    parentId: 'task-1',
    subtaskIds: [],
  },
  {
    id: 'task-1b',
    number: 3,
    title: 'Build features grid component',
    description: 'Implement the responsive features grid.',
    status: 'in-progress',
    priority: 'medium',
    assignee: 'Alice',
    createdBy: 'Alice',
    tags: ['frontend'],
    comments: [],
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    parentId: 'task-1',
    subtaskIds: [],
  },
  {
    id: 'task-2',
    number: 4,
    title: 'Set up CI/CD pipeline',
    description: 'Configure GitHub Actions for automated testing and deployment.',
    status: 'todo',
    priority: 'medium',
    assignee: 'Charlie',
    createdBy: 'Bob',
    tags: ['devops'],
    comments: [],
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    updatedAt: new Date(Date.now() - 259200000).toISOString(),
    subtaskIds: [],
  },
  {
    id: 'task-3',
    number: 5,
    title: 'Fix authentication bug',
    description: 'Users are being logged out after 5 minutes. Need to fix token refresh logic.',
    status: 'review',
    priority: 'urgent',
    assignee: 'Diana',
    createdBy: 'Diana',
    tags: ['bug', 'auth'],
    comments: [
      { id: 'c2', text: 'Found the issue - refresh token was not being stored correctly.', author: 'Diana', createdAt: new Date(Date.now() - 7200000).toISOString() },
      { id: 'c3', text: 'PR is up for review!', author: 'Diana', createdAt: new Date(Date.now() - 3600000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 345600000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
    subtaskIds: [],
  },
  {
    id: 'task-4',
    number: 6,
    title: 'Write API documentation',
    description: 'Document all REST API endpoints with examples using OpenAPI spec.',
    status: 'backlog',
    priority: 'low',
    assignee: '',
    createdBy: 'Charlie',
    tags: ['docs'],
    comments: [],
    createdAt: new Date(Date.now() - 432000000).toISOString(),
    updatedAt: new Date(Date.now() - 432000000).toISOString(),
    subtaskIds: [],
  },
  {
    id: 'task-5',
    number: 7,
    title: 'Implement dark mode',
    description: 'Add dark mode toggle with system preference detection and local storage persistence.',
    status: 'done',
    priority: 'medium',
    assignee: 'Eve',
    createdBy: 'Eve',
    tags: ['feature', 'ui'],
    comments: [
      { id: 'c4', text: 'Shipped! Looks beautiful.', author: 'Alice', createdAt: new Date(Date.now() - 86400000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 604800000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    completedAt: new Date(Date.now() - 86400000).toISOString(),
    subtaskIds: [],
  },
  {
    id: 'task-6',
    number: 8,
    title: 'Optimize database queries',
    description: 'Profile slow queries and add proper indexes to improve performance.',
    status: 'todo',
    priority: 'high',
    assignee: 'Bob',
    createdBy: 'Bob',
    tags: ['performance', 'backend'],
    comments: [],
    createdAt: new Date(Date.now() - 518400000).toISOString(),
    updatedAt: new Date(Date.now() - 518400000).toISOString(),
    subtaskIds: [],
  },
]

interface TaskContextType {
  state: TaskState
  addTask: (task: Omit<Task, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'comments'>) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  deleteTask: (id: string) => void
  moveTask: (id: string, status: TaskStatus) => void
  reorderTask: (taskId: string, status: TaskStatus, targetIndex: number) => void
  addComment: (taskId: string, text: string, author: string) => void
  deleteComment: (taskId: string, commentId: string) => void
  setSearch: (query: string) => void
  setFilterPriority: (priority: TaskPriority | 'all') => void
  setView: (view: 'board' | 'reports' | 'profile') => void
  toggleSubtasksOnBoard: () => void
  updateProfile: (updates: Partial<UserProfile>) => void
  getFilteredTasks: (status: TaskStatus) => Task[]
  addColumn: (title: string, color: string, icon: string, afterColumnId?: string) => void
  removeColumn: (columnId: string) => void
  reorderColumns: (columns: Column[]) => void
}

const TaskContext = createContext<TaskContextType | null>(null)

export function TaskProvider({ children, initialTasks, initialProfile }: { children: ReactNode; initialTasks?: Task[]; initialProfile?: Partial<UserProfile> }) {
  const saved = initialTasks ? undefined : loadState()
  const tasks = initialTasks ?? saved?.tasks ?? SAMPLE_TASKS
  const defaultNextNumber = tasks.length > 0
    ? Math.max(...tasks.map((t) => t.number ?? 0)) + 1
    : 1
  const [state, dispatch] = useReducer(taskReducer, {
    tasks,
    columns: saved?.columns ?? DEFAULT_COLUMNS,
    nextTaskNumber: saved?.nextTaskNumber ?? defaultNextNumber,
    searchQuery: '',
    filterPriority: 'all',
    currentView: 'board',
    showSubtasksOnBoard: saved?.showSubtasksOnBoard ?? false,
    profile: saved?.profile ?? {
      username: '',
      email: '',
      displayName: '',
      avatarColor: '#6366f1',
      ...initialProfile,
    },
  })

  useEffect(() => {
    saveState(state)
  }, [state])

  const addTask = useCallback(
    (task: Omit<Task, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'comments'>) =>
      dispatch({ type: 'ADD_TASK', payload: task }),
    []
  )
  const updateTask = useCallback(
    (id: string, updates: Partial<Task>) =>
      dispatch({ type: 'UPDATE_TASK', payload: { id, updates } }),
    []
  )
  const deleteTask = useCallback(
    (id: string) => dispatch({ type: 'DELETE_TASK', payload: id }),
    []
  )
  const moveTask = useCallback(
    (id: string, status: TaskStatus) =>
      dispatch({ type: 'MOVE_TASK', payload: { id, status } }),
    []
  )
  const reorderTask = useCallback(
    (taskId: string, status: TaskStatus, targetIndex: number) =>
      dispatch({ type: 'REORDER_TASK', payload: { taskId, status, targetIndex } }),
    []
  )
  const addComment = useCallback(
    (taskId: string, text: string, author: string) =>
      dispatch({ type: 'ADD_COMMENT', payload: { taskId, text, author } }),
    []
  )
  const deleteComment = useCallback(
    (taskId: string, commentId: string) =>
      dispatch({ type: 'DELETE_COMMENT', payload: { taskId, commentId } }),
    []
  )
  const setSearch = useCallback(
    (query: string) => dispatch({ type: 'SET_SEARCH', payload: query }),
    []
  )
  const setFilterPriority = useCallback(
    (priority: TaskPriority | 'all') =>
      dispatch({ type: 'SET_FILTER_PRIORITY', payload: priority }),
    []
  )
  const setView = useCallback(
    (view: 'board' | 'reports' | 'profile') => dispatch({ type: 'SET_VIEW', payload: view }),
    []
  )
  const toggleSubtasksOnBoard = useCallback(
    () => dispatch({ type: 'TOGGLE_SUBTASKS_ON_BOARD' }),
    []
  )
  const updateProfile = useCallback(
    (updates: Partial<UserProfile>) => dispatch({ type: 'UPDATE_PROFILE', payload: updates }),
    []
  )
  const addColumn = useCallback(
    (title: string, color: string, icon: string, afterColumnId?: string) =>
      dispatch({ type: 'ADD_COLUMN', payload: { title, color, icon, afterColumnId } }),
    []
  )
  const removeColumn = useCallback(
    (columnId: string) => dispatch({ type: 'REMOVE_COLUMN', payload: columnId }),
    []
  )
  const reorderColumns = useCallback(
    (columns: Column[]) => dispatch({ type: 'REORDER_COLUMNS', payload: columns }),
    []
  )

  const getFilteredTasks = useCallback(
    (status: TaskStatus): Task[] => {
      return state.tasks.filter((task) => {
        if (task.status !== status) return false
        // Only show subtasks on board when toggle is on
        if (task.parentId && !state.showSubtasksOnBoard) return false
        if (state.searchQuery) {
          const q = state.searchQuery.toLowerCase()
          const taskKey = formatTaskKey(task.number).toLowerCase()
          if (
            !task.title.toLowerCase().includes(q) &&
            !task.description.toLowerCase().includes(q) &&
            !taskKey.includes(q)
          )
            return false
        }
        if (state.filterPriority !== 'all' && task.priority !== state.filterPriority)
          return false
        return true
      })
    },
    [state.tasks, state.searchQuery, state.filterPriority, state.showSubtasksOnBoard]
  )

  return (
    <TaskContext.Provider
      value={{
        state,
        addTask,
        updateTask,
        deleteTask,
        moveTask,
        reorderTask,
        addComment,
        deleteComment,
        setSearch,
        setFilterPriority,
        setView,
        toggleSubtasksOnBoard,
        updateProfile,
        getFilteredTasks,
        addColumn,
        removeColumn,
        reorderColumns,
      }}
    >
      {children}
    </TaskContext.Provider>
  )
}

export function useTaskContext(): TaskContextType {
  const context = useContext(TaskContext)
  if (!context) {
    throw new Error('useTaskContext must be used within a TaskProvider')
  }
  return context
}
