import type { Database, DbClient } from './db.js'
import { inTransaction } from './db.js'
import { HttpError } from './errors.js'

const POSITION_STEP = 1000

interface TaskRow {
  id: string
  board_id: string
  number: number
  title: string
  description: string
  column_slug: string
  priority: string
  position: number
  assignee_name: string
  created_by_name: string
  created_by_id: string
  tags: string[]
  parent_id: string | null
  due_date: Date | null
  completed_at: Date | null
  created_at: Date
  updated_at: Date
}

interface ColumnRow {
  id: string
  board_id: string
  slug: string
  title: string
  color: string
  icon: string
  position: number
  is_protected: boolean
}

export interface CreateTaskInput {
  title: string
  description: string
  columnSlug: string
  priority: string
  assigneeName: string
  tags: string[]
  parentId: string | null
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  priority?: string
  assigneeName?: string
  tags?: string[]
  columnSlug?: string
  targetIndex?: number
}

function mapTask(row: TaskRow, subtaskIds: string[] = []) {
  return {
    ...row,
    subtask_ids: subtaskIds,
  }
}

function positionAt(rows: Array<{ position: number }>, targetIndex: number): number | null {
  if (rows.length === 0) return POSITION_STEP
  if (targetIndex <= 0) return rows[0].position - POSITION_STEP
  if (targetIndex >= rows.length) return rows[rows.length - 1].position + POSITION_STEP
  const before = rows[targetIndex - 1].position
  const after = rows[targetIndex].position
  return after - before > 1 ? Math.floor((before + after) / 2) : null
}

export class Repository {
  constructor(
    private readonly db: Database,
    private readonly actorId: string,
    private readonly boardId: string,
  ) {}

  async bootstrap() {
    const [actor, board, columns, tasks, comments] = await Promise.all([
      this.db.query('select id, display_name, avatar_color from actors where id = $1', [this.actorId]),
      this.db.query('select id, name from boards where id = $1', [this.boardId]),
      this.db.query<ColumnRow>('select id, board_id, slug, title, color, icon, position, is_protected from columns where board_id = $1 order by position', [this.boardId]),
      this.db.query<TaskRow>('select * from tasks where board_id = $1 order by position', [this.boardId]),
      this.db.query('select id, task_id, board_id, author_id, author_name, text, created_at from task_comments where board_id = $1 order by created_at', [this.boardId]),
    ])
    if (!actor.rows[0] || !board.rows[0]) throw new HttpError(500, 'Local workspace seed is missing')

    const children = new Map<string, string[]>()
    for (const task of tasks.rows) {
      if (!task.parent_id) continue
      children.set(task.parent_id, [...(children.get(task.parent_id) ?? []), task.id])
    }
    return {
      actor: actor.rows[0],
      board: board.rows[0],
      columns: columns.rows,
      tasks: tasks.rows.map((task) => mapTask(task, children.get(task.id) ?? [])),
      comments: comments.rows,
    }
  }

  async updateActor(displayName: string, avatarColor: string) {
    const result = await this.db.query(
      'update actors set display_name = $1, avatar_color = $2 where id = $3 returning id, display_name, avatar_color',
      [displayName, avatarColor, this.actorId],
    )
    if (!result.rows[0]) throw new HttpError(404, 'Local actor not found')
    return result.rows[0]
  }

