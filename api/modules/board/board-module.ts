import type { Database, DbClient } from '../../db.js'
import { inTransaction } from '../../db.js'
import { inspectAuthorizedSpace } from '../private-capabilities.js'
import { SESSION_IDLE_MILLISECONDS } from '../session-policy.js'
import {
  isDatabaseError,
  type BoardId,
  type ChangeSequence,
  type ColumnId,
  type CommentId,
  type FieldIssue,
  type Instant,
  type MemberId,
  type NotificationId,
  type OpaqueCursor,
  type PageRequest,
  type RequestId,
  type Result,
  type Revision,
  type SpaceId,
  type SpaceKey,
  type TaskId,
  type TaskKey,
} from '../shared.js'
import type { AuthorizedSpace, SpaceSummary } from '../space/space-module.js'

export interface BoardColumnView {
  id: ColumnId
  name: string
  flowRole: 'queue' | 'active' | 'complete'
  intake: boolean
  completion: boolean
  wipLimit: number | null
  position: number
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

export interface TaskSummary {
  id: TaskId
  key: TaskKey
  title: string
  columnId: ColumnId
  revision: Revision
}

export interface TaskDetail extends TaskSummary {
  description: string
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
  | { kind: 'overview'; firstPageSize?: number }
  | { kind: 'tasks'; selection: TaskSelection; page?: PageRequest }
  | { kind: 'task'; task: TaskLocator; comments?: PageRequest; history?: PageRequest }
  | { kind: 'flow' }
  | { kind: 'workload' }
  | { kind: 'inbox'; page?: PageRequest }

export type BoardView =
  | { kind: 'overview'; value: BoardOverview; sequence: ChangeSequence }
  | { kind: 'tasks'; value: Page<TaskSummary>; sequence: ChangeSequence }
  | { kind: 'task'; value: TaskDetail; sequence: ChangeSequence }
  | { kind: 'flow'; value: FlowView; sequence: ChangeSequence }
  | { kind: 'workload'; value: WorkloadView; sequence: ChangeSequence }
  | { kind: 'inbox'; value: Page<NotificationView>; sequence: ChangeSequence }

export interface VersionedTask { taskId: TaskId; expectedRevision: Revision }
export interface VersionedComment { commentId: CommentId; expectedRevision: Revision }
export interface CaptureTask { title: string; description?: string; parentTaskId?: TaskId }
export interface TaskChanges { title?: string; description?: string; assigneeId?: MemberId | null }

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
export type BoardCommandResult = { kind: BoardCommand['kind'] }
export type BoardWarning =
  | { kind: 'wip-limit-exceeded'; columnId: ColumnId; limit: number; actual: number; parentTasks: number; subtasks: number }
  | { kind: 'open-subtasks'; taskId: TaskId; count: number }

export interface BoardCounts { open: number; closed: number; archived: number }
export interface QueryRevisions { tasks: Revision; inbox: Revision }
export interface TaskPlacement { columnId: ColumnId; beforeTaskId?: TaskId; afterTaskId?: TaskId }
export interface WorkflowView { columns: BoardColumnView[] }
export interface MemberSummary { id: MemberId; displayName: string; role: BoardMemberView['role'] }
export interface CommentView { id: CommentId; text: string; revision: Revision }
export interface CommentTombstone { id: CommentId; removedAt: Instant }
export interface TaskHistoryEntry { occurredAt: Instant; summary: string }

export type BoardProjectionChange =
  | { kind: 'space-revised'; space: SpaceSummary }
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

export interface BoardModule {
  read(access: AuthorizedSpace<'board-read'>, query: BoardQuery): Promise<Result<BoardView, BoardFault>>
  change(access: AuthorizedSpace<'board-change'>, request: ChangeRequest): Promise<Result<ChangeReceipt, BoardFault>>
  follow(
    access: AuthorizedSpace<'board-follow'>,
    options: FollowOptions,
  ): Promise<Result<AsyncIterable<BoardFeedItem>, BoardFault>>
}

interface AccessSpaceRow {
  id: string
  space_key: string
  display_name: string
  time_zone: string
  lifecycle: BoardOverview['space']['lifecycle']
  revision: number
  access_revision: string | number
}

interface BoardRow {
  id: string
  change_sequence: string | number
  workflow_revision: number
}

interface ColumnRow {
  id: string
  name: string
  flow_role: BoardColumnView['flowRole']
  is_intake: boolean
  is_completion: boolean
  wip_limit: number | null
  position: number
  revision: number
}

interface MemberRow {
  id: string
  display_name: string
  role: BoardMemberView['role']
}

export class BoardModuleImplementation implements BoardModule {
  constructor(private readonly db: Database) {}

