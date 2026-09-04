# Codebase Module design

Status: selected design. Slice 1 implements the first `read` path; later Board behavior remains planned.

## Design goal

The current Task mutation path repeats each operation through HTTP routes, `AppService`, `Repository`, the browser fetch wrapper, and `TaskContext`. Validation, database-shaped fields, transport errors, ordering, and completion behavior leak across those seams. The team MVP would add Space authorization, work-in-progress warnings, revisions, immutable history, Notifications, pagination, and live changes to the same path.

The replacement needs one deep Module. Callers should express a Board intent and receive an authoritative result without learning transaction order, position arithmetic, Column-role rules, history writes, Notification rules, or live sequencing.

## Dependency classification

- PostgreSQL is local-substitutable. `BoardModule` uses it inside its Implementation and tests against an isolated PostgreSQL database. The external Interface does not expose a repository or database records.
- OpenID Connect is true external. It belongs to `IdentityModule`, outside the Board Seam, behind a port with production and mock Adapters.
- The browser-to-server hop is remote but owned. `BoardTransport` is a port with an HTTP and Server-Sent Events Adapter in production and an in-memory Adapter in browser tests.
- Time and ID generation are internal seams. Production and deterministic test Adapters remain private to each Module's Implementation.

## Designs considered

### Minimal command grammar

This design offered `read`, `change`, and `follow`. A nested command grammar reduced mutations to `task.create`, `task.change`, and `workflow.change`.

Its Interface had the highest Depth. Callers gained authorization, validation, transactions, history, ordering, closure, warnings, pagination, and live sequencing through three methods. Its cost was discoverability because callers had to browse the command grammar.

### Flexible intent model

This design kept the same three methods, added idempotent requests, and described workflow changes as one complete desired plan. The Module could compare the current and desired workflow, validate the final state, and apply renames, ordering, role changes, archive, restore, Intake replacement, and Completion replacement atomically.

Its declarative workflow gave the best Locality. Its weaker option was to emit refresh hints rather than authoritative changes, which would force extra reads and create another reconciliation path in the browser.

### Caller-first named methods

This design offered named methods such as `createTask`, `moveTask`, `closeTask`, `reopenTask`, and `archiveTask`. Individual HTTP routes were obvious, but the Interface was wide. Splitting move, close, and reopen also gave closure semantics several places to diverge.

Named methods improved discovery but offered less Depth. The method list would grow with every Board capability.

## Selected Interface

Use the three-entry shape with the flexible design's idempotency and declarative workflow. Mutation results and the live feed carry the same authoritative `BoardUpdate` so the browser needs one reducer.

```ts
export interface BoardModule {
  read(
    access: AuthorizedSpace<'board-read'>,
    query: BoardQuery,
  ): Promise<Result<BoardView, BoardFault>>

  change(
    access: AuthorizedSpace<'board-change'>,
    request: ChangeRequest,
  ): Promise<Result<ChangeReceipt, BoardFault>>

  follow(
    access: AuthorizedSpace<'board-follow'>,
    options: FollowOptions,
  ): Promise<Result<AsyncIterable<BoardFeedItem>, BoardFault>>
}
```

`AuthorizedSpace` is opaque and request-scoped. `SpaceModule` creates it after checking the server session, active membership, role, Space lifecycle, and access revision. Browser input cannot construct it. Mutations recheck access in their PostgreSQL transaction when a membership change could race with the write.

The normative query, command, update, warning, and fault types are frozen in [BoardModule Interface contract](board-interface-contract.md). The excerpts below explain the selected design but do not replace that contract.

### Read grammar

```ts
export type BoardQuery =
  | { kind: 'overview'; firstPageSize?: number }
  | { kind: 'tasks'; selection: TaskSelection; page?: PageRequest }
  | { kind: 'task'; task: TaskLocator; comments?: PageRequest; history?: PageRequest }
  | { kind: 'flow' }
  | { kind: 'workload' }
  | { kind: 'inbox'; page?: PageRequest }

export type TaskSelection =
  | { kind: 'column'; columnId: ColumnId }
  | { kind: 'search'; text: string; include: 'active' | 'closed' | 'all' }
  | { kind: 'archive' }
```

