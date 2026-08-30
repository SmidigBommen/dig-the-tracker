// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'
import type { Repository } from './repository.js'
import { AppService } from './service.js'

describe('local actor boundary', () => {
  it('refuses a public bind unless container binding is explicit', () => {
    expect(() => loadConfig({ API_HOST: '0.0.0.0' })).toThrow('Refusing non-loopback')
  })

  it('accepts the explicit container bind used behind a loopback-only published port', () => {
    expect(loadConfig({ API_HOST: '0.0.0.0', ALLOW_CONTAINER_BIND: 'true' }).host).toBe('0.0.0.0')
  })

  it('drops browser-supplied actor and workspace identifiers from task creation', async () => {
    const createTask = vi.fn(async (input) => input)
    const repository = { createTask } as unknown as Repository
    const service = new AppService(repository)
    await service.createTask({
      title: 'Safe task', description: '', columnSlug: 'todo', priority: 'medium', tags: [],
      actorId: 'attacker', userId: 'attacker', boardId: 'other-board',
    })
    expect(createTask).toHaveBeenCalledWith({
      title: 'Safe task', description: '', columnSlug: 'todo', priority: 'medium',
      assigneeName: '', tags: [], parentId: null,
    })
  })
})
