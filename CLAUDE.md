# Project notes

## Git

- Remote: `git@github.com:SmidigBommen/dig-the-tracker.git`
- Default branch: `master`

## Current architecture

- Local single-user modular monolith; Supabase is completely removed.
- React 19 + TypeScript + Vite frontend.
- Node built-in HTTP route adapter, isolated in `api/server.ts`.
- Application validation in `api/service.ts`; parameterized PostgreSQL access in `api/repository.ts`.
- PostgreSQL 16, managed with Podman Compose and versioned checksummed SQL migrations.
- One seeded actor and one configured workspace. No authentication, sessions, memberships, invitations, RLS, or live collaboration.
- API defaults to loopback. The container binds internally only with an explicit override and publishes to host loopback.
- Mutation responses update the reducer; focus triggers a complete `/api/bootstrap` resync.

## Structure

```text
api/
  config.ts             # loopback/exposure and local actor/workspace configuration
  db.ts                 # pg pool and transaction helper
  migrate.ts            # migration ledger, checksums, advisory lock, transactions
  errors.ts             # transport-safe application errors
  repository.ts         # parameterized SQL and transactional invariants
  service.ts            # input validation and application operations
  server.ts             # Node HTTP routes, origin checks, static serving
  service.test.ts       # local identity/exposure boundary tests
db/migrations/
  202608300001_initial.sql # portable schema and deterministic seed
src/
  App.tsx               # TaskProvider and board/report/profile views
  lib/api.ts            # typed domain-oriented fetch client and DTO mapper
  context/TaskContext.tsx # reducer, bootstrap, mutations, focus resync
  components/           # kanban, tasks, reports, and local profile UI
  test/apiMock.ts       # HTTP-client boundary mock
Containerfile           # builds API + frontend; runs as non-root Node user
podman-compose.yml      # private PostgreSQL, migration job, loopback app
scripts/                # Compose compatibility and disposable DB-test harnesses
```

## Domain invariants

- The server assigns actor and workspace IDs; request DTOs never accept trusted identity or board scope.
- A board row stores `next_task_number`; creation locks and increments it transactionally.
- Task and column positions are calculated server-side and normalized when gaps are exhausted.
- Parent task deletion cascades through subtasks and comments in one transaction.
- Protected columns cannot be deleted; non-protected columns must be empty.
- Task references use hash links such as `#DIG-5`.

## Commands

| Command | Purpose |
|---|---|
| `npm run build` | Type-check and build the frontend and API |
| `npm test` | Run all Vitest suites |
| `npm run test:db` | Run migration and concurrency tests against a disposable PostgreSQL container |
| `npm run test:db:running` | Run the same test against an existing database; CI uses this command |
| `npm run lint` | Run ESLint |
| `npm run db:up` and `npm run db:migrate` | Start and migrate the local database |
| `npm run dev:api` and `npm run dev` | Start the API and frontend development processes |
| `./scripts/compose -f podman-compose.yml up --build` | Run the full application on `127.0.0.1:8080` |

## Future boundary

Do not expose the current application to a LAN or public network. Authentication, authorization, memberships, onboarding, invitations, and collaboration must be designed and tested as a separate feature before exposure changes.

Keep this file synchronized with architecture and file-layout changes.
