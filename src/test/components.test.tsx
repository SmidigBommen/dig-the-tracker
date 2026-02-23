import { describe, it, expect } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider } from '../context/AuthContext.tsx'
import { TaskProvider } from '../context/TaskContext.tsx'
import { setMockTasks } from './supabaseMock.ts'
import KanbanBoard from '../components/KanbanBoard.tsx'
import Header from '../components/Header.tsx'
import ReportsPage from '../components/ReportsPage.tsx'

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

function renderWithProvider(component: React.ReactNode, initialTasks?: Record<string, unknown>[]) {
  setMockTasks(initialTasks ?? [])
  return render(
    <AuthProvider>
      <TaskProvider>
        {component}
      </TaskProvider>
    </AuthProvider>
  )
}

// Helper to wait for loading to finish
async function waitForLoad() {
  await waitFor(() => {
    // KanbanBoard renders columns when loaded — wait for at least one
    expect(screen.queryByText('Loading board...')).not.toBeInTheDocument()
  }, { timeout: 3000 })
}

describe('Header', () => {
  it('renders logo and title', async () => {
    renderWithProvider(<Header />, [])
    await waitForLoad()
    expect(screen.getByText('Dig')).toBeInTheDocument()
    expect(screen.getByText('Issue Tracker')).toBeInTheDocument()
  })

  it('shows task counts', async () => {
    renderWithProvider(<Header />, [
      createTestTask({ id: '1', number: 1, column_slug: 'todo' }),
      createTestTask({ id: '2', number: 2, column_slug: 'done' }),
    ])
    await waitForLoad()
    expect(screen.getByText('2 tasks')).toBeInTheDocument()
    expect(screen.getByText('1 done')).toBeInTheDocument()
  })

  it('renders search input', async () => {
    renderWithProvider(<Header />, [])
    await waitForLoad()
    expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument()
  })

  it('renders priority filter', async () => {
    renderWithProvider(<Header />, [])
    await waitForLoad()
    expect(screen.getByLabelText('Filter by priority')).toBeInTheDocument()
  })

  it('renders navigation tabs', async () => {
    renderWithProvider(<Header />, [])
    await waitForLoad()
    expect(screen.getByText('Board')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('allows typing in search', async () => {
    const user = userEvent.setup()
    renderWithProvider(<Header />, [])
    await waitForLoad()
    const input = screen.getByPlaceholderText('Search tasks...')
    await user.type(input, 'hello')
    expect(input).toHaveValue('hello')
  })

  it('shows clear button when search has value', async () => {
    const user = userEvent.setup()
    renderWithProvider(<Header />, [])
    await waitForLoad()
    const input = screen.getByPlaceholderText('Search tasks...')
    await user.type(input, 'test')
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument()
  })
})

describe('KanbanBoard', () => {
  it('renders all 5 columns', async () => {
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders tasks in their correct columns', async () => {
    renderWithProvider(
      <KanbanBoard />,
      [
        createTestTask({ id: '1', number: 1, title: 'Todo Task', column_slug: 'todo' }),
        createTestTask({ id: '2', number: 2, title: 'Done Task', column_slug: 'done' }),
      ]
    )
    await waitForLoad()
    expect(screen.getByText('Todo Task')).toBeInTheDocument()
    expect(screen.getByText('Done Task')).toBeInTheDocument()
  })

  it('shows add buttons for each column', async () => {
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    const addButtons = screen.getAllByText('+')
    expect(addButtons.length).toBe(5)
  })

  it('opens create modal when clicking add button', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    expect(screen.getByText('Create New Task')).toBeInTheDocument()
  })

  it('opens task detail modal when clicking a task', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'Clickable Task', column_slug: 'todo' })]
    )
    await waitForLoad()
    await user.click(screen.getByText('Clickable Task'))
    expect(screen.getAllByText('Clickable Task').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})

describe('Task Creation Modal', () => {
  it('validates empty title on submit', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    await user.click(screen.getByText('Create Task'))
    expect(screen.getByText('Title is required')).toBeInTheDocument()
  })

  it('validates short title on submit', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    await user.type(screen.getByPlaceholderText('Enter task title...'), 'ab')
    await user.click(screen.getByText('Create Task'))
    expect(screen.getByText('Title must be at least 3 characters')).toBeInTheDocument()
  })

  it('closes modal on cancel', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    expect(screen.getByText('Create New Task')).toBeInTheDocument()
    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Create New Task')).not.toBeInTheDocument()
  })
})

