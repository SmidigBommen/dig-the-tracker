# Decisions to Make — Local Postgres Migration

The initial choices are confirmed and implemented. The full comparison and rationale are in `ARCHITECTURE_OPTIONS.md`.

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

- **Fastify:** built-in validation model, hooks, plugin boundaries, and injection testing.
- **Express 5:** familiar and unopinionated, but requires more decisions around validation, typing, errors, and tests.
- **Hono:** small Web-Standards API with runtime portability, although Node uses an adapter.

### Implemented choice

Use Node's built-in HTTP server, confined to `api/server.ts`. The application services and repositories remain independent of HTTP types so the adapter can be replaced later.

### Decision

- [ ] Fastify
- [ ] Express 5
- [ ] Hono
- [x] Node HTTP adapter (selected because required framework packages were unavailable locally; isolated for later replacement)

## 2. PostgreSQL access

### Options

- **Raw `pg`:** transparent parameterized SQL and minimal abstraction, with manual row typing and mapping.
- **Kysely + `pg`:** type-safe SQL-like queries, with an additional query-builder and schema-type layer.
- **Drizzle:** integrated typed schema, query, and migration tooling, with greater toolkit coupling.
- **Prisma:** comprehensive generated client and tooling, but heavier than this project appears to need.

### Lean recommendation

**Raw `pg`**, with SQL isolated in repository modules and explicit row-to-domain mappers. Reassess Kysely only if query typing becomes a recurring defect source.

### Decision

- [x] Raw `pg`
- [ ] Kysely + `pg`
- [ ] Drizzle
- [ ] Prisma

## 3. Schema migrations

### Options

- **Small SQL runner:** numbered portable SQL files with a ledger, checksums, advisory lock, transactions, and failure handling maintained by us.
- **dbmate or comparable SQL-first tool:** keeps migrations as SQL while outsourcing bookkeeping to a mature external tool.
- **node-pg-migrate:** stays within Node tooling but introduces its migration API and conventions.
- **ORM-owned migrations:** appropriate only if the matching ORM is selected for database access.

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

- **Mutation responses plus refetch-on-focus:** no collaboration infrastructure; another tab may be stale until focused.
- **Polling plus refetch-on-focus:** simple convergence, with periodic background requests.
- **Server-Sent Events:** near-realtime one-way delivery with browser reconnection; writes continue over HTTP.
- **WebSockets:** full duplex, but require more protocol, heartbeat, reconnection, and backpressure handling than this application currently needs.
- **PostgreSQL `LISTEN/NOTIFY`:** useful when multiple API instances or external database writers exist, but unnecessary for one API process.

### Lean recommendation

Use **mutation responses plus a complete refetch on focus**. Add polling or SSE only when multi-client collaboration becomes an actual requirement.

### Decision

- [x] Mutation responses plus refetch-on-focus
- [ ] Polling initially
- [ ] SSE in the first release
- [ ] WebSockets in the first release

## 6. Round-one identity

### Decision

- [x] No authentication; one seeded local actor

There is no signup, login, logout, email identity, session table, session cookie, membership role, or invite flow in the initial local release. Keep a stable actor ID and actor context in the domain so a future authentication provider can be added without rewriting task and comment ownership.

## Implemented smallest viable stack

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

This deliberately excludes an ORM, GraphQL, tRPC, Redis, WebSockets, PostgreSQL notifications, microservices, and a Supabase compatibility layer until a demonstrated need justifies them.
