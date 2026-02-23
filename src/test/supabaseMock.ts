import { vi } from 'vitest'

// In-memory stores for mock data
let mockTasks: Record<string, unknown>[] = []
let mockColumns: Record<string, unknown>[] = []
let mockComments: Record<string, unknown>[] = []
let mockBoardMembers: Record<string, unknown>[] = [
  { board_id: 'test-board', user_id: 'test-user' },
]
let mockUserProfiles: Record<string, unknown>[] = [
  { id: 'test-user', display_name: 'Test User', avatar_color: '#6366f1' },
]
let taskNumberCounter = 1

export function resetMockData() {
  mockTasks = []
  mockColumns = [
    { slug: 'backlog', board_id: 'test-board', title: 'Backlog', color: '#6b7280', icon: '📋', position: 0, is_protected: true },
    { slug: 'todo', board_id: 'test-board', title: 'To Do', color: '#3b82f6', icon: '📝', position: 1000, is_protected: false },
    { slug: 'in-progress', board_id: 'test-board', title: 'In Progress', color: '#f59e0b', icon: '⚡', position: 2000, is_protected: false },
    { slug: 'review', board_id: 'test-board', title: 'Review', color: '#8b5cf6', icon: '🔍', position: 3000, is_protected: false },
    { slug: 'done', board_id: 'test-board', title: 'Done', color: '#10b981', icon: '✅', position: 4000, is_protected: true },
  ]
  mockComments = []
  mockBoardMembers = [{ board_id: 'test-board', user_id: 'test-user' }]
  mockUserProfiles = [{ id: 'test-user', display_name: 'Test User', avatar_color: '#6366f1' }]
  taskNumberCounter = 1
}

export function setMockTasks(tasks: Record<string, unknown>[]) {
  mockTasks = [...tasks]
  if (tasks.length > 0) {
    const maxNum = Math.max(...tasks.map((t) => (t.number as number) ?? 0))
    taskNumberCounter = maxNum + 1
  }
}

export function setMockComments(comments: Record<string, unknown>[]) {
  mockComments = [...comments]
}

function getStore(table: string): Record<string, unknown>[] {
  switch (table) {
    case 'tasks': return mockTasks
    case 'columns': return mockColumns
    case 'task_comments': return mockComments
    case 'board_members': return mockBoardMembers
    case 'board_shares': return []
    case 'user_profiles': return mockUserProfiles
    default: return []
  }
}

function setStore(table: string, data: Record<string, unknown>[]) {
  switch (table) {
    case 'tasks': mockTasks = data; break
    case 'columns': mockColumns = data; break
    case 'task_comments': mockComments = data; break
  }
}

/**
 * Creates a chainable query builder that is also a "thenable"
 * so `await supabase.from('x').select('*').eq('f', 'v').order('pos')` works.
 */
function createChain(table: string) {
  const filters: Array<{ field: string; value: unknown }> = []
  let orderField: string | null = null
  let limitCount: number | null = null
  let isSingle = false
  let isInsert = false
  let insertData: Record<string, unknown>[] = []
  let isUpdate = false
  let updateData: Record<string, unknown> = {}
  let isDelete = false
  let isSelectAfterMutate = false

  function applyFilters(data: Record<string, unknown>[]) {
    let result = data
    for (const { field, value } of filters) {
      result = result.filter((r) => r[field] === value)
    }
    if (orderField) {
      result = [...result].sort((a, b) => (a[orderField!] as number) - (b[orderField!] as number))
    }
    if (limitCount) {
      result = result.slice(0, limitCount)
    }
    return result
  }

  function resolve(): { data: unknown; error: unknown } {
    if (isInsert) {
      const store = getStore(table)
      for (const row of insertData) {
        if (!row.id) row.id = crypto.randomUUID()
        store.push({ ...row })
      }
      if (isSingle) {
        return { data: insertData[0], error: null }
      }
      return { data: insertData, error: null }
    }
    if (isUpdate) {
      const store = getStore(table)
      for (let i = 0; i < store.length; i++) {
        let match = true
        for (const { field, value } of filters) {
          if (store[i][field] !== value) { match = false; break }
        }
        if (match) {
          store[i] = { ...store[i], ...updateData, updated_at: new Date().toISOString() }
        }
      }
      if (isSelectAfterMutate && isSingle) {
        const data = applyFilters(store)
        return { data: data[0] ?? null, error: null }
      }
      return { data: null, error: null }
    }
    if (isDelete) {
      const store = getStore(table)
      const remaining = store.filter((r) => {
        for (const { field, value } of filters) {
          if (r[field] !== value) return true
        }
        return false
      })
      setStore(table, remaining)
      return { data: null, error: null }
    }
    // Read query
    const data = applyFilters(getStore(table))
    if (isSingle) {
      if (data.length === 0) return { data: null, error: { code: 'PGRST116', message: 'Not found' } }
      return { data: data[0], error: null }
    }
    return { data, error: null }
  }

  // The chain object - all methods return `chain` so it stays thenable
  const chain: Record<string, unknown> = {
    select(_fields?: string) {
      if (isInsert || isUpdate) isSelectAfterMutate = true
      return chain
    },
    eq(field: string, value: unknown) {
      filters.push({ field, value })
      return chain
    },
    order(field: string) {
      orderField = field
      return chain
    },
    limit(n: number) {
      limitCount = n
      return chain
    },
    single() {
      isSingle = true
      return chain
    },
    insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
      isInsert = true
      insertData = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [{ ...rows }]
      return chain
    },
    update(data: Record<string, unknown>) {
      isUpdate = true
      updateData = data
      return chain
    },
    delete() {
      isDelete = true
      return chain
    },
    // Make the chain a "thenable" so `await chain` works
    then(
      onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      try {
        const result = resolve()
        return Promise.resolve(result).then(onFulfilled, onRejected)
      } catch (e) {
        if (onRejected) return Promise.reject(e).catch(onRejected)
        return Promise.reject(e)
      }
    },
  }

  return chain
}

export const mockSupabase = {
  from(table: string) {
    return createChain(table)
  },
  rpc(fn: string, _params?: Record<string, unknown>) {
    if (fn === 'create_default_board') {
      return Promise.resolve({ data: 'test-board', error: null })
    }
    if (fn === 'next_task_number') {
      const num = taskNumberCounter++
      return Promise.resolve({ data: num, error: null })
    }
    if (fn === 'accept_invite') {
      return Promise.resolve({ data: 'test-board', error: null })
    }
    return Promise.resolve({ data: null, error: null })
  },
  channel(_name: string) {
    return {
      on() { return this },
      subscribe() { return this },
    }
  },
  removeChannel() {
    return Promise.resolve()
  },
  auth: {
    getSession() {
      return Promise.resolve({
        data: {
          session: {
            user: { id: 'test-user', email: 'test@example.com' },
            access_token: 'test-token',
          },
        },
      })
    },
    onAuthStateChange(callback: (event: string, session: unknown) => void) {
      // Call immediately with a session
      setTimeout(() => {
        callback('SIGNED_IN', {
          user: { id: 'test-user', email: 'test@example.com' },
          access_token: 'test-token',
        })
      }, 0)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    },
    signInWithOtp() {
      return Promise.resolve({ error: null })
    },
    signOut() {
      return Promise.resolve({ error: null })
    },
  },
}
