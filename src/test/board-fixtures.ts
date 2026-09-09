import type { BoardTransport, BoardFeedObserver } from '../board-session/board-session.ts'
import type { FollowOptions } from '../../api/contracts/board.ts'
import type { BoardFault, BoardOverview, BoardView, ChangeReceipt, ChangeRequest, TaskDetail } from '../../api/contracts/board.ts'

export const emptyBoard = {
  space: { id: 'space', key: 'DIG', displayName: 'Delivery', lifecycle: 'active', timeZone: 'Europe/Oslo', revision: 1 },
  board: { id: 'board', changeSequence: 0, workflowRevision: 1 },
  columns: [{ id: 'intake', name: 'Backlog', intake: true, completion: false, flowRole: 'queue', wipLimit: null,
    position: 0, revision: 1, tasks: { items: [] }, counts: { tasks: 0, parentTasks: 0, subtasks: 0 } }],
  members: [{ id: 'member', displayName: 'Ada', role: 'member' }], tasks: { items: [] }, unreadNotifications: 0,
} as unknown as BoardOverview

export const capturedTask = {
  id: 'task', key: 'DIG-1', title: 'Server title', description: 'Details', columnId: 'intake', revision: 1,
  assignee: null, tags: [], parentTaskId: null, archived: false, subtasks: { items: [] },
} as unknown as TaskDetail

export class MemoryBoardTransport implements BoardTransport {
  follow(_options: FollowOptions, observer: BoardFeedObserver) { observer.open(); return () => {} }
  requests: ChangeRequest[] = []
  fault?: BoardFault
  view: BoardView = { kind: 'task', sequence: 1 as never, value: capturedTask }
  receipt = { result: { kind: 'capture-task', taskId: capturedTask.id }, warnings: [], update: {
    sequence: 1, occurredAt: '2026-09-07T12:00:00Z', changes: [{ kind: 'task-upserted', task: capturedTask, placement: { columnId: 'intake' } }],
  } } as unknown as ChangeReceipt
  async read() { return { ok: true as const, value: this.view } }
  async change(request: ChangeRequest) { this.requests.push(request); return this.fault ? { ok: false as const, fault: this.fault } : { ok: true as const, value: this.receipt } }
}
