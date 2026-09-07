import type {
  BoardId,
  ChangeSequence,
  ColumnId,
  CommentId,
  FieldIssue,
  Instant,
  MemberId,
  NotificationId,
  OpaqueCursor,
  PageRequest,
  RequestId,
  Revision,
  SpaceId,
  SpaceKey,
  TaskId,
  TagId,
  TaskKey,
} from '../modules/shared.js'

export interface BoardColumnView {
  id: ColumnId
  name: string
  flowRole: 'queue' | 'active' | 'complete'
  intake: boolean
  completion: boolean
  wipLimit: number | null
  position: number
  tasks: Page<TaskSummary>
  counts: ColumnCounts
  revision: Revision
}

export interface BoardMemberView {
  id: MemberId
  displayName: string
  role: 'member' | 'space-administrator'
}

export interface BoardOverview {
  space: {
    id: SpaceId
    key: SpaceKey
    displayName: string
    timeZone: string
    lifecycle: 'active' | 'archived' | 'deletion_scheduled'
    revision: Revision
  }
  board: { id: BoardId; changeSequence: ChangeSequence; workflowRevision: Revision }
  columns: BoardColumnView[]
  members: BoardMemberView[]
  tasks: Page<TaskSummary>
  unreadNotifications: number
}

export interface Page<T> {
  items: T[]
  next?: OpaqueCursor
}

export interface TagView { id: TagId; name: string }

export interface TaskSummary {
  archived: boolean
  parentTaskId: TaskId | null
  tags: TagView[]
  id: TaskId
  key: TaskKey
  title: string
  columnId: ColumnId
  assignee: { id: MemberId; displayName: string } | null
  revision: Revision
}

export interface TaskDetail extends TaskSummary {
  description: string
  subtasks: Page<TaskSummary>
}

export interface FlowView { columns: BoardColumnView[] }
export interface WorkloadView { members: BoardMemberView[] }
export interface NotificationView { id: NotificationId; read: boolean }

export type TaskLocator =
  | { kind: 'id'; taskId: TaskId }
  | { kind: 'key'; taskKey: TaskKey }

export type TaskSelection =
  | { kind: 'column'; columnId: ColumnId }
  | { kind: 'search'; text: string; include?: 'open' | 'closed' | 'archived' | 'all' }
  | { kind: 'archive' }

export type BoardQuery =
  | { kind: 'tags'; text?: string; page?: PageRequest }
  | { kind: 'overview'; firstPageSize?: number }
  | { kind: 'tasks'; selection: TaskSelection; page?: PageRequest }
  | { kind: 'task'; task: TaskLocator; subtasks?: PageRequest; comments?: PageRequest; history?: PageRequest }
  | { kind: 'flow' }
  | { kind: 'workload' }
  | { kind: 'inbox'; page?: PageRequest }

export type BoardView =
  | { kind: 'tags'; value: Page<TagView>; sequence: ChangeSequence }
  | { kind: 'overview'; value: BoardOverview; sequence: ChangeSequence }
  | { kind: 'tasks'; value: Page<TaskSummary>; sequence: ChangeSequence }
  | { kind: 'task'; value: TaskDetail; sequence: ChangeSequence }
  | { kind: 'flow'; value: FlowView; sequence: ChangeSequence }
  | { kind: 'workload'; value: WorkloadView; sequence: ChangeSequence }
  | { kind: 'inbox'; value: Page<NotificationView>; sequence: ChangeSequence }

export interface VersionedTask { taskId: TaskId; expectedRevision: Revision }
export interface VersionedComment { commentId: CommentId; expectedRevision: Revision }
export interface CaptureTask { title: string; description?: string; parentTaskId?: TaskId; assigneeId?: MemberId | null; tags?: string[] }
export interface TaskChanges { title?: string; description?: string; assigneeId?: MemberId | null; tags?: string[] }

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

export interface Closure { outcome?: Outcome; comment?: string }
export interface WorkflowColumnPlan {
  id?: ColumnId
  name: string
  flowRole: 'queue' | 'active' | 'complete'
  intake: boolean
  completion: boolean
  wipLimit: number | null
}
export interface WorkflowPlan { columns: WorkflowColumnPlan[] }