  async createTask(input: CreateTaskInput) {
    return inTransaction(this.db, async (client) => {
      const actor = await this.actor(client)
      await this.requireColumn(client, input.columnSlug)
      if (input.parentId) await this.requireTask(client, input.parentId)

      const boardResult = await client.query<{ next_task_number: number }>(
        'select next_task_number from boards where id = $1 for update',
        [this.boardId],
      )
      const number = boardResult.rows[0]?.next_task_number
      if (!number) throw new HttpError(500, 'Local workspace not found')
      await client.query('update boards set next_task_number = next_task_number + 1 where id = $1', [this.boardId])

      const positionResult = await client.query<{ position: number }>(
        'select position from tasks where board_id = $1 and column_slug = $2 order by position desc limit 1 for update',
        [this.boardId, input.columnSlug],
      )
      const position = (positionResult.rows[0]?.position ?? 0) + POSITION_STEP
      const result = await client.query<TaskRow>(
        `insert into tasks (
          board_id, number, title, description, column_slug, priority, position,
          assignee_name, created_by_name, created_by_id, tags, parent_id
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [this.boardId, number, input.title, input.description, input.columnSlug, input.priority,
          position, input.assigneeName, actor.display_name, this.actorId, input.tags, input.parentId],
      )
      return mapTask(result.rows[0])
    })
  }

  async updateTask(taskId: string, input: UpdateTaskInput) {
    return inTransaction(this.db, async (client) => {
      const current = await this.requireTask(client, taskId)
      const values: unknown[] = []
      const assignments: string[] = []
      const add = (column: string, value: unknown) => {
        values.push(value)
        assignments.push(`${column} = $${values.length}`)
      }
      if (input.title !== undefined) add('title', input.title)
      if (input.description !== undefined) add('description', input.description)
      if (input.priority !== undefined) add('priority', input.priority)
      if (input.assigneeName !== undefined) add('assignee_name', input.assigneeName)
      if (input.tags !== undefined) add('tags', input.tags)

      if (input.columnSlug !== undefined || input.targetIndex !== undefined) {
        const targetColumn = input.columnSlug ?? current.column_slug
        await this.requireColumn(client, targetColumn)
        const rowsResult = await client.query<{ id: string; position: number }>(
          'select id, position from tasks where board_id = $1 and column_slug = $2 and id <> $3 order by position for update',
          [this.boardId, targetColumn, taskId],
        )
        const rows = rowsResult.rows
        const targetIndex = Math.max(0, Math.min(input.targetIndex ?? rows.length, rows.length))
        let position = positionAt(rows, targetIndex)
        if (position === null) {
          for (let index = 0; index < rows.length; index += 1) {
            rows[index].position = (index + 1) * POSITION_STEP
            await client.query('update tasks set position = $1 where id = $2', [rows[index].position, rows[index].id])
          }
          position = positionAt(rows, targetIndex)
        }
        add('column_slug', targetColumn)
        add('position', position)
        add('completed_at', targetColumn === 'done' ? (current.completed_at ?? new Date()) : null)
      }

      if (assignments.length === 0) return mapTask(current)
      values.push(taskId, this.boardId)
      const result = await client.query<TaskRow>(
        `update tasks set ${assignments.join(', ')} where id = $${values.length - 1} and board_id = $${values.length} returning *`,
        values,
      )
      if (!result.rows[0]) throw new HttpError(404, 'Task not found')
      const childResult = await client.query<{ id: string }>('select id from tasks where parent_id = $1 order by position', [taskId])
      return mapTask(result.rows[0], childResult.rows.map((row) => row.id))
    })
  }

  async deleteTask(taskId: string) {
    return inTransaction(this.db, async (client) => {
      await this.requireTask(client, taskId)
      const descendants = await client.query<{ id: string }>(
        `with recursive tree as (
          select id from tasks where id = $1 and board_id = $2
          union all select task.id from tasks task join tree on task.parent_id = tree.id
        ) select id from tree`,
        [taskId, this.boardId],
      )
      await client.query('delete from tasks where id = $1 and board_id = $2', [taskId, this.boardId])
      return descendants.rows.map((row) => row.id)
    })
  }

  async createComment(taskId: string, text: string) {
    const actor = await this.actor(this.db)
    const task = await this.db.query('select id from tasks where id = $1 and board_id = $2', [taskId, this.boardId])
    if (!task.rows[0]) throw new HttpError(404, 'Task not found')
    const result = await this.db.query(
      `insert into task_comments (task_id, board_id, author_id, author_name, text)
       values ($1,$2,$3,$4,$5) returning id, task_id, board_id, author_id, author_name, text, created_at`,
      [taskId, this.boardId, this.actorId, actor.display_name, text],
    )
    return result.rows[0]
  }

  async deleteComment(taskId: string, commentId: string) {
    const result = await this.db.query(
      'delete from task_comments where id = $1 and task_id = $2 and board_id = $3 returning id',
      [commentId, taskId, this.boardId],
    )
    if (!result.rows[0]) throw new HttpError(404, 'Comment not found')
    return commentId
  }

  async createColumn(title: string, slug: string, color: string, icon: string, afterColumnSlug?: string) {
    return inTransaction(this.db, async (client) => {
      const rowsResult = await client.query<ColumnRow>(
        'select id, board_id, slug, title, color, icon, position, is_protected from columns where board_id = $1 order by position for update',
        [this.boardId],
      )
      const rows = rowsResult.rows
      const afterIndex = afterColumnSlug ? rows.findIndex((column) => column.slug === afterColumnSlug) : rows.findIndex((column) => column.slug === 'done') - 1
      const targetIndex = Math.max(0, Math.min(afterIndex + 1, rows.length))
      let position = positionAt(rows, targetIndex)
      if (position === null) {
        for (let index = 0; index < rows.length; index += 1) {
          rows[index].position = index * POSITION_STEP
          await client.query('update columns set position = $1 where id = $2', [rows[index].position, rows[index].id])
        }
        position = positionAt(rows, targetIndex)
      }
      const result = await client.query<ColumnRow>(
        `insert into columns (board_id, slug, title, color, icon, position, is_protected)
         values ($1,$2,$3,$4,$5,$6,false)
         returning id, board_id, slug, title, color, icon, position, is_protected`,
        [this.boardId, slug, title, color, icon, position],
      )
      return result.rows[0]
    })
  }

  async deleteColumn(slug: string) {
    const result = await this.db.query(
      `delete from columns where board_id = $1 and slug = $2 and is_protected = false
       and not exists (select 1 from tasks where board_id = $1 and column_slug = $2) returning slug`,
      [this.boardId, slug],
    )
    if (!result.rows[0]) throw new HttpError(409, 'Column is protected, missing, or contains tasks')
    return slug
  }

  async reorderColumns(slugs: string[]) {
    return inTransaction(this.db, async (client) => {
      const current = await client.query<ColumnRow>(
        'select id, board_id, slug, title, color, icon, position, is_protected from columns where board_id = $1 order by position for update',
        [this.boardId],
      )
      if (slugs.length !== current.rows.length || new Set(slugs).size !== slugs.length || current.rows.some((column) => !slugs.includes(column.slug))) {
        throw new HttpError(400, 'Column order must contain every column exactly once')
      }
      for (let index = 0; index < slugs.length; index += 1) {
        await client.query('update columns set position = $1 where board_id = $2 and slug = $3', [index * POSITION_STEP, this.boardId, slugs[index]])
      }
      const bySlug = new Map(current.rows.map((column) => [column.slug, column]))
      return slugs.map((slug, index) => ({ ...bySlug.get(slug)!, position: index * POSITION_STEP }))
    })
  }

  private async actor(client: Pick<DbClient, 'query'> | Database) {
    const result = await client.query<{ id: string; display_name: string; avatar_color: string }>(
      'select id, display_name, avatar_color from actors where id = $1',
      [this.actorId],
    )
    if (!result.rows[0]) throw new HttpError(500, 'Local actor not found')
    return result.rows[0]
  }

  private async requireColumn(client: DbClient, slug: string) {
    const result = await client.query('select slug from columns where board_id = $1 and slug = $2', [this.boardId, slug])
    if (!result.rows[0]) throw new HttpError(400, 'Unknown column')
  }

  private async requireTask(client: DbClient, taskId: string) {
    const result = await client.query<TaskRow>('select * from tasks where id = $1 and board_id = $2 for update', [taskId, this.boardId])
    if (!result.rows[0]) throw new HttpError(404, 'Task not found')
    return result.rows[0]
  }
}
