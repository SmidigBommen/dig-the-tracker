import type { TaskPriority } from '../types/index.ts'
import { useTaskContext } from '../context/TaskContext.tsx'
import { useAuth } from '../context/AuthContext.tsx'
import './Header.css'

export default function Header() {
  const { state, setSearch, setFilterPriority, setView, toggleSubtasksOnBoard } = useTaskContext()
  const { profile: authProfile, signOut } = useAuth()

  const totalTasks = state.tasks.filter(t => !t.parentId).length
  const doneTasks = state.tasks.filter(t => t.status === 'done' && !t.parentId).length

  const displayName = authProfile?.display_name || ''
  const avatarColor = authProfile?.avatar_color || '#6366f1'
  const initials = (displayName || '')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('')

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="logo">
          <span className="logo-icon">◆</span>
          <h1>Dig</h1>
          <span className="logo-subtitle">Issue Tracker</span>
        </div>
        <div className="nav-tabs">
          <button
            className={`nav-tab ${state.currentView === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            className={`nav-tab ${state.currentView === 'reports' ? 'active' : ''}`}
            onClick={() => setView('reports')}
          >
            Reports
          </button>
        </div>
        <div className="header-stats">
          <span className="stat">{totalTasks} tasks</span>
          <span className="stat-divider">·</span>
          <span className="stat">{doneTasks} done</span>
        </div>
      </div>

      <div className="header-right">
        {state.currentView === 'board' && (
          <>
            <button
              className={`toggle-btn ${state.showSubtasksOnBoard ? 'active' : ''}`}
              onClick={toggleSubtasksOnBoard}
              title={state.showSubtasksOnBoard ? 'Hide subtasks on board' : 'Show subtasks on board'}
              aria-label="Toggle subtasks on board"
            >
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
              <span className="toggle-label">Subtasks</span>
            </button>

            <div className="search-wrapper">
              <span className="search-icon">⌕</span>
              <input
                type="text"
                placeholder="Search tasks..."
                value={state.searchQuery}
                onChange={(e) => setSearch(e.target.value)}
                className="search-input"
                aria-label="Search tasks"
              />
              {state.searchQuery && (
                <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>
              )}
            </div>

            <select
              value={state.filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as TaskPriority | 'all')}
              className="filter-select"
              aria-label="Filter by priority"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </>
        )}

        <button
          className="header-sign-out"
          onClick={signOut}
          title="Sign out"
        >
          Sign out
        </button>

        <button
          className={`header-avatar ${state.currentView === 'profile' ? 'active' : ''}`}
          onClick={() => setView('profile')}
          title="Profile"
          aria-label="Open profile"
          style={{ background: avatarColor }}
        >
          {initials || '?'}
        </button>
      </div>
    </header>
  )
}
