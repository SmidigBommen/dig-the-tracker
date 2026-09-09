import { readReferences } from './private-references.js'
import { readFlow, readWorkload } from './private-reports.js'
import { taskSummary, type TaskRow } from './private-task-summary.js'
import { searchTasks } from './private-search.js'
import { readWorkflow, setWorkflow } from './private-workflow.js'
import { inboxPage, unreadCount, markNotificationsRead, notify } from './private-notifications.js'
import { changeComment, commentPage, commentForClosure } from './private-comments.js'
import { commitChange, appendUpdate } from './private-receipts.js'
import { restoreFamily } from './private-family.js'
import { transitionTask, changeOutcome } from './private-flow.js'
import { historyPage } from './private-history.js'
import { placeTask, appendRank, taskPlacement } from './private-placement.js'
import { BoardRejection, decodeCursor, encodeCursor, pageSize } from './private-cursors.js'
import { createHash } from 'node:crypto'
import type { Database, DbClient } from '../../db.js'
import { inTransaction } from '../../db.js'
import { inspectAuthorizedSpace } from '../private-capabilities.js'
import { recheckAccess } from './private-access.js'
import { followBoard } from './private-feed.js'
import { isDatabaseError, type BoardId, type ChangeSequence, type ColumnId, type MemberId, type Result, type Revision, type SpaceId, type SpaceKey, type PageRequest, type TaskId } from '../shared.js'
import type { AuthorizedSpace } from '../space/space-module.js'

export type * from '../../contracts/board.js'
import type {
  BoardWarning, TaskHistoryEntry, ColumnCounts, BoardCounts, BoardColumnView, BoardMemberView, BoardQuery, BoardView,
  BoardProjectionChange, Page, TagView, TaskSummary, TaskDetail, ChangeRequest, ChangeReceipt, FollowOptions, BoardFeedItem, BoardFault,
} from '../../contracts/board.js'

export interface BoardModule {
  read(access: AuthorizedSpace<'board-read'>, query: BoardQuery): Promise<Result<BoardView, BoardFault>>
  change(access: AuthorizedSpace<'board-change'>, request: ChangeRequest): Promise<Result<ChangeReceipt, BoardFault>>
  follow(
    access: AuthorizedSpace<'board-follow'>,
    options: FollowOptions,
  ): Promise<Result<AsyncIterable<BoardFeedItem>, BoardFault>>
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
  order_revision: number
  revision: number
}

interface MemberRow {
  id: string
  display_name: string
  role: BoardMemberView['role']
}

export class BoardModuleImplementation implements BoardModule {
  constructor(private readonly db: Database, private readonly config: { now?: () => Date } = {}) {}

