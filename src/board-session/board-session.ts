import type {
  TagView, BoardCommand, BoardFault, BoardOverview, BoardQuery, BoardUpdate, BoardView,
  ChangeReceipt, ChangeRequest, Page, TaskDetail, TaskLocator, TaskSummary,
} from '../../api/contracts/board.ts'
import type { ColumnId, MemberId, RequestId, Result, Revision, TaskId } from '../../api/modules/shared.ts'

export interface BoardTransport {
  read(query: BoardQuery): Promise<Result<BoardView, BoardFault>>
  change(request: ChangeRequest): Promise<Result<ChangeReceipt, BoardFault>>
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

export interface BoardSessionState {
  overview: BoardOverview
  tagSuggestions: TagView[]
  detail?: TaskDetail
  draft?: TaskDraft
  conflict?: TaskDetail
  archive?: Page<TaskSummary>
  busy: boolean
  savingEdits: boolean
  pagesStale: boolean
  connected: boolean
  error?: string
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
  private pageGeneration = 0
  private editBaseline?: TaskDraft
  private editSave?: Promise<boolean>

  constructor(transport: BoardTransport, overview: BoardOverview) {
    this.transport = transport
    this.state = { overview, tagSuggestions: [], busy: false, savingEdits: false, pagesStale: false, connected: true }
  }

  getSnapshot = (): BoardSessionState => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private set(changes: Partial<BoardSessionState>) {
    this.state = { ...this.state, ...changes }
    for (const listener of this.listeners) listener()
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
    if (this.state.draft && this.state.connected && this.state.overview.space.lifecycle === 'active'
      && (!this.state.busy || this.state.savingEdits)) {
      this.set({ draft: { ...this.state.draft, ...changes }, error: this.state.conflict ? this.state.error : undefined })
    }
  }

  hasUnsavedEdits = () => {
    const draft = this.state.draft, saved = this.editBaseline
    return Boolean(draft?.taskId && (!saved || draft.title !== saved.title || draft.description !== saved.description
      || draft.assigneeId !== saved.assigneeId || JSON.stringify(draft.tags) !== JSON.stringify(saved.tags)))
  }

  async openEditor(task: TaskLocator) {
    if (!await this.saveEdits() || this.state.busy) return
    if (await this.openTask(task)) {
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
        detail: { ...task, description: submitted.description, subtasks: this.state.detail?.subtasks ?? { items: [] } } })
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
  setConnected(connected: boolean) { this.set({ connected }) }

  private canChange() { return this.state.connected && !this.state.busy && this.state.overview.space.lifecycle === 'active' }

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
    const result = await this.transport.read({ kind: 'task', task })
    if (request !== this.detailRequest || generation !== this.pageGeneration) return
    if (!result.ok) { this.fail(result.fault); return }
    if (result.value.sequence < this.state.overview.board.changeSequence) return
    if (result.value.kind === 'task') { this.set({ detail: result.value.value, error: undefined }); return true }
  }

  async saveDraft(): Promise<boolean> {
    const draft = this.state.draft
    if (!draft || !this.canChange() || this.state.conflict) return false
    const changes = { title: draft.title, description: draft.description, assigneeId: draft.assigneeId, tags: draft.tags }
    const command: BoardCommand = draft.taskId
      ? { kind: 'revise-task', task: { taskId: draft.taskId, expectedRevision: draft.expectedRevision! }, changes }
      : { kind: 'capture-task', input: { ...changes, parentTaskId: draft.parentTaskId } }
    const receipt = await this.commit(command)
    if (!receipt) return false
    this.set({ draft: undefined, conflict: undefined })
    if (receipt.result.taskId) await this.openTask({ kind: 'id', taskId: receipt.result.taskId })
    return true
  }

  useCurrentRevision() {
    if (this.state.draft && this.state.conflict) this.set({ draft: { ...this.state.draft, expectedRevision: this.state.conflict.revision }, conflict: undefined, error: undefined })
  }

