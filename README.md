# Dig — Local Issue Tracker

Dig is a local, single-user kanban issue tracker built with React, TypeScript, a small Node HTTP API, and PostgreSQL 16.

The first local release deliberately has no signup, login, session, membership, invite, or realtime collaboration functionality. It uses one seeded local actor and one server-configured workspace. Do not expose it to a LAN or the internet.

## Features

- Customizable kanban columns and drag-and-drop task ordering
- Tasks with priorities, assignees, tags, and sequential `DIG-N` numbers
- Subtasks with progress tracking and transactional cascade deletion
- Comments with automatically linked `DIG-N` references
- Search, priority filtering, deep links, and reports
- Local display name and avatar color preferences
- PostgreSQL persistence with transactional numbering and ordering

## Start with Podman

The complete application is exposed only on loopback:

```sh
./scripts/compose -f podman-compose.yml up --build
```

Open http://127.0.0.1:8080. The application and PostgreSQL ports bind only to host loopback; the containers also share an internal network.

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

`db:reset` and `db:restore` are destructive and should be invoked only when replacing the local database is intended.

## Architecture

```text
React reducer/context
  -> typed fetch client
    -> Node HTTP route adapter
      -> application service validation
        -> parameterized pg repository
          -> PostgreSQL 16
```

The server, not the browser, supplies the actor and workspace identifiers. Task numbering, task positioning, column positioning, and cascade deletion are database transactions. Successful mutations update client state; a complete bootstrap refresh runs when the window regains focus.

Schema changes live in `db/migrations`. The small migration runner records checksums in a ledger, holds a PostgreSQL advisory lock, and applies each migration in a transaction. The API and built frontend share one production container.

The Compose wrapper works around the installed provider's Python-version mismatch and directs Podman through its service socket when the normal rootless runtime directory is unavailable. Kubernetes is intentionally not part of the local stack: it would add a control plane while retaining the same container-runtime dependency.

## Risk controls

The current no-signup design is a local product mode, not anonymous authentication. It is bounded by these controls:

- the API and database publish only on `127.0.0.1`, browser origins are allowlisted, and non-loopback API binding requires an explicit container-only override;
- the server supplies the actor and workspace, so request bodies cannot select trusted identity or board scope;
- actor and workspace identifiers remain in the domain model, preserving a seam for future authentication without carrying Supabase Auth forward;
- PostgreSQL transactions serialize issue numbering and ordering, with real-database concurrency coverage locally and in CI;
- migrations are checksummed and locked, and the persistent database has explicit backup and restore commands;
- public or shared-network deployment remains blocked until authentication, authorization, membership isolation, and negative security tests are implemented.

The full decision and risk record is in `decisions-to-make.md` and `RISK_REGISTER.md`.

## Security boundary

The API refuses non-loopback binding unless `ALLOW_CONTAINER_BIND=true`; the container uses that explicit override only while publishing port 8080 to `127.0.0.1`. Browser origins are allowlisted and request bodies are bounded.

Authentication, authorization, memberships, invites, multi-user synchronization, and public deployment are future features. They must be implemented and security-tested before changing the loopback-only exposure.