  async read(
    access: AuthorizedSpace<'board-read'>,
    query: BoardQuery,
  ): Promise<Result<BoardView, BoardFault>> {
    if (query.kind !== 'references' && query.kind !== 'workload' && query.kind !== 'flow' && query.kind !== 'workflow' && query.kind !== 'overview' && query.kind !== 'task' && query.kind !== 'tasks' && query.kind !== 'tags' && query.kind !== 'inbox') return { ok: false, fault: { kind: 'temporarily-unavailable' } }
    if (query.kind === 'overview' && query.firstPageSize !== undefined
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
           from team.boards where space_id = $1 for ${query.kind === 'task' && query.markNotificationsRead === true ? 'update' : 'share'}`,
          [claims.spaceId],
        )
        const board = boardResult.rows[0]
        if (!board) return { ok: false as const, fault: { kind: 'not-found' as const } }

        let sequence = Number(board.change_sequence) as ChangeSequence
        if (query.kind === 'references') return { ok: true as const,value: { kind: 'references' as const,sequence,value: await readReferences(client,claims.spaceId,permitted.space.space_key,query.keys) } }
        if (query.kind === 'workload') return { ok: true as const, value: { kind: 'workload' as const, sequence, value: await readWorkload(client,claims.spaceId,permitted.space.space_key,sequence,query.memberId,query.page) } }
        if (query.kind === 'flow') return { ok: true as const, value: { kind: 'flow' as const, sequence, value: await readFlow(client,claims.spaceId,permitted.space.space_key,permitted.space.time_zone,sequence,query.page,this.config.now?.() ?? new Date()) } }
        if (query.kind === 'workflow') return { ok: true as const, value: { kind: 'workflow' as const, sequence, value: await readWorkflow(client, claims.spaceId) } }
        if (query.kind === 'inbox') return { ok: true as const, value: { kind: 'inbox' as const, sequence, value: await inboxPage(client, claims.spaceId, claims.memberId, query.page), unreadNotifications: await unreadCount(client, claims.spaceId, claims.memberId) } }
        if (query.kind === 'tags') {
          if (query.text !== undefined && (typeof query.text !== 'string' || [...query.text].length > 40)) {
            throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'text', message: 'Use at most 40 characters.' }] })
          }
          const text = query.text?.trim().toLowerCase() ?? ''
          const scope = `${claims.spaceId}:tags:${text}`
          const last = decodeCursor(query.page?.after, scope, sequence)
          const size = pageSize(query.page?.size)
          const tags = await client.query<TagView & { ordering: string }>(
            `select id, name, lower(name) as ordering from team.tags where space_id = $1
             and starts_with(lower(name), $2) ${last ? 'and lower(name) > $4' : ''}
             order by lower(name) limit $3`, [claims.spaceId, text, size + 1, ...(last ? [last] : [])],
          )
          const rows = tags.rows.slice(0, size)
          return { ok: true as const, value: { kind: 'tags' as const, sequence, value: {
            items: rows.map(({ id, name }) => ({ id, name })),
            ...(tags.rows.length > size ? { next: encodeCursor(scope, sequence, rows.at(-1)!.ordering) } : {}),
          } } }
        }
        if (query.kind === 'tasks') {
          if (query.selection.kind === 'search') return { ok: true as const, value: { kind: 'tasks' as const, sequence,
            value: await searchTasks(client, claims.spaceId, permitted.space.space_key, sequence, query.selection, query.page) } }
          if (query.selection.kind === 'column') {
          const column = await client.query('select id from team.board_columns where space_id = $1 and id::text = $2 and archived_at is null',
            [claims.spaceId, query.selection.columnId])
          if (!column.rows[0]) return { ok: false as const, fault: { kind: 'not-found' as const } }
          }
          return { ok: true as const, value: { kind: 'tasks' as const, sequence,
            value: await taskPage(client, claims.spaceId, permitted.space.space_key, sequence, query.selection, query.page) } }
        }
        if (query.kind === 'task') {
          const byId = query.task.kind === 'id'
          const value = query.task.kind === 'id' ? query.task.taskId : query.task.taskKey
          const result = await client.query<TaskRow>(
            `select task.*, space.space_key from team.tasks task
             join team.spaces space on space.id = task.space_id
             where task.space_id = $1 and ${byId ? 'task.id::text' : "space.space_key || '-' || task.number::text"} = $2`,
            [claims.spaceId, value],
          )
          const task = result.rows[0]
          if (!task) return { ok: false as const, fault: { kind: 'not-found' as const } }
          const readChange = query.markNotificationsRead === true
            ? await markNotificationsRead(client, claims.spaceId, claims.memberId, { taskId: task.id as TaskId }) : undefined
          if (readChange) sequence = (await appendUpdate(client, claims.spaceId, [readChange])).sequence
          return { ok: true as const, value: { kind: 'task' as const, sequence, unreadNotifications: await unreadCount(client, claims.spaceId, claims.memberId),
            value: await taskDetail(client, task, sequence, query.subtasks, query.history, query.comments) satisfies TaskDetail } }
        }
        const [columnResult, memberResult] = await Promise.all([
          client.query<ColumnRow>(
            `select id, name, flow_role, is_intake, is_completion, wip_limit, position, revision, order_revision
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
             order by lower(identity.display_name), member.id limit 200`,
            [claims.spaceId],
          ),
        ])
        const counts = await boardCounts(client, claims.spaceId)
        const columns: BoardColumnView[] = []
        for (const column of columnResult.rows) {
          const tasks = await taskPage(client, claims.spaceId, permitted.space.space_key, sequence,
            { kind: 'column', columnId: column.id }, { size: query.firstPageSize })
          columns.push({ id: column.id as ColumnId, name: column.name, flowRole: column.flow_role,
            intake: column.is_intake, completion: column.is_completion, wipLimit: column.wip_limit,
            position: column.position, orderRevision: column.order_revision as Revision, revision: column.revision as Revision, tasks,
            counts: counts.columns!.find((item) => item.columnId === column.id)!.counts })
        }
        return {
          ok: true as const,
          value: {
            kind: 'overview' as const,
            sequence,
            value: {
              currentMemberId: claims.memberId,
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
              columns,
              members: memberResult.rows.map((member) => ({
                id: member.id as MemberId,
                displayName: member.display_name,
                role: member.role,
              })),
              tasks: { items: [] },
              unreadNotifications: await unreadCount(client, claims.spaceId, claims.memberId),
            },
          },
        }
      })
    } catch (error) {
      if (error instanceof BoardRejection) return { ok: false, fault: error.fault }
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  async change(
    access: AuthorizedSpace<'board-change'>,
    request: ChangeRequest,
  ): Promise<Result<ChangeReceipt, BoardFault>> {
    const claims = inspectAuthorizedSpace(access)
    if (!claims || claims.use !== 'board-change') return { ok: false, fault: { kind: 'forbidden' } }
    if (request.command.kind !== 'set-workflow' && request.command.kind !== 'capture-task' && request.command.kind !== 'revise-task'
      && request.command.kind !== 'mark-notification-read' && request.command.kind !== 'mark-all-notifications-read' && request.command.kind !== 'revise-comment' && request.command.kind !== 'remove-comment' && request.command.kind !== 'add-comment' && request.command.kind !== 'change-outcome' && request.command.kind !== 'place-task' && request.command.kind !== 'archive-task' && request.command.kind !== 'restore-task') return { ok: false, fault: { kind: 'temporarily-unavailable' } }
    if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 100) {
      return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'requestId', message: 'Use 1 to 100 characters.' }] } }
    }
    const requestHash = createHash('sha256').update(canonicalJson(request.command)).digest('hex')
    const command = request.command
    const input = command.kind === 'capture-task' ? command.input : command.kind === 'revise-task' ? command.changes : {}
    if ((command.kind === 'capture-task' && input.title === undefined)
      || (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || [...input.title.trim()].length > 200))
      || (input.description !== undefined && (typeof input.description !== 'string' || [...input.description].length > 20_000))) {
      return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'input', message: 'Use a title of 1 to 200 characters and a description of at most 20,000.' }] } }
    }
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 20
      || input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || [...tag.trim()].length > 40))) {
      return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'tags', message: 'Use at most 20 Tags, each with 1 to 40 characters.' }] } }
    }
    try {
      return await inTransaction(this.db, async (client) => {
        const permitted = await recheckAccess(client, claims)
        if (!permitted.ok) return permitted
        if (command.kind === 'set-workflow' && permitted.role !== 'space-administrator') return { ok: false as const, fault: { kind: 'forbidden' as const } }
        await client.query('select id from team.boards where space_id = $1 for update', [claims.spaceId])
        const previous = await client.query<{ request_hash: string; response: ChangeReceipt }>(
          `select request_hash, response from team.board_request_receipts
           where space_id = $1 and member_id = $2 and request_id = $3`,
          [claims.spaceId, claims.memberId, request.requestId],
        )
        if (previous.rows[0]) {
          if (previous.rows[0].request_hash !== requestHash) return { ok: false as const,
            fault: { kind: 'conflict' as const, reason: 'request-id-reused' as const } }
          return { ok: true as const, value: previous.rows[0].response }
        }
        if (command.kind === 'set-workflow') {
          const workflow = await setWorkflow(client, claims.spaceId, claims.identityId, command.expectedRevision, command.desired)
          return { ok: true as const, value: await commitChange(client, claims.spaceId, claims.memberId, request, requestHash,
            { kind: command.kind }, [{ kind: 'workflow-replaced', workflow }]) }
        }
        if (command.kind === 'mark-notification-read' || command.kind === 'mark-all-notifications-read') {
          const changed = await markNotificationsRead(client, claims.spaceId, claims.memberId, command.kind === 'mark-notification-read' ? { notificationId: command.notificationId } : {})
          return { ok: true as const, value: await commitChange(client, claims.spaceId, claims.memberId, request, requestHash,
            { kind: command.kind }, changed ? [changed] : []) }
        }
        if (command.kind === 'add-comment' || command.kind === 'revise-comment' || command.kind === 'remove-comment') {
          const changed = await changeComment(client, claims.spaceId, claims.memberId, claims.identityId, permitted.role, command)
          const receipt = await commitChange(client, claims.spaceId, claims.memberId, request, requestHash,
            { kind: command.kind, taskId: changed.taskId, commentId: changed.comment.id }, changed.changes)
          return { ok: true as const, value: receipt }
        }
        if ('assigneeId' in input && input.assigneeId !== undefined && input.assigneeId !== null) {
          const member = await client.query('select id from team.members where space_id = $1 and id::text = $2 and ended_at is null',
            [claims.spaceId, input.assigneeId])
          if (!member.rows[0]) return { ok: false as const, fault: { kind: 'not-found' as const } }
        }
        if (command.kind === 'capture-task' && command.input.parentTaskId !== undefined) {
          const parent = await client.query<TaskRow>('select * from team.tasks where space_id = $1 and id::text = $2',
            [claims.spaceId, command.input.parentTaskId])
          if (!parent.rows[0] || parent.rows[0].archived_at) return { ok: false as const, fault: { kind: 'not-found' as const } }
          if (parent.rows[0].parent_task_id) return { ok: false as const,
            fault: { kind: 'rule-violation' as const, rule: 'subtask-depth' as const } }
        }
        let events: TaskHistoryEntry[] = []
        let previousAssignee: string | null = null
        let row: TaskRow
        let family: TaskRow[] = []
        let affectedOrderColumns: string[] = []
        if (command.kind !== 'capture-task') {
          const current = await client.query<TaskRow>(
            'select *, $3::text as space_key from team.tasks where space_id = $1 and id::text = $2 for update',
            [claims.spaceId, command.task.taskId, permitted.space.space_key],
          )
          if (!current.rows[0]) return { ok: false as const, fault: { kind: 'not-found' as const } }
          previousAssignee = current.rows[0].assignee_id
          if (current.rows[0].revision !== command.task.expectedRevision) {
            const board = await client.query<{ change_sequence: string }>('select change_sequence from team.boards where space_id = $1', [claims.spaceId])
            return { ok: false as const, fault: { kind: 'conflict' as const, reason: 'stale-task' as const,
              current: { kind: 'task' as const, sequence: Number(board.rows[0].change_sequence) as ChangeSequence,
                value: await taskDetail(client, current.rows[0], Number(board.rows[0].change_sequence)) } } }
          }
          if (command.kind === 'archive-task' || command.kind === 'restore-task') {
            const archived = command.kind === 'archive-task'
            const currentTask = current.rows[0]
            if (Boolean(currentTask.archived_at) === archived) throw new BoardRejection({ kind: 'invalid',
              issues: [{ field: 'task', message: archived ? 'Task is already archived.' : 'Task is already active.' }] })
            if (!archived && currentTask.parent_task_id) {
              const parent = await client.query('select id from team.tasks where space_id = $1 and id = $2 and archived_at is not null',
                [claims.spaceId, currentTask.parent_task_id])
              if (parent.rows[0]) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'task', message: 'Restore the parent Task first.' }] })
            }
            const affected = await client.query<{ id: string }>(`select distinct column_id as id from team.tasks
              where space_id = $1 and (id = $2 or parent_task_id = $2) and archived_at is null`, [claims.spaceId, currentTask.id])
            affectedOrderColumns = affected.rows.map((column) => column.id)
            if (archived) await client.query(
              `with changed as (
                update team.tasks set archived_at = now(), revision = revision + 1, updated_at = now()
                where space_id = $1 and (id = $2 or parent_task_id = $2) and archived_at is null returning id
              ) insert into team.task_events (space_id, task_id, actor_member_id, kind, details)
                select $1, id, $3, 'archive-task', '{}'::jsonb from changed`,
              [claims.spaceId, currentTask.id, claims.memberId],
            )
            else await restoreFamily(client, claims.spaceId, currentTask.id, claims.memberId)
            const changed = await client.query<TaskRow>(
              `select *, $3::text as space_key from team.tasks where space_id = $1 and (id = $2 or parent_task_id = $2)
               order by number limit 201`, [claims.spaceId, currentTask.id, permitted.space.space_key],
            )
            if (!archived) {
              const restoredColumns = await client.query<{ id: string }>(`select distinct column_id as id from team.tasks
                where space_id = $1 and (id = $2 or parent_task_id = $2) and archived_at is null`, [claims.spaceId, currentTask.id])
              affectedOrderColumns = restoredColumns.rows.map((column) => column.id)
            }
            family = changed.rows
            row = family.find((task) => task.id === currentTask.id)!
          } else if (command.kind === 'place-task' || command.kind === 'change-outcome') {
            if (command.kind === 'place-task') {
              await placeTask(client, claims.spaceId, current.rows[0], command.destination)
              events = await transitionTask(client, claims.spaceId, claims.memberId, current.rows[0], command.destination.columnId, command.closure)
            } else events = [await changeOutcome(client, claims.spaceId, claims.memberId, current.rows[0], command.outcome)]
            const moved = await client.query<TaskRow>('select *, $3::text as space_key from team.tasks where space_id = $1 and id = $2',
              [claims.spaceId, current.rows[0].id, permitted.space.space_key])
            row = moved.rows[0]
          } else {
            if (current.rows[0].archived_at) throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'task', message: 'Restore the Task before editing it.' }] })
          const revised = await client.query<TaskRow>(
            `update team.tasks set title = coalesce($3, title), description = coalesce($4, description),
             assignee_id = case when $6 then $7::uuid else assignee_id end,
             revision = revision + 1, updated_at = now() where space_id = $1 and id = $2 returning *, $5::text as space_key`,
            [claims.spaceId, command.task.taskId, input.title?.trim(), input.description, permitted.space.space_key, command.changes.assigneeId !== undefined, command.changes.assigneeId ?? null],
          )
          row = revised.rows[0]
          }
        } else {
          const number = await client.query<{ number: string }>(
            `update team.boards set next_task_number = next_task_number + 1
             where space_id = $1 returning next_task_number - 1 as number`, [claims.spaceId],
          )
          const created = await client.query<TaskRow>(
            `insert into team.tasks (space_id, number, column_id, title, description, created_by_member_id, assignee_id, parent_task_id)
             select $1, $2, id, $3, $4, $5, $7, $8 from team.board_columns
             where space_id = $1 and is_intake and archived_at is null returning *, $6::text as space_key`,
            [claims.spaceId, number.rows[0].number, input.title!.trim(), input.description ?? '', claims.memberId, permitted.space.space_key, input.assigneeId ?? null, command.input.parentTaskId ?? null],
          )
          row = created.rows[0]
          await appendRank(client, claims.spaceId, row.id, row.column_id)
          affectedOrderColumns = [row.column_id]
        }
        if ((command.kind === 'capture-task' || command.kind === 'revise-task') && row.assignee_id && row.assignee_id !== previousAssignee) {
          await notify(client, claims.spaceId, claims.memberId, row.id, [{ memberId: row.assignee_id, kind: 'assignment' }])
        }
        if (input.tags !== undefined) {
          await client.query('delete from team.task_tags where space_id = $1 and task_id = $2', [claims.spaceId, row.id])
          for (const name of input.tags) {
            const tag = await client.query<{ id: string }>(
              `insert into team.tags (space_id, name) values ($1,$2)
               on conflict (space_id, lower(name)) do update set name = team.tags.name returning id`,
              [claims.spaceId, name.trim()],
            )
            await client.query('insert into team.task_tags (space_id, task_id, tag_id) values ($1,$2,$3) on conflict do nothing',
              [claims.spaceId, row.id, tag.rows[0].id])
          }
        }
        if (command.kind === 'capture-task' || command.kind === 'revise-task') {
          await client.query('insert into team.task_events (space_id, task_id, actor_member_id, kind, details) values ($1,$2,$3,$4,$5)',
            [claims.spaceId, row.id, claims.memberId, command.kind, command])
        }
        const task = await taskSummary(client, row)
        const changes: BoardProjectionChange[] = []
        if (command.kind === 'archive-task' && family.length <= 200) changes.push({ kind: 'tasks-archived', taskIds: family.map((task) => task.id as TaskId) })
        else if (command.kind === 'restore-task' && family.length <= 200) {
          for (const restored of family) changes.push({ kind: 'task-upserted', task: await taskSummary(client, restored), placement: await taskPlacement(client, claims.spaceId, restored.id) })
        } else if (command.kind === 'capture-task' || command.kind === 'revise-task' || command.kind === 'place-task' || command.kind === 'change-outcome') changes.push({ kind: 'task-upserted', task, placement: await taskPlacement(client, claims.spaceId, task.id) })
        if (command.kind === 'capture-task' || command.kind === 'archive-task' || command.kind === 'restore-task') {
          await client.query('update team.board_columns set order_revision = order_revision + 1 where space_id = $1 and id = any($2::uuid[])', [claims.spaceId, affectedOrderColumns])
        }
        for (const event of events) {
          if (event.kind === 'closed') {
            const comment = await commentForClosure(client, claims.spaceId, event.id)
            if (comment) changes.push({ kind: 'comment-upserted', taskId: task.id, comment })
          }
        }
        if (events.length) changes.push({ kind: 'history-appended', taskId: task.id, entries: events })
        const orders = await client.query<{ id: ColumnId; order_revision: Revision }>('select id, order_revision from team.board_columns where space_id = $1 and archived_at is null', [claims.spaceId])
        for (const column of orders.rows) changes.push({ kind: 'column-order-revised', columnId: column.id, revision: column.order_revision })
        const counts = await boardCounts(client, claims.spaceId)
        const warnings: BoardWarning[] = []
        if (command.kind === 'place-task') {
          const destination = await client.query<{ flow_role: string; wip_limit: number | null }>(
            'select flow_role, wip_limit from team.board_columns where space_id = $1 and id = $2', [claims.spaceId, row.column_id])
          const column = destination.rows[0]
          const count = counts.columns!.find((item) => item.columnId === row.column_id)!.counts
          if (column.flow_role === 'active' && column.wip_limit !== null && count.tasks > column.wip_limit) {
            warnings.push({ kind: 'wip-limit-exceeded', columnId: task.columnId, limit: column.wip_limit,
              actual: count.tasks, parentTasks: count.parentTasks, subtasks: count.subtasks })
          }
          if (events.some((event) => event.kind === 'closed')) {
            const open = await client.query<{ count: number }>('select count(*)::int as count from team.tasks where space_id = $1 and parent_task_id = $2 and closed_at is null', [claims.spaceId, row.id])
            if (open.rows[0].count) warnings.push({ kind: 'open-subtasks', taskId: task.id, count: open.rows[0].count })
          }
        }
        changes.push({ kind: 'board-counts-revised', counts })
        const receipt = await commitChange(client, claims.spaceId, claims.memberId, request, requestHash,
          { kind: command.kind, taskId: task.id }, changes, warnings)
        return { ok: true as const, value: receipt }
      })
    } catch (error) {
      if (error instanceof BoardRejection) return { ok: false, fault: error.fault }
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  async follow(
    access: AuthorizedSpace<'board-follow'>,
    options: FollowOptions,
  ): Promise<Result<AsyncIterable<BoardFeedItem>, BoardFault>> {
    return followBoard(this.db, access, options)
  }
}


function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function taskDetail(client: DbClient, task: TaskRow, sequence: number, page?: PageRequest, history?: PageRequest, comments?: PageRequest): Promise<TaskDetail> {
  return { ...await taskSummary(client, task), description: task.description,
    startedAt: task.started_at?.toISOString() as import('../shared.js').Instant ?? null,
    columnEnteredAt: task.column_entered_at.toISOString() as import('../shared.js').Instant,
    cycleTimeMilliseconds: task.started_at && task.closed_at ? task.closed_at.getTime() - task.started_at.getTime() : null,
    ...(comments ? { comments: await commentPage(client, task.space_id, task.id, sequence, comments) } : {}),
    ...(history ? { history: await historyPage(client, task.space_id, task.id, sequence, history) } : {}),
    subtasks: await taskPage(client, task.space_id, task.space_key, sequence, { kind: 'parent', taskId: task.id }, page) }
}

type PageSelection = { kind: 'column'; columnId: string } | { kind: 'parent'; taskId: string } | { kind: 'archive' }

async function taskPage(client: DbClient, spaceId: string, spaceKey: string, sequence: number,
  selection: PageSelection, page?: PageRequest): Promise<Page<TaskSummary>> {
  const size = pageSize(page?.size)
  const ordered = selection.kind === 'column'
  const scope = `${spaceId}:${JSON.stringify(selection)}:${ordered ? 'rank-number' : 'number'}`
  const last = decodeCursor(page?.after, scope, sequence)
  const boundary: string[] = last ? (ordered ? JSON.parse(last) : [last]) : []
  const field = selection.kind === 'column' ? 'column_id' : 'parent_task_id'
  const id = selection.kind === 'column' ? selection.columnId : selection.kind === 'parent' ? selection.taskId : null
  const result = await client.query<TaskRow>(
    `select id, space_id, number, rank, title, column_id, assignee_id, parent_task_id, archived_at, revision,
            created_at, updated_at, outcome, duplicate_task_id, closed_at, $3::text as space_key
     from team.tasks where space_id = $1 ${selection.kind === 'archive' ? 'and archived_at is not null and $2::uuid is null' : `and ${field} = $2`}
       ${selection.kind === 'column' ? 'and archived_at is null' : ''}
       ${last ? (ordered ? 'and (rank, number) > ($5::bigint, $6::bigint)' : 'and number > $5') : ''} order by ${ordered ? 'rank, number' : 'number'} limit $4`,
    [spaceId, id, spaceKey, size + 1, ...boundary],
  )
  const rows = result.rows.slice(0, size)
  const items: TaskSummary[] = []
  for (const row of rows) items.push(await taskSummary(client, row))
  return { items, ...(result.rows.length > size ? { next: encodeCursor(scope, sequence, ordered ? JSON.stringify([rows.at(-1)!.rank, rows.at(-1)!.number]) : rows.at(-1)!.number) } : {}) }
}

async function boardCounts(client: DbClient, spaceId: string): Promise<BoardCounts> {
  const columns = await client.query<{ id: ColumnId; flow_role: string }>(
    'select id, flow_role from team.board_columns where space_id = $1 and archived_at is null order by position', [spaceId],
  )
  const result: BoardCounts = { open: 0, closed: 0, archived: 0, columns: [] }
  for (const column of columns.rows) {
    const count = await client.query<ColumnCounts>(
      `select count(*)::int as tasks, count(*) filter (where parent_task_id is null)::int as "parentTasks",
              count(*) filter (where parent_task_id is not null)::int as subtasks
       from team.tasks where space_id = $1 and column_id = $2 and archived_at is null`, [spaceId, column.id],
    )
    result.columns!.push({ columnId: column.id, counts: count.rows[0] })
    if (column.flow_role === 'complete') result.closed += count.rows[0].tasks
    else result.open += count.rows[0].tasks
  }
  const archive = await client.query<{ count: number }>('select count(*)::int as count from team.tasks where space_id = $1 and archived_at is not null', [spaceId])
  result.archived = archive.rows[0].count
  return result
}