  private async commit(command: BoardCommand): Promise<ChangeReceipt | undefined> {
    this.set({ busy: true, error: undefined })
    if (!this.pending || JSON.stringify(this.pending.command) !== JSON.stringify(command)) {
      this.pending = { requestId: crypto.randomUUID() as RequestId, command }
    }
    try {
      const result = await this.transport.change(this.pending)
      if (!result.ok) {
        if (result.fault.kind !== 'temporarily-unavailable') this.pending = undefined
        this.fail(result.fault)
        return
      }
      this.pending = undefined
      this.applyUpdate(result.value.update)
      if (this.state.pagesStale) await this.refresh()
      return result.value
    } catch {
      this.fail({ kind: 'temporarily-unavailable' })
      return
    } finally { this.set({ busy: false }) }
  }

  applyUpdate(update: BoardUpdate) {
    if (update.sequence <= this.state.overview.board.changeSequence) return
    this.pageGeneration++
    let overview = this.state.overview
    let pagesStale = this.state.pagesStale
    for (const change of update.changes) {
      if (change.kind === 'query-revisions-changed') {
        pagesStale = true
      } else if (change.kind === 'task-upserted') {
        const task = change.task
        overview = { ...overview, columns: overview.columns.map((column) => {
          const wasLoaded = column.tasks.items.some((item) => item.id === task.id)
          const items = column.tasks.items.filter((item) => item.id !== task.id)
          if (column.id === task.columnId && !task.archived && (wasLoaded || !column.tasks.next)) {
            const oldIndex = column.tasks.items.findIndex((item) => item.id === task.id)
            items.splice(oldIndex < 0 ? items.length : oldIndex, 0, task)
          }
          return { ...column, tasks: { ...column.tasks, items } }
        }) }
      } else if (change.kind === 'tasks-archived') {
        overview = { ...overview, columns: overview.columns.map((column) => ({ ...column,
          tasks: { ...column.tasks, items: column.tasks.items.filter((task) => !change.taskIds.includes(task.id)) } })) }
      } else if (change.kind === 'board-counts-revised' && change.counts.columns) {
        const counts = change.counts.columns
        overview = { ...overview, columns: overview.columns.map((column) => ({ ...column, counts: counts.find((item) => item.columnId === column.id)?.counts ?? column.counts })) }
      } else if (change.kind === 'membership-ended') {
        overview = { ...overview, members: overview.members.filter((member) => member.id !== change.memberId) }
      }
    }
    this.set({ pagesStale, overview: { ...overview, board: { ...overview.board, changeSequence: update.sequence } } })
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
    this.set({ overview: result.value.value, connected: true, pagesStale: false, archive: undefined,
      detail: this.state.draft?.taskId ? this.state.detail : undefined, error: undefined })
    if (this.detailLocator) await this.openTask(this.detailLocator)
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
    if (result.value.kind === 'task' && this.state.detail?.id === detail.id) this.set({ detail: { ...result.value.value,
      subtasks: { items: [...detail.subtasks.items, ...result.value.value.subtasks.items], next: result.value.value.subtasks.next } } })
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
    if (fault.kind === 'rule-violation') error = fault.rule === 'subtask-depth' ? 'Subtasks cannot have Subtasks.' : 'This change is not allowed.'
    if (fault.kind === 'cursor-expired') error = 'This page changed. Reload it to continue.'
    if (fault.kind === 'conflict') {
      error = 'Someone changed this Task. Compare your draft with the current version.'
      if (fault.current?.kind === 'task') this.set({ conflict: fault.current.value, detail: fault.current.value })
    }
    if (fault.kind === 'read-only') { error = 'This Space is read-only.'; this.set({ overview: { ...this.state.overview,
      space: { ...this.state.overview.space, lifecycle: fault.reason === 'space-archived' ? 'archived' : 'deletion_scheduled' } } }) }
    if (fault.kind === 'forbidden') { error = 'Your access changed. Reopen the Space.'; this.set({ connected: false }) }
    if (fault.kind === 'temporarily-unavailable') { error = 'Connection lost. Your draft is kept. Reconnect before saving.'; this.set({ connected: false }) }
    this.set({ error })
  }
}
