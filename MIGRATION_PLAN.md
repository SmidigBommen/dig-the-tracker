# Migration Plan — Supabase → Local Postgres

Status: **Implemented and verified in the working tree. Build, lint, unit, boundary, migration, and real-PostgreSQL concurrency tests pass. Disposable Podman/PostgreSQL testing works locally and the equivalent PostgreSQL-backed test is wired into CI.**

## Locked constraints

- Supabase is offline and unavailable. It cannot be used for runtime, development, tests, fallback, or rollback.
- Replace it completely with a custom backend and local PostgreSQL.
- Run PostgreSQL through a container/pod-based local setup using Podman.
- Prefer a simple modular monolith with explicit, loosely coupled boundaries.
- Do not recreate Supabase, PostgREST, or its chainable client API.
- Restore a fully functional single-user local application before considering authentication, collaboration, or public deployment.
- Round one has one seeded local actor and one server-configured workspace, with no signup, login, session, membership, invite, or per-user authorization flow.
- The API is loopback-only and PostgreSQL remains private until a future authentication and authorization design is implemented.

See `ARCHITECTURE_OPTIONS.md` for the framework, database, migration, authorization, authentication, synchronization, package, and orchestration alternatives.

## Current dependency surface

The current Supabase dependency surface includes:

- PostgreSQL tables for profiles, boards, memberships, invites, columns, tasks, and comments.
- Magic-link auth and browser sessions currently supplied by Supabase Auth.
- PostgREST reads and mutations used throughout `AuthContext` and `TaskContext`.
- Stored operations for default-board creation, issue numbering, task creation, and invite acceptance.
- Realtime updates for tasks, comments, columns, and memberships.
- Supabase-specific RLS policies and `auth.uid()`.
- The chainable Supabase test mock.

Round one replaces the database and domain operations but deliberately removes the authentication, membership, invite, and realtime collaboration features. It preserves stable actor and board identifiers so those capabilities can be redesigned later without rewriting task and comment ownership.

The browser must no longer know database table names or issue database-shaped queries. It will call domain-oriented HTTP operations through a typed client.

---

## Phase 0 — Confirm architecture and preserve behavioral baseline

1. Record the selected HTTP, database-access, and migration choices.
2. Create a migration branch from GitHub `master` at `16dbaee`.
3. Install the synchronized dependencies and record current build, lint, and test results as behavioral evidence only.
4. Inventory every existing Supabase read, mutation, RPC, auth call, and subscription.
5. Preserve any existing database dump if one is already available. Legacy data recovery is optional and must not block the replacement.

**Checkpoint:** approved remaining architecture decisions, clean migration branch, baseline results, and complete operation inventory.

## Phase 1 — PostgreSQL container and portable schema

1. Add a local Compose file with a version-pinned PostgreSQL image, named volume, health check, and localhost-only host binding when required.
2. Add a real incremental migration mechanism; do not rely only on container initialization scripts.
3. Port the useful round-one domain schema into portable migrations.
4. Add a local actors table with one stable seeded actor; do not add a sessions table.
5. Seed one stable workspace and its default columns.
6. Keep actor IDs on task and comment ownership fields and board IDs on domain records, but omit memberships, invite shares, and RLS policies from round one.

**Checkpoint:** one command resets, migrates, and seeds the database; persistent data survives container recreation.

## Phase 2 — Transactional domain operations

Move invariants currently calculated in React or Supabase RPCs behind application services and database transactions:

1. Create and identify the configured local workspace deterministically.
2. Store `next_task_number` on the board and increment it while locking that row. Do not use `max(number) + 1`.
3. Calculate task and column positions on the server; normalize positions when no numeric gap remains.
4. Delete task/subtask trees atomically.
5. Assign task and comment actor IDs on the server; never trust actor or board IDs from browser input.
6. Map database rows to plain domain objects inside repository adapters.

**Checkpoint:** real-Postgres tests prove unique sequential issue numbers, deterministic ordering, fixed server-side actor/workspace scoping, and rollback on failure.

## Phase 3 — Custom API and local actor

Implement a modular monolith with explicit endpoints:

```text
GET    /api/bootstrap
PATCH  /api/profile
POST   /api/tasks
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/comments
DELETE /api/tasks/:taskId/comments/:commentId
POST   /api/columns
PUT    /api/columns/order
DELETE /api/columns/:slug
GET    /api/healthz
```