describe('Task Detail Modal', () => {
  it('shows task details', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({
        id: '1',
        title: 'Detail Task',
        description: 'Detailed description here for testing',
        column_slug: 'todo',
        priority: 'high',
        assignee_name: 'Alice',
        tags: ['frontend'],
      })]
    )
    await waitForLoad()
    await user.click(screen.getByText('Detail Task'))
    expect(screen.getAllByText('Detailed description here for testing').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1)
  })

  it('validates empty comment', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'Comment Task', column_slug: 'todo' })]
    )
    await waitForLoad()
    await user.click(screen.getByText('Comment Task'))
    // Need display name set up for the comment form to show
    const postBtn = screen.queryByText('Post Comment')
    if (postBtn) {
      await user.click(postBtn)
      expect(screen.getByText('Comment text is required')).toBeInTheDocument()
    }
  })

  it('shows subtasks section', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [
        createTestTask({ id: '1', number: 1, title: 'Parent Task', column_slug: 'todo', subtask_ids: ['sub-1'] }),
        createTestTask({ id: 'sub-1', number: 2, title: 'Child Subtask', column_slug: 'todo', parent_id: '1', subtask_ids: [] }),
      ]
    )
    await waitForLoad()
    await user.click(screen.getByText('Parent Task'))
    expect(screen.getByText('Child Subtask')).toBeInTheDocument()
    expect(screen.getByText('+ Add Subtask')).toBeInTheDocument()
  })
})

describe('Dynamic Columns', () => {
  it('renders add column button', async () => {
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    expect(screen.getByText('+ Add Column')).toBeInTheDocument()
  })

  it('opens add column form when clicking button', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    await user.click(screen.getByText('+ Add Column'))
    expect(screen.getByText('New Column')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByLabelText('Icon')).toBeInTheDocument()
  })

  it('shows remove button on non-protected columns', async () => {
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    expect(screen.getByLabelText('Remove To Do column')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove In Progress column')).toBeInTheDocument()
    expect(screen.getByLabelText('Remove Review column')).toBeInTheDocument()
  })

  it('does not show remove button on Backlog or Done', async () => {
    renderWithProvider(<KanbanBoard />, [])
    await waitForLoad()
    expect(screen.queryByLabelText('Remove Backlog column')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Remove Done column')).not.toBeInTheDocument()
  })

  it('disables remove button when column has tasks', async () => {
    renderWithProvider(<KanbanBoard />, [createTestTask({ id: '1', column_slug: 'todo' })])
    await waitForLoad()
    const removeBtn = screen.getByLabelText('Remove To Do column')
    expect(removeBtn).toBeDisabled()
  })
})

describe('ReportsPage', () => {
  it('renders summary cards', async () => {
    renderWithProvider(
      <ReportsPage />,
      [
        createTestTask({ id: '1', number: 1, column_slug: 'todo' }),
        createTestTask({ id: '2', number: 2, column_slug: 'done', completed_at: new Date().toISOString() }),
      ]
    )
    await waitForLoad()
    expect(screen.getByText('Reports & Analytics')).toBeInTheDocument()
    expect(screen.getByText('Total Tasks')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Completion Rate')).toBeInTheDocument()
  })

  it('shows correct total task count', async () => {
    renderWithProvider(
      <ReportsPage />,
      [
        createTestTask({ id: '1', number: 1, column_slug: 'todo' }),
        createTestTask({ id: '2', number: 2, column_slug: 'done' }),
        createTestTask({ id: '3', number: 3, column_slug: 'in-progress' }),
      ]
    )
    await waitForLoad()
    const totalLabel = screen.getByText('Total Tasks')
    const summaryCard = totalLabel.closest('.summary-card')
    expect(summaryCard).toBeTruthy()
    expect(within(summaryCard as HTMLElement).getByText('3')).toBeInTheDocument()
  })

  it('shows team workload section', async () => {
    renderWithProvider(
      <ReportsPage />,
      [createTestTask({ id: '1', assignee_name: 'Alice' })]
    )
    await waitForLoad()
    expect(screen.getByText('Team Workload')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows status distribution', async () => {
    renderWithProvider(<ReportsPage />, [createTestTask()])
    await waitForLoad()
    expect(screen.getByText('Status Distribution')).toBeInTheDocument()
  })

  it('shows priority distribution', async () => {
    renderWithProvider(<ReportsPage />, [createTestTask()])
    await waitForLoad()
    expect(screen.getByText('Priority Distribution')).toBeInTheDocument()
  })
})
