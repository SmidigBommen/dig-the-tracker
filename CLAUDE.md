# Project notes

## Git

- Remote: `git@github.com:SmidigBommen/dig-the-tracker.git`
- Default branch: `master`
- Preserve unrelated working-tree changes. This repository may be dirty.

## Current implementation

- Slices 1 and 2 of the small-team MVP are implemented.
- The running React entry is `src/team/TeamApp.tsx`; it handles sign-in, invitations, Space selection, membership administration, Space lifecycle, the empty default Board, reload, and sign-out.
- The Node HTTP Adapter is `api/server.ts`.
- `IdentityModule` owns OpenID Connect correlation and PostgreSQL sessions.
- `SpaceModule` owns Space reads, invitations, membership, roles, lifecycle, audit, idempotent changes, access invalidation, and request authorization.
- `BoardModule` implements the empty overview read and transaction-time access recheck. Its change and follow entries remain later-slice placeholders.
- PostgreSQL 16 uses checksummed migrations. New team tables live in the `team` schema.
- The old public-schema Task prototype and browser files remain for replacement in Slice 3, but the runtime entry does not import them.
- The repository Compose path remains loopback-only. Public deployment is blocked.

## Structure

```text
ARCHITECTURE.md
CONTEXT.md
api/
  adapters/oidc/       OpenID Connect port, production Adapter, test Adapter
  modules/identity/    IdentityModule Interface and Implementation
  modules/space/       SpaceModule Interface and Implementation
  modules/board/       BoardModule overview and access recheck
  config.ts            runtime and OpenID Connect configuration
  server.ts            HTTP, cookie, CSRF, JSON, health, static-file Adapter
  migrate.ts           checksummed migration runner
db/migrations/
  202608300001_initial.sql         retained prototype schema
  202609040001_team_slice_one.sql  team identity, Space, and Board schema
  202609040002_space_membership.sql invitations, audit, and Space lifecycle
src/
  team/TeamApp.tsx      running Slice 1 browser Module
  team/team-api.ts      owned HTTP Adapter
  context/, components/, lib/api.ts  retained prototype, not running
docs/design/            confirmed product and Module design
docs/implementation/    delivered-slice notes
```

## Module rules

- Test behavior through `IdentityModule`, `SpaceModule`, and `BoardModule`; do not expose a repository Interface to mock PostgreSQL.
- OpenID Connect is a true-external port with production and mock Adapters.
- Browser input cannot construct or inspect `AuthenticatedIdentity` or `AuthorizedSpace`.
- An authorized Space is evidence to recheck inside the Board transaction, not a lasting bearer permission.
- Human names, Space keys, and Column names never own relationships.
- Each Space has one unnamed Board, one Intake Column, and one Completion Column.
- New Active Columns require a positive WIP limit. Exceeding it warns and allows movement once Task changes arrive.
- Expected Module failures use typed result values. HTTP status codes and PostgreSQL errors do not cross Module Seams.

## Commands

| Command | Purpose |
|---|---|
| `npm run build` | Type-check and build browser and server |
| `npm test` | Run regular Vitest suites |
| `npm run test:db` | Run migrations and integration tests in disposable PostgreSQL |
| `npm run test:db:running` | Run database tests against an existing PostgreSQL instance |
| `npm run lint` | Run ESLint |
| `npm run db:up` and `npm run db:migrate` | Start and migrate local PostgreSQL |
| `npm run dev:api` and `npm run dev` | Start the server and Vite development processes |
| `./scripts/compose -f podman-compose.yml up --build` | Run the configured app at `127.0.0.1:8080` |

## Next slice

Slice 3 adds Task capture, editing, assignment, tags, archive and restore, bounded pages, and the browser `BoardSession`. Follow [the vertical-slice plan](docs/design/vertical-slice-plan.md). Keep this file and `ARCHITECTURE.md` synchronized with delivered behavior.
