import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { Task, TaskStatus, TaskPriority, TaskComment, Column } from '../types/index.ts'
import { DEFAULT_COLUMNS, PROTECTED_COLUMN_IDS, mapTask, mapColumn } from '../types/index.ts'
import { formatTaskKey } from './taskUtils.ts'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './AuthContext.tsx'

// ============================================================
// State
// ============================================================

interface MemberProfile {
  display_name: string
  avatar_color: string
}

interface TaskState {
  tasks: Task[]
  columns: Column[]
  commentsByTask: Record<string, TaskComment[]>
  memberProfiles: Record<string, MemberProfile>
  boardId: string | null
  loading: boolean
  error: string | null
  toast: string | null
  searchQuery: string
  filterPriority: TaskPriority | 'all'
  currentView: 'board' | 'reports' | 'profile'
  showSubtasksOnBoard: boolean
}

// ============================================================
// Actions
// ============================================================

type TaskAction =
  | { type: 'SET_INITIAL_DATA'; payload: { boardId: string; tasks: Task[]; columns: Column[]; comments: TaskComment[]; memberProfiles: Record<string, MemberProfile> } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_TOAST'; payload: string | null }
  | { type: 'REALTIME_TASK_INSERT'; payload: Task }
  | { type: 'REALTIME_TASK_UPDATE'; payload: Task }
  | { type: 'REALTIME_TASK_DELETE'; payload: { id: string } }
  | { type: 'REALTIME_COMMENT_INSERT'; payload: TaskComment }
  | { type: 'REALTIME_COMMENT_DELETE'; payload: { id: string; task_id: string } }
  | { type: 'REALTIME_COLUMN_INSERT'; payload: Column }
  | { type: 'REALTIME_COLUMN_UPDATE'; payload: Column }
  | { type: 'REALTIME_COLUMN_DELETE'; payload: { slug: string } }
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_FILTER_PRIORITY'; payload: TaskPriority | 'all' }
  | { type: 'SET_VIEW'; payload: 'board' | 'reports' | 'profile' }
  | { type: 'TOGGLE_SUBTASKS_ON_BOARD' }

function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case 'SET_INITIAL_DATA': {
      const commentsByTask: Record<string, TaskComment[]> = {}
      for (const c of action.payload.comments) {
        if (!commentsByTask[c.task_id]) commentsByTask[c.task_id] = []
        commentsByTask[c.task_id].push(c)
      }
      return {
        ...state,
        boardId: action.payload.boardId,
        tasks: action.payload.tasks,
        columns: action.payload.columns.length > 0 ? action.payload.columns : DEFAULT_COLUMNS,
        commentsByTask,
        memberProfiles: action.payload.memberProfiles,
        loading: false,
        error: null,
      }
    }
    case 'SET_LOADING':
      return { ...state, loading: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false }
    case 'SET_TOAST':
      return { ...state, toast: action.payload }

    // Realtime: tasks
    case 'REALTIME_TASK_INSERT':
      if (state.tasks.some((t) => t.id === action.payload.id)) return state
      return { ...state, tasks: [...state.tasks, action.payload] }
    case 'REALTIME_TASK_UPDATE':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.payload.id ? action.payload : t)),
      }
    case 'REALTIME_TASK_DELETE':
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== action.payload.id),
      }

    // Realtime: comments
    case 'REALTIME_COMMENT_INSERT': {
      const taskId = action.payload.task_id
      const existing = state.commentsByTask[taskId] ?? []
      if (existing.some((c) => c.id === action.payload.id)) return state
      return {
        ...state,
        commentsByTask: {
          ...state.commentsByTask,
          [taskId]: [...existing, action.payload],
        },
      }
    }
    case 'REALTIME_COMMENT_DELETE': {
      const taskId = action.payload.task_id
      const existing = state.commentsByTask[taskId] ?? []
      return {
        ...state,
        commentsByTask: {
          ...state.commentsByTask,
          [taskId]: existing.filter((c) => c.id !== action.payload.id),
        },
      }
    }

    // Realtime: columns
    case 'REALTIME_COLUMN_INSERT': {
      if (state.columns.some((c) => c.slug === action.payload.slug)) return state
      const cols = [...state.columns, action.payload].sort((a, b) => a.position - b.position)
      return { ...state, columns: cols }
    }
    case 'REALTIME_COLUMN_UPDATE': {
      const cols = state.columns
        .map((c) => (c.slug === action.payload.slug ? action.payload : c))
        .sort((a, b) => a.position - b.position)
      return { ...state, columns: cols }
    }
    case 'REALTIME_COLUMN_DELETE':
      return { ...state, columns: state.columns.filter((c) => c.slug !== action.payload.slug) }

    // Local UI state
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.payload }
    case 'SET_FILTER_PRIORITY':
      return { ...state, filterPriority: action.payload }
    case 'SET_VIEW':
      return { ...state, currentView: action.payload }
    case 'TOGGLE_SUBTASKS_ON_BOARD':
      return { ...state, showSubtasksOnBoard: !state.showSubtasksOnBoard }
    default:
      return state
  }
}

