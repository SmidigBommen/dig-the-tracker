import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from './db.js'
import { createDatabase } from './db.js'
import { HttpError, isDatabaseConstraintError } from './errors.js'
import { loadConfig, type AppConfig } from './config.js'
import { Repository } from './repository.js'
import { AppService } from './service.js'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

function sendJson(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(data))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new HttpError(413, 'Request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
}

function assertOrigin(request: IncomingMessage, config: AppConfig) {
  const origin = request.headers.origin
  if (origin && !config.allowedOrigins.has(origin)) throw new HttpError(403, 'Origin not allowed')
}

async function serveStatic(pathname: string, response: ServerResponse, staticDir: string): Promise<boolean> {
  const root = resolve(staticDir)
  const candidate = resolve(root, `.${pathname}`)
  const safeCandidate = candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : root
  let filePath = safeCandidate
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = resolve(filePath, 'index.html')
    await stat(filePath)
  } catch {
    filePath = resolve(root, 'index.html')
    try {
      await stat(filePath)
    } catch {
      return false
    }
  }
  response.statusCode = 200
  response.setHeader('content-type', MIME_TYPES[extname(filePath)] ?? 'application/octet-stream')
  createReadStream(filePath).pipe(response)
  return true
}

export function createAppServer(service: AppService, db: Database, config: AppConfig) {
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'")
    const origin = request.headers.origin
    if (origin && config.allowedOrigins.has(origin)) response.setHeader('access-control-allow-origin', origin)
    response.setHeader('vary', 'Origin')

    try {
      assertOrigin(request, config)
      const url = new URL(request.url ?? '/', 'http://local.invalid')
      const pathname = url.pathname
      const method = request.method ?? 'GET'

      if (method === 'OPTIONS') {
        response.statusCode = 204
        response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
        response.setHeader('access-control-allow-headers', 'content-type')
        response.end()
        return
      }

      if (method === 'GET' && pathname === '/api/healthz') {
        await db.query('select 1')
        sendJson(response, 200, { status: 'ok' })
        return
      }
      if (method === 'GET' && pathname === '/api/bootstrap') {
        sendJson(response, 200, await service.bootstrap())
        return
      }
      if (method === 'PATCH' && pathname === '/api/profile') {
        sendJson(response, 200, await service.updateProfile(await readJson(request)))
        return
      }
      if (method === 'POST' && pathname === '/api/tasks') {
        sendJson(response, 201, await service.createTask(await readJson(request)))
        return
      }
      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/)
      if (taskMatch && method === 'PATCH') {
        sendJson(response, 200, await service.updateTask(decodeURIComponent(taskMatch[1]), await readJson(request)))
        return
      }
      if (taskMatch && method === 'DELETE') {
        sendJson(response, 200, { deletedIds: await service.deleteTask(decodeURIComponent(taskMatch[1])) })
        return
      }
      const commentsMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments$/)
      if (commentsMatch && method === 'POST') {
        sendJson(response, 201, await service.createComment(decodeURIComponent(commentsMatch[1]), await readJson(request)))
        return
      }
      const commentMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/)
      if (commentMatch && method === 'DELETE') {
        sendJson(response, 200, { deletedId: await service.deleteComment(decodeURIComponent(commentMatch[1]), decodeURIComponent(commentMatch[2])) })
        return
      }
      if (method === 'POST' && pathname === '/api/columns') {
        sendJson(response, 201, await service.createColumn(await readJson(request)))
        return
      }
      if (method === 'PUT' && pathname === '/api/columns/order') {
        sendJson(response, 200, await service.reorderColumns(await readJson(request)))
        return
      }
      const columnMatch = pathname.match(/^\/api\/columns\/([^/]+)$/)
      if (columnMatch && method === 'DELETE') {
        sendJson(response, 200, { deletedSlug: await service.deleteColumn(decodeURIComponent(columnMatch[1])) })
        return
      }
      if (!pathname.startsWith('/api/') && config.staticDir && method === 'GET' && await serveStatic(pathname, response, config.staticDir)) return
      throw new HttpError(404, 'Not found')
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message })
      } else if (isDatabaseConstraintError(error)) {
        const status = error.code === '23505' || error.code === '23503' || error.code === '23514' ? 409 : 500
        sendJson(response, status, { error: status === 409 ? 'The change conflicts with existing data' : 'Database error' })
      } else {
        console.error(error)
        sendJson(response, 500, { error: 'Internal server error' })
      }
    }
  })
}

async function main() {
  const config = loadConfig()
  const db = createDatabase(config.databaseUrl)
  const repository = new Repository(db, config.actorId, config.boardId)
  const service = new AppService(repository)
  const server = createAppServer(service, db, config)
  server.listen(config.port, config.host, () => {
    console.log(`Dig API listening on http://${config.host}:${config.port}`)
  })

  const shutdown = async () => {
    server.close()
    await db.end()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
