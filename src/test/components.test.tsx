import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskProvider } from '../context/TaskContext.tsx'
import type { Task } from '../types/index.ts'
import KanbanBoard from '../components/KanbanBoard.tsx'
import Header from '../components/Header.tsx'
import ReportsPage from '../components/ReportsPage.tsx'

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

function renderWithProvider(component: React.ReactNode, initialTasks?: Task[], initialProfile?: { username?: string; email?: string; displayName?: string; avatarColor?: string }) {
  return render(
    <TaskProvider initialTasks={initialTasks} initialProfile={initialProfile}>
      {component}
    </TaskProvider>
  )
}

describe('Header', () => {
  it('renders logo and title', () => {
    renderWithProvider(<Header />, [])
    expect(screen.getByText('Dig')).toBeInTheDocument()
    expect(screen.getByText('Issue Tracker')).toBeInTheDocument()
  })

  it('shows task counts', () => {
    renderWithProvider(<Header />, [
      createTestTask({ id: '1', status: 'todo' }),
      createTestTask({ id: '2', status: 'done' }),
    ])
    expect(screen.getByText('2 tasks')).toBeInTheDocument()
    expect(screen.getByText('1 done')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderWithProvider(<Header />, [])
    expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument()
  })

  it('renders priority filter', () => {
    renderWithProvider(<Header />, [])
    expect(screen.getByLabelText('Filter by priority')).toBeInTheDocument()
  })

  it('renders navigation tabs', () => {
    renderWithProvider(<Header />, [])
    expect(screen.getByText('Board')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('allows typing in search', async () => {
    const user = userEvent.setup()
    renderWithProvider(<Header />, [])
    const input = screen.getByPlaceholderText('Search tasks...')
    await user.type(input, 'hello')
    expect(input).toHaveValue('hello')
  })

  it('shows clear button when search has value', async () => {
    const user = userEvent.setup()
    renderWithProvider(<Header />, [])
    const input = screen.getByPlaceholderText('Search tasks...')
    await user.type(input, 'test')
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument()
  })
})

describe('KanbanBoard', () => {
  it('renders all 5 columns', () => {
    renderWithProvider(<KanbanBoard />, [])
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders tasks in their correct columns', () => {
    renderWithProvider(
      <KanbanBoard />,
      [
        createTestTask({ id: '1', title: 'Todo Task', status: 'todo' }),
        createTestTask({ id: '2', title: 'Done Task', status: 'done' }),
      ]
    )
    expect(screen.getByText('Todo Task')).toBeInTheDocument()
    expect(screen.getByText('Done Task')).toBeInTheDocument()
  })

  it('shows add buttons for each column', () => {
    renderWithProvider(<KanbanBoard />, [])
    const addButtons = screen.getAllByText('+')
    expect(addButtons.length).toBe(5)
  })

  it('opens create modal when clicking add button', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    expect(screen.getByText('Create New Task')).toBeInTheDocument()
  })

  it('opens task detail modal when clicking a task', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'Clickable Task', status: 'todo' })]
    )
    await user.click(screen.getByText('Clickable Task'))
    // Detail modal should open - both card and detail will show the title
    expect(screen.getAllByText('Clickable Task').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})

describe('Task Creation Modal', () => {
  it('validates empty title on submit', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    await user.click(screen.getByText('Create Task'))
    expect(screen.getByText('Title is required')).toBeInTheDocument()
  })

  it('validates short title on submit', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[0])
    await user.type(screen.getByPlaceholderText('Enter task title...'), 'ab')
    await user.click(screen.getByText('Create Task'))
    expect(screen.getByText('Title must be at least 3 characters')).toBeInTheDocument()
  })

  it('creates a task with valid input', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
    const addButtons = screen.getAllByText('+')
    await user.click(addButtons[1]) // "To Do" column add button
    await user.type(screen.getByPlaceholderText('Enter task title...'), 'My New Task')
    await user.type(screen.getByPlaceholderText('Describe the task...'), 'A description')
    await user.click(screen.getByText('Create Task'))
    // Modal should close and task should appear
    expect(screen.getByText('My New Task')).toBeInTheDocument()
  })

  it('closes modal on cancel', async () => {
    const user = userEvent.setup()
    renderWithProvider(<KanbanBoard />, [])
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
        status: 'todo',
        priority: 'high',
        assignee: 'Alice',
        tags: ['frontend'],
      })]
    )
    await user.click(screen.getByText('Detail Task'))
    // Both card and detail modal show the description (card truncates at 80 chars, detail shows full)
    expect(screen.getAllByText('Detailed description here for testing').length).toBeGreaterThanOrEqual(1)
    // Alice appears in both the card avatar and the detail assignee field
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1)
  })

  it('can add comments when profile is set', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'Comment Task', status: 'todo' })],
      { username: 'bob', displayName: 'Bob' }
    )
    await user.click(screen.getByText('Comment Task'))
    await user.type(screen.getByPlaceholderText('Write a comment...'), 'Great work!')
    await user.click(screen.getByText('Post Comment'))
    expect(screen.getByText('Great work!')).toBeInTheDocument()
    expect(screen.getAllByText('Bob').length).toBeGreaterThanOrEqual(1)
  })

  it('validates empty comment', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'Comment Task', status: 'todo' })],
      { username: 'bob', displayName: 'Bob' }
    )
    await user.click(screen.getByText('Comment Task'))
    await user.click(screen.getByText('Post Comment'))
    expect(screen.getByText('Comment text is required')).toBeInTheDocument()
  })

  it('disables comments when no profile is set', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'No Profile Task', status: 'todo' })]
    )
    await user.click(screen.getByText('No Profile Task'))
    expect(screen.getByText('Set up your profile to leave comments.')).toBeInTheDocument()
  })

  it('deletes task with confirmation', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [createTestTask({ id: '1', title: 'Delete Me', status: 'todo' })]
    )
    await user.click(screen.getByText('Delete Me'))
    await user.click(screen.getByText('Delete'))
    expect(screen.getByText('Confirm Delete?')).toBeInTheDocument()
    await user.click(screen.getByText('Confirm Delete?'))
    // Task should be gone
    expect(screen.queryByText('Delete Me')).not.toBeInTheDocument()
  })

  it('shows subtasks section', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [
        createTestTask({ id: '1', title: 'Parent Task', status: 'todo', subtaskIds: ['sub-1'] }),
        createTestTask({ id: 'sub-1', title: 'Child Subtask', status: 'todo', parentId: '1', subtaskIds: [] }),
      ]
    )
    await user.click(screen.getByText('Parent Task'))
    expect(screen.getByText('Child Subtask')).toBeInTheDocument()
    expect(screen.getByText('+ Add Subtask')).toBeInTheDocument()
  })

  it('can toggle subtask completion', async () => {
    const user = userEvent.setup()
    renderWithProvider(
      <KanbanBoard />,
      [
        createTestTask({ id: '1', title: 'Parent Task', status: 'todo', subtaskIds: ['sub-1'] }),
        createTestTask({ id: 'sub-1', title: 'Child Subtask', status: 'todo', parentId: '1', subtaskIds: [] }),
      ]
    )
    await user.click(screen.getByText('Parent Task'))
    const checkBtn = screen.getByLabelText('Mark as complete')
    await user.click(checkBtn)
    expect(screen.getByLabelText('Mark as incomplete')).toBeInTheDocument()
  })
})