// ============================================================
// Context
// ============================================================

interface TaskContextType {
  state: TaskState
  addTask: (task: {
    title: string
    description: string
    status: TaskStatus
    priority: TaskPriority
    assignee: string
    createdBy: string
    tags: string[]
    parentId?: string
    subtaskIds: string[]
  }) => Promise<void>
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  moveTask: (id: string, status: TaskStatus) => Promise<void>
  reorderTask: (taskId: string, status: TaskStatus, targetIndex: number) => Promise<void>
  addComment: (taskId: string, text: string, author: string) => Promise<void>
  deleteComment: (taskId: string, commentId: string) => Promise<void>
  setSearch: (query: string) => void
  setFilterPriority: (priority: TaskPriority | 'all') => void
  setView: (view: 'board' | 'reports' | 'profile') => void
  toggleSubtasksOnBoard: () => void
  getFilteredTasks: (status: TaskStatus) => Task[]
  getCommentCount: (taskId: string) => number
  getComments: (taskId: string) => TaskComment[]
  clearToast: () => void
  addColumn: (title: string, color: string, icon: string, afterColumnId?: string) => Promise<void>
  removeColumn: (columnId: string) => Promise<void>
  reorderColumns: (columns: Column[]) => Promise<void>
}

const TaskContext = createContext<TaskContextType | null>(null)

// ============================================================
// Provider
// ============================================================

const UI_STORAGE_KEY = 'dig-tracker-ui'

function loadUiPrefs(): { showSubtasksOnBoard: boolean } {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { showSubtasksOnBoard: false }
}

