import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Task, TaskStatus, TaskPriority, ValidationError } from '../types/index.ts'

export interface UserProfile {
  username: string
  email: string
  displayName: string
  avatarColor: string
}

interface TaskState {
  tasks: Task[]
  searchQuery: string
  filterPriority: TaskPriority | 'all'
  currentView: 'board' | 'reports' | 'profile'
  showSubtasksOnBoard: boolean
  profile: UserProfile
}

type TaskAction =
  | { type: 'ADD_TASK'; payload: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'comments'> }
  | { type: 'UPDATE_TASK'; payload: { id: string; updates: Partial<Task> } }
  | { type: 'DELETE_TASK'; payload: string }
  | { type: 'MOVE_TASK'; payload: { id: string; status: TaskStatus } }
  | { type: 'ADD_COMMENT'; payload: { taskId: string; text: string; author: string } }
  | { type: 'DELETE_COMMENT'; payload: { taskId: string; commentId: string } }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_FILTER_PRIORITY'; payload: TaskPriority | 'all' }
  | { type: 'SET_VIEW'; payload: 'board' | 'reports' | 'profile' }
  | { type: 'TOGGLE_SUBTASKS_ON_BOARD' }
  | { type: 'UPDATE_PROFILE'; payload: Partial<UserProfile> }

const now = () => new Date().toISOString()

function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case 'ADD_TASK': {
      const newId = uuidv4()
      const newTask: Task = {
        ...action.payload,
        id: newId,
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
      return { ...state, tasks }
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
    default:
      return state
  }
}

export function validateTask(task: {
  title?: string
  description?: string
}): ValidationError[] {
  const errors: ValidationError[] = []
  if (!task.title || task.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title is required' })
  } else if (task.title.trim().length < 3) {
    errors.push({ field: 'title', message: 'Title must be at least 3 characters' })
  } else if (task.title.trim().length > 100) {
    errors.push({ field: 'title', message: 'Title must be less than 100 characters' })
  }
  if (task.description && task.description.trim().length > 1000) {
    errors.push({ field: 'description', message: 'Description must be less than 1000 characters' })
  }
  return errors
}

export function validateProfile(profile: { username?: string; email?: string; displayName?: string }): ValidationError[] {
  const errors: ValidationError[] = []
  if (!profile.username || profile.username.trim().length === 0) {
    errors.push({ field: 'username', message: 'Username is required' })
  } else if (profile.username.trim().length < 2) {
    errors.push({ field: 'username', message: 'Username must be at least 2 characters' })
  } else if (profile.username.trim().length > 30) {
    errors.push({ field: 'username', message: 'Username must be less than 30 characters' })
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(profile.username.trim())) {
    errors.push({ field: 'username', message: 'Username can only contain letters, numbers, dots, hyphens, and underscores' })
  }
  if (!profile.email || profile.email.trim().length === 0) {
    errors.push({ field: 'email', message: 'Email is required' })
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
    errors.push({ field: 'email', message: 'Please enter a valid email address' })
  }
  if (profile.displayName && profile.displayName.trim().length > 50) {
    errors.push({ field: 'displayName', message: 'Display name must be less than 50 characters' })
  }
  return errors
}

export function validateComment(text: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!text || text.trim().length === 0) {
    errors.push({ field: 'text', message: 'Comment text is required' })
  } else if (text.trim().length > 500) {
    errors.push({ field: 'text', message: 'Comment must be less than 500 characters' })
  }
  return errors
}

