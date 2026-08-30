# Architecture options for local Dig

Status: **Implemented. This document records the alternatives and the reasons for the selected design.**

## Constraints already decided

- Supabase is offline and cannot be used for runtime, development, tests, fallback, or rollback.
- PostgreSQL runs locally in a container/pod-based setup.
- Prefer the simplest system that satisfies the current product.
- Keep framework, transport, database, and UI concerns loosely coupled.
- Build a modular monolith. Do not introduce distributed services without a demonstrated need.
- The first local release is single-user and has no signup, login, session, membership, invite, or per-user authorization flow.
- Authentication and public or shared-network exposure are deferred to a separate future design.

## What "loosely coupled" means here

Keep HTTP, application logic, and database access separate. Do not wrap every function in an interface.

```text
React UI
  -> typed API client
    -> HTTP route adapter
      -> application services
        -> repository interface
          -> PostgreSQL adapter
        -> change publisher interface
          -> polling, SSE, or WebSocket adapter
```

Framework request/reply objects stop at the HTTP adapter. SQL stays in the PostgreSQL repository. Application services operate on plain TypeScript inputs and outputs. The UI never knows table names or query syntax.

---

## 1. Overall shape

| Choice | Advantages | Costs | Fit |
|---|---|---|---|
| **Modular monolith** | One API process, one DB, ordinary function calls, simple transactions and deployment | Requires discipline to retain module boundaries | **Recommended** |
| Microservices | Independent scaling and deployment | Networking, tracing, retries, eventual consistency, more containers | Too complex for this project |
| Database API/PostgREST clone | Less route code initially | Recreates the coupling we are removing and exposes persistence concepts to the UI | Reject |

The initial modules are `workspace`, `tasks`, `comments`, and `columns`. They share one process and database. Modules call application-service functions instead of importing one another's SQL. Authentication, membership, invitations, and live updates are not present in this release.

---

## 2. HTTP framework

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **Fastify** | Built-in schema validation model, hooks, structured plugins, and first-class injection testing; intended for small and large projects | Framework-specific schemas/hooks; plugin architecture can be overused | **Leading choice** |
| Express 5 | Familiar, extremely small conceptual core, makes few structural assumptions | Validation, typing, async conventions, and testing patterns require additional choices | Good conservative alternative |
| Hono | Small Web-Standards API, portable across runtimes, Node adapter includes WebSocket support | Portability is not currently required; Node support uses an adapter and its ecosystem is newer | Good if runtime portability matters |
| **Node `http` directly** | Minimum dependencies and complete control | Requires explicit routing, validation, errors, security headers, and test seams | **Selected because the framework packages were unavailable locally; confined to `api/server.ts`** |

