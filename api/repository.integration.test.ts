// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from './db.js'
import { Repository } from './repository.js'

const run = process.env.DIG_DATABASE_TESTS === '1' ? describe : describe.skip
const actorId = '00000000-0000-4000-8000-000000000001'
const boardId = '00000000-0000-4000-8000-000000000010'
let db: Database
let repository: Repository
const createdIds: string[] = []

run('real PostgreSQL invariants', () => {
  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL ?? 'postgres://dig:dig-local-only@127.0.0.1:5432/dig')
    repository = new Repository(db, actorId, boardId)
  })

  afterAll(async () => {
    await Promise.all(createdIds.map((id) => repository.deleteTask(id).catch(() => [])))
    await db.end()
  })

  it('serializes concurrent issue numbering and column positions', async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) => repository.createTask({
      title: `Concurrency task ${index}`, description: '', columnSlug: 'backlog', priority: 'medium',
      assigneeName: '', tags: ['integration'], parentId: null,
    })))
    createdIds.push(...created.map((task) => task.id))
    const numbers = created.map((task) => task.number).sort((a, b) => a - b)
    expect(new Set(numbers).size).toBe(8)
    expect(numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1)).toBe(true)
    expect(new Set(created.map((task) => task.position)).size).toBe(8)
  })
})
