# BoardModule Interface contract

Status: frozen as the implementation baseline on 2026-09-04. Slices 1 through 4 implement overview, Task/detail and history pages, Tag autocomplete, capture, revision, family archive/restore, movement, closure Outcomes, and warnings. Later slices implement collaboration, reports, and `follow`.

This document makes the selected `BoardModule` Interface precise enough to plan and test vertical slices. Names describe domain intent, not HTTP routes, database tables, or React state.

## Interface

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

The permission parameter is a compile-time restriction. Every entry also rechecks current access inside its Implementation as described in [Identity and Space Module design](identity-space-module-design.md).

## Shared value shapes

```ts
export type Result<T, F> =
  | { ok: true; value: T }
  | { ok: false; fault: F }

export interface PageRequest {
  after?: OpaqueCursor
  size?: number
}

export interface Page<T> {
  items: T[]
  next?: OpaqueCursor
}

export type TaskLocator =
  | { kind: 'id'; taskId: TaskId }
  | { kind: 'key'; taskKey: TaskKey }

export interface VersionedTask {
  taskId: TaskId
  expectedRevision: Revision
}

export interface VersionedComment {
  commentId: CommentId
  expectedRevision: Revision
}
```

IDs, revisions, cursors, keys, instants, and request IDs are branded scalars. Plain strings cannot silently substitute for them. All human text is Unicode and subject to the confirmed server-side limits.

## Read grammar

```ts
export type BoardQuery =
  | { kind: 'tags'; text?: string; page?: PageRequest }
  | { kind: 'overview'; firstPageSize?: number }
  | { kind: 'tasks'; selection: TaskSelection; page?: PageRequest }
  | {
      kind: 'task'
      task: TaskLocator
      subtasks?: PageRequest
      comments?: PageRequest
      history?: PageRequest
    }
  | { kind: 'flow' }
  | { kind: 'workload' }
  | { kind: 'inbox'; page?: PageRequest }

export type TaskSelection =
  | { kind: 'column'; columnId: ColumnId }
  | {
      kind: 'search'
      text: string
      include?: 'open' | 'closed' | 'archived' | 'all'
    }
  | { kind: 'archive' }

export type BoardView =
  | { kind: 'tags'; value: Page<TagView> }
  | { kind: 'overview'; value: BoardOverview }
  | { kind: 'tasks'; value: Page<TaskSummary> }
  | { kind: 'task'; value: TaskDetail }
  | { kind: 'flow'; value: FlowView }
  | { kind: 'workload'; value: WorkloadView }
  | { kind: 'inbox'; value: Page<NotificationView> }
```

Every `BoardView` contains or is accompanied by the `ChangeSequence` at which it was read. Cursors are opaque, Space-scoped, selection-scoped, ordering-scoped, and revision-aware. An expired or invalidated cursor returns `cursor-expired` rather than silently skipping or duplicating Tasks.

`overview` contains Space and Member summaries, the complete bounded workflow, WIP evidence, unread-notification count, and one bounded Task-summary page for each initially displayed lane. Description, comments, history, search results, old Closed Tasks, and Archive entries load separately.

## Change grammar

```ts
export interface ChangeRequest {
  requestId: RequestId
  command: BoardCommand
}

export type BoardCommand =
  | { kind: 'capture-task'; input: CaptureTask }
  | { kind: 'revise-task'; task: VersionedTask; changes: TaskChanges }
  | {
      kind: 'place-task'
      task: VersionedTask
      destination: TaskDestination
      closure?: Closure
    }
  | { kind: 'change-outcome'; task: VersionedTask; outcome: Outcome }
  | { kind: 'archive-task'; task: VersionedTask }
  | { kind: 'restore-task'; task: VersionedTask }
  | {
      kind: 'add-comment'
      taskId: TaskId
      text: string
      mentions: MemberId[]
    }
  | {
      kind: 'revise-comment'
      comment: VersionedComment
      text: string
      mentions: MemberId[]
    }
  | { kind: 'remove-comment'; comment: VersionedComment }
  | { kind: 'mark-notification-read'; notificationId: NotificationId }
  | { kind: 'mark-all-notifications-read' }
  | {
      kind: 'set-workflow'
      expectedRevision: Revision
      desired: WorkflowPlan
    }
```

