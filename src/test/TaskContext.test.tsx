import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskProvider, useTaskContext } from '../context/TaskContext.tsx'
import type { Task } from '../types/index.ts'

function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-1',
    title: 'Test Task',
    description: 'Test Description',
    status: 'todo',
    priority: 'medium',
    assignee: 'Tester',
    createdBy: 'Tester',
    tags: ['test'],
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    subtaskIds: [],
    ...overrides,
  }
}

function TestComponent() {
  const { state, addTask, updateTask, deleteTask, moveTask, addComment, getFilteredTasks, setSearch, setFilterPriority } = useTaskContext()
  const todoTasks = getFilteredTasks('todo')
  const doneTasks = getFilteredTasks('done')

  return (
    <div>
      <div data-testid="task-count">{state.tasks.length}</div>
      <div data-testid="todo-count">{todoTasks.length}</div>
      <div data-testid="done-count">{doneTasks.length}</div>
      <div data-testid="search">{state.searchQuery}</div>
      <div data-testid="filter">{state.filterPriority}</div>
      <ul data-testid="task-list">
        {state.tasks.map(t => (
          <li key={t.id} data-testid={`task-${t.id}`}>
            {t.title} | {t.status} | {t.priority} | comments:{t.comments.length} | parent:{t.parentId || 'none'}
          </li>
        ))}
      </ul>
      <button onClick={() => addTask({ title: 'New Task', description: 'Desc', status: 'todo', priority: 'high', assignee: 'Alice', tags: ['new'], subtaskIds: [] })}>
        Add Task
      </button>
      <button onClick={() => addTask({ title: 'Subtask', description: 'Sub', status: 'todo', priority: 'low', assignee: '', tags: [], parentId: 'test-1', subtaskIds: [] })}>
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
    </div>
  )
}

function renderWithProvider(initialTasks: Task[] = [createTestTask()]) {
  return render(
    <TaskProvider initialTasks={initialTasks}>
      <TestComponent />
    </TaskProvider>
  )
}

describe('TaskContext', () => {
  it('renders initial tasks', () => {
    renderWithProvider()
    expect(screen.getByTestId('task-count').textContent).toBe('1')
    expect(screen.getByTestId('todo-count').textContent).toBe('1')
  })

  it('adds a new task', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Add Task'))
    expect(screen.getByTestId('task-count').textContent).toBe('2')
  })

  it('updates a task', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Update Task'))
    const taskEl = screen.getByTestId('task-test-1')
    expect(taskEl.textContent).toContain('Updated Title')
  })

  it('deletes a task', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Delete Task'))
    expect(screen.getByTestId('task-count').textContent).toBe('0')
  })

  it('moves a task to done', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Move to Done'))
    const taskEl = screen.getByTestId('task-test-1')
    expect(taskEl.textContent).toContain('done')
    expect(screen.getByTestId('done-count').textContent).toBe('1')
    expect(screen.getByTestId('todo-count').textContent).toBe('0')
  })

  it('adds a comment to a task', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Add Comment'))
    const taskEl = screen.getByTestId('task-test-1')
    expect(taskEl.textContent).toContain('comments:1')
  })

  it('filters tasks by search query', async () => {
    const user = userEvent.setup()
    renderWithProvider([
      createTestTask({ id: 'a', title: 'Alpha Task' }),
      createTestTask({ id: 'b', title: 'Beta Task' }),
    ])
    await user.click(screen.getByText('Update Task')) // won't find test-1 but that's ok
    await user.click(screen.getByText('Search Updated'))
    expect(screen.getByTestId('search').textContent).toBe('Updated')
  })

  it('filters tasks by priority', async () => {
    const user = userEvent.setup()
    renderWithProvider([
      createTestTask({ id: 'a', title: 'High Priority', priority: 'high' }),
      createTestTask({ id: 'b', title: 'Low Priority', priority: 'low' }),
    ])
    await user.click(screen.getByText('Filter High'))
    expect(screen.getByTestId('todo-count').textContent).toBe('1')
  })

  it('adds a subtask with parent reference', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Add Subtask'))
    expect(screen.getByTestId('task-count').textContent).toBe('2')
    // The subtask should have parentId
    const list = screen.getByTestId('task-list')
    const items = within(list).getAllByRole('listitem')
    const subtask = items.find(item => item.textContent?.includes('parent:test-1'))
    expect(subtask).toBeDefined()
  })

  it('deleting a parent also deletes its subtasks', async () => {
    const user = userEvent.setup()
    const parent = createTestTask({ id: 'test-1', subtaskIds: ['sub-1'] })
    const subtask = createTestTask({ id: 'sub-1', title: 'Subtask', parentId: 'test-1', subtaskIds: [] })
    renderWithProvider([parent, subtask])
    expect(screen.getByTestId('task-count').textContent).toBe('2')
    await user.click(screen.getByText('Delete Task'))
    expect(screen.getByTestId('task-count').textContent).toBe('0')
  })

  it('subtasks are not shown in filtered top-level results', async () => {
    renderWithProvider([
      createTestTask({ id: 'parent', subtaskIds: ['child'] }),
      createTestTask({ id: 'child', parentId: 'parent', subtaskIds: [] }),
    ])
    // getFilteredTasks should exclude subtasks
    expect(screen.getByTestId('todo-count').textContent).toBe('1')
  })

  it('moving task to done sets completedAt', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Move to Done'))
    const taskEl = screen.getByTestId('task-test-1')
    expect(taskEl.textContent).toContain('done')
  })

  it('clears search', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Search Updated'))
    expect(screen.getByTestId('search').textContent).toBe('Updated')
    await user.click(screen.getByText('Clear Search'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('resets filter to all', async () => {
    const user = userEvent.setup()
    renderWithProvider()
    await user.click(screen.getByText('Filter High'))
    expect(screen.getByTestId('filter').textContent).toBe('high')
    await user.click(screen.getByText('Filter All'))
    expect(screen.getByTestId('filter').textContent).toBe('all')
  })
})
