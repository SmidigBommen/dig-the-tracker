import { useState, useEffect, useCallback } from 'react'
import { TaskProvider, useTaskContext } from './context/TaskContext.tsx'
import Header from './components/Header.tsx'
import KanbanBoard from './components/KanbanBoard.tsx'
import ReportsPage from './components/ReportsPage.tsx'
import ProfilePage from './components/ProfilePage.tsx'
import TaskModal from './components/TaskModal.tsx'
import './App.css'

function AppContent() {
  const { state, setView } = useTaskContext()
  const [showQuickCreate, setShowQuickCreate] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs/textareas/selects
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    // Don't trigger when a modal is open (check for overlay)
    if (document.querySelector('.modal-overlay')) return

    switch (e.key) {
      case 'c':
        e.preventDefault()
        setShowQuickCreate(true)
        break
      case 'b':
        e.preventDefault()
        setView('board')
        break
      case 'p':
        e.preventDefault()
        setView('profile')
        break
      case '?':
        // Could show a shortcuts help modal in the future
        break
    }
  }, [setView])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="app">
      <Header />
      <main className="app-main">
        {state.currentView === 'board' && <KanbanBoard />}
        {state.currentView === 'reports' && <ReportsPage />}
        {state.currentView === 'profile' && <ProfilePage />}
      </main>

      <div className="shortcut-hint">
        <span><kbd>C</kbd> Create</span>
        <span><kbd>B</kbd> Board</span>
        <span><kbd>P</kbd> Profile</span>
      </div>

      {showQuickCreate && (
        <TaskModal
          defaultStatus="backlog"
          onClose={() => setShowQuickCreate(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <TaskProvider>
      <AppContent />
    </TaskProvider>
  )
}
