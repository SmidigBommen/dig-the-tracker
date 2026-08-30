import { HttpError } from './errors.js'
import type { CreateTaskInput, Repository, UpdateTaskInput } from './repository.js'

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const COLOR = /^#[0-9a-fA-F]{6}$/

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'JSON object required')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`)
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) throw new HttpError(400, `${field} must be ${min}-${max} characters`)
  return trimmed
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, `${field} must be at most ${max} characters`)
  return value.trim()
}

function tags(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) throw new HttpError(400, 'tags must be an array of text')
  return value.map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
}

export class AppService {
  constructor(private readonly repository: Repository) {}

  bootstrap() { return this.repository.bootstrap() }

  updateProfile(value: unknown) {
    const body = object(value)
    const displayName = text(body.displayName, 'displayName', 1, 50)
    if (typeof body.avatarColor !== 'string' || !COLOR.test(body.avatarColor)) throw new HttpError(400, 'avatarColor must be a hex color')
    return this.repository.updateActor(displayName, body.avatarColor)
  }

  createTask(value: unknown) {
    const body = object(value)
    const priority = body.priority ?? 'medium'
    if (typeof priority !== 'string' || !PRIORITIES.has(priority)) throw new HttpError(400, 'Invalid priority')
    const input: CreateTaskInput = {
      title: text(body.title, 'title', 3, 100),
      description: optionalText(body.description, 'description', 1000),
      columnSlug: text(body.columnSlug ?? 'backlog', 'columnSlug', 1, 50),
      priority,
      assigneeName: optionalText(body.assigneeName, 'assigneeName', 50),
      tags: tags(body.tags),
      parentId: body.parentId === undefined || body.parentId === null ? null : text(body.parentId, 'parentId', 1, 100),
    }
    return this.repository.createTask(input)
  }

  updateTask(taskId: string, value: unknown) {
    const body = object(value)
    const input: UpdateTaskInput = {}
    if (body.title !== undefined) input.title = text(body.title, 'title', 3, 100)
    if (body.description !== undefined) input.description = optionalText(body.description, 'description', 1000)
    if (body.priority !== undefined) {
      if (typeof body.priority !== 'string' || !PRIORITIES.has(body.priority)) throw new HttpError(400, 'Invalid priority')
      input.priority = body.priority
    }
    if (body.assigneeName !== undefined) input.assigneeName = optionalText(body.assigneeName, 'assigneeName', 50)
    if (body.tags !== undefined) input.tags = tags(body.tags)
    if (body.columnSlug !== undefined) input.columnSlug = text(body.columnSlug, 'columnSlug', 1, 50)
    if (body.targetIndex !== undefined) {
      if (!Number.isInteger(body.targetIndex) || Number(body.targetIndex) < 0) throw new HttpError(400, 'targetIndex must be a non-negative integer')
      input.targetIndex = Number(body.targetIndex)
    }
    return this.repository.updateTask(taskId, input)
  }

  deleteTask(taskId: string) { return this.repository.deleteTask(taskId) }

  createComment(taskId: string, value: unknown) {
    const body = object(value)
    return this.repository.createComment(taskId, text(body.text, 'text', 1, 500))
  }

  deleteComment(taskId: string, commentId: string) { return this.repository.deleteComment(taskId, commentId) }

  createColumn(value: unknown) {
    const body = object(value)
    const title = text(body.title, 'title', 1, 30)
    if (typeof body.color !== 'string' || !COLOR.test(body.color)) throw new HttpError(400, 'color must be a hex color')
    const icon = optionalText(body.icon, 'icon', 8)
    const after = body.afterColumnSlug === undefined ? undefined : text(body.afterColumnSlug, 'afterColumnSlug', 1, 50)
    const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-')
    if (!slug) throw new HttpError(400, 'Title must produce a valid column slug')
    return this.repository.createColumn(title, slug, body.color, icon, after)
  }

  deleteColumn(slug: string) { return this.repository.deleteColumn(slug) }

  reorderColumns(value: unknown) {
    const body = object(value)
    if (!Array.isArray(body.slugs) || body.slugs.some((slug) => typeof slug !== 'string')) throw new HttpError(400, 'slugs must be an array of text')
    return this.repository.reorderColumns(body.slugs as string[])
  }
}
