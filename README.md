# Dig team Kanban

Dig is a flow-based Kanban system for small teams. The current implementation is Slice 1 of the team MVP: OpenID Connect sign-in, PostgreSQL sessions, Space creation and selection, and the default empty Board.

The running application does not expose the retained single-actor Task prototype. Task creation and movement return in Slice 3 behind the new `BoardModule` Interface.

## Current behavior

- OpenID Connect authorization-code sign-in with PKCE and signed ID-token verification
- Server-side sessions with five-day idle and 30-day absolute expiry
- Origin and CSRF checks for browser changes
- Installation-administrator-only Space creation
- One unnamed Board per Space
- Default Backlog, In Progress with WIP limit 3, and Done Columns
- Space selection, last-Space reload, and sign-out
- PostgreSQL persistence and checksummed migrations

Invitations, membership administration, Tasks, comments, live updates, reports, archive behavior, and export are not implemented in the running path yet. Do not expose this build publicly.

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
| `npm run test:db:running` | Run the same database tests against an existing PostgreSQL instance |
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
