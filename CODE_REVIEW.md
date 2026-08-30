# Code Review — dig-the-tracker

> Historical review of the pre-migration Supabase implementation. The local PostgreSQL migration removes or supersedes many findings below; use current tests and architecture documents for the active system.

Reviewed commit: current `master`. Stack: React 19 + TypeScript + Vite + Supabase.

Scope: security, correctness, types, maintainability, performance, testing, a11y, DX.

---

## P0 — Fix before the next deploy

### 1. Add `.env.example`
- **Where:** repo root (missing).
- **Why:** Fresh clones have no signal about required env vars. `src/lib/supabase.ts` silently depends on `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; without a template, onboarding is guess-and-check and misconfigurations surface as confusing runtime errors.
- **Fix:** commit a placeholder file with both keys and a one-line comment.

### 2. Invite tokens can't be revoked
- **Where:** `supabase/migrations/001_initial_schema.sql` (`board_shares`) + `accept_invite()` RPC.
- **Why:** A leaked link is valid for the full 7-day window. There is no kill switch — you cannot invalidate a specific token, only wait for expiry. For a shared-board product this is the highest real-world security risk.
- **Fix:** add a `revoked_at timestamptz` column, filter it out in `accept_invite`, and expose a "revoke link" action in `ProfilePage`.

### 3. Optimistic position collisions on rapid task creation
- **Where:** `src/context/TaskContext.tsx` `addTask` (position computed client-side from stale `state.tasks`).
- **Why:** Two quick creates in the same column can be assigned the same `position` before realtime syncs. Ordering after that point becomes non-deterministic and drag-drop uses position as the ordering key.
- **Fix:** compute and return `position` inside the existing `create_task` RPC so the increment is atomic server-side; drop the client math.

### 4. Error handling stops at `console.log` + toast
- **Where:** every mutation in `TaskContext.tsx` (`addTask`, `updateTask`, `deleteTask`, `moveTask`, `reorderTask`, `reorderColumns`).
- **Why:** Failed writes (lost membership, RLS denial, offline) leave the UI in a "success-looking" state. There are no optimistic updates to roll back, but there is also no retry or clear failure affordance for the user — the toast disappears and the write is just gone.
- **Fix:** standardize on a `mutate()` wrapper that surfaces a persistent error state + retry for the affected row, and refetches the board on repeated failures.

---

## P1 — Do this sprint

### 5. Realtime channel cleanup is fragile
- **Where:** `src/context/TaskContext.tsx`, the `useEffect` keyed on `state.boardId`.
- **Why:** Channel is created inside the effect but also referenced via `boardIdRef`. When boardId changes, the old channel is removed in cleanup, but any in-flight `.on()` callbacks can still dispatch into a stale reducer. Low probability today (single board), high blast radius once multi-board switching lands.
- **Fix:** store the channel in a ref, `removeChannel` before creating a new one, and guard dispatches with a "current board" check.

### 6. Subtask delete is a client-side loop
- **Where:** `src/components/TaskDetailModal.tsx` delete handler (~lines 111–115).
- **Why:** Deleting a parent iterates through children with individual DELETEs, then deletes the parent. Any mid-loop failure leaves orphaned subtasks pointing at a missing `parent_id`.
- **Fix:** add a `delete_task_cascade(task_id)` Supabase function and call it once.

### 7. `state as unknown as {...}` casts
- **Where:** `src/components/ProfilePage.tsx` (`commentsByTask`), `TaskContext.tsx` provider value (`profile` grafted onto state).
- **Why:** Defeats the point of strict TS — schema drifts go unnoticed until runtime. Both fields actually exist; they're just absent from the type.
- **Fix:** add `commentsByTask` and `profile` to the `TaskState` interface. Delete the casts.

### 8. Pervasive `as Record<string, unknown>` on Supabase rows
- **Where:** `TaskContext.tsx` initial fetch + realtime handlers (mapTask / mapColumn call sites).
- **Why:** Every row coming out of Supabase is being laundered through `Record<string, unknown>`. A column rename in the DB passes type-check but fails at runtime.
- **Fix:** generate typed rows with `supabase gen types typescript`, commit to `src/types/db.ts`, type the query responses directly.

### 9. Task card is a `div` with `role="button"`
- **Where:** `src/components/TaskCard.tsx`.
- **Why:** Screen readers announce it as a button but keyboard activation, focus ring, and `Enter`/`Space` semantics aren't free — they have to be wired manually and currently aren't consistent.
- **Fix:** either make it a real `<button>` wrapping the content, or add `tabindex="0"` + `onKeyDown` for Enter/Space.

### 10. Drag-drop is mouse-only
- **Where:** `KanbanColumn.tsx` / `TaskCard.tsx`.
- **Why:** Keyboard users cannot reorder or move tasks between columns except through the status dropdown in the detail modal. This is an accessibility blocker for a kanban app.
- **Fix:** add keyboard shortcuts on a focused card (e.g. `⌘/Ctrl + ←/→` to change column, `↑/↓` to reorder). Doesn't need to replace the mouse path.

### 11. Supabase mock can't simulate failures or realtime
- **Where:** `src/test/supabaseMock.ts`.
- **Why:** `rpc()` is hardcoded to succeed; `channel()` is a no-op. Every test runs the happy path — the exact cases most likely to have bugs (RLS denial, realtime races, invite expiry) aren't exercised.
- **Fix:** make the mock configurable per-test (injectable rpc responses, a way to fire realtime events).

---

## P2 — Worth doing, not urgent

### 12. `TaskContext.tsx` is 733 lines
- **Why:** Reducer, initial fetch, realtime wiring, and ~10 CRUD actions all in one file. Review and test surface is large; circular concerns (e.g., position math in both `addTask` and `moveTask`) go unnoticed.
- **Fix:** split into `taskReducer.ts`, `useTaskInit.ts`, `useTaskRealtime.ts`, `useTaskActions.ts`. No behavior change — pure carve-up.

### 13. Magic numbers + duplicated position math
- **Where:** `TaskContext.tsx` (`+ 1000`, `/ 2`), `TaskCard.tsx` (`.slice(0, 80)`), slugify inlined in `addColumn`.
- **Fix:** `const POSITION_STEP = 1000`; extract `calculatePosition(tasksInColumn, targetIndex)` and `slugify()` into `taskUtils.ts`.

### 14. Re-render cost on large boards
- **Where:** `KanbanBoard.tsx` hash-listener effect depends on `state.tasks`; `TaskCard` is unmemoized.
- **Why:** Every task edit re-renders every card and re-attaches the hashchange listener. Imperceptible at ~50 tasks, painful at 500.
- **Fix:** `React.memo(TaskCard)` with a stable `onClick` from a ref or `useCallback`; move the hashchange effect to depend only on the lookup map.

### 15. `TaskStatus = string`
- **Where:** `src/types/index.ts`.
- **Why:** Removes any help the type system could give around reserved statuses (`backlog`, `done` are protected columns per CLAUDE.md).
- **Fix:** `type TaskStatus = 'backlog' | 'done' | (string & {})` to preserve both literal autocomplete and custom-column flexibility.

### 16. Modal focus is not trapped
- **Where:** `TaskModal.tsx`, `TaskDetailModal.tsx`, `InviteHandler.tsx`.
- **Why:** Tabbing past the last field sends focus behind the modal. Standard a11y pattern is a focus trap + restore focus on close.
- **Fix:** add a small focus-trap utility (or `focus-trap-react` if deps are fine).

### 17. Test coverage gaps
- **Missing:** `AuthContext` flows, `InviteHandler`, realtime sync behavior, drag-drop, subtask delete, error-path coverage on mutations.
- **Fix:** once #11 lands, add one integration test per missing flow.

---

## P3 — Nice to have

- Add `lint` / `typecheck` / `format` npm scripts and run them in CI (today only `build` and `test` run).
- Add Husky + lint-staged to block broken commits.
- Expand README with Supabase setup steps, how to run migrations, and auth redirect configuration.
- Document the schema (ER diagram or `supabase/SCHEMA.md`) — currently only readable via SQL.
- Pagination / virtualization on the board view — not a problem under ~1k tasks, but worth planning.
- Consider Playwright for smoke tests on the login → create task → invite flow.

---

## What I did *not* find

- No `dangerouslySetInnerHTML`, no XSS vectors in current rendering paths.
- No hardcoded secrets; anon key usage is correct for a browser app.
- RLS policies look sound: `is_board_member()` gates every sensitive table; `security definer` RPCs check membership.
- `build` already runs `tsc -b` before Vite — type errors can't slip into a deploy.
- GitHub Actions workflow is clean (uses `npm ci`, secrets injected correctly).

---

## Suggested order of attack

1. **Day 1:** #1 (`.env.example`), #7 (type casts), #3 (position RPC), #8 (generated DB types) — all low-risk, high-signal.
2. **Day 2–3:** #2 (invite revocation), #4 (error handling), #6 (cascade delete RPC) — touches both schema and client.
3. **Week 2:** #5 (realtime cleanup), #9–10 (a11y), #11 (mock upgrade) → unblocks #17 (tests).
4. **Background:** #12 (split context), #13 (constants), #14 (memoization) as opportunistic cleanup.

Want me to start with the P0 block, or a specific item?
