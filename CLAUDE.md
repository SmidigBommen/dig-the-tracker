# Project notes

## Git

- The remote is `git@github.com:SmidigBommen/dig-the-tracker.git` and the default branch is `master` (not `main`).
- Always verify the remote is configured (`git remote -v`) before assuming branch names. If no remote is set, check with the user rather than relying on auto-detection.

## Codebase structure

```
src/
  App.tsx                          # Root app component, keyboard shortcuts, view routing
  App.css                          # Global app styles
  main.tsx                         # React entry point
  index.css                        # Global CSS reset/variables
  types/
    index.ts                       # Shared types: Task, Column, Priority, ValidationError
  context/
    TaskContext.tsx                 # Central state: reducer, actions, persistence, validation, context API
  components/
    Header.tsx / Header.css        # Top nav bar: tabs, search, filters
    KanbanBoard.tsx / KanbanBoard.css  # Board view: columns, add-column form, task modals
    KanbanColumn.tsx / KanbanColumn.css  # Single column with drag-drop
    TaskCard.tsx / TaskCard.css    # Individual task card in column
    TaskModal.tsx / TaskModal.css  # Create task modal
    TaskDetailModal.tsx / TaskDetailModal.css  # View/edit task details modal
    ReportsPage.tsx / ReportsPage.css  # Reports/analytics view
    ProfilePage.tsx / ProfilePage.css  # User profile settings
  test/
    setup.ts                       # Vitest setup
    TaskContext.test.tsx            # Context/reducer unit tests
    validation.test.ts             # Validation function tests
    components.test.tsx            # Component rendering tests
```

## Architecture notes

- **State management:** Single `useReducer` in `TaskContext.tsx` with localStorage persistence
- **Views:** Routed via `state.currentView` (`'board' | 'reports' | 'profile'`)
- **Columns:** Dynamic, stored in state. Protected columns: `backlog`, `done`
- **Modals:** Use `.modal-overlay` / `.modal-content` CSS pattern from TaskModal
- **Testing:** Vitest + React Testing Library. Tests use a `TestComponent` that exposes context actions via buttons.

## Keep this file updated

When adding/removing/renaming files or changing architecture, update this structure.
