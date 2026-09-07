// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { loadConfig } from './config.js'
import { createTeamServer, type ServerModules } from './server.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

async function start(isReady?: () => Promise<boolean>) {
  const unexpected = vi.fn(() => { throw new Error('Health must not resolve a browser session or read Space data') })
  const modules: ServerModules = {
    identity: { signIn: unexpected, session: unexpected },
    space: { read: unexpected, change: unexpected, authorize: unexpected },
    board: { read: unexpected, change: unexpected, follow: unexpected },
  }
  const server = createTeamServer(modules, loadConfig({}), isReady)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, unexpected }
}

describe('container health over HTTP', () => {
  it('reports liveness without database or sign-in access and defaults readiness to unavailable', async () => {
    const { url, unexpected } = await start()
    const live = await fetch(`${url}/health/live`)
    expect(live.status).toBe(200)
    expect(await live.json()).toEqual({ status: 'alive' })
    expect((await fetch(`${url}/health/ready`)).status).toBe(503)
    expect(unexpected).not.toHaveBeenCalled()
  })

  it('rechecks readiness on each probe and conceals database errors', async () => {
    const ready = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('postgres://secret-credentials/internal-database'))
      .mockResolvedValueOnce(false)
    const { url, unexpected } = await start(ready)
    const healthy = await fetch(`${url}/health/ready`)
    expect(healthy.status).toBe(200)
    expect(healthy.headers.get('cache-control')).toBe('no-store')
    expect(await healthy.json()).toEqual({ status: 'ready' })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const unavailable = await fetch(`${url}/health/ready`)
      expect(unavailable.status).toBe(503)
      expect(await unavailable.json()).toEqual({ status: 'unavailable' })
    }
    expect((await fetch(`${url}/health/live`)).status).toBe(200)
    expect(ready).toHaveBeenCalledTimes(3)
    expect(unexpected).not.toHaveBeenCalled()
  })
})
