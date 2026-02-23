import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '../context/AuthContext.tsx'
import { TaskProvider, useTaskContext } from '../context/TaskContext.tsx'
import { setMockTasks } from './supabaseMock.ts'
import type { Task } from '../types/index.ts'

function createTestTask(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'test-1',
    board_id: 'test-board',
    number: 1,
    title: 'Test Task',
    description: 'Test Description',
    column_slug: 'todo',
    priority: 'medium',
    position: 1000,
    assignee_name: 'Tester',
    created_by_name: 'Tester',
    created_by_id: 'test-user',
    assignee_id: null,
    tags: ['test'],
    parent_id: null,
    subtask_ids: [],
    due_date: null,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function TestComponent() {
  const { state, addTask, updateTask, deleteTask, moveTask, addComment, getFilteredTasks, getCommentCount, setSearch, setFilterPriority, addColumn, removeColumn } = useTaskContext()
  const todoTasks = getFilteredTasks('todo')
  const doneTasks = getFilteredTasks('done')

  return (
    <div>
      <div data-testid="task-count">{state.tasks.length}</div>
      <div data-testid="todo-count">{todoTasks.length}</div>
      <div data-testid="done-count">{doneTasks.length}</div>
      <div data-testid="column-count">{state.columns.length}</div>
      <div data-testid="search">{state.searchQuery}</div>
      <div data-testid="filter">{state.filterPriority}</div>
      <div data-testid="loading">{state.loading ? 'true' : 'false'}</div>
      <ul data-testid="column-list">
        {state.columns.map(c => (
          <li key={c.id} data-testid={`col-${c.id}`}>{c.title}</li>
        ))}
      </ul>
      <ul data-testid="task-list">
        {state.tasks.map((t: Task) => (
          <li key={t.id} data-testid={`task-${t.id}`}>
            {t.title} | {t.status} | {t.priority} | comments:{getCommentCount(t.id)} | parent:{t.parentId || 'none'}
          </li>
        ))}
      </ul>
      <button onClick={() => addTask({ title: 'New Task', description: 'Desc', status: 'todo', priority: 'high', assignee: 'Alice', createdBy: 'Alice', tags: ['new'], subtaskIds: [] })}>
        Add Task
      </button>
      <button onClick={() => addTask({ title: 'Subtask', description: 'Sub', status: 'todo', priority: 'low', assignee: '', createdBy: 'Tester', tags: [], parentId: 'test-1', subtaskIds: [] })}>
        Add Subtask
      </button>
      <button onClick={() => updateTask('test-1', { title: 'Updated Title' })}>
        Update Task
      </button>
      <button onClick={() => deleteTask('test-1')}>
        Delete Task
      </button>
      <button onClick={() => moveTask('test-1', 'done')}>
        Move to Done
      </button>
      <button onClick={() => addComment('test-1', 'A comment', 'Bob')}>
        Add Comment
      </button>
      <button onClick={() => setSearch('Updated')}>
        Search Updated
      </button>
      <button onClick={() => setFilterPriority('high')}>
        Filter High
      </button>
      <button onClick={() => setFilterPriority('all')}>
        Filter All
      </button>
      <button onClick={() => setSearch('')}>
        Clear Search
      </button>
      <button onClick={() => addColumn('QA', '#ec4899', '🧪')}>
        Add Column
      </button>
      <button onClick={() => addColumn('QA', '#ec4899', '🧪', 'backlog')}>
        Add Column After Backlog
      </button>
      <button onClick={() => removeColumn('review')}>
        Remove Review
      </button>
      <button onClick={() => removeColumn('backlog')}>
        Remove Backlog
      </button>
      <button onClick={() => removeColumn('done')}>
        Remove Done
      </button>
      <button onClick={() => removeColumn('todo')}>
        Remove Todo
      </button>
    </div>
  )
}

function renderWithProvider(initialTasks: Record<string, unknown>[] = [createTestTask()]) {
  setMockTasks(initialTasks)
  return render(
    <AuthProvider>
      <TaskProvider>
        <TestComponent />
      </TaskProvider>
    </AuthProvider>
  )
}

describe('TaskContext', () => {
  it('renders initial tasks after loading', async () => {
    renderWithProvider()
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('task-count').textContent).toBe('1')
    expect(screen.getByTestId('todo-count').textContent).toBe('1')
  })

  it('starts with 5 default columns', async () => {
    renderWithProvider()
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('column-count').textContent).toBe('5')
  })

  it('filters tasks by search query (local state)', async () => {
    const user = userEvent.setup()
    renderWithProvider([
      createTestTask({ id: 'a', number: 1, title: 'Alpha Task' }),
      createTestTask({ id: 'b', number: 2, title: 'Beta Task' }),
    ])
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await user.click(screen.getByText('Search Updated'))
    expect(screen.getByTestId('search').textContent).toBe('Updated')
  })

  it('filters tasks by priority (local state)', async () => {
    const user = userEvent.setup()
    renderWithProvider([
      createTestTask({ id: 'a', number: 1, title: 'High Priority', priority: 'high' }),
      createTestTask({ id: 'b', number: 2, title: 'Low Priority', priority: 'low' }),
    ])
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await user.click(screen.getByText('Filter High'))
    expect(screen.getByTestId('todo-count').textContent).toBe('1')
  })

  it('subtasks are not shown in filtered top-level results', async () => {
    renderWithProvider([
      createTestTask({ id: 'parent', number: 1, subtask_ids: ['child'] }),
      createTestTask({ id: 'child', number: 2, parent_id: 'parent', subtask_ids: [] }),
    ])
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    expect(screen.getByTestId('todo-count').textContent).toBe('1')
  })

  it('clears search', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await user.click(screen.getByText('Search Updated'))
    expect(screen.getByTestId('search').textContent).toBe('Updated')
    await user.click(screen.getByText('Clear Search'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('resets filter to all', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await user.click(screen.getByText('Filter High'))
    expect(screen.getByTestId('filter').textContent).toBe('high')
    await user.click(screen.getByText('Filter All'))
    expect(screen.getByTestId('filter').textContent).toBe('all')
  })

  it('prevents removing protected column: backlog', async () => {
    const user = userEvent.setup()
    renderWithProvider([])
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await user.click(screen.getByText('Remove Backlog'))
    expect(screen.getByTestId('column-count').textContent).toBe('5')
  })

  it('prevents removing protected column: done', async () => {
    const user = userEvent.setup()
    renderWithProvider([])
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false')
    })
    await user.click(screen.getByText('Remove Done'))
    expect(screen.getByTestId('column-count').textContent).toBe('5')
  })
})
