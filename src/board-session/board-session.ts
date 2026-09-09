import { referenceKeys } from './task-reference-text.ts'
import type {
  TaskReference, FlowView, WorkloadView, TaskSelection, WorkflowView, WorkflowPlan, NotificationView, CommentView, BoardWarning, Closure, Outcome, TaskDestination, TagView, BoardCommand, BoardFault, BoardOverview, BoardQuery, BoardUpdate, BoardView,
  ChangeReceipt, ChangeRequest, Page, TaskDetail, TaskLocator, TaskSummary, BoardFeedItem, FollowOptions,
} from '../../api/contracts/board.ts'
import type { NotificationId, CommentId, ColumnId, MemberId, RequestId, Result, Revision, TaskId, TaskKey } from '../../api/modules/shared.ts'

export interface BoardTransport {
  read(query: BoardQuery): Promise<Result<BoardView, BoardFault>>
  change(request: ChangeRequest): Promise<Result<ChangeReceipt, BoardFault>>
  follow(options: FollowOptions, observer: BoardFeedObserver): () => void
}

export interface BoardFeedObserver {
  open(): void
  item(item: BoardFeedItem): void
  disconnected(): void
}

export interface TaskDraft {
  taskId?: TaskId
  expectedRevision?: Revision
  parentTaskId?: TaskId
  title: string
  description: string
  assigneeId: MemberId | null
  tags: string[]
}

export interface CommentDraft {
  text: string
  mentions: MemberId[]
  commentId?: CommentId
  expectedRevision?: Revision
}

export type SearchScope = NonNullable<Extract<TaskSelection, { kind: 'search' }>['include']>
export type BoardExploration =
  | { kind: 'search'; text: string; include: SearchScope; results?: Page<TaskSummary> }
  | { kind: 'flow'; value?: FlowView }
  | { kind: 'workload'; value?: WorkloadView }

export interface BoardSessionState {
  references?: TaskReference[]
  exploration?: BoardExploration
  explorationLoading?: boolean
  workflow?: WorkflowView
  workflowLoad?: number
  commentDraft?: CommentDraft
  commentConflict?: CommentView
  overview: BoardOverview
  tagSuggestions: TagView[]
  detail?: TaskDetail
  draft?: TaskDraft
  conflict?: TaskDetail
  inbox?: Page<NotificationView>
  archive?: Page<TaskSummary>
  busy: boolean
  savingEdits: boolean
  pagesStale: boolean
  connected: boolean
  error?: string
  pendingAction?: boolean
  warnings: BoardWarning[]
}

export class BoardSession {
  private state: BoardSessionState
  private readonly listeners = new Set<() => void>()
  private readonly transport: BoardTransport
  private pending?: ChangeRequest
  private detailRequest = 0
  private detailLocator?: TaskLocator
  private tagRequest = 0
  private refreshRequest = 0
  private archiveRequest = 0
  private inboxRequest = 0
  private workflowRequest = 0
  private explorationRequest = 0
  private referenceRequest = 0
  private pageGeneration = 0
  private readonly commentDrafts = new Map<TaskId, CommentDraft>()
  private editBaseline?: TaskDraft
  private editSave?: Promise<boolean>
  private live = false
  private feedReady = false
  private closeFeed?: () => void
  private liveGeneration = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private syncTimer?: ReturnType<typeof setTimeout>
  private liveRefreshing = false
  private liveDirty = false
  private retryMilliseconds = 1000
  private accessDenied = false

  constructor(transport: BoardTransport, overview: BoardOverview) {
    this.transport = transport
    this.state = { overview, warnings: [], tagSuggestions: [], busy: false, savingEdits: false, pagesStale: false, connected: true }
  }

  getSnapshot = (): BoardSessionState => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private set(changes: Partial<BoardSessionState>) {
    this.state = { ...this.state, ...changes }
    for (const listener of this.listeners) listener()
    if (this.live && this.liveDirty && this.feedReady && !this.state.busy && !this.state.savingEdits) this.scheduleLiveSync()
  }

  startLive() {
    if (this.live) return
    this.live = true
    if (this.state.overview.space.lifecycle === 'active') this.connectFeed()
  }