`CaptureTask` may identify one parent Task. The Module rejects a parent that is already a Subtask and always places the new Task or Subtask in Intake. Board order expresses priority, so capture and revision inputs have no Priority field.

```ts
export interface TaskDestination {
  columnId: ColumnId
  expectedOrderRevision: Revision
  place:
    | { kind: 'first' }
    | { kind: 'last' }
    | { kind: 'before'; taskId: TaskId }
    | { kind: 'after'; taskId: TaskId }
}

export type Outcome =
  | { kind: 'completed' }
  | { kind: 'rejected' }
  | { kind: 'cancelled' }
  | { kind: 'duplicate'; taskId: TaskId }

export interface Closure {
  outcome?: Outcome
  comment?: string
}
```

`place-task` never accepts an array index or stored database position. When the destination is Complete, omitted `closure.outcome` means Completed. Rejected and Cancelled may carry a closing comment. Duplicate must reference another Task in the same Space. A closure is invalid for a non-Complete destination.

Moving a Closed Task out of Complete reopens it and clears its current Outcome. `change-outcome` is valid only for a Closed Task and preserves its Closed at and Cycle time. Archiving or restoring a parent includes all its Subtasks.

`mentions` contains stable Member IDs selected by the plain-text editor. The Module validates that each mentioned Member is current and belongs to the same Space. It never derives a relationship from a display name.

`set-workflow` supplies the complete desired ordered workflow. Existing Column IDs preserve identity and request-local references identify new Columns. The Module computes operation order, validates the final workflow, and commits it atomically. Role changes and archive require an empty Column; replacing Intake or Complete is one change.

## Idempotency and receipt

```ts
export interface ChangeReceipt {
  result: BoardCommandResult
  update: BoardUpdate
  warnings: BoardWarning[]
}
```

Every change is idempotent within a Member and Space. Retrying the same `requestId` with identical content returns the original receipt and creates no second history, audit, Notification, or update entry. Reusing it with different content returns `request-id-reused`.

Warnings describe a change that already committed. They never require a second confirmation request.

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

## Authoritative updates

The mutation receipt and live feed carry the same `BoardUpdate`. Projection changes are authoritative facts; there is no separate optimistic-response format.

```ts
export interface BoardUpdate {
  sequence: ChangeSequence
  requestId?: RequestId
  occurredAt: Instant
  changes: BoardProjectionChange[]
}

export type BoardProjectionChange =
  | { kind: 'space-revised'; space: SpaceSummary }
  | { kind: 'membership-revised'; member: MemberSummary }
  | { kind: 'membership-ended'; memberId: MemberId }
  | { kind: 'workflow-replaced'; workflow: WorkflowView }
  | {
      kind: 'task-upserted'
      task: TaskSummary
      previousColumnId?: ColumnId
      placement: TaskPlacement
    }
  | { kind: 'tasks-archived'; taskIds: TaskId[] }
  | {
      kind: 'comment-upserted'
      taskId: TaskId
      comment: CommentView
    }
  | {
      kind: 'comment-removed'
      taskId: TaskId
      comment: CommentTombstone
    }
  | { kind: 'history-appended'; taskId: TaskId; entries: TaskHistoryEntry[] }
  | { kind: 'notification-upserted'; notification: NotificationView }
  | { kind: 'notifications-read'; notificationIds?: NotificationId[]; all: boolean }
  | { kind: 'board-counts-revised'; counts: BoardCounts }
  | { kind: 'query-revisions-changed'; revisions: QueryRevisions }
```