  async read(
    access: AuthorizedSpace<'board-read'>,
    query: BoardQuery,
  ): Promise<Result<BoardView, BoardFault>> {
    if (query.kind !== 'overview') return { ok: false, fault: { kind: 'temporarily-unavailable' } }
    if (query.firstPageSize !== undefined
      && (!Number.isInteger(query.firstPageSize) || query.firstPageSize < 1 || query.firstPageSize > 200)) {
      return {
        ok: false,
        fault: { kind: 'invalid', issues: [{ field: 'firstPageSize', message: 'Use a value from 1 to 200.' }] },
      }
    }
    const claims = inspectAuthorizedSpace(access)
    if (!claims || claims.use !== 'board-read') return { ok: false, fault: { kind: 'forbidden' } }

    try {
      return await inTransaction(this.db, async (client) => {
        const permitted = await recheckAccess(client, claims)
        if (!permitted.ok) return permitted

        const boardResult = await client.query<BoardRow>(
          `select id, change_sequence, workflow_revision
           from team.boards where space_id = $1`,
          [claims.spaceId],
        )
        const board = boardResult.rows[0]
        if (!board) return { ok: false as const, fault: { kind: 'not-found' as const } }

        const [columnResult, memberResult] = await Promise.all([
          client.query<ColumnRow>(
            `select id, name, flow_role, is_intake, is_completion, wip_limit, position, revision
             from team.board_columns
             where board_id = $1 and archived_at is null
             order by position`,
            [board.id],
          ),
          client.query<MemberRow>(
            `select member.id, identity.display_name, member.role
             from team.members member
             join team.identities identity on identity.id = member.identity_id
             where member.space_id = $1 and member.ended_at is null
             order by lower(identity.display_name), member.id`,
            [claims.spaceId],
          ),
        ])
        const sequence = Number(board.change_sequence) as ChangeSequence
        return {
          ok: true as const,
          value: {
            kind: 'overview' as const,
            sequence,
            value: {
              space: {
                id: permitted.space.id as SpaceId,
                key: permitted.space.space_key as SpaceKey,
                displayName: permitted.space.display_name,
                timeZone: permitted.space.time_zone,
                lifecycle: permitted.space.lifecycle,
                revision: permitted.space.revision as Revision,
              },
              board: {
                id: board.id as BoardId,
                changeSequence: sequence,
                workflowRevision: board.workflow_revision as Revision,
              },
              columns: columnResult.rows.map((column) => ({
                id: column.id as ColumnId,
                name: column.name,
                flowRole: column.flow_role,
                intake: column.is_intake,
                completion: column.is_completion,
                wipLimit: column.wip_limit,
                position: column.position,
                revision: column.revision as Revision,
              })),
              members: memberResult.rows.map((member) => ({
                id: member.id as MemberId,
                displayName: member.display_name,
                role: member.role,
              })),
              tasks: { items: [] },
              unreadNotifications: 0,
            },
          },
        }
      })
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  async change(
    access: AuthorizedSpace<'board-change'>,
    request: ChangeRequest,
  ): Promise<Result<ChangeReceipt, BoardFault>> {
    void request
    if (!inspectAuthorizedSpace(access)) return { ok: false, fault: { kind: 'forbidden' } }
    return { ok: false, fault: { kind: 'temporarily-unavailable' } }
  }

  async follow(
    access: AuthorizedSpace<'board-follow'>,
    options: FollowOptions,
  ): Promise<Result<AsyncIterable<BoardFeedItem>, BoardFault>> {
    void options
    if (!inspectAuthorizedSpace(access)) return { ok: false, fault: { kind: 'forbidden' } }
    return { ok: false, fault: { kind: 'temporarily-unavailable' } }
  }
}

async function recheckAccess(
  client: DbClient,
  claims: NonNullable<ReturnType<typeof inspectAuthorizedSpace>>,
): Promise<{ ok: true; space: AccessSpaceRow } | { ok: false; fault: BoardFault }> {
  const spaceResult = await client.query<AccessSpaceRow>(
    `select id, space_key, display_name, time_zone, lifecycle, revision, access_revision
     from team.spaces where id = $1 for share`,
    [claims.spaceId],
  )
  const space = spaceResult.rows[0]
  if (!space) return { ok: false, fault: { kind: 'not-found' } }
  if (Number(space.access_revision) !== claims.accessRevision) {
    return { ok: false, fault: { kind: 'forbidden' } }
  }

  const member = await client.query(
    `select id from team.members
     where id = $1 and space_id = $2 and identity_id = $3 and ended_at is null
     for share`,
    [claims.memberId, claims.spaceId, claims.identityId],
  )
  if (!member.rows[0]) return { ok: false, fault: { kind: 'forbidden' } }

  const session = await client.query(
    `select id from team.browser_sessions
     where id = $1 and identity_id = $2 and revoked_at is null
       and absolute_expires_at > now()
       and last_active_at + $3 * interval '1 millisecond' > now()
     for share`,
    [claims.sessionId, claims.identityId, SESSION_IDLE_MILLISECONDS],
  )
  if (!session.rows[0]) return { ok: false, fault: { kind: 'forbidden' } }
  return { ok: true, space }
}