  stopLive() {
    this.referenceRequest++
    this.live = false
    this.liveGeneration++
    this.feedReady = false
    this.closeFeed?.()
    this.closeFeed = undefined
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.syncTimer)
    this.reconnectTimer = this.syncTimer = undefined
  }

  async reconnect() {
    if (!this.live) { await this.refresh(); return }
    this.accessDenied = false
    this.disconnectLive(0)
  }

  private connectFeed() {
    const generation = ++this.liveGeneration
    this.closeFeed?.()
    this.feedReady = false
    this.set({ connected: false })
    this.closeFeed = this.transport.follow({ after: this.state.overview.board.changeSequence }, {
      open: () => {
        if (!this.live || generation !== this.liveGeneration) return
        this.feedReady = true
        this.retryMilliseconds = 1000
        this.set({ connected: true, error: this.state.conflict || this.state.commentConflict ? this.state.error : undefined })
        if (this.state.detail && !this.state.draft && !this.state.busy) this.beginEdit()
      },
      disconnected: () => { if (this.live && generation === this.liveGeneration) this.disconnectLive() },
      item: (item) => {
        if (!this.live || generation !== this.liveGeneration) return
        if (item.kind !== 'update') { this.disconnectLive(item.kind === 'snapshot-required' ? 0 : 1000); return }
        if (item.update.sequence <= this.state.overview.board.changeSequence) return
        if (item.update.sequence !== this.state.overview.board.changeSequence + 1) { this.disconnectLive(0); return }
        this.liveDirty = true
        if (!this.state.busy && !this.state.savingEdits && !this.liveRefreshing) this.applyUpdate(item.update)
        this.scheduleLiveSync()
      },
    })
  }

  private disconnectLive(delay = this.retryMilliseconds) {
    if (!this.live) return
    this.liveGeneration++
    this.closeFeed?.()
    this.closeFeed = undefined
    this.feedReady = false
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.syncTimer)
    this.syncTimer = undefined
    this.set({ connected: false, error: 'Connection lost. Your drafts are kept while the Board reconnects.' })
    this.retryMilliseconds = Math.min(this.retryMilliseconds * 2, 10000)
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; void this.recoverLive() }, delay)
  }

  private async recoverLive() {
    if (!this.live) return
    if (this.state.busy || this.state.savingEdits || this.liveRefreshing) { this.disconnectLive(100); return }
    if (!await this.refreshLiveSnapshot()) {
      if (this.live && !this.accessDenied && !this.reconnectTimer) this.disconnectLive(100)
      return
    }
    if (!this.live) return
    if (this.state.overview.space.lifecycle === 'active') this.connectFeed()
    else this.set({ connected: true, error: undefined })
  }

  private scheduleLiveSync() {
    if (this.syncTimer || this.liveRefreshing || !this.feedReady || !this.live) return
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      if (!this.live || !this.feedReady || this.state.busy || this.state.savingEdits) return
      void this.refreshLiveSnapshot()
    }, 0)
  }

  private async refreshLiveSnapshot(): Promise<boolean> {
    const generation = this.liveGeneration, detailRequest = this.detailRequest
    const detail = this.state.detail, inbox = this.state.inbox, archive = this.state.archive
    this.liveRefreshing = true
    this.liveDirty = false
    try {
      const overview = await this.transport.read({ kind: 'overview' })
      if (!this.live || generation !== this.liveGeneration) return false
      if (!overview.ok) {
        this.accessDenied = overview.fault.kind === 'forbidden' || overview.fault.kind === 'not-found'
        this.fail(overview.fault)
        if (overview.fault.kind !== 'forbidden' && overview.fault.kind !== 'not-found') this.disconnectLive()
        return false
      }
      if (overview.value.kind !== 'overview') { this.disconnectLive(); return false }
      const [task, notices, archived] = await Promise.all([
        detail ? this.transport.read({ kind: 'task', task: { kind: 'id', taskId: detail.id }, comments: {}, ...(detail.history ? { history: {} } : {}) }) : undefined,
        inbox ? this.transport.read({ kind: 'inbox' }) : undefined,
        archive ? this.transport.read({ kind: 'tasks', selection: { kind: 'archive' } }) : undefined,
      ])
      if (!this.live || generation !== this.liveGeneration) return false
      if (this.state.busy || this.state.savingEdits || detailRequest !== this.detailRequest
        || overview.value.sequence < this.state.overview.board.changeSequence) { this.liveDirty = true; return false }
      for (const result of [task, notices, archived]) {
        if (result && !result.ok) { this.fail(result.fault); this.disconnectLive(); return false }
      }
      const current = task?.ok && task.value.kind === 'task' ? task.value.value : undefined
      const dirty = this.hasUnsavedEdits()
      this.pageGeneration++
      this.set({ overview: overview.value.value, pagesStale: false,
        ...(current ? { detail: current } : {}),
        ...(notices?.ok && notices.value.kind === 'inbox' && this.state.inbox ? { inbox: notices.value.value } : {}),
        ...(archived?.ok && archived.value.kind === 'tasks' && this.state.archive ? { archive: archived.value.value } : {}),
      })
      if (current && this.state.draft?.taskId === current.id) {
        if (dirty && this.state.draft.expectedRevision !== current.revision && !this.pending) {
          this.set({ conflict: current, error: 'Someone changed this Task. Compare your draft with the current version.' })
        } else if (!dirty && !this.state.conflict) {
          this.editBaseline = { taskId: current.id, expectedRevision: current.revision, title: current.title, description: current.description,
            assigneeId: current.assignee?.id ?? null, tags: current.tags.map((tag) => tag.name) }
          this.set({ draft: current.archived ? undefined : this.editBaseline })
        }
      }
      const editedComment = current?.comments?.items.find((comment) => comment.id === this.state.commentDraft?.commentId)
      if (editedComment && editedComment.revision !== this.state.commentDraft?.expectedRevision) this.set({ commentConflict: editedComment })
      if (this.state.exploration) await this.refreshExploration()
      return true
    } catch { this.disconnectLive(); return false }
    finally {
      this.liveRefreshing = false
      if (this.liveDirty) this.scheduleLiveSync()
    }
  }

  beginCapture(parentTaskId?: TaskId) {
    if (!this.canChange()) return
    this.set({ draft: { title: '', description: '', assigneeId: null, tags: [], parentTaskId }, conflict: undefined, error: undefined })
  }

  beginEdit() {
    const task = this.state.detail
    if (!task || task.archived || !this.canChange()) return
    this.editBaseline = { taskId: task.id, expectedRevision: task.revision, title: task.title, description: task.description,
      assigneeId: task.assignee?.id ?? null, tags: task.tags.map((tag) => tag.name) }
    this.set({ draft: this.editBaseline, conflict: undefined, error: undefined })
  }

  updateDraft(changes: Partial<Pick<TaskDraft, 'title' | 'description' | 'assigneeId' | 'tags'>>) {
    if (this.state.draft && !this.state.pendingAction && this.state.connected && this.state.overview.space.lifecycle === 'active'
      && !(this.state.draft.taskId && this.state.detail?.archived)
      && (!this.state.busy || this.state.savingEdits)) {
      this.set({ draft: { ...this.state.draft, ...changes }, error: this.state.conflict ? this.state.error : undefined })
    }
  }

  hasUnsavedEdits = () => {
    const draft = this.state.draft, saved = this.editBaseline
    const uncertain = this.pending?.command.kind === 'revise-task' && this.pending.command.task.taskId === draft?.taskId
    return Boolean(draft?.taskId && (uncertain || !saved || draft.title !== saved.title || draft.description !== saved.description
      || draft.assigneeId !== saved.assigneeId || JSON.stringify(draft.tags) !== JSON.stringify(saved.tags)))
  }

  async openEditor(task: TaskLocator) {
    if (!await this.saveEdits() || this.state.busy) return
    this.set({ busy: true })
    let opened: boolean | undefined
    try { opened = await this.openTask(task) } finally { this.set({ busy: false }) }
    if (opened) {
      this.cancelDraft()
      this.beginEdit()
    }
  }

  async closeEditor() {
    if (this.state.busy && !this.state.savingEdits) return
    if (await this.saveEdits()) this.closeDetail()
  }

  saveEdits(): Promise<boolean> {
    if (this.editSave) return this.editSave
    if (!this.hasUnsavedEdits()) return Promise.resolve(true)
    if (this.state.detail?.archived) return Promise.resolve(false)
    if (!this.canChange() || this.state.conflict) return Promise.resolve(false)
    this.set({ savingEdits: true })
    this.editSave = this.flushEdits().finally(() => {
      this.editSave = undefined
      this.set({ savingEdits: false })
    })
    return this.editSave
  }

  private async flushEdits(): Promise<boolean> {
    while (this.hasUnsavedEdits()) {
      if (!this.canChange() || this.state.conflict) return false
      const draft = this.state.draft!
      // Resolve an uncertain save with its original request before sending newer typing.
      const retry = this.pending?.command.kind === 'revise-task' && this.pending.command.task.taskId === draft.taskId
        ? this.pending.command : undefined
      const submitted = retry ? { ...draft, ...retry.changes, expectedRevision: retry.task.expectedRevision } : draft
      const receipt = await this.commit(retry ?? { kind: 'revise-task', task: { taskId: draft.taskId!, expectedRevision: draft.expectedRevision! },
        changes: { title: draft.title, description: draft.description, assigneeId: draft.assigneeId, tags: draft.tags } })
      if (!receipt) return false
      const change = receipt.update.changes.find((change) => change.kind === 'task-upserted' && change.task.id === draft.taskId)
      if (change?.kind !== 'task-upserted') { this.fail({ kind: 'temporarily-unavailable' }); return false }
      const task = change.task
      const saved = { ...submitted, expectedRevision: task.revision, title: task.title, assigneeId: task.assignee?.id ?? null,
        tags: task.tags.map((tag) => tag.name) }
      const current = this.state.draft!
      this.editBaseline = saved
      this.set({ draft: { ...current, expectedRevision: saved.expectedRevision,
        title: current.title === submitted.title ? saved.title : current.title,
        assigneeId: current.assigneeId === submitted.assigneeId ? saved.assigneeId : current.assigneeId,
        tags: JSON.stringify(current.tags) === JSON.stringify(submitted.tags) ? saved.tags : current.tags },
        detail: { ...this.state.detail!, ...task, description: submitted.description, subtasks: this.state.detail?.subtasks ?? { items: [] } } })
    }
    return true
  }

  async quickCapture(title: string, parentTaskId?: TaskId): Promise<boolean> {
    if (!await this.saveEdits() || !this.canChange()) return false
    const receipt = await this.commit({ kind: 'capture-task', input: { title, parentTaskId } })
    if (!receipt) return false
    if (parentTaskId) {
      await this.openTask({ kind: 'id', taskId: parentTaskId })
      this.beginEdit()
    }
    return true
  }

  cancelDraft() { this.set({ draft: undefined, conflict: undefined, error: undefined }) }
  closeDetail() { this.detailRequest++; this.detailLocator = undefined; this.set({ detail: undefined, draft: undefined, conflict: undefined }) }
  setConnected(connected: boolean) {
    if (this.live && !connected) this.disconnectLive()
    else this.set({ connected })
  }

  private canChange() { return !this.state.pendingAction && this.state.connected && !this.state.busy && this.state.overview.space.lifecycle === 'active' }

  suggestTags = async (text: string) => {
    const request = ++this.tagRequest
    const result = await this.transport.read({ kind: 'tags', text, page: { size: 50 } })
    if (request !== this.tagRequest) return
    if (!result.ok) { this.fail(result.fault); return }
    if (result.value.kind === 'tags') this.set({ tagSuggestions: result.value.value.items })
  }

  async openTask(task: TaskLocator) {
    this.detailLocator = task
    const generation = this.pageGeneration
    const request = ++this.detailRequest
    const result = await this.transport.read({ kind: 'task', task, markNotificationsRead: true, comments: {}, ...(this.state.detail?.history ? { history: {} } : {}) })
    if (request !== this.detailRequest || generation !== this.pageGeneration) return
    if (!result.ok) { this.fail(result.fault); return }
    if (result.value.sequence < this.state.overview.board.changeSequence) return
    if (result.value.kind === 'task') { const taskId = result.value.value.id; this.set({ overview: { ...this.state.overview, unreadNotifications: result.value.unreadNotifications ?? this.state.overview.unreadNotifications },
      inbox: this.state.inbox ? { ...this.state.inbox, items: this.state.inbox.items.map((notification) => notification.task.id === taskId ? { ...notification, read: true } : notification) } : undefined,
      detail: result.value.value, commentConflict: undefined, commentDraft: this.commentDrafts.get(result.value.value.id) ?? { text: '', mentions: [] }, error: undefined }); return true }
  }

  async saveDraft(): Promise<boolean> {
    const draft = this.state.draft
    if (!draft || !this.canChange() || this.state.conflict) return false
    if (draft.taskId) {
      const saved = await this.saveEdits()
      if (saved) this.cancelDraft()
      return saved
    }
    const changes = { title: draft.title, description: draft.description, assigneeId: draft.assigneeId, tags: draft.tags }
    const receipt = await this.commit({ kind: 'capture-task', input: { ...changes, parentTaskId: draft.parentTaskId } })
    if (!receipt) return false
    this.set({ draft: undefined, conflict: undefined })
    if (receipt.result.taskId) await this.openTask({ kind: 'id', taskId: receipt.result.taskId })
    return true
  }

  useCurrentRevision() {
    if (this.state.detail?.archived) return
    if (this.state.draft && this.state.conflict) this.set({ draft: { ...this.state.draft, expectedRevision: this.state.conflict.revision }, conflict: undefined, error: undefined })
  }

  private async commit(command: BoardCommand, reloadTaskId?: TaskId, reloadInbox = false): Promise<ChangeReceipt | undefined> {
    if (this.state.pendingAction && JSON.stringify(this.pending?.command) !== JSON.stringify(command)) {
      this.set({ error: 'Retry the pending change before making another change.' })
      return
    }
    this.set({ busy: true, error: undefined, warnings: [] })
    if (!this.pending || JSON.stringify(this.pending.command) !== JSON.stringify(command)) {
      this.pending = { requestId: crypto.randomUUID() as RequestId, command }
    }
    try {
      const result = await this.transport.change(this.pending)
      if (!result.ok) {
        if (result.fault.kind !== 'temporarily-unavailable') this.pending = undefined
        if (result.fault.kind === 'conflict' && (command.kind === 'place-task')
          && (result.fault.reason === 'stale-order' || result.fault.reason === 'stale-task')) {
          await this.refresh()
          this.set({ error: 'Another change won. The Board has been refreshed; choose the move again.' })
        } else this.fail(result.fault)
        return
      }
      this.pending = undefined
      this.set({ warnings: result.value.warnings })
      this.applyUpdate(result.value.update)
      if (this.state.pagesStale) await this.refresh()
      if (reloadTaskId && this.state.detail?.id === reloadTaskId) await this.openTask({ kind: 'id', taskId: reloadTaskId })
      if (reloadInbox) await this.readInbox()
      return result.value
    } catch {
      this.fail({ kind: 'temporarily-unavailable' })
      return
    } finally { this.set({ busy: false, pendingAction: Boolean(this.pending && this.pending.command.kind !== 'capture-task' && this.pending.command.kind !== 'revise-task') }) }
  }

  applyUpdate(update: BoardUpdate) {
    if (update.sequence <= this.state.overview.board.changeSequence) return
    this.pageGeneration++
    let overview = this.state.overview
    let detail = this.state.detail
    let inbox = this.state.inbox
    let pagesStale = this.state.pagesStale
    for (const change of update.changes) {
      if (change.kind === 'query-revisions-changed') {
        pagesStale = true
      } else if (change.kind === 'workflow-replaced') {
        overview = { ...overview, board: { ...overview.board, workflowRevision: change.workflow.revision },
          columns: change.workflow.columns.filter((column) => !column.archived).map((column) => {
            const previous = overview.columns.find((item) => item.id === column.id)
            return { ...column, tasks: previous?.tasks ?? { items: [] },
              counts: previous?.counts ?? { tasks: 0, parentTasks: 0, subtasks: 0 } }
          }) }
      } else if (change.kind === 'task-upserted') {
        const task = change.task
        if (detail?.id === task.id) detail = { ...detail, ...task }
        overview = { ...overview, columns: overview.columns.map((column) => {
          const oldIndex = column.tasks.items.findIndex((item) => item.id === task.id)
          const items = column.tasks.items.filter((item) => item.id !== task.id)
          if (column.id === task.columnId && !task.archived) {
            const { beforeTaskId, afterTaskId } = change.placement
            const anchorId = beforeTaskId ?? afterTaskId
            const anchor = items.findIndex((item) => item.id === anchorId)
            if (anchorId && anchor >= 0) items.splice(anchor + (afterTaskId ? 1 : 0), 0, task)
            else if (!anchorId && (oldIndex >= 0 || !column.tasks.next)) items.splice(oldIndex < 0 ? items.length : oldIndex, 0, task)
            else pagesStale = true
          }
          return { ...column, tasks: { ...column.tasks, items } }
        }) }
      } else if (change.kind === 'comment-upserted' && detail?.id === change.taskId && detail.comments) {
        const existing = detail.comments.items.some((item) => item.id === change.comment.id)
        detail = { ...detail, comments: { ...detail.comments, items: existing
          ? detail.comments.items.map((item) => item.id === change.comment.id ? change.comment : item)
          : [change.comment, ...detail.comments.items] } }
      } else if (change.kind === 'comment-removed' && detail?.id === change.taskId && detail.comments) {
        detail = { ...detail, comments: { ...detail.comments, items: detail.comments.items.map((item) => item.id === change.comment.id
          ? { ...item, text: '', mentions: [], removedAt: change.comment.removedAt, revision: change.comment.revision } : item) } }
      } else if (change.kind === 'history-appended' && detail?.id === change.taskId && detail.history) {
        const ids = new Set(change.entries.map((entry) => entry.id))
        detail = { ...detail, history: { ...detail.history, items: [...change.entries].reverse().concat(detail.history.items.filter((entry) => !ids.has(entry.id))) } }
      } else if (change.kind === 'column-order-revised') {
        overview = { ...overview, columns: overview.columns.map((column) => column.id === change.columnId ? { ...column, orderRevision: change.revision } : column) }
      } else if (change.kind === 'tasks-archived') {
        if (detail && change.taskIds.includes(detail.id)) detail = { ...detail, archived: true }
        overview = { ...overview, columns: overview.columns.map((column) => ({ ...column,
          tasks: { ...column.tasks, items: column.tasks.items.filter((task) => !change.taskIds.includes(task.id)) } })) }
      } else if (change.kind === 'board-counts-revised' && change.counts.columns) {
        const counts = change.counts.columns
        overview = { ...overview, columns: overview.columns.map((column) => ({ ...column, counts: counts.find((item) => item.columnId === column.id)?.counts ?? column.counts })) }
      } else if (change.kind === 'notifications-read' && change.memberId === overview.currentMemberId) {
        overview = { ...overview, unreadNotifications: change.unreadNotifications }
        if (inbox) inbox = { ...inbox, items: inbox.items.map((notification) => change.all || change.taskId === notification.task.id || change.notificationIds?.includes(notification.id)
          ? { ...notification, read: true } : notification) }
      } else if (change.kind === 'membership-ended') {
        overview = { ...overview, members: overview.members.filter((member) => member.id !== change.memberId) }
      }
    }
    this.set({ inbox, detail, pagesStale, overview: { ...overview, board: { ...overview.board, changeSequence: update.sequence } } })
  }

  async refresh() {
    const request = ++this.refreshRequest
    const result = await this.transport.read({ kind: 'overview' })
    if (request !== this.refreshRequest) return
    if (!result.ok) { this.fail(result.fault); return }
    if (result.value.kind !== 'overview' || result.value.sequence < this.state.overview.board.changeSequence) return
    this.pageGeneration++
    this.archiveRequest++
    this.detailRequest++
    this.set({ overview: result.value.value, connected: !this.live || this.feedReady, pagesStale: false, archive: undefined,
      detail: this.state.draft?.taskId ? this.state.detail : undefined, error: undefined })
    if (this.detailLocator) await this.openTask(this.detailLocator)
    if (this.state.exploration) await this.refreshExploration()
  }

  async loadMore(columnId: ColumnId) {
    const column = this.state.overview.columns.find((column) => column.id === columnId)
    if (!column?.tasks.next || this.state.busy || this.state.pagesStale) return
    const generation = this.pageGeneration
    this.set({ busy: true })
    try {
      const result = await this.transport.read({ kind: 'tasks', selection: { kind: 'column', columnId }, page: { after: column.tasks.next } })
      if (generation !== this.pageGeneration) return
      if (!result.ok) {
        if (result.fault.kind === 'cursor-expired') await this.refresh()
        this.fail(result.fault); return
      }
      if (result.value.sequence !== this.state.overview.board.changeSequence) { await this.refresh(); return }
      if (result.value.kind === 'tasks') {
        const page = result.value.value
        this.set({ overview: { ...this.state.overview, columns: this.state.overview.columns.map((current) => current.id === columnId
          ? { ...current, tasks: { items: [...current.tasks.items, ...page.items], next: page.next } } : current) } })
      }
    } finally { this.set({ busy: false }) }
  }

  async resolveReferences(text: string) {
    const request = ++this.referenceRequest
    const keys = referenceKeys(text) as TaskKey[]
    const references: TaskReference[] = []
    if (!keys.length) { this.set({ references }); return }
    for (let offset=0;offset<keys.length;offset+=50) {
      try {
        const result = await this.transport.read({ kind: 'references',keys: keys.slice(offset,offset+50) })
        if (request !== this.referenceRequest) return
        if (result.ok && result.value.kind === 'references') references.push(...result.value.value)
      } catch { /* Failed or inaccessible lookups leave the original text unlinked. */ }
      if (request !== this.referenceRequest) return
    }
    this.set({ references })
  }

  async explore(kind: 'board' | BoardExploration['kind']) {
    this.explorationRequest++
    this.set({ exploration: kind === 'board' ? undefined : kind === 'search' ? { kind, text: '', include: 'open' } : { kind }, explorationLoading: false, error: undefined })
    if (kind !== 'board') await this.refreshExploration()
  }

  async search(text: string, include: SearchScope) {
    this.set({ exploration: { kind: 'search',text,include },error: undefined })
    await this.refreshExploration()
  }

  async loadExplorationMore(memberId?: MemberId) {
    if (this.state.explorationLoading || this.state.pagesStale) return
    const view = this.state.exploration
    const after = view?.kind === 'search' ? view.results?.next : view?.kind === 'flow' ? view.value?.oldest.next
      : view?.kind === 'workload' ? view.value?.members.find((row) => row.member.id === memberId)?.tasks.next : undefined
    if (after) await this.refreshExploration(after,memberId)
  }

  private async refreshExploration(after?: import('../../api/modules/shared.ts').OpaqueCursor, memberId?: MemberId): Promise<void> {
    const view = this.state.exploration
    if (!view) return
    const request = ++this.explorationRequest
    const query: BoardQuery = view.kind === 'search' ? { kind: 'tasks',selection: { kind: 'search',text: view.text,include: view.include },page: { after } }
      : view.kind === 'flow' ? { kind: 'flow',page: { after } } : { kind: 'workload',memberId,page: { after } }
    this.set({ explorationLoading: true })
    try {
      const result = await this.transport.read(query)
      if (request !== this.explorationRequest) return
      if (!result.ok) {
        if (result.fault.kind === 'cursor-expired') { await this.refreshExploration(); return }
        this.fail(result.fault); return
      }
      if (result.value.sequence < this.state.overview.board.changeSequence) {
        this.liveDirty = true; this.scheduleLiveSync(); return
      }
      if (view.kind === 'search' && result.value.kind === 'tasks') this.set({ exploration: { ...view, results: {
        ...result.value.value,items: after ? [...(view.results?.items ?? []),...result.value.value.items] : result.value.value.items,
      } } })
      if (view.kind === 'flow' && result.value.kind === 'flow') this.set({ exploration: { kind: 'flow',value: { ...result.value.value,
        oldest: { ...result.value.value.oldest,items: after ? [...(view.value?.oldest.items ?? []),...result.value.value.oldest.items] : result.value.value.oldest.items },
      } } })
      if (view.kind === 'workload' && result.value.kind === 'workload') {
        const value = result.value.value
        this.set({ exploration: { kind: 'workload', value: after && view.value ? { ...value,members: view.value.members.map((row) => {
          const next = value.members.find((item) => item.member.id === row.member.id)
          return next ? { ...next,tasks: { ...next.tasks,items: [...row.tasks.items,...next.tasks.items] } } : row
        }) } : value } })
      }
    } catch { if (request === this.explorationRequest) this.fail({ kind: 'temporarily-unavailable' }) }
    finally { if (request === this.explorationRequest) this.set({ explorationLoading: false }) }
  }

  async openWorkflow() {
    if (this.state.busy || this.state.pendingAction) return
    const request = ++this.workflowRequest
    this.set({ busy: true })
    try {
      const result = await this.transport.read({ kind: 'workflow' })
      if (request !== this.workflowRequest) return
      if (!result.ok) { this.fail(result.fault); return }
      if (result.value.kind === 'workflow') this.set({ workflow: result.value.value, workflowLoad: request, error: undefined })
    } finally { this.set({ busy: false }) }
  }

  closeWorkflow() { if (!this.state.busy && !this.state.pendingAction) { this.workflowRequest++; this.set({ workflow: undefined }) } }

  async saveWorkflow(expectedRevision: Revision, desired: WorkflowPlan) {
    if (!this.canChange()) return false
    const result = await this.commit({ kind: 'set-workflow', expectedRevision, desired })
    if (!result) return false
    this.set({ workflow: undefined })
    return true
  }

  async openArchive(more = false) {
    if (this.state.busy || (more && (!this.state.archive?.next || this.state.pagesStale))) return
    const after = more ? this.state.archive?.next : undefined
    const request = ++this.archiveRequest
    const generation = this.pageGeneration
    this.set({ busy: true })
    try {
      const result = await this.transport.read({ kind: 'tasks', selection: { kind: 'archive' }, page: { after } })
      if (request !== this.archiveRequest || generation !== this.pageGeneration) return
      if (!result.ok) {
        if (result.fault.kind === 'cursor-expired') this.set({ archive: undefined })
        this.fail(result.fault); return
      }
      if (result.value.sequence < this.state.overview.board.changeSequence) return
      if (result.value.kind === 'tasks') this.set({ archive: {
        items: [...(more ? this.state.archive?.items ?? [] : []), ...result.value.value.items], next: result.value.value.next,
      } })
    } finally { this.set({ busy: false }) }
  }

  async openInbox(more = false) {
    if (this.state.busy || more && (!this.state.inbox?.next || this.state.pagesStale)) return
    this.set({ busy: true })
    try { await this.readInbox(more) } finally { this.set({ busy: false }) }
  }

  private async readInbox(more = false) {
    const request = ++this.inboxRequest, generation = this.pageGeneration
    const result = await this.transport.read({ kind: 'inbox', page: { after: more ? this.state.inbox?.next : undefined } })
    if (request !== this.inboxRequest || generation !== this.pageGeneration) return
    if (!result.ok) { if (result.fault.kind === 'cursor-expired') this.set({ inbox: undefined }); this.fail(result.fault); return }
    if (result.value.kind === 'inbox' && result.value.sequence >= this.state.overview.board.changeSequence) this.set({
      inbox: { items: [...(more ? this.state.inbox?.items ?? [] : []), ...result.value.value.items], next: result.value.value.next },
      overview: { ...this.state.overview, unreadNotifications: result.value.unreadNotifications ?? this.state.overview.unreadNotifications },
    })
  }

  closeInbox() { this.inboxRequest++; this.set({ inbox: undefined }) }

  async markNotificationRead(notificationId?: NotificationId) {
    if (!this.canChange()) return
    await this.commit(notificationId ? { kind: 'mark-notification-read', notificationId } : { kind: 'mark-all-notifications-read' }, undefined, true)
  }

  closeArchive() { this.archiveRequest++; this.set({ archive: undefined }) }

  async loadMoreSubtasks() {
    const detail = this.state.detail
    if (!detail?.subtasks.next || this.state.busy || this.state.pagesStale) return
    const generation = this.pageGeneration
    const request = this.detailRequest
    this.set({ busy: true })
    try {
    const result = await this.transport.read({ kind: 'task', task: { kind: 'id', taskId: detail.id }, subtasks: { after: detail.subtasks.next } })
    if (generation !== this.pageGeneration || request !== this.detailRequest) return
    if (!result.ok) {
      if (result.fault.kind === 'cursor-expired') {
        await this.openTask({ kind: 'id', taskId: detail.id })
        if (this.state.connected) this.set({ error: 'Subtasks changed. Their first page has been reloaded.' })
      } else this.fail(result.fault)
      return
    }
    if (result.value.kind === 'task' && this.state.detail?.id === detail.id) this.set({ detail: { ...result.value.value, history: this.state.detail.history, comments: this.state.detail.comments,
      subtasks: { items: [...detail.subtasks.items, ...result.value.value.subtasks.items], next: result.value.value.subtasks.next } } })
    } finally { this.set({ busy: false }) }
  }

  async retryPendingChange() {
    if (!this.state.connected || this.state.busy || this.state.overview.space.lifecycle !== 'active' || !this.state.pendingAction || !this.pending) return false
    const command = this.pending.command
    const taskId = 'task' in command ? command.task.taskId : command.kind === 'add-comment' ? command.taskId : this.state.detail?.id
    const result = await this.commit(command, taskId, command.kind === 'mark-notification-read' || command.kind === 'mark-all-notifications-read')
    if (!result) return false
    if (command.kind === 'set-workflow') this.set({ workflow: undefined })
    if ((command.kind === 'add-comment' || command.kind === 'revise-comment') && result.result.taskId) {
      this.commentDrafts.delete(result.result.taskId)
      if (this.state.detail?.id === result.result.taskId) this.set({ commentDraft: { text: '', mentions: [] }, commentConflict: undefined })
    }
    if (this.state.detail && !this.hasUnsavedEdits()) this.beginEdit()
    return true
  }

  async moveTask(task: TaskSummary, destination: TaskDestination, closure?: Closure) {
    if (!await this.saveEdits() || !this.canChange()) return false
    const current = this.state.detail?.id === task.id ? this.state.detail : task
    const result = await this.commit({ kind: 'place-task', task: { taskId: current.id, expectedRevision: current.revision }, destination, closure }, current.id)
    if (!result) return false
    if (this.state.detail?.id === task.id) this.beginEdit()
    return true
  }

  async chooseOutcome(kind: Outcome['kind'], duplicateKey: string, comment?: string) {
    if (!await this.saveEdits() || !this.canChange() || !this.state.detail) return false
    const detail = this.state.detail
    let outcome: Outcome
    if (kind === 'duplicate') {
      this.set({ busy: true })
      try {
        const target = await this.transport.read({ kind: 'task', task: { kind: 'key', taskKey: duplicateKey.trim() as TaskKey } })
        if (!target.ok) { this.fail(target.fault); return false }
        if (target.value.kind !== 'task') return false
        outcome = { kind, taskId: target.value.value.id }
      } finally { this.set({ busy: false }) }
    } else outcome = { kind }
    if (detail.closedAt) {
      const receipt = await this.commit({ kind: 'change-outcome', task: { taskId: detail.id, expectedRevision: detail.revision }, outcome }, detail.id)
      if (!receipt) return false
      this.beginEdit()
      return true
    }
    const completion = this.state.overview.columns.find((column) => column.completion)!
    return this.moveTask(detail, { columnId: completion.id, expectedOrderRevision: completion.orderRevision, place: { kind: 'last' } }, { outcome, ...(comment ? { comment } : {}) })
  }

  hasUnsavedComments = () => this.commentDrafts.size > 0

  updateCommentDraft(changes: Partial<Pick<CommentDraft, 'text' | 'mentions'>>) {
    if (!this.canChange() || !this.state.detail || this.state.detail.archived) return
    const draft = { ...this.state.commentDraft ?? { text: '', mentions: [] }, ...changes }
    if (draft.text || draft.mentions.length || draft.commentId) this.commentDrafts.set(this.state.detail.id, draft)
    else this.commentDrafts.delete(this.state.detail.id)
    this.set({ commentDraft: draft })
  }

  editComment(comment: CommentView) {
    if (!this.canChange() || !this.state.detail || this.state.commentDraft?.text || this.state.commentDraft?.commentId) return
    const draft = { commentId: comment.id, expectedRevision: comment.revision, text: comment.text, mentions: comment.mentions.map((member) => member.id) }
    this.commentDrafts.set(this.state.detail.id, draft)
    this.set({ commentDraft: draft })
  }

  cancelComment() {
    if (this.state.busy || this.state.pendingAction) return
    if (this.state.detail) this.commentDrafts.delete(this.state.detail.id)
    this.set({ commentDraft: { text: '', mentions: [] }, commentConflict: undefined })
  }

  useCurrentCommentRevision() {
    const current = this.state.commentConflict, detail = this.state.detail, draft = this.state.commentDraft
    if (!current || !detail || !draft || !this.canChange()) return
    const revised = { ...draft, commentId: current.removedAt ? undefined : current.id,
      expectedRevision: current.removedAt ? undefined : current.revision }
    this.commentDrafts.set(detail.id, revised)
    this.set({ commentDraft: revised, commentConflict: undefined, error: undefined })
  }

  async saveComment() {
    if (!await this.saveEdits() || !this.canChange() || !this.state.detail || !this.state.commentDraft || this.state.commentConflict) return false
    const { detail, commentDraft: draft } = this.state
    const command: BoardCommand = draft.commentId ? { kind: 'revise-comment', comment: { commentId: draft.commentId, expectedRevision: draft.expectedRevision! }, text: draft.text, mentions: draft.mentions }
      : { kind: 'add-comment', taskId: detail.id, text: draft.text, mentions: draft.mentions }
    const receipt = await this.commit(command, detail.id)
    if (!receipt) return false
    this.commentDrafts.delete(detail.id)
    this.set({ commentDraft: { text: '', mentions: [] }, commentConflict: undefined })
    this.beginEdit()
    return true
  }

  async removeComment(comment: CommentView) {
    if (!await this.saveEdits() || !this.canChange() || !this.state.detail) return
    await this.commit({ kind: 'remove-comment', comment: { commentId: comment.id, expectedRevision: comment.revision } }, this.state.detail.id)
  }

  async loadMoreComments() {
    const detail = this.state.detail
    if (!detail?.comments?.next || this.state.busy || this.state.pagesStale) return
    const generation = this.pageGeneration, request = this.detailRequest
    this.set({ busy: true })
    try {
      const result = await this.transport.read({ kind: 'task', task: { kind: 'id', taskId: detail.id }, comments: { after: detail.comments.next } })
      if (generation !== this.pageGeneration || request !== this.detailRequest) return
      if (!result.ok) { if (result.fault.kind === 'cursor-expired') await this.openTask({ kind: 'id', taskId: detail.id }); this.fail(result.fault); return }
      if (result.value.kind === 'task' && result.value.value.comments) this.set({ detail: { ...this.state.detail!,
        comments: { items: [...detail.comments.items, ...result.value.value.comments.items], next: result.value.value.comments.next } } })
    } finally { this.set({ busy: false }) }
  }

  async loadHistory(more = false) {
    const detail = this.state.detail
    if (!detail || this.state.busy || more && (!detail.history?.next || this.state.pagesStale)) return
    const generation = this.pageGeneration
    const request = this.detailRequest
    this.set({ busy: true })
    try {
      const result = await this.transport.read({ kind: 'task', task: { kind: 'id', taskId: detail.id }, history: { after: more ? detail.history?.next : undefined } })
      if (generation !== this.pageGeneration || request !== this.detailRequest) return
      if (!result.ok) {
        if (result.fault.kind === 'cursor-expired') await this.openTask({ kind: 'id', taskId: detail.id })
        this.fail(result.fault); return
      }
      if (result.value.kind === 'task' && result.value.value.history) {
        const history = result.value.value.history
        this.set({ detail: { ...this.state.detail!, history: { items: [...(more ? detail.history?.items ?? [] : []), ...history.items], next: history.next } } })
      }
    } finally { this.set({ busy: false }) }
  }

  async archiveTask(restore = false) {
    if (!await this.saveEdits()) return
    const detail = this.state.detail
    if (!detail || !this.canChange()) return
    const result = await this.commit({ kind: restore ? 'restore-task' : 'archive-task', task: { taskId: detail.id, expectedRevision: detail.revision } })
    if (result) {
      this.cancelDraft()
      await this.openTask({ kind: 'id', taskId: detail.id })
      if (restore) this.beginEdit()
      if (this.state.archive) await this.openArchive()
    }
  }

  private fail(fault: BoardFault) {
    let error = 'The request could not be completed.'
    if (fault.kind === 'invalid') error = fault.issues.map((issue) => issue.message).join(' ')
    if (fault.kind === 'not-found') error = 'Task or Member is no longer available.'
    if (fault.kind === 'rule-violation') error = fault.rule === 'subtask-depth' ? 'Subtasks cannot have Subtasks.' : fault.rule === 'column-not-empty' ? 'Empty the Column before changing its role, Intake status, or archiving it.' : 'This change is not allowed.'
    if (fault.kind === 'cursor-expired') error = 'This page changed. Reload it to continue.'
    if (fault.kind === 'conflict') {
      error = fault.reason === 'stale-workflow' ? 'The workflow changed. Reload the current workflow before saving.' : 'Someone changed this Task. Compare your draft with the current version.'
      if (fault.current?.kind === 'task') this.set({ conflict: fault.current.value, detail: fault.current.value })
    }
    if (fault.kind === 'conflict' && fault.reason === 'stale-comment') { error = 'This comment changed. Your draft is kept beside the current version.'; this.set({ commentConflict: fault.currentComment }) }
    if (fault.kind === 'conflict' && fault.reason === 'stale-order') error = 'Another move changed this Column. The Board has been refreshed; choose the position again.'
    if (fault.kind === 'read-only') { error = 'This Space is read-only.'; this.set({ overview: { ...this.state.overview,
      space: { ...this.state.overview.space, lifecycle: fault.reason === 'space-archived' ? 'archived' : 'deletion_scheduled' } } }) }
    if (fault.kind === 'forbidden') { error = 'Your access changed. Reopen the Space.'; this.set({ connected: false }) }
    if (fault.kind === 'temporarily-unavailable') { error = 'Connection lost. Your draft is kept. Reconnect before saving.'; this.set({ connected: false }) }
    this.set({ error })
    if (this.live && this.feedReady && (fault.kind === 'temporarily-unavailable' || fault.kind === 'forbidden')) this.disconnectLive()
  }
}
