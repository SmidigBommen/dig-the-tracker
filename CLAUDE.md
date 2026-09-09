# Project notes

## Git

- Remote: `git@github.com:SmidigBommen/dig-the-tracker.git`
- Default branch: `master`
- Preserve unrelated working-tree changes. This repository may be dirty.

## Current implementation

- Slices 1 through 8 of the small-team MVP are implemented.
- The running React entry is `src/team/TeamApp.tsx`; it handles sign-in, invitations, Space selection, membership administration, Space lifecycle, Task capture, editing, assignment, Tags, Subtasks, Task Archive, movement, closure Outcomes, history, comments, mentions, the in-app inbox, reload, and sign-out.
- The Node HTTP Adapter is `api/server.ts`.
- `IdentityModule` owns OpenID Connect correlation and PostgreSQL sessions.
- `SpaceModule` owns Space reads, invitations, membership, roles, lifecycle, audit, idempotent changes, access invalidation, and request authorization.
- `BoardModule` owns Task reads and changes, revisions, numbering, Tags, Subtasks, archive/restore, relative placement, order revisions, closure Outcomes, immutable flow history, comment revisions and tombstones, Notifications, cursor pages, and transaction-time access checks. `follow` streams committed updates with access rechecks, bounded replay, and recipient filtering. Declarative workflow edits are administrator-only and atomic. Scheduled archive preserves Task families and local-date retention; Space deletion removes scoped receipts while retaining non-personal key reservations.
- `BoardSession` owns browser Task state, drafts, live updates, and snapshot recovery through the `BoardTransport` port. Owned HTTP and in-memory test Adapters share wire values in `api/contracts/board.ts`.
- PostgreSQL 16 uses checksummed migrations. New team tables live in the `team` schema.
- Slice 3 removes the prototype mutation path and drops its public-schema tables with a forward migration. Team data remains in the `team` schema.
- Member removal and leave call Board-owned unassignment inside the Space transaction. Preserve the Space, Member, session, then Board lock order.
- The repository Compose path remains loopback-only. Coolify setup for real-provider sign-in validation precedes Slice 3; the remaining team-release gates still apply.
- For Coolify setup, OIDC configuration, or deployment verification, follow [the deployment guide](docs/coolify-deployment.md). Server startup now migrates before listening, and the image probes `/health/ready` against PostgreSQL.

## Module rules

- Test behavior through `IdentityModule`, `SpaceModule`, and `BoardModule`; do not expose a repository Interface to mock PostgreSQL.
- OpenID Connect is a true-external port with production and mock Adapters.
- Browser input cannot construct or inspect `AuthenticatedIdentity` or `AuthorizedSpace`.
- An authorized Space is evidence to recheck inside the Board transaction, not a lasting bearer permission.
- Human names, Space keys, and Column names never own relationships.
- Each Space has one unnamed Board, one Intake Column, and one Completion Column.
- New Active Columns require a positive WIP limit. Exceeding it warns and allows movement.
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

For Slice 9 release work, read [the vertical-slice plan](docs/design/vertical-slice-plan.md), [Slice 8 notes](docs/implementation/slice-08-search-flow-workload.md), and [deployment guidance](docs/coolify-deployment.md). Search and report reads remain inside `BoardModule`; `BoardSession` owns their selection, paging, and live refresh. WIP projections are maintained transactionally and backfilled from immutable history. Preserve Space-local report definitions, full timestamp cursor precision, and recipient privacy. Use [UI foundations](docs/design/design-system.md) for new views. Keep this file and `ARCHITECTURE.md` synchronized with delivered behavior.
