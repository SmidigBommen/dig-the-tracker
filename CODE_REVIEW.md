# Code review of the former Supabase implementation

> This is a historical review of the Supabase implementation. The PostgreSQL migration removed or superseded many of these findings. Use the current tests and architecture documents when assessing the active system.

Reviewed revision: the pre-migration `master` branch. Stack: React 19, TypeScript, Vite, and Supabase.

Scope: security, correctness, types, maintainability, performance, tests, accessibility, and developer experience.

---

## P0: fix before the next deploy

### 1. Add `.env.example`

- **Location.** Repository root. The file was missing.
- **Problem.** Fresh clones did not list the required environment variables. `src/lib/supabase.ts` depended on `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, so a missing value produced an unclear runtime error.
- **Fix.** Commit a template with both keys and a one-line comment.

### 2. Invite tokens can't be revoked

- **Location.** `supabase/migrations/001_initial_schema.sql`, in `board_shares` and the `accept_invite()` RPC.
- **Problem.** A leaked link remained valid for seven days. The owner could not invalidate one token before it expired. This was the most serious security risk in the shared-board design.
- **Fix.** Add a `revoked_at timestamptz` column, reject revoked tokens in `accept_invite`, and add a "revoke link" action to `ProfilePage`.

### 3. Optimistic position collisions on rapid task creation

- **Location.** `addTask` in `src/context/TaskContext.tsx`, which calculated position from stale client state.
- **Problem.** Two quick creates in one column could receive the same `position` before a live update arrived. Ordering then became nondeterministic because drag and drop used that value as its key.
- **Fix.** Calculate and return `position` inside the existing `create_task` RPC so the server changes it atomically. Remove the client calculation.

### 4. Error handling stops at `console.log` + toast

- **Location.** Every mutation in `TaskContext.tsx`: `addTask`, `updateTask`, `deleteTask`, `moveTask`, `reorderTask`, and `reorderColumns`.
- **Problem.** A failed write, such as a lost membership, RLS denial, or dropped connection, left the UI looking successful. The toast disappeared, with no retry action or lasting error state.
- **Fix.** Use a common `mutate()` wrapper that keeps the error visible, offers a retry for the affected row, and refetches the board after repeated failures.

---

## P1: do this sprint

### 5. Realtime channel cleanup is fragile

- **Location.** The `useEffect` keyed on `state.boardId` in `src/context/TaskContext.tsx`.
- **Problem.** The effect created the channel but also referred to it through `boardIdRef`. When the board changed, cleanup removed the old channel, but an in-flight `.on()` callback could still dispatch into a stale reducer. A single board made this unlikely, but board switching would have increased the impact.
- **Fix.** Store the channel in a ref, call `removeChannel` before creating another, and check the current board before dispatching.

### 6. Subtask delete is a client-side loop

- **Location.** The delete handler in `src/components/TaskDetailModal.tsx`, around lines 111 to 115.
- **Problem.** Deleting a parent sent one request per child and then deleted the parent. A failure midway could leave orphaned subtasks.
- **Fix.** Add a `delete_task_cascade(task_id)` Supabase function and call it once.

### 7. `state as unknown as {...}` casts

- **Location.** `commentsByTask` in `src/components/ProfilePage.tsx` and the `profile` value added to state in `TaskContext.tsx`.
- **Problem.** These casts bypassed strict TypeScript checks. Both fields existed at runtime but were missing from the type.
- **Fix.** Add `commentsByTask` and `profile` to `TaskState`, then delete the casts.

### 8. Pervasive `as Record<string, unknown>` on Supabase rows

- **Location.** The initial fetch and live-update handlers in `TaskContext.tsx`, at the `mapTask` and `mapColumn` call sites.
- **Problem.** Casting every Supabase row to `Record<string, unknown>` hid schema drift. A renamed database column passed type checking and failed at runtime.
- **Fix.** Generate row types with `supabase gen types typescript`, commit them to `src/types/db.ts`, and type query responses directly.

### 9. Task card is a `div` with `role="button"`

- **Location.** `src/components/TaskCard.tsx`.
- **Problem.** Screen readers announced the card as a button, but it lacked consistent keyboard activation and focus behavior.
- **Fix.** Use a real `<button>`, or add `tabindex="0"` and an `onKeyDown` handler for Enter and Space.

### 10. Drag-drop is mouse-only

- **Location.** `KanbanColumn.tsx` and `TaskCard.tsx`.
- **Problem.** Keyboard users could move tasks only through the status dropdown in the detail modal. They could not reorder cards from the board.
- **Fix.** Add keyboard commands to a focused card, such as Command or Control with the arrow keys. Keep the existing mouse controls.

### 11. Supabase mock can't simulate failures or live updates

- **Location.** `src/test/supabaseMock.ts`.
- **Problem.** `rpc()` always succeeded and `channel()` did nothing. Tests could not cover RLS denials, live-update races, or expired invitations.
- **Fix.** Let each test provide RPC responses and fire live-update events.

---

## P2: worth doing, not urgent

### 12. `TaskContext.tsx` is 733 lines

- **Problem.** The reducer, initial fetch, live-update wiring, and about ten CRUD actions all lived in one file. That made review and testing harder. It also hid repeated logic, including position calculations in both `addTask` and `moveTask`.
- **Fix.** Split it into `taskReducer.ts`, `useTaskInit.ts`, `useTaskRealtime.ts`, and `useTaskActions.ts` without changing behavior.

### 13. Magic numbers + duplicated position math

- **Location.** Position calculations in `TaskContext.tsx`, title truncation in `TaskCard.tsx`, and the inline slug function in `addColumn`.
- **Fix.** Define `POSITION_STEP`, then move `calculatePosition()` and `slugify()` into `taskUtils.ts`.

### 14. Re-render cost on large boards

- **Location.** The hash-listener effect in `KanbanBoard.tsx` depended on `state.tasks`, and `TaskCard` was not memoized.
- **Problem.** Every task edit rendered every card and reattached the hash-change listener. The cost was negligible around 50 tasks and noticeable around 500.
- **Fix.** Wrap `TaskCard` in `React.memo`, give it a stable `onClick`, and make the hash-change effect depend only on the lookup map.

### 15. `TaskStatus = string`

- **Location.** `src/types/index.ts`.
- **Problem.** The type system could not distinguish reserved statuses such as `backlog` and `done`.
- **Fix.** Use `type TaskStatus = 'backlog' | 'done' | (string & {})` to keep literal completion while allowing custom columns.

### 16. Modal focus is not trapped

- **Location.** `TaskModal.tsx`, `TaskDetailModal.tsx`, and `InviteHandler.tsx`.
- **Problem.** Tabbing past the last field moved focus behind the modal.
- **Fix.** Trap focus inside the modal and restore it when the modal closes.

### 17. Test coverage gaps

- **Missing coverage.** `AuthContext`, `InviteHandler`, live updates, drag and drop, subtask deletion, and mutation failures.
- **Fix.** After improving the mock in item 11, add one integration test for each missing flow.

---

## P3: optional improvements

- Add `lint` / `typecheck` / `format` npm scripts and run them in CI (today only `build` and `test` run).
- Add Husky + lint-staged to block broken commits.
- Expand README with Supabase setup steps, how to run migrations, and auth redirect configuration.
- Document the schema with an ER diagram or `supabase/SCHEMA.md`. At the time of review, SQL was the only documentation.
- Add pagination or virtualization if boards approach 1,000 tasks. Smaller boards did not need it.
- Consider Playwright for smoke tests on the login → create task → invite flow.

---

## What I did *not* find

- No `dangerouslySetInnerHTML`, no XSS vectors in current rendering paths.
- No hardcoded secrets; anon key usage is correct for a browser app.
- RLS policies look sound: `is_board_member()` gates every sensitive table; `security definer` RPCs check membership.
- `build` already ran `tsc -b` before Vite, so type errors could not slip into a deploy.
- GitHub Actions workflow is clean (uses `npm ci`, secrets injected correctly).

---

## Suggested order of attack

1. **Day 1.** Add `.env.example`, remove unsafe type casts, move position assignment into the RPC, and generate database types. These changes were low risk and made later work easier to verify.
2. **Days 2 and 3.** Add invite revocation, improve error handling, and make cascade deletion atomic. These changes touched both the schema and client.
3. **Week 2.** Fix live-update cleanup and keyboard access, then improve the mock so error-path tests could be added.
4. **As time allowed.** Split the context, extract constants, and reduce unnecessary renders.
