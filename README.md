# Dig team Kanban

Dig is a flow-based Kanban system for small teams. The current implementation covers Slices 1 through 7 of the team MVP: authenticated Spaces, membership administration, Space lifecycle, Task capture and editing, work movement and closure, comments, the in-app inbox, and live collaboration.

Members can create, open, edit, assign, tag, archive, and restore Tasks and one-level Subtasks. They can drag or explicitly move work, close with an Outcome, reopen, and inspect immutable Task history.

## Current behavior

- OpenID Connect authorization-code sign-in with PKCE and signed ID-token verification
- Server-side sessions with five-day idle and 30-day absolute expiry
- Origin and CSRF checks for browser changes
- Installation-administrator-only Space creation
- One unnamed Board per Space
- Default Backlog, In Progress with WIP limit 3, and Done Columns
- Space selection, last-Space reload, and sign-out
- Seven-day, single-use invitation links that store only a secret digest
- Member promotion, demotion, removal, and voluntary leave with a last-administrator guard
- Session rotation or revocation after permission changes
- Space name and time-zone settings
- Read-only archive, restore, and deletion scheduling with a seven-day cancellation window
- Administrator-only invitation status and immutable access audit
- Task revisions with drafts preserved beside stale-edit conflicts
- Relative Task ordering with stale-move detection and keyboard movement
- Completed, Rejected, Cancelled, and same-Space Duplicate Outcomes
- WIP and open-Subtask warnings that allow changes to commit
- Immutable transitions, closures, reopenings, and Outcome history
- Authored comments with revisions, stable Member mentions, tombstones, and administrator moderation
- Assignment, mention, and assigned-Task comment Notifications with read state and 90-day expiry
- Bounded lane, Subtask, Archive, comment, history, inbox, and Tag autocomplete pages
- Live Board updates with automatic reconnect and snapshot recovery
- Draft preservation and paused editing while disconnected
- PostgreSQL persistence and checksummed migrations

Workflow configuration, scheduled retention, reports, permanent Space deletion, and export remain planned. Coolify setup for real-provider sign-in validation is the current deployment step; the remaining team-release gates still apply.

## Coolify setup

Follow [Coolify and OpenID Connect setup](docs/coolify-deployment.md). The existing `Containerfile` builds one application on port 8080, applies migrations before listening, and provides a database-backed readiness check. PostgreSQL runs as a separate private Coolify resource. Configure OIDC and secrets as runtime variables.

## Configure OpenID Connect

Register an authorization-code client with your provider. Dig needs these runtime values:

```dotenv
OIDC_ISSUER=https://identity.example.com
OIDC_CLIENT_ID=dig-local
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=http://127.0.0.1:8080/api/auth/callback
INSTALLATION_ADMIN_SUBJECTS=your-provider-subject
SESSION_SECRET=replace-with-at-least-32-random-characters
```

`INSTALLATION_ADMIN_SUBJECTS` is a comma-separated list of exact OpenID Connect `sub` claims. These identities may create Spaces. `OIDC_CLIENT_SECRET` may stay empty for a public client.

Production uses an HTTPS callback and Secure cookies. The local Compose setup explicitly permits its loopback HTTP callback.

## Run with Compose

Copy `.env.example` to `.env`, replace its placeholders, and register this callback with the provider:

```text
http://127.0.0.1:8080/api/auth/callback
```

Then run:

```sh
./scripts/compose -f podman-compose.yml up --build
```

Open http://127.0.0.1:8080. The application and PostgreSQL ports bind to loopback, and the containers communicate over a private network.

## Local development

Start PostgreSQL and apply migrations:

```sh
npm install
npm run db:up
npm run db:migrate
```

Copy `.env.example` to `.env.local` and change the callback to:

```text
http://127.0.0.1:5173/api/auth/callback
```

Run the server and Vite in separate terminals:

```sh
npm run dev:api
npm run dev
```

Open http://127.0.0.1:5173.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run Vite with `/api` proxying to port 3001 |
| `npm run dev:api` | Build and run the Node server using `.env.local` |
| `npm run build` | Type-check and build the browser and server |
| `npm test` | Run the regular Vitest suites |
| `npm run test:db` | Run migrations and Module/HTTP integration tests against disposable PostgreSQL |
| `npm run test:db:running` | Run the same database tests against an existing disposable PostgreSQL test instance |
| `npm run lint` | Run ESLint |
| `npm run db:up` | Start local PostgreSQL |
| `npm run db:migrate` | Apply pending checksummed migrations |
| `npm run db:reset` | Roll back and reapply every migration |
| `npm run db:down` | Stop local services without deleting the volume |

`db:reset` replaces local database contents. Use it only when intended.

## Design and implementation status

- [Current architecture](ARCHITECTURE.md)
- [Domain language](CONTEXT.md)
- [Team MVP design checkpoint](docs/design/team-kanban-checkpoint.md)
- [Vertical-slice plan](docs/design/vertical-slice-plan.md)
- [Slice 1 implementation notes](docs/implementation/slice-01-authenticated-space-shell.md)
- [Slice 2 implementation notes](docs/implementation/slice-02-safe-team-membership.md)

- [Slice 3 implementation notes](docs/implementation/slice-03-capture-and-shape-work.md)
- [Slice 4 implementation notes](docs/implementation/slice-04-move-work-and-record-flow.md)
- [Slice 5 implementation notes](docs/implementation/slice-05-discuss-and-notify.md)
- [Slice 6 implementation notes](docs/implementation/slice-06-collaborate-live.md)

Workflow settings lets Space administrators configure, reorder, archive, and restore Columns. Closed Tasks auto-archive after 30 Space-local dates; restored Closed Tasks get a new retention window. Scheduled Space deletion runs after the seven-day cancellation period. See [Slice 7 notes](docs/implementation/slice-07-workflow-retention.md).