function saveUiPrefs(prefs: { showSubtasksOnBoard: boolean }) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const { user, profile: authProfile } = useAuth()
  const uiPrefs = loadUiPrefs()

  const [state, dispatch] = useReducer(taskReducer, {
    tasks: [],
    columns: DEFAULT_COLUMNS,
    commentsByTask: {},
    memberProfiles: {},
    boardId: null,
    loading: true,
    error: null,
    toast: null,
    searchQuery: '',
    filterPriority: 'all',
    currentView: 'board',
    showSubtasksOnBoard: uiPrefs.showSubtasksOnBoard,
  })

  const boardIdRef = useRef<string | null>(null)
  const initInFlightRef = useRef(false)

  // Save UI prefs when they change
  useEffect(() => {
    saveUiPrefs({ showSubtasksOnBoard: state.showSubtasksOnBoard })
  }, [state.showSubtasksOnBoard])

  // ---- Initial data fetch ----
  useEffect(() => {
    if (!user) return

    async function init() {
      if (initInFlightRef.current) {
        console.log('[board] init: skipping, already in flight')
        return
      }
      initInFlightRef.current = true
      console.log('[board] init: starting for user', user!.id)
      dispatch({ type: 'SET_LOADING', payload: true })

      try {
        // Find all boards the user is a member of
        const { data: memberships } = await supabase
          .from('board_members')
          .select('board_id, role, joined_at')
          .eq('user_id', user!.id)
          .order('joined_at', { ascending: true })

        let boardId: string

        if (!memberships || memberships.length === 0) {
          // Create a default board for this user
          const { data, error } = await supabase.rpc('create_default_board', { p_user_id: user!.id })
          if (error || !data) {
            dispatch({ type: 'SET_ERROR', payload: error?.message ?? 'Failed to create board' })
            return
          }
          boardId = data as string
          console.log('[board] created default board:', boardId)
        } else {
          // Prefer shared board (editor role) over auto-created (owner role), fallback to oldest
          const shared = memberships.find((m) => m.role === 'editor')
          boardId = shared ? shared.board_id : memberships[0].board_id
          console.log('[board] using existing board:', boardId, shared ? '(shared)' : '(owned)')
        }

        boardIdRef.current = boardId

        // Fetch columns, tasks, comments, and board member IDs in parallel
        const [colRes, taskRes, commentRes, membersRes] = await Promise.all([
          supabase.from('columns').select('*').eq('board_id', boardId).order('position'),
          supabase.from('tasks').select('*').eq('board_id', boardId).order('position'),
          supabase.from('task_comments').select('*').eq('board_id', boardId).order('created_at'),
          supabase.from('board_members').select('user_id').eq('board_id', boardId),
        ])

        if (colRes.error || taskRes.error || commentRes.error) {
          dispatch({ type: 'SET_ERROR', payload: colRes.error?.message ?? taskRes.error?.message ?? commentRes.error?.message ?? 'Fetch error' })
          return
        }

        // Fetch member profiles
        const memberProfiles: Record<string, MemberProfile> = {}
        const memberIds = (membersRes.data ?? []).map((m) => (m as Record<string, unknown>).user_id as string)
        if (memberIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, display_name, avatar_color')
            .in('id', memberIds)
          for (const p of (profiles ?? []) as Array<Record<string, unknown>>) {
            memberProfiles[p.id as string] = {
              display_name: (p.display_name as string) ?? '',
              avatar_color: (p.avatar_color as string) ?? '#6366f1',
            }
          }
        }

        const columns = (colRes.data ?? []).map((r) => mapColumn(r as Record<string, unknown>))
        const tasks = (taskRes.data ?? []).map((r) => mapTask(r as Record<string, unknown>))
        const comments = (commentRes.data ?? []) as TaskComment[]

        console.log('[board] loaded:', { tasks: tasks.length, columns: columns.length, comments: comments.length, members: Object.keys(memberProfiles).length })
        dispatch({ type: 'SET_INITIAL_DATA', payload: { boardId, tasks, columns, comments, memberProfiles } })
      } finally {
        initInFlightRef.current = false
      }
    }

    init()
  }, [user])

  // ---- Realtime subscriptions ----
  useEffect(() => {
    const boardId = boardIdRef.current
    if (!boardId) return

    const channel = supabase
      .channel(`board-${boardId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_TASK_INSERT', payload: mapTask(payload.new as Record<string, unknown>) }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_TASK_UPDATE', payload: mapTask(payload.new as Record<string, unknown>) }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_TASK_DELETE', payload: { id: (payload.old as Record<string, unknown>).id as string } }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_COMMENT_INSERT', payload: payload.new as TaskComment }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_comments', filter: `board_id=eq.${boardId}` },
        (payload) => {
          const old = payload.old as Record<string, unknown>
          dispatch({ type: 'REALTIME_COMMENT_DELETE', payload: { id: old.id as string, task_id: old.task_id as string } })
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'columns', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_COLUMN_INSERT', payload: mapColumn(payload.new as Record<string, unknown>) }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'columns', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_COLUMN_UPDATE', payload: mapColumn(payload.new as Record<string, unknown>) }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'columns', filter: `board_id=eq.${boardId}` },
        (payload) => dispatch({ type: 'REALTIME_COLUMN_DELETE', payload: { slug: (payload.old as Record<string, unknown>).slug as string } }))
      .subscribe((status) => {
        console.log('[realtime] subscription status:', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [state.boardId])

  // ---- Actions (all async, write to Supabase) ----

  const addTask = useCallback(
    async (task: {
      title: string; description: string; status: TaskStatus; priority: TaskPriority
      assignee: string; createdBy: string; tags: string[]; parentId?: string; subtaskIds: string[]
    }) => {
      const boardId = boardIdRef.current
      if (!boardId) return

      // Calculate position: put at end of column
      const tasksInColumn = state.tasks.filter((t) => t.status === task.status)
      const maxPosition = tasksInColumn.length > 0 ? Math.max(...tasksInColumn.map((t) => t.position)) : 0
      const position = maxPosition + 1000

      // Retry loop: handles concurrent task creation race on number unique constraint
      const MAX_RETRIES = 3
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const { data: nextNum } = await supabase.rpc('next_task_number', { p_board_id: boardId })

        const { error } = await supabase.from('tasks').insert({
          board_id: boardId,
          number: nextNum ?? 1,
          title: task.title,
          description: task.description,
          column_slug: task.status,
          priority: task.priority,
          position,
          assignee_name: task.assignee,
          created_by_name: task.createdBy,
          created_by_id: user?.id ?? null,
          assignee_id: null,
          tags: task.tags,
          parent_id: task.parentId ?? null,
          subtask_ids: task.subtaskIds ?? [],
        })

        if (!error) return // success
        if (error.code === '23505' && attempt < MAX_RETRIES - 1) {
          console.log('[board] addTask: number conflict, retrying...', attempt + 1)
          continue
        }
        console.log('[board] addTask error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
        return
      }
    },
    [state.tasks, user]
  )

  const updateTask = useCallback(
    async (id: string, updates: Partial<Task>) => {
      // Map compat fields to DB fields
      const dbUpdates: Record<string, unknown> = {}
      if (updates.title !== undefined) dbUpdates.title = updates.title
      if (updates.description !== undefined) dbUpdates.description = updates.description
      if (updates.priority !== undefined) dbUpdates.priority = updates.priority
      if (updates.assignee !== undefined || updates.assignee_name !== undefined)
        dbUpdates.assignee_name = updates.assignee ?? updates.assignee_name
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags
      if (updates.status !== undefined || updates.column_slug !== undefined)
        dbUpdates.column_slug = updates.status ?? updates.column_slug
      if (updates.completed_at !== undefined || updates.completedAt !== undefined)
        dbUpdates.completed_at = updates.completed_at ?? updates.completedAt ?? null
      if (updates.subtask_ids !== undefined || updates.subtaskIds !== undefined)
        dbUpdates.subtask_ids = updates.subtask_ids ?? updates.subtaskIds

      const { error } = await supabase.from('tasks').update(dbUpdates).eq('id', id)
      if (error) {
        console.log('[board] updateTask error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    []
  )

  const deleteTask = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) {
        console.log('[board] deleteTask error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    []
  )

  const moveTask = useCallback(
    async (id: string, status: TaskStatus) => {
      const task = state.tasks.find((t) => t.id === id)
      const completedAt = status === 'done' ? (task?.completed_at ?? new Date().toISOString()) : null

      const tasksInColumn = state.tasks.filter((t) => t.status === status && t.id !== id)
      const maxPosition = tasksInColumn.length > 0 ? Math.max(...tasksInColumn.map((t) => t.position)) : 0
      const position = maxPosition + 1000

      const { error } = await supabase
        .from('tasks')
        .update({ column_slug: status, position, completed_at: completedAt })
        .eq('id', id)
      if (error) {
        console.log('[board] moveTask error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    [state.tasks]
  )

  const reorderTask = useCallback(
    async (taskId: string, status: TaskStatus, targetIndex: number) => {
      const tasksInColumn = state.tasks
        .filter((t) => t.status === status && t.id !== taskId)
        .sort((a, b) => a.position - b.position)

      let newPosition: number
      const clamped = Math.min(targetIndex, tasksInColumn.length)

      if (tasksInColumn.length === 0) {
        newPosition = 1000
      } else if (clamped === 0) {
        newPosition = tasksInColumn[0].position - 1000
      } else if (clamped >= tasksInColumn.length) {
        newPosition = tasksInColumn[tasksInColumn.length - 1].position + 1000
      } else {
        newPosition = Math.floor((tasksInColumn[clamped - 1].position + tasksInColumn[clamped].position) / 2)
      }

      const task = state.tasks.find((t) => t.id === taskId)
      const completedAt = status === 'done' ? (task?.completed_at ?? new Date().toISOString()) : null

      const { error } = await supabase
        .from('tasks')
        .update({ column_slug: status, position: newPosition, completed_at: completedAt })
        .eq('id', taskId)
      if (error) {
        console.log('[board] reorderTask error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    [state.tasks]
  )

  const addComment = useCallback(
    async (taskId: string, text: string, author: string) => {
      const boardId = boardIdRef.current
      if (!boardId) return
      const { error } = await supabase.from('task_comments').insert({
        task_id: taskId,
        board_id: boardId,
        author_id: user?.id ?? null,
        author_name: author,
        text,
      })
      if (error) {
        console.log('[board] addComment error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    [user]
  )

  const deleteComment = useCallback(
    async (_taskId: string, commentId: string) => {
      const { error } = await supabase.from('task_comments').delete().eq('id', commentId)
      if (error) {
        console.log('[board] deleteComment error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    []
  )

  const setSearch = useCallback(
    (query: string) => dispatch({ type: 'SET_SEARCH', payload: query }),
    []
  )
  const setFilterPriority = useCallback(
    (priority: TaskPriority | 'all') => dispatch({ type: 'SET_FILTER_PRIORITY', payload: priority }),
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
  const clearToast = useCallback(
    () => dispatch({ type: 'SET_TOAST', payload: null }),
    []
  )

  const getFilteredTasks = useCallback(
    (status: TaskStatus): Task[] => {
      return state.tasks
        .filter((task) => {
          if (task.status !== status) return false
          if (task.parentId && !state.showSubtasksOnBoard) return false
          if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase()
            const taskKey = formatTaskKey(task.number).toLowerCase()
            if (
              !task.title.toLowerCase().includes(q) &&
              !task.description.toLowerCase().includes(q) &&
              !taskKey.includes(q)
            ) return false
          }
          if (state.filterPriority !== 'all' && task.priority !== state.filterPriority)
            return false
          return true
        })
        .sort((a, b) => a.position - b.position)
    },
    [state.tasks, state.searchQuery, state.filterPriority, state.showSubtasksOnBoard]
  )

  const getCommentCount = useCallback(
    (taskId: string): number => (state.commentsByTask[taskId] ?? []).length,
    [state.commentsByTask]
  )

  const getComments = useCallback(
    (taskId: string): TaskComment[] => state.commentsByTask[taskId] ?? [],
    [state.commentsByTask]
  )

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  const addColumn = useCallback(
    async (title: string, color: string, icon: string, afterColumnId?: string) => {
      const boardId = boardIdRef.current
      if (!boardId) return

      const slug = slugify(title)
      if (!slug || state.columns.some((c) => c.slug === slug)) return

      let position: number
      if (afterColumnId) {
        const afterCol = state.columns.find((c) => c.slug === afterColumnId)
        const afterIdx = state.columns.indexOf(afterCol!)
        const nextCol = state.columns[afterIdx + 1]
        position = nextCol
          ? Math.floor((afterCol!.position + nextCol.position) / 2)
          : afterCol!.position + 1000
      } else {
        // Insert before Done
        const doneCol = state.columns.find((c) => c.slug === 'done')
        const doneIdx = state.columns.indexOf(doneCol!)
        const prevCol = state.columns[doneIdx - 1]
        position = prevCol && doneCol
          ? Math.floor((prevCol.position + doneCol.position) / 2)
          : (doneCol?.position ?? 4000) - 1000
      }

      const { error } = await supabase.from('columns').insert({
        board_id: boardId,
        slug,
        title: title.trim(),
        color,
        icon,
        position,
        is_protected: false,
      })
      if (error) {
        console.log('[board] addColumn error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    [state.columns]
  )

  const removeColumn = useCallback(
    async (columnId: string) => {
      if (PROTECTED_COLUMN_IDS.includes(columnId)) return
      if (state.tasks.some((t) => t.status === columnId)) return

      const col = state.columns.find((c) => c.slug === columnId)
      if (!col) return

      // Need to delete by board_id + slug since our id field is the slug
      const boardId = boardIdRef.current
      if (!boardId) return

      const { error } = await supabase
        .from('columns')
        .delete()
        .eq('board_id', boardId)
        .eq('slug', columnId)
      if (error) {
        console.log('[board] removeColumn error:', error.message)
        dispatch({ type: 'SET_TOAST', payload: error.message })
      }
    },
    [state.tasks, state.columns]
  )

  const reorderColumns = useCallback(
    async (columns: Column[]) => {
      const boardId = boardIdRef.current
      if (!boardId) return

      // Update positions for each column
      const updates = columns.map((col, i) => ({
        slug: col.slug,
        position: i * 1000,
      }))

      for (const u of updates) {
        await supabase
          .from('columns')
          .update({ position: u.position })
          .eq('board_id', boardId)
          .eq('slug', u.slug)
      }
    },
    []
  )

  // Expose profile as a compat object on state for components that read state.profile
  const compatProfile = authProfile
    ? {
        username: user?.email?.split('@')[0] ?? '',
        email: user?.email ?? '',
        displayName: authProfile.display_name,
        avatarColor: authProfile.avatar_color,
      }
    : { username: '', email: '', displayName: '', avatarColor: '#6366f1' }

  const stateWithProfile = { ...state, profile: compatProfile }

  return (
    <TaskContext.Provider
      value={{
        state: stateWithProfile as TaskState & { profile: typeof compatProfile },
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
        clearToast,
        getFilteredTasks,
        getCommentCount,
        getComments,
        addColumn,
        removeColumn,
        reorderColumns,
      }}
    >
      {state.loading ? (
        <div className="app-loading">
          <div className="loading-spinner" />
          <p>Loading board...</p>
        </div>
      ) : state.error ? (
        <div className="app-error">
          <p>Error: {state.error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : (
        children
      )}
    </TaskContext.Provider>
  )
}

// ============================================================
// Hook
// ============================================================

export function useTaskContext(): TaskContextType {
  const context = useContext(TaskContext)
  if (!context) {
    throw new Error('useTaskContext must be used within a TaskProvider')
  }
  return context
}
