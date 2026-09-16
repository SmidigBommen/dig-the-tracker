import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function observeRequest(request: IncomingMessage, response: ServerResponse) {
  const requestId = randomUUID(), started = performance.now()
  response.setHeader('x-request-id',requestId)
  response.once('close',() => {
    const path = (request.url ?? '').split('?')[0]
    const route = path.startsWith('/health/') ? 'health' : path.startsWith('/api/auth/') ? 'authentication'
      : path === '/api/session' ? 'session' : path === '/api/appearance' ? 'appearance'
      : /^\/api\/spaces\/[A-Z0-9]+\/export$/.test(path) ? 'space-export' : path.startsWith('/api/spaces') ? 'space' : path.startsWith('/api/') ? 'api' : 'static'
    console.info(JSON.stringify({ event: 'http-request',requestId,route,method: ['GET','POST','HEAD','OPTIONS'].includes(request.method ?? '') ? request.method : 'other',
      status: response.statusCode,completed: response.writableFinished,durationMs: Math.round(performance.now()-started) }))
  })
}

// One replica. Bounded buckets cover sign-in abuse and mutation bursts. Never
// trust client-supplied forwarding headers or retain raw cookies as keys.
export class RequestLimits {
  private buckets = new Map<string,{ count: number; until: number }>()
  retryAfter(request: IncomingMessage, pathname: string): number {
    if (request.method !== 'POST') return 0
    const authentication = pathname.startsWith('/api/auth/')
    const windowMs = authentication ? 300_000 : 60_000
    const limit = authentication ? 120 : 300
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)dig_session=([^;]*)/)?.[1]
    const source = authentication || !cookie ? request.socket.remoteAddress ?? 'unknown' : cookie
    const key = createHash('sha256').update(`${authentication}:${source}`).digest('hex')
    const now = Date.now()
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.until <= now) {
      for (const [id,entry] of this.buckets) if (entry.until <= now) this.buckets.delete(id)
      if (this.buckets.size >= 10_000) return 60
      bucket = { count: 0,until: now+windowMs };this.buckets.set(key,bucket)
    }
    bucket.count++
    return bucket.count > limit ? Math.ceil((bucket.until-now)/1000) : 0
  }
}
