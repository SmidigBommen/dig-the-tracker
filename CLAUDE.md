# Project notes

## Git

- The remote is `git@github.com:SmidigBommen/dig-the-tracker.git` and the default branch is `master` (not `main`).
- Always verify the remote is configured (`git remote -v`) before assuming branch names. If no remote is set, check with the user rather than relying on auto-detection.

## Codebase structure

```
supabase/
  migrations/
    001_initial_schema.sql           # Full Supabase schema: tables, RLS, functions, realtime
    002_idempotent_board_creation.sql # Make create_default_board idempotent (prevents duplicate boards)
src/
  App.tsx                            # Root app: AuthProvider > AuthGate > TaskProvider > AppContent
  App.css                            # Global app styles + loading/error states
  main.tsx                           # React entry point
  index.css                          # Global CSS reset/variables
  lib/
    supabase.ts                      # Supabase client singleton (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
    migrateLocalData.ts              # One-time localStorage → Supabase migration helper
  types/
    index.ts                         # Shared types: Task, Column, TaskComment, mapTask(), mapColumn()
  context/
    AuthContext.tsx                   # Auth: session, profile, signIn (magic link), signOut, updateProfile
    TaskContext.tsx                   # Board state: Supabase CRUD, realtime subscriptions, reducer
    taskUtils.ts                     # Validation + formatTaskKey (unchanged)
  components/
    LoginPage.tsx / LoginPage.css    # Magic link login page
    InviteHandler.tsx                # Invite link acceptance flow (?invite=<token>)
    Toast.tsx / Toast.css            # Notification component for errors/success
    Header.tsx / Header.css          # Top nav: tabs, search, filters, sign-out
    KanbanBoard.tsx / KanbanBoard.css  # Board view: columns, add-column form, task modals
    KanbanColumn.tsx / KanbanColumn.css  # Single column with drag-drop
    TaskCard.tsx / TaskCard.css      # Individual task card in column
    TaskModal.tsx / TaskModal.css    # Create task modal (async)
    TaskDetailModal.tsx / TaskDetailModal.css  # View/edit task + comments (async)
    ReportsPage.tsx / ReportsPage.css  # Reports/analytics view
    ProfilePage.tsx / ProfilePage.css  # Profile settings + invite link generation
  test/
    setup.ts                         # Vitest setup + supabase mock
    supabaseMock.ts                  # In-memory Supabase mock (chainable query builder)
    TaskContext.test.tsx             # Context/reducer unit tests
    validation.test.ts              # Validation function tests (unchanged)
    components.test.tsx             # Component rendering tests
```

## Architecture notes

- **Backend:** Supabase (Postgres + Auth + Realtime). Static site on GitHub Pages.
- **Auth:** Magic link (passwordless email) via `AuthContext`. Session managed with `supabase.auth`.
- **State management:** `useReducer` in `TaskContext.tsx`. Data fetched from Supabase on mount, kept in sync via realtime subscriptions. All mutations are async (write to Supabase, realtime updates local state).
- **Comments:** Stored in separate `task_comments` table (not nested in tasks). Accessed via `state.commentsByTask[taskId]` and `getCommentCount(taskId)` / `getComments(taskId)` helpers.
- **Task numbering:** `DIG-N` format. `next_task_number()` Postgres function for atomic numbering.
- **Columns:** Stored in `columns` table with `position` field (gapped by 1000). `id` in app = `slug` from DB.
- **Deep-linking:** Hash-based `#DIG-N`. Invite links use query param `?invite=<token>`.
- **Views:** Routed via `state.currentView` (`'board' | 'reports' | 'profile'`)
- **Protected columns:** `backlog`, `done` (cannot be removed)
- **Invite system:** `board_shares` table with token + expiry. `accept_invite()` RPC. Generated in ProfilePage.
- **UI-only state:** `searchQuery`, `filterPriority`, `currentView`, `showSubtasksOnBoard` stay local (not in DB).
- **Testing:** Vitest + React Testing Library. `supabaseMock.ts` provides a chainable in-memory mock. All tests wrap with `AuthProvider` + `TaskProvider`.
- **Env vars:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (set in `.env.local` or GitHub secrets)

## Deployment

- **GitHub Pages:** Auto-deploys on push to `master` via `.github/workflows/deploy.yml`
- **Supabase project:** `sptklawzzgpycosxizuq` (free tier)
- **GitHub secrets:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured in repo settings
- **Auth redirect URLs:** `https://smidigbommen.github.io/dig-the-tracker/` and `http://localhost:5173/dig-the-tracker/` configured in Supabase Auth settings
- **Live URL:** https://smidigbommen.github.io/dig-the-tracker/

## Dev commands

- `npm run dev` — local dev server (port 5173)
- `npm run build` — TypeScript check + production build
- `npm test` — run all 52 tests
- `npm run test:watch` — tests in watch mode

## Keep this file updated

When adding/removing/renaming files or changing architecture, update this structure.