Fastify explicitly emphasizes plugin boundaries, validation, and testability in its [technical principles](https://fastify.dev/docs/latest/Reference/Principles/). Express deliberately leaves structure, database access, and authentication to the application, per its [official FAQ](https://expressjs.com/en/starter/faq/). Hono runs on Node through an adapter and documents Node WebSocket integration in its [Node guide](https://hono.dev/docs/getting-started/nodejs).

**Decision.** Use Node's built-in HTTP server, confined to `api/server.ts`. Application services and repositories do not import HTTP types. Fastify can replace the adapter later if its validation and injection testing justify another dependency.

---

## 3. API style

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **Explicit JSON REST endpoints** | Browser-native, debuggable, stable contracts, framework-independent client | Some route and DTO code | **Recommended** |
| tRPC | Excellent TypeScript inference across client/server | Couples frontend and backend build/tooling; awkward for non-TS clients | Not needed |
| GraphQL | Flexible querying and rich tooling | Schema, resolver, authorization, caching, and N+1 complexity | Too large for current needs |
| Generic CRUD/query API | Very little endpoint design | Leaks schema, expands authorization surface, recreates PostgREST | Reject |

Use resource and command endpoints for actual product operations. Do not expose arbitrary filters or table names.

---

## 4. PostgreSQL access

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **`pg` + parameterized SQL** | Direct, mature, transparent SQL, minimum abstraction, easy to optimize | Manual row/result typing and mapping | **Leading choice for this small schema** |
| Kysely + `pg` | Type-safe SQL-like query builder and inferred results | Adds schema type generation/maintenance and query-builder concepts | Best alternative if raw-SQL typing becomes painful |
| Drizzle | Typed schema, queries, and migration tooling in one ecosystem | More of the project becomes coupled to one data toolkit | Good integrated option, less loosely coupled |
| Prisma | Strong generated client and broad tooling | Heavier abstraction, generated schema/client workflow, less direct SQL | More than this project needs |

`node-postgres` supports parameterized queries, which must be used instead of string concatenation; see its [query documentation](https://node-postgres.com/features/queries). Kysely describes itself as a type-safe SQL query builder in its [introduction](https://www.kysely.dev/docs/intro). Drizzle intentionally combines typed schema, SQL-like querying, and optional tooling, as described in its [overview](https://orm.drizzle.team/docs/overview).

**Implemented choice.** Use `pg`, keep SQL in repository modules, and map rows to domain objects explicitly. Reassess Kysely only if query typing causes repeated defects.

---

## 5. Schema migrations

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **Numbered SQL files + small migration runner** | SQL remains portable and reviewable; no ORM lock-in | Runner must correctly provide a ledger, checksum, lock, transaction, and failure handling | **Lean option** |
| dbmate or similar SQL-first tool | Mature migration bookkeeping while retaining SQL files | Adds an external binary/container and its conventions | Strong alternative |
| node-pg-migrate | Stays in Node tooling and provides migration lifecycle | Migrations use a library API or embedded SQL | Strong alternative |
| ORM-owned migrations | One schema/query toolchain | Tightest coupling and awkward for advanced PostgreSQL features | Only if selecting that ORM |

Do not use only `/docker-entrypoint-initdb.d`; it runs only for an empty volume and is not an incremental migration system.

**Implemented decision.** The runner in `api/migrate.ts` owns a migration ledger with SHA-256 checksums, holds a PostgreSQL advisory lock, and applies each migration in a transaction. Unit tests cover its parser. Disposable PostgreSQL and CI tests run the migrations. This keeps the SQL portable and avoids another migration image.

---

## 6. Initial authorization and exposure

**Decision.** The application has one server-configured workspace and one seeded local actor. It has no per-user authorization or board membership model. The API selects the actor and workspace and rejects browser-supplied `user_id`, actor ID, and `board_id` values as trusted inputs.

This is safe only while the application is local. The API must bind to loopback, PostgreSQL must remain on a private container network or loopback binding, and browser origins must be explicit. The application must not support public or shared-network exposure until an authentication and authorization design is selected and tested.

Keep stable actor and board identifiers in the domain schema so future authentication can resolve a request to an actor without rewriting task, comment, and board ownership. Membership roles and RLS can be added later if the future multi-user model requires them.

---

## 7. Round-one identity

**Decision.** This release has no signup, login, logout, email identity, or browser session. Database setup creates one stable local actor and one workspace. `/api/bootstrap` returns that actor. The profile UI can update its display name and avatar color.

Application services still receive an actor context, but the HTTP adapter always supplies the server-configured local actor. This preserves a narrow seam for a future authentication provider without implementing or pretending to provide authentication now.

Task and comment author IDs are assigned by the server. Assignee names may remain free text. The existing login page, auth gate, invite handler, email profile field, sign-out action, session handling, membership roles, and invite-link UI are removed during frontend cutover.

---

## 8. Change delivery and realtime

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **Mutation responses with resync on focus** | No collaboration infrastructure; deterministic recovery on reload/focus | Other tabs may remain stale until focus | **Selected for the single-user release** |
| Periodic polling | Simple convergence between tabs | Unnecessary background requests for the initial use case | Add only if dogfooding needs it |
| Server-Sent Events (SSE) | One-way server-to-browser stream fits this app; browser reconnect is built in | One persistent HTTP connection per client; server-to-client only | **Leading realtime upgrade** |
| WebSocket | Full duplex and widely supported | Custom reconnect, heartbeat, backpressure, and protocol handling | Unnecessary because writes already use HTTP |
| PostgreSQL `LISTEN/NOTIFY` + SSE/WS | Supports events from multiple API instances or external writers | Notifications are not durable and add database event plumbing | Add only when there are multiple writers/instances |
| Redis pub/sub | Separates event transport from DB | Adds another service and operational failure mode | Reject until scale requires it |

Round one updates local state from successful mutation responses and performs a complete bootstrap resync when the window regains focus. It has no change publisher, subscription protocol, or realtime infrastructure. If multi-user collaboration is added later, introduce polling or SSE behind a new delivery boundary and require a complete resync after reconnecting.

---

## 9. Frontend state and contracts

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **Existing reducer/context + small fetch client** | Lowest migration risk and fewest dependencies | Manual request cache/refetch behavior | **Recommended initially** |
| TanStack Query | Strong server-state caching, retries, invalidation | New state model and migration work | Reassess after API cutover |
| Generated OpenAPI client | Contract automation and useful external API docs | Generation/build tooling and schema discipline | Good later if contract drift becomes a problem |

The frontend client exposes domain operations such as `createTask`, not generic `from('tasks')` queries. HTTP mocks replace the Supabase chain mock.

---

## 10. Repository/package structure

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **One repository and root package, separate TS configs/builds** | Simplest scripts and dependency management | Frontend/backend dependency lists share one manifest | **Recommended to start** |
| npm workspaces (`web`, `api`, `contracts`) | Clear package boundaries and independent builds | More manifests, linking, and tooling | Adopt if shared package boundaries become useful |
| Separate repositories | Strong deployment independence | Version coordination and duplicated tooling | Reject |

Loose coupling comes from source boundaries and contract tests, not necessarily separate packages or repositories.

---

## 11. Container orchestration

| Choice | Advantages | Costs | Assessment |
|---|---|---|---|
| **Compose specification through Podman** | Familiar, portable, one command for DB/API | `podman compose` delegates to an external provider | **Recommended locally** |
| Native Podman pod commands/scripts | Direct control and true pod semantics | Custom lifecycle scripts and less portability | Useful only for Podman-specific needs |
| Quadlet/systemd units | Excellent host boot lifecycle and service management | Linux/systemd-specific and more deployment files | Recommended later for the Ubuntu host |
| Kubernetes | Declarative orchestration and scale | Vastly disproportionate complexity | Reject |

The repository's `scripts/compose` launcher isolates the external provider and works around the current host's Python package mismatch. `scripts/podman-remote` uses the existing Podman service socket with a disposable writable client runtime directory. Kubernetes remains rejected for this local stack because it adds a control plane without removing the underlying runtime dependency.

---

## Current architecture

The implemented stack is:

```text
React + existing reducer/context
  -> handwritten typed fetch client
    -> Node HTTP modular monolith
      -> application services
        -> pg repositories
          -> PostgreSQL 16

Local orchestration: Podman Compose
Identity: one seeded local actor; no authentication or session
Initial synchronization: mutation responses + focus resync
Tests: HTTP boundary mocks + real PostgreSQL integration tests
```

It excludes an ORM, GraphQL, tRPC, Redis, WebSockets, PostgreSQL notifications, microservices, and a Supabase compatibility layer. Add one only when a concrete requirement warrants it.

## Confirmed implementation choices

The completed checklist is in [the decision record](decisions-to-make.md).

The implementation uses a Node HTTP adapter, raw `pg`, a checksummed SQL migration runner, one local actor, one server-configured workspace, a loopback-only API, mutation responses, and refresh-on-focus.