Read results contain domain read models, never PostgreSQL rows. Every result carries the Space sequence at which it was read. Cursors are opaque and bound to their Space, selection, and ordering.

### Change grammar

```ts
export interface ChangeRequest {
  requestId: RequestId
  command: BoardCommand
}

export type BoardCommand =
  | { kind: 'capture-task'; input: CaptureTask }
  | { kind: 'revise-task'; task: VersionedTask; changes: TaskChanges }
  | { kind: 'place-task'; task: VersionedTask; destination: TaskDestination; closure?: Closure }
  | { kind: 'change-outcome'; task: VersionedTask; outcome: Outcome }
  | { kind: 'archive-task'; task: VersionedTask }
  | { kind: 'restore-task'; taskId: TaskId }
  | { kind: 'add-comment'; taskId: TaskId; text: string; mentions: MemberId[] }
  | { kind: 'revise-comment'; comment: VersionedComment; text: string; mentions: MemberId[] }
  | { kind: 'remove-comment'; comment: VersionedComment }
  | { kind: 'mark-notification-read'; notificationId: NotificationId }
  | { kind: 'mark-all-notifications-read' }
  | { kind: 'set-workflow'; expectedRevision: Revision; desired: WorkflowPlan }
```

`capture-task` has no Column input because new Tasks and Subtasks always enter Intake. `place-task` addresses a destination as first, last, before a stable Task ID, or after a stable Task ID. It never accepts an array index or stored position.

`set-workflow` receives the complete desired ordered workflow. Existing Column IDs preserve identity; request-local references identify new Columns. The Implementation determines the safe operation order and commits the valid final state atomically.

Every mutation has a Member-and-Space-scoped `requestId`. Retrying identical content returns the original result. Reusing an ID with different content returns a conflict.

### Mutation and feed results

```ts
export interface ChangeReceipt {
  result: BoardCommandResult
  update: BoardUpdate
  warnings: BoardWarning[]
}

export interface BoardUpdate {
  sequence: ChangeSequence
  occurredAt: Instant
  changes: BoardProjectionChange[]
}

export type BoardFeedItem =
  | { kind: 'update'; update: BoardUpdate }
  | { kind: 'snapshot-required'; latest: ChangeSequence }
  | { kind: 'closed'; reason: 'access-revoked' | 'space-archived' | 'server-draining' }
```

The mutation response and live feed use the same projection changes. Delivery is ordered and at least once, so callers ignore sequences they already applied. A caller that falls behind the retained feed receives `snapshot-required` and loads a new bounded overview.

Warnings describe a committed change. They do not trigger a second confirmation request.

```ts
export type BoardWarning =
  | {
      kind: 'wip-limit-exceeded'
      columnId: ColumnId
      limit: number
      actual: number
      parentTasks: number
      subtasks: number
    }
  | { kind: 'open-subtasks'; taskId: TaskId; count: number }
```

### Faults

Expected failures cross the Seam as typed values. Unexpected Implementation defects may throw and become an internal failure in the HTTP Adapter.

```ts
export type BoardFault =
  | { kind: 'invalid'; issues: FieldIssue[] }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'read-only'; reason: 'space-archived' }
  | { kind: 'conflict'; reason: ConflictReason; current?: BoardView }
  | { kind: 'rule-violation'; rule: BoardRule }
  | { kind: 'cursor-expired' }
  | { kind: 'temporarily-unavailable' }
```

The HTTP Adapter maps these values to status codes and safe response documents. PostgreSQL codes and `HttpError` never cross the Board Seam. Inaccessible and cross-Space identifiers return the same `not-found` value.

## Interface contract

`BoardModule` owns these facts:

