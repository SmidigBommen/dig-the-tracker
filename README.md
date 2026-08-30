# Dig: local issue tracker

Dig is a local, single-user kanban issue tracker built with React, TypeScript, a small Node HTTP API, and PostgreSQL 16.

This release has no signup, login, sessions, memberships, invitations, or live collaboration. It uses one seeded local actor and one server-configured workspace. Do not expose it to a LAN or the internet.

## What it does

- Customizable kanban columns and drag-and-drop task ordering
- Tasks with priorities, assignees, tags, and sequential `DIG-N` numbers
- Subtasks with progress tracking and transactional cascade deletion
- Comments with automatically linked `DIG-N` references
- Search, priority filtering, deep links, and reports
- Local display name and avatar color preferences
- PostgreSQL persistence with transactional numbering and ordering

## Run the full application

Start the application on loopback:

```sh
./scripts/compose -f podman-compose.yml up --build
```

Open http://127.0.0.1:8080. The application and PostgreSQL ports bind to host loopback. The containers share a private network.

To stop the application without deleting its database volume:

```sh
npm run db:down
```

## Local development

Start PostgreSQL and apply migrations:

```sh
npm install
npm run db:up
npm run db:migrate
```

Run the API and Vite frontend in separate terminals:

```sh
npm run dev:api
npm run dev
```

Open http://127.0.0.1:5173. Copy `.env.example` to `.env.local` only when overriding the defaults.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run the Vite frontend with `/api` proxying to port 3001 |
| `npm run dev:api` | Compile and run the loopback-only local API |
| `npm run build` | Type-check and build the frontend and API |
| `npm test` | Run frontend, context, validation, and service-boundary tests |
| `npm run test:db` | Create a disposable Podman PostgreSQL instance, migrate it, and run concurrency tests |
| `npm run test:db:running` | Migrate and test an existing PostgreSQL service (used by CI) |
| `npm run lint` | Lint frontend and API code |
| `npm run db:up` | Start PostgreSQL |
| `npm run db:migrate` | Apply pending checksummed SQL migrations |
| `npm run db:reset` | Roll back and reapply all SQL migrations |
| `npm run db:down` | Stop local services without deleting the volume |
| `npm run db:backup` | Write `dig-backup.dump` in PostgreSQL custom format |
| `npm run db:restore` | Replace local database contents from `dig-backup.dump` |

`db:reset` and `db:restore` replace local database contents. Use them only when that is what you intend.

## Architecture

```text
React reducer/context
  -> typed fetch client
    -> Node HTTP route adapter
      -> application service validation
        -> parameterized pg repository
          -> PostgreSQL 16
```

The server supplies actor and workspace identifiers. The browser cannot choose them. Database transactions handle task numbering, task and column positions, and cascade deletion. Successful mutations update client state. The client fetches a fresh bootstrap payload when the window regains focus.

Schema changes live in `db/migrations`. The migration runner records checksums in a ledger, holds a PostgreSQL advisory lock, and applies each migration in a transaction. The API and built frontend share one production container.

The Compose wrapper works around the installed provider's Python version mismatch. It also directs Podman through its service socket when the usual rootless runtime directory is unavailable. This local stack does not use Kubernetes because it would add a control plane without removing the container runtime dependency.

## Risk controls

The absence of signup does not make this an anonymously accessible application. Local use depends on these controls:

- The API and database publish only on `127.0.0.1`. Browser origins are allowlisted. Non-loopback API binding requires an explicit container-only override.
- The server supplies the actor and workspace, so request bodies cannot select a trusted identity or board.
- Actor and workspace identifiers remain in the domain model. Future authentication can use them without carrying Supabase Auth forward.
- PostgreSQL transactions serialize issue numbering and ordering. Local and CI tests cover concurrent writes against a real database.
- The migration runner validates checksums and takes a lock. Backup and restore commands cover the persistent database.
- Public or shared-network deployment remains blocked until the application has authentication, authorization, membership isolation, and negative security tests.

See [the decision record](decisions-to-make.md) and [risk register](RISK_REGISTER.md) for the full rationale.

## Security boundary

The API refuses non-loopback binding unless `ALLOW_CONTAINER_BIND=true`. The container sets that override while publishing port 8080 only to `127.0.0.1`. The API allowlists browser origins and limits request body size.

Authentication, authorization, memberships, invites, multi-user synchronization, and public deployment are future features. They must be implemented and security-tested before changing the loopback-only exposure.