`TaskPlacement` names a Column and relative stable Task anchors; it exposes no database rank. `QueryRevisions` invalidates affected cursor chains without forcing an unbounded snapshot into the feed. `BoardSession` applies these changes to loaded state and discards any received sequence at or below its last applied sequence.

Current state, immutable history, administrative audit where applicable, Notifications, idempotency receipt, and `BoardUpdate` commit in one PostgreSQL transaction.

## Live feed

```ts
export interface FollowOptions {
  after?: ChangeSequence
}

export type BoardFeedItem =
  | { kind: 'update'; update: BoardUpdate }
  | { kind: 'snapshot-required'; latest: ChangeSequence }
  | {
      kind: 'closed'
      reason: 'access-revoked' | 'space-archived' | 'server-draining'
    }
```

Delivery is ordered and at least once. A retained sequence gap yields `snapshot-required`; the client loads a fresh bounded overview before resuming. The feed has bounded buffering and closes a slow subscriber rather than accumulating an unbounded queue.

## Faults

```ts
export type BoardFault =
  | { kind: 'invalid'; issues: FieldIssue[] }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | {
      kind: 'read-only'
      reason: 'space-archived' | 'deletion-scheduled'
    }
  | {
      kind: 'conflict'
      reason:
        | 'stale-task'
        | 'stale-comment'
        | 'stale-order'
        | 'stale-workflow'
        | 'request-id-reused'
      current?: BoardView
    }
  | {
      kind: 'rule-violation'
      rule:
        | 'subtask-depth'
        | 'column-not-empty'
        | 'intake-required'
        | 'completion-required'
        | 'active-wip-limit-required'
        | 'closure-required'
        | 'duplicate-target-invalid'
    }
  | { kind: 'cursor-expired' }
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  | { kind: 'temporarily-unavailable' }
```

Inaccessible and cross-Space identifiers return `not-found`. PostgreSQL codes, `HttpError`, stack traces, and transport status codes never cross the Seam. Unexpected defects may throw and become a redacted internal failure in the HTTP Adapter.

## Invariants and performance

The invariant and performance contracts in [Codebase Module design](codebase-module-design.md) remain normative. In particular:

- one Intake and one Completion Column always exist;
- new Tasks enter Intake, entering Complete closes, and leaving Complete reopens;
- Active WIP limits warn but allow movement;
- Task, comment, workflow, and ordering revisions reject stale changes;
- no read returns an unbounded collection;
- pages default to 50 and cap at 200;
- reports do not scan all 100,000 retained Tasks for an interactive request;
- ordinary Task changes do not lock unrelated Spaces or the installation.

The types intentionally leave view DTO fields to the slice that first needs them. Adding a field to a view is compatible. Adding an Interface entry, accepting transport or PostgreSQL types, weakening an invariant, or adding a new command/fault variant is a contract amendment and must update this document and its Interface tests.

## Slice 3 wire values and query amendment

The `tags` query adds bounded, case-insensitive prefix autocomplete for Space Tags, including Tags used only by archived Tasks. It uses the existing `read` entry and cursor faults. This query addition is covered by the Slice 3 Module tests.

`CaptureTask` accepts optional `assigneeId` and Tag names for inline creation. `TaskChanges` accepts replacement Tag names. Task summaries return stable Tag IDs, an Assignee summary, parent Task ID, and archive state. `TaskDetail.subtasks` is a separately paged summary collection. Each overview Column contains its own Task page and counts for all its Tasks, parent Tasks, and Subtasks. A command result names the affected `taskId`.

Wire values live in `api/contracts/board.ts`; server capabilities and PostgreSQL types remain outside that source. Cursors currently expire after one hour, a Board change, or process restart. Every expiry produces `cursor-expired`. Task-number ordering is private to Slice 3 until relative placement arrives in Slice 4.

Family changes above 200 Tasks emit count and query-revision changes instead of a partial Task projection. `BoardSession` marks loaded pages stale and reloads the bounded overview and open Task detail. Snapshot reads never move its sequence backwards.
