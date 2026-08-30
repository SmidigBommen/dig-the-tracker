# Local PostgreSQL decisions

These choices are implemented. See [the architecture record](ARCHITECTURE_OPTIONS.md) for the alternatives and rationale.

## Locked constraints

- Supabase is offline and cannot be used for runtime, development, tests, fallback, or rollback.
- PostgreSQL will run in a local container/pod-based setup using Podman.
- Prefer the simplest viable system with loosely coupled boundaries.
- Build a modular monolith, not microservices.
- Use an explicit domain-oriented API rather than recreating Supabase/PostgREST.
- Start with one local actor and one local workspace, without signup, login, sessions, memberships, invites, or per-user authorization.
- Keep the API loopback-only and PostgreSQL private until a future authentication and authorization design is implemented.

## 1. HTTP framework

### Options

- **Fastify.** Built-in validation, hooks, plugin boundaries, and injection testing.
- **Express 5.** Familiar and unopinionated, but requires separate choices for validation, typing, errors, and tests.
- **Hono.** A small Web Standards API with runtime portability. Node requires an adapter.

### Implemented choice

Use Node's built-in HTTP server, confined to `api/server.ts`. The application services and repositories remain independent of HTTP types so the adapter can be replaced later.

### Decision

- [ ] Fastify
- [ ] Express 5
- [ ] Hono
- [x] Node HTTP adapter (selected because required framework packages were unavailable locally; isolated for later replacement)

## 2. PostgreSQL access

### Options

- **Raw `pg`.** Parameterized SQL with little abstraction, plus manual row types and mapping.
- **Kysely with `pg`.** Typed SQL-like queries, plus a query builder and schema type layer.
- **Drizzle.** Typed schema, query, and migration tools in one package, which ties more of the project to that toolkit.
- **Prisma.** A generated client and broad tooling, but more machinery than this project needs.

### Implemented choice

Use **raw `pg`**. Keep SQL in repository modules and map rows to domain objects explicitly. Reassess Kysely only if query typing causes repeated defects.

### Decision

- [x] Raw `pg`
- [ ] Kysely + `pg`
- [ ] Drizzle
- [ ] Prisma

## 3. Schema migrations

### Options

- **Small SQL runner.** Numbered SQL files, with a ledger, checksums, an advisory lock, transactions, and failure handling maintained in this repository.
- **dbmate or a similar SQL-first tool.** Keep migrations as SQL and delegate bookkeeping to an external tool.
- **node-pg-migrate.** Stay in the Node toolchain but adopt its migration API and conventions.
- **ORM-owned migrations.** Use only with the matching ORM.

Container initialization scripts alone are not sufficient because they only run against an empty volume.

### Implemented choice

Use the **small SQL runner** in `api/migrate.ts`. It keeps migrations portable and avoids an unavailable external image while providing the required ledger, SHA-256 drift checks, PostgreSQL advisory lock, per-migration transactions, and rollback/reapply path. Its parser is unit-tested and its execution is exercised by the real-PostgreSQL CI job.

### Decision

- [x] Small SQL runner
- [ ] dbmate SQL-first migrations
- [ ] node-pg-migrate
- [ ] ORM-owned migrations

## 4. Initial authorization and exposure

### Decision

- [x] Local single-workspace mode with no per-user authorization

The server selects the configured workspace and local actor. Browser requests do not supply trusted actor or board identifiers. Public or shared-network exposure is prohibited until authentication, authorization, and their integration tests are added.

## 5. Initial synchronization

### Options

- **Mutation responses plus refresh-on-focus.** Requires no collaboration infrastructure. A background tab can remain stale until it receives focus.
- **Polling plus refresh-on-focus.** Converges between tabs through periodic background requests.
- **Server-Sent Events.** Sends one-way updates with browser-managed reconnection. Writes continue over HTTP.
- **WebSockets.** Supports two-way messages but requires a protocol, heartbeats, reconnection, and backpressure handling that this application does not need.
- **PostgreSQL `LISTEN/NOTIFY`.** Useful with several API instances or external database writers, but unnecessary for one API process.

### Implemented choice

Use **mutation responses plus a complete refresh on focus**. Add polling or SSE only when the product needs multiple active clients.

### Decision

- [x] Mutation responses plus refetch-on-focus
- [ ] Polling initially
- [ ] SSE in the first release
- [ ] WebSockets in the first release

## 6. Round-one identity

### Decision

- [x] No authentication; one seeded local actor

There is no signup, login, logout, email identity, session table, session cookie, membership role, or invite flow in the initial local release. Keep a stable actor ID and actor context in the domain so a future authentication provider can be added without rewriting task and comment ownership.

## Implemented stack

The current implementation is:

```text
React + existing reducer/context
  -> handwritten typed fetch client
    -> Node HTTP modular monolith
      -> application services
        -> pg repositories
          -> PostgreSQL

Local orchestration: Podman Compose
Migrations: checksummed SQL files + small locked/transactional runner
Authorization: none in local single-workspace mode; server fixes actor/workspace
Authentication: deferred; one seeded local actor
Synchronization: mutation responses and refetch-on-focus
Tests: HTTP-boundary mocks + real-Postgres integration tests
```

This excludes an ORM, GraphQL, tRPC, Redis, WebSockets, PostgreSQL notifications, microservices, and a Supabase compatibility layer. Add one only when a concrete requirement justifies it.