describe('ReportsPage', () => {
  it('renders summary cards', () => {
    renderWithProvider(
      <ReportsPage />,
      [
        createTestTask({ id: '1', status: 'todo' }),
        createTestTask({ id: '2', status: 'done', completedAt: new Date().toISOString() }),
      ]
    )
    expect(screen.getByText('Reports & Analytics')).toBeInTheDocument()
    expect(screen.getByText('Total Tasks')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Completion Rate')).toBeInTheDocument()
  })

  it('shows correct total task count', () => {
    renderWithProvider(
      <ReportsPage />,
      [
        createTestTask({ id: '1', status: 'todo' }),
        createTestTask({ id: '2', status: 'done' }),
        createTestTask({ id: '3', status: 'in-progress' }),
      ]
    )
    // The summary card should show 3 total tasks
    const totalLabel = screen.getByText('Total Tasks')
    const summaryCard = totalLabel.closest('.summary-card')
    expect(summaryCard).toBeTruthy()
    expect(within(summaryCard as HTMLElement).getByText('3')).toBeInTheDocument()
  })

  it('shows team workload section', () => {
    renderWithProvider(
      <ReportsPage />,
      [createTestTask({ id: '1', assignee: 'Alice' })]
    )
    expect(screen.getByText('Team Workload')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('shows status distribution', () => {
    renderWithProvider(<ReportsPage />, [createTestTask()])
    expect(screen.getByText('Status Distribution')).toBeInTheDocument()
  })

  it('shows priority distribution', () => {
    renderWithProvider(<ReportsPage />, [createTestTask()])
    expect(screen.getByText('Priority Distribution')).toBeInTheDocument()
  })
})