const SAMPLE_TASKS: Task[] = [
  {
    id: 'task-1',
    title: 'Design new landing page',
    description: 'Create a modern, responsive landing page with hero section, features grid, and testimonials.',
    status: 'in-progress',
    priority: 'high',
    assignee: 'Alice',
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
    title: 'Create hero section mockup',
    description: 'Design the hero section with gradient background and CTA.',
    status: 'done',
    priority: 'medium',
    assignee: 'Alice',
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
    title: 'Build features grid component',
    description: 'Implement the responsive features grid.',
    status: 'in-progress',
    priority: 'medium',
    assignee: 'Alice',
    tags: ['frontend'],
    comments: [],
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    parentId: 'task-1',
    subtaskIds: [],
  },
  {
    id: 'task-2',
    title: 'Set up CI/CD pipeline',
    description: 'Configure GitHub Actions for automated testing and deployment.',
    status: 'todo',
    priority: 'medium',
    assignee: 'Charlie',
    tags: ['devops'],
    comments: [],
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    updatedAt: new Date(Date.now() - 259200000).toISOString(),
    subtaskIds: [],
  },
  {
    id: 'task-3',
    title: 'Fix authentication bug',
    description: 'Users are being logged out after 5 minutes. Need to fix token refresh logic.',
    status: 'review',
    priority: 'urgent',
    assignee: 'Diana',
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
    title: 'Write API documentation',
    description: 'Document all REST API endpoints with examples using OpenAPI spec.',
    status: 'backlog',
    priority: 'low',
    assignee: '',
    tags: ['docs'],
    comments: [],
    createdAt: new Date(Date.now() - 432000000).toISOString(),
    updatedAt: new Date(Date.now() - 432000000).toISOString(),
    subtaskIds: [],
  },
  {
    id: 'task-5',
    title: 'Implement dark mode',
    description: 'Add dark mode toggle with system preference detection and local storage persistence.',
    status: 'done',
    priority: 'medium',
    assignee: 'Eve',
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
    title: 'Optimize database queries',
    description: 'Profile slow queries and add proper indexes to improve performance.',
    status: 'todo',
    priority: 'high',
    assignee: 'Bob',
    tags: ['performance', 'backend'],
    comments: [],
    createdAt: new Date(Date.now() - 518400000).toISOString(),
    updatedAt: new Date(Date.now() - 518400000).toISOString(),
    subtaskIds: [],
  },
]

interface TaskContextType {
  state: TaskState
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'comments'>) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  deleteTask: (id: string) => void
  moveTask: (id: string, status: TaskStatus) => void
  addComment: (taskId: string, text: string, author: string) => void
  deleteComment: (taskId: string, commentId: string) => void
  setSearch: (query: string) => void
  setFilterPriority: (priority: TaskPriority | 'all') => void
  setView: (view: 'board' | 'reports' | 'profile') => void
  toggleSubtasksOnBoard: () => void
  updateProfile: (updates: Partial<UserProfile>) => void
  getFilteredTasks: (status: TaskStatus) => Task[]
}

const TaskContext = createContext<TaskContextType | null>(null)

export function TaskProvider({ children, initialTasks }: { children: ReactNode; initialTasks?: Task[] }) {
  const [state, dispatch] = useReducer(taskReducer, {
    tasks: initialTasks ?? SAMPLE_TASKS,
    searchQuery: '',
    filterPriority: 'all',
    currentView: 'board',
    showSubtasksOnBoard: false,
    profile: {
      username: '',
      email: '',
      displayName: '',
      avatarColor: '#6366f1',
    },
  })

  const addTask = useCallback(
    (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'comments'>) =>
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

  const getFilteredTasks = useCallback(
    (status: TaskStatus): Task[] => {
      return state.tasks.filter((task) => {
        if (task.status !== status) return false
        // Only show subtasks on board when toggle is on
        if (task.parentId && !state.showSubtasksOnBoard) return false
        if (
          state.searchQuery &&
          !task.title.toLowerCase().includes(state.searchQuery.toLowerCase()) &&
          !task.description.toLowerCase().includes(state.searchQuery.toLowerCase())
        )
          return false
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
        addComment,
        deleteComment,
        setSearch,
        setFilterPriority,
        setView,
        toggleSubtasksOnBoard,
        updateProfile,
        getFilteredTasks,
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
