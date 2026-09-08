import type { BoardQuery, CaptureTask, ChangeRequest, TaskDestination, Closure, Outcome, TaskChanges, VersionedTask } from '../../contracts/board.js'
import type { ColumnId, MemberId, PageRequest, RequestId, Revision, TaskId } from '../../modules/shared.js'

export class InvalidBoardRequest extends Error {}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !fields.includes(field))) throw new InvalidBoardRequest('Invalid Board request')
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidBoardRequest('Expected text')
  return value
}

function page(value: unknown): PageRequest | undefined {
  if (value === undefined) return undefined
  const input = object(value, ['after', 'size'])
  if (input.after !== undefined) string(input.after)
  if (input.size !== undefined && typeof input.size !== 'number') throw new InvalidBoardRequest('Invalid page size')
  return input as PageRequest
}

function task(value: unknown): VersionedTask {
  const input = object(value, ['taskId', 'expectedRevision'])
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) throw new InvalidBoardRequest('Invalid Task revision')
  return { taskId: string(input.taskId) as TaskId, expectedRevision: input.expectedRevision as Revision }
}

function changes(value: unknown, capture: boolean): CaptureTask | TaskChanges {
  const input = object(value, ['title', 'description', 'assigneeId', 'tags', ...(capture ? ['parentTaskId'] : [])])
  if (capture || input.title !== undefined) string(input.title)
  if (input.description !== undefined) string(input.description)
  if (input.parentTaskId !== undefined) string(input.parentTaskId)
  if (input.assigneeId !== undefined && input.assigneeId !== null) string(input.assigneeId)
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string'))) {
    throw new InvalidBoardRequest('Invalid Tags')
  }
  return input as { title: string; description?: string; assigneeId?: MemberId | null; tags?: string[]; parentTaskId?: TaskId }
}

export function parseBoardChange(value: unknown): ChangeRequest {
  const body = object(value, ['requestId', 'command'])
  const command = object(body.command, ['kind', 'input', 'task', 'changes', 'destination', 'closure', 'outcome'])
  const requestId = string(body.requestId) as RequestId
  switch (command.kind) {
    case 'capture-task':
      object(command, ['kind', 'input'])
      return { requestId, command: { kind: 'capture-task', input: changes(command.input, true) as CaptureTask } }
    case 'revise-task':
      object(command, ['kind', 'task', 'changes'])
      return { requestId, command: { kind: 'revise-task', task: task(command.task), changes: changes(command.changes, false) } }
    case 'place-task': {
      object(command, ['kind', 'task', 'destination', 'closure'])
      const destination = object(command.destination, ['columnId', 'expectedOrderRevision', 'place'])
      if (!Number.isSafeInteger(destination.expectedOrderRevision) || Number(destination.expectedOrderRevision) < 1) throw new InvalidBoardRequest('Invalid order revision')
      const place = object(destination.place, ['kind', 'taskId'])
      if (place.kind === 'before' || place.kind === 'after') string(place.taskId)
      else if (place.kind === 'first' || place.kind === 'last') object(place, ['kind'])
      else throw new InvalidBoardRequest('Invalid placement')
      return { requestId, command: { kind: 'place-task', task: task(command.task), closure: closure(command.closure), destination: {
        columnId: string(destination.columnId) as ColumnId, expectedOrderRevision: destination.expectedOrderRevision as Revision,
        place: place as unknown as TaskDestination['place'],
      } } }
    }
    case 'change-outcome':
      object(command, ['kind', 'task', 'outcome'])
      return { requestId, command: { kind: 'change-outcome', task: task(command.task), outcome: outcome(command.outcome) } }
    case 'archive-task':
    case 'restore-task':
      object(command, ['kind', 'task'])
      return { requestId, command: { kind: command.kind, task: task(command.task) } }
    default: throw new InvalidBoardRequest('Unknown Board command')
  }
}

export function parseBoardQuery(value: unknown): BoardQuery {
  const input = object(value, ['kind', 'firstPageSize', 'selection', 'page', 'task', 'subtasks', 'history', 'text'])
  switch (input.kind) {
    case 'tags':
      object(input, ['kind', 'text', 'page'])
      if (input.text !== undefined) string(input.text)
      page(input.page)
      return input as BoardQuery
    case 'overview':
      object(input, ['kind', 'firstPageSize'])
      if (input.firstPageSize !== undefined && typeof input.firstPageSize !== 'number') throw new InvalidBoardRequest('Invalid page size')
      return input as BoardQuery
    case 'tasks': {
      object(input, ['kind', 'selection', 'page'])
      const selection = object(input.selection, ['kind', 'columnId'])
      if (selection.kind === 'column') string(selection.columnId)
      else if (selection.kind === 'archive') object(selection, ['kind'])
      else throw new InvalidBoardRequest('Unknown Task selection')
      page(input.page)
      return input as BoardQuery
    }
    case 'task': {
      object(input, ['kind', 'task', 'subtasks', 'history'])
      const locator = object(input.task, ['kind', 'taskId', 'taskKey'])
      if (locator.kind === 'id') { object(locator, ['kind', 'taskId']); string(locator.taskId) }
      else if (locator.kind === 'key') { object(locator, ['kind', 'taskKey']); string(locator.taskKey) }
      else throw new InvalidBoardRequest('Invalid Task locator')
      page(input.subtasks)
      page(input.history)
      return input as BoardQuery
    }
    default: throw new InvalidBoardRequest('Unknown Board query')
  }
}

function outcome(value: unknown): Outcome {
  const input = object(value, ['kind', 'taskId'])
  if (input.kind === 'duplicate') return { kind: 'duplicate', taskId: string(input.taskId) as TaskId }
  if (input.kind === 'completed' || input.kind === 'rejected' || input.kind === 'cancelled') {
    object(input, ['kind'])
    return { kind: input.kind }
  }
  throw new InvalidBoardRequest('Invalid Outcome')
}

function closure(value: unknown): Closure | undefined {
  if (value === undefined) return undefined
  const input = object(value, ['outcome', 'comment'])
  return { ...(input.outcome !== undefined ? { outcome: outcome(input.outcome) } : {}),
    ...(input.comment !== undefined ? { comment: string(input.comment) } : {}) }
}