- Every lookup and relationship stays within `AuthorizedSpace`.
- An Archived Space rejects all changes.
- New Tasks and Subtasks enter Intake; Subtasks stop at one level.
- Task numbers never repeat.
- A Board always has one Intake Queue Column and one Complete Column.
- Every Active Column has a positive work-in-progress limit.
- Role changes and Column archive require an empty Column.
- Replacing Intake or Complete is atomic.
- Entering Complete closes; leaving Complete reopens.
- A Closed Task always has an Outcome. Duplicate references another Task in the same Space.
- Outcome changes preserve Closed at and Cycle time.
- Closing a parent with open Subtasks and exceeding a work-in-progress limit commit with warnings.
- Archiving or restoring a parent includes its Subtasks.
- Tags, Assignees, mentions, text, comments, and moderation follow the confirmed MVP rules.
- Task, comment, workflow, and ordering revisions reject stale changes.
- Current state, immutable history, audit records, Notifications, and `BoardUpdate` commit in one PostgreSQL transaction.
- Human names, Space keys, Task keys, and Column names never act as relationships.

Filtered dragging remains browser behavior. The Board Module cannot know what a caller chose to display. The browser disables drag while filtered but may still offer the explicit Move action.

## Performance contract

- No read returns an unbounded collection.
- Task pages default to 50 and cap at 200.
- Comments and history page independently.
- Overview returns Space and Member summaries, Columns, counts, WIP evidence, and bounded Task summaries.
- Task detail loads description, comments, and history on demand.
- Stable cursors use database-backed ordering, never array offsets.
- Ordinary Task changes lock only the Task and affected ordered lanes, not the installation.
- Reports use indexed history or maintained summaries rather than scanning every retained Task.
- The live feed has bounded buffering. A slow caller receives `snapshot-required` rather than an unbounded queue.
- These characteristics are verified at 100,000 retained Tasks per Space and 100 concurrent browser connections.

## Module arrangement

```text
React views
└── BoardSession Module
    └── BoardTransport seam
        ├── HTTP and Server-Sent Events Adapter
        └── In-memory test Adapter

HTTP and Server-Sent Events Adapter
├── IdentityModule
├── SpaceModule
│   └── creates AuthorizedSpace
└── BoardModule
    └── PostgreSQL Implementation
```

`IdentityModule` owns OpenID Connect and sessions. `SpaceModule` owns Space creation, invitations, membership, roles, lifecycle, and authorization. `BoardModule` owns workflow, Tasks, comments, flow history, reports, Notifications, pagination, revisions, and live sequencing.

`BoardSession` owns browser loading, cursor pages, Task-detail loading, reconnecting, disconnected mode, and applying `BoardUpdate`. React views express intent and render state without reproducing Board rules.

Space export remains a separate Module because streaming, versioning, privacy, and its large output contract differ from ordinary Board reads.

## Seam discipline

Do not preserve `Repository` as an external Interface merely to mock SQL. PostgreSQL is part of the Board Implementation, and Board tests run through `read`, `change`, and `follow` against an isolated database.

Do not preserve `AppService` as a pass-through Module. HTTP parsing stays in the HTTP Adapter; domain validation and behavior live inside `BoardModule`.

Do not turn `change` into generic CRUD such as `{ entity, operation, payload: unknown }`. The discriminated command grammar is real Interface complexity and must name domain intent.

The deletion test is strong. Removing `BoardModule` would scatter Space checks, revisions, completion, ordering, history, Notifications, warning calculation, and projection mapping across routes, SQL callers, browser state, and live delivery.

## Testing through the Seam

- Board behavior tests call `read`, `change`, and `follow` against an isolated PostgreSQL database.
- HTTP Adapter tests verify transport parsing, session and Space resolution, fault mapping, cookies, CSRF, and response serialization without retesting Board invariants.
- Browser tests run `BoardSession` against an in-memory `BoardTransport` Adapter. End-to-end tests exercise the HTTP and Server-Sent Events Adapter.
- OIDC tests use the mock Adapter at the true external port.
- Old tests that reach through the Board Seam into validation helpers or repository methods are removed after equivalent Interface tests exist. Tests are replaced, not layered.

## Design continuation

[Identity and Space Module design](identity-space-module-design.md) selects the upstream Interfaces and the private transaction-time access recheck. [BoardModule Interface contract](board-interface-contract.md) freezes the planning baseline. [Team MVP vertical-slice plan](vertical-slice-plan.md) sequences implementation. Slice 1 now implements the authenticated empty-Board overview; `change`, `follow`, and Task reads remain later slices.