Rules:

- Route adapters validate transport input and call framework-independent application services.
- SQL exists only in repository adapters and is always parameterized.
- The API binds to loopback and accepts only explicit local browser origins.
- PostgreSQL is reachable only through the private container network or a loopback binding.
- The HTTP adapter supplies the stable local actor and configured workspace to application services.
- Request DTOs do not accept trusted actor IDs, user IDs, or board IDs.
- `/api/bootstrap` returns the local actor, current workspace, columns, tasks, and comments in one typed response.

**Checkpoint:** route tests and real-database tests cover success, invalid input, server-side actor/workspace assignment, rejected identity overrides, and loopback-safe configuration.

## Phase 4 — Frontend cutover

1. Add a small typed API client exposing domain operations such as `bootstrap`, `createTask`, and `updateProfile`.
2. Remove the login page, auth gate, sign-out action, invite handler, invite UI, and email identity UI; replace `AuthContext` with the local actor returned by bootstrap.
3. Rewrite `TaskContext`, the remaining profile functionality, and local-data import to use the typed client.
4. Preserve the existing reducer and UI behavior where it remains useful.
5. Replace Supabase row casts with explicit API DTOs and domain mappers.
6. Replace the Supabase chain mock with HTTP-boundary mocks.
7. Remove `@supabase/supabase-js` as soon as the frontend compiles against the custom API. There is no backend feature flag.

**Checkpoint:** ordinary CRUD, subtasks, comments, `DIG-N` links, custom columns, local profile preferences, reports, and search work using only the local API and PostgreSQL.

## Phase 5 — Refresh behavior and deferred collaboration

1. Update frontend state from successful mutation responses.
2. Perform a complete bootstrap resync when the window regains focus and after recoverable errors.
3. Do not add a change publisher, polling loop, SSE, WebSockets, PostgreSQL notifications, or Redis in round one.
4. Treat multi-client collaboration as a future feature that must be designed together with authentication and authorization.

**Checkpoint:** one local client remains consistent after mutations, focus changes, API restarts, and recoverable errors.

## Phase 6 — Remove Supabase and verify the local replacement

1. Delete `src/lib/supabase.ts`, `src/test/supabaseMock.ts`, and every Supabase import.
2. Remove Supabase environment variables, package dependencies, CI settings, and documentation.
3. Move the useful schema into `db/migrations` and remove the `supabase/` directory after parity is verified.
4. Update `CLAUDE.md`, `README.md`, container instructions, and architecture notes.
5. Add repository-wide checks proving there is no active Supabase dependency.
6. Run clean install, build, lint, unit, API, database-integration, concurrency, and smoke tests with Supabase unreachable. `npm run test:db` owns a disposable Podman database locally; `npm run test:db:running` targets CI's PostgreSQL service.
7. Document and test local backup and restore commands.

**Checkpoint:** one documented command starts the local application, all tests pass, and no runtime or test path depends on Supabase.

## Phase 7 — Optional self-hosted deployment

Only after local dogfooding:

1. Select and implement an authentication, authorization, membership, and onboarding design before any shared-network or public exposure.
2. Add security tests for anonymous access, identity handling, and cross-board denial.
3. Containerize the API and web application.
4. Keep PostgreSQL on a private network and persistent host storage.
5. Choose a reverse proxy and configure TLS, security headers, and request limits.
6. Add Quadlet/systemd lifecycle management for the Ubuntu host.
7. Add daily encrypted off-host backups and complete a restore drill before launch.
8. Import legacy data only if a usable dump exists; otherwise start fresh.

---

## Definition of done for the local replacement

- One documented command starts PostgreSQL and the API.
- One documented command resets, migrates, and seeds the database.
- The frontend works without Supabase credentials or network access.
- No production or test dependency references Supabase.
- The selected single-user product behavior is preserved, including task-reference links in comments and local profile preferences.
- Signup, login, logout, sessions, memberships, invites, and realtime collaboration are absent from round one.
- The server, not the browser, selects the local actor and workspace.
- Concurrent issue numbering uses real-Postgres tests.
- The API is loopback-only and PostgreSQL is not publicly reachable.
- Persistent data survives container recreation.
- Backup and restore are documented and tested locally.

The initial architecture choices are confirmed and the migration is implemented. Public exposure and multi-user features remain explicitly out of scope.