export type BoardCommand =
  | { kind: 'capture-task'; input: CaptureTask }
  | { kind: 'revise-task'; task: VersionedTask; changes: TaskChanges }
  | { kind: 'place-task'; task: VersionedTask; destination: TaskDestination; closure?: Closure }
  | { kind: 'change-outcome'; task: VersionedTask; outcome: Outcome }
  | { kind: 'archive-task'; task: VersionedTask }
  | { kind: 'restore-task'; task: VersionedTask }
  | { kind: 'add-comment'; taskId: TaskId; text: string; mentions: MemberId[] }
  | { kind: 'revise-comment'; comment: VersionedComment; text: string; mentions: MemberId[] }
  | { kind: 'remove-comment'; comment: VersionedComment }
  | { kind: 'mark-notification-read'; notificationId: NotificationId }
  | { kind: 'mark-all-notifications-read' }
  | { kind: 'set-workflow'; expectedRevision: Revision; desired: WorkflowPlan }

export interface ChangeRequest { requestId: RequestId; command: BoardCommand }
export type BoardCommandResult = { kind: BoardCommand['kind']; taskId?: TaskId }
export type BoardWarning =
  | { kind: 'wip-limit-exceeded'; columnId: ColumnId; limit: number; actual: number; parentTasks: number; subtasks: number }
  | { kind: 'open-subtasks'; taskId: TaskId; count: number }

export interface ColumnCounts { tasks: number; parentTasks: number; subtasks: number }
export interface BoardCounts { open: number; closed: number; archived: number; columns?: Array<{ columnId: ColumnId; counts: ColumnCounts }> }
export interface QueryRevisions { tasks: Revision; inbox: Revision }
export interface TaskPlacement { columnId: ColumnId; beforeTaskId?: TaskId; afterTaskId?: TaskId }
export interface WorkflowView { columns: BoardColumnView[] }
export interface MemberSummary { id: MemberId; displayName: string; role: BoardMemberView['role'] }
export interface CommentView { id: CommentId; text: string; revision: Revision }
export interface CommentTombstone { id: CommentId; removedAt: Instant }
export interface TaskHistoryEntry { occurredAt: Instant; summary: string }

export type BoardProjectionChange =
  | { kind: 'space-revised'; space: BoardOverview['space'] }
  | { kind: 'membership-revised'; member: MemberSummary }
  | { kind: 'membership-ended'; memberId: MemberId }
  | { kind: 'workflow-replaced'; workflow: WorkflowView }
  | { kind: 'task-upserted'; task: TaskSummary; previousColumnId?: ColumnId; placement: TaskPlacement }
  | { kind: 'tasks-archived'; taskIds: TaskId[] }
  | { kind: 'comment-upserted'; taskId: TaskId; comment: CommentView }
  | { kind: 'comment-removed'; taskId: TaskId; comment: CommentTombstone }
  | { kind: 'history-appended'; taskId: TaskId; entries: TaskHistoryEntry[] }
  | { kind: 'notification-upserted'; notification: NotificationView }
  | { kind: 'notifications-read'; notificationIds?: NotificationId[]; all: boolean }
  | { kind: 'board-counts-revised'; counts: BoardCounts }
  | { kind: 'query-revisions-changed'; revisions: QueryRevisions }

export interface BoardUpdate {
  sequence: ChangeSequence
  requestId?: RequestId
  occurredAt: Instant
  changes: BoardProjectionChange[]
}
export interface ChangeReceipt { result: BoardCommandResult; update: BoardUpdate; warnings: BoardWarning[] }
export interface FollowOptions { after?: ChangeSequence }
export type BoardFeedItem =
  | { kind: 'update'; update: BoardUpdate }
  | { kind: 'snapshot-required'; latest: ChangeSequence }
  | { kind: 'closed'; reason: 'access-revoked' | 'space-archived' | 'server-draining' }

export type BoardFault =
  | { kind: 'invalid'; issues: FieldIssue[] }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'read-only'; reason: 'space-archived' | 'deletion-scheduled' }
  | { kind: 'conflict'; reason: 'stale-task' | 'stale-comment' | 'stale-order' | 'stale-workflow' | 'request-id-reused'; current?: BoardView }
  | { kind: 'rule-violation'; rule: 'subtask-depth' | 'column-not-empty' | 'intake-required' | 'completion-required' | 'active-wip-limit-required' | 'closure-required' | 'duplicate-target-invalid' }
  | { kind: 'cursor-expired' }
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  | { kind: 'temporarily-unavailable' }
