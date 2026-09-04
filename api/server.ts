import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductionOidcAdapter } from './adapters/oidc/production-oidc-adapter.js'
import { loadConfig, type AppConfig } from './config.js'
import { createDatabase } from './db.js'
import { BoardModuleImplementation, type BoardFault, type BoardModule } from './modules/board/board-module.js'
import {
  IdentityModuleImplementation,
  type AuthenticatedIdentity,
  type IdentityFault,
  type IdentityModule,
  type SessionEvidence,
} from './modules/identity/identity-module.js'
import {
  SpaceModuleImplementation,
  type SpaceFault,
  type SpaceModule,
} from './modules/space/space-module.js'
import type { LocalApplicationPath, OpaqueSecret, RequestId, SpaceKey } from './modules/shared.js'

const SESSION_COOKIE = 'dig_session'
const ATTEMPT_COOKIE = 'dig_oidc_attempt'

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

export interface ServerModules {
  identity: IdentityModule
  space: SpaceModule
  board: BoardModule
}

function sendJson(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(data))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new RequestError(413, 'Request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required')
    return value as Record<string, unknown>
  } catch {
    throw new RequestError(400, 'Invalid JSON object')
  }
}

function assertOrigin(request: IncomingMessage, config: AppConfig) {
  const origin = request.headers.origin
  if (origin && !config.allowedOrigins.has(origin)) throw new RequestError(403, 'Origin not allowed')
}

function assertMutationOrigin(request: IncomingMessage, config: AppConfig) {
  const origin = request.headers.origin
  if (!origin || !config.allowedOrigins.has(origin)) throw new RequestError(403, 'Origin not allowed')
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

export function createTeamServer(modules: ServerModules, config: AppConfig) {
  return createServer(async (request, response) => {
    setSecurityHeaders(response)
    const origin = request.headers.origin
    if (origin && config.allowedOrigins.has(origin)) {
      response.setHeader('access-control-allow-origin', origin)
      response.setHeader('access-control-allow-credentials', 'true')
    }
    response.setHeader('vary', 'Origin')

    try {
      assertOrigin(request, config)
      const url = new URL(request.url ?? '/', 'http://local.invalid')
      const pathname = url.pathname
      const method = request.method ?? 'GET'

      if (method === 'OPTIONS') {
        response.statusCode = 204
        response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
        response.setHeader('access-control-allow-headers', 'content-type,x-csrf-token')
        response.end()
        return
      }

      if (method === 'GET' && pathname === '/api/session') {
        const resolved = await modules.identity.session({ kind: 'resolve', use: 'read', evidence: evidence(request) })
        if (!resolved.ok || resolved.value.kind !== 'resolved') {
          clearSessionCookie(response, config)
          sendFault(response, resolved.ok ? { kind: 'not-authenticated' } : resolved.fault)
          return
        }
        sendJson(response, 200, {
          authenticated: true,
          identity: resolved.value.identityView,
          csrfToken: resolved.value.csrfToken,
          absoluteExpiresAt: resolved.value.absoluteExpiresAt,
        })
        return
      }
      if (method === 'POST' && pathname === '/api/auth/sign-in') {
        assertMutationOrigin(request, config)
        const body = await readJson(request)
        const result = await modules.identity.signIn({
          kind: 'begin',
          returnTo: (typeof body.returnTo === 'string' ? body.returnTo : '/') as LocalApplicationPath,
        })
        if (!result.ok || result.value.kind !== 'redirect') {
          sendFault(response, result.ok ? { kind: 'temporarily-unavailable' } : result.fault)
          return
        }
        response.setHeader('set-cookie', cookie(ATTEMPT_COOKIE, result.value.attemptSecret, config, 600))
        sendJson(response, 200, { authorizationUrl: result.value.authorizationUrl })
        return
      }
      if (method === 'GET' && pathname === '/api/auth/callback') {
        const result = await modules.identity.signIn({
          kind: 'complete',
          attemptSecret: (cookies(request)[ATTEMPT_COOKIE] ?? '') as OpaqueSecret,
          callback: {
            code: url.searchParams.get('code') ?? undefined,
            state: url.searchParams.get('state') ?? undefined,
            error: url.searchParams.get('error') ?? undefined,
          },
        })
        if (!result.ok || result.value.kind !== 'established') {
          response.setHeader('set-cookie', clearCookie(ATTEMPT_COOKIE, config))
          sendFault(response, result.ok ? { kind: 'temporarily-unavailable' } : result.fault)
          return
        }
        response.statusCode = 303
        response.setHeader('location', result.value.returnTo)
        response.setHeader('set-cookie', [
          cookie(SESSION_COOKIE, result.value.session.sessionSecret, config, 30 * 24 * 60 * 60),
          clearCookie(ATTEMPT_COOKIE, config),
        ])
        response.end()
        return
      }
      if (method === 'POST' && pathname === '/api/auth/sign-out') {
        const ended = await modules.identity.session({
          kind: 'end',
          requestId: (request.headers['x-request-id']?.toString() ?? 'sign-out') as RequestId,
          evidence: evidence(request),
        })
        if (!ended.ok) {
          sendFault(response, ended.fault)
          return
        }
        clearSessionCookie(response, config)
        response.statusCode = 204
        response.end()
        return
      }
      if (method === 'GET' && pathname === '/api/spaces') {
        const identity = await requireIdentity(request, response, modules.identity, 'read')
        if (!identity) return
        const result = await modules.space.read(identity, { kind: 'switcher', include: 'active' })
        if (!result.ok || result.value.kind !== 'switcher') {
          sendFault(response, result.ok ? { kind: 'temporarily-unavailable' } : result.fault)
          return
        }
        sendJson(response, 200, { spaces: result.value.spaces, next: result.value.next })
        return
      }
      if (method === 'POST' && pathname === '/api/spaces') {
        const identity = await requireIdentity(request, response, modules.identity, 'change')
        if (!identity) return
        const body = await readJson(request)
        const result = await modules.space.change(identity, {
          requestId: (typeof body.requestId === 'string' ? body.requestId : '') as RequestId,
          command: {
            kind: 'create-space',
            input: {
              displayName: typeof body.displayName === 'string' ? body.displayName : '',
              key: typeof body.key === 'string' ? body.key : '',
              timeZone: typeof body.timeZone === 'string' ? body.timeZone : '',
            },
          },
        })
        if (!result.ok) {
          sendFault(response, result.fault)
          return
        }
        sendJson(response, 201, result.value.result.space)
        return
      }
      const boardMatch = pathname.match(/^\/api\/spaces\/([^/]+)\/board$/)
      if (method === 'GET' && boardMatch) {
        const identity = await requireIdentity(request, response, modules.identity, 'read')
        if (!identity) return
        const authorized = await modules.space.authorize(identity, {
          space: { kind: 'key', spaceKey: decodeURIComponent(boardMatch[1]) as SpaceKey },
          use: 'board-read',
        })
        if (!authorized.ok) {
          sendFault(response, authorized.fault)
          return
        }
        const result = await modules.board.read(authorized.value, { kind: 'overview' })
        if (!result.ok || result.value.kind !== 'overview') {
          sendFault(response, result.ok ? { kind: 'temporarily-unavailable' } : result.fault)
          return
        }
        sendJson(response, 200, result.value.value)
        return
      }
      if (!pathname.startsWith('/api/') && config.staticDir && method === 'GET'
        && await serveStatic(pathname, response, config.staticDir)) return
      throw new RequestError(404, 'Not found')
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.status, { error: error.message })
      } else {
        console.error(error)
        sendJson(response, 500, { error: 'Internal server error' })
      }
    }
  })
}

async function requireIdentity(
  request: IncomingMessage,
  response: ServerResponse,
  identityModule: IdentityModule,
  use: 'read' | 'change',
): Promise<AuthenticatedIdentity | null> {
  const result = await identityModule.session({ kind: 'resolve', use, evidence: evidence(request) })
  if (!result.ok || result.value.kind !== 'resolved') {
    sendFault(response, result.ok ? { kind: 'not-authenticated' } : result.fault)
    return null
  }
  return result.value.identity
}

function evidence(request: IncomingMessage): SessionEvidence {
  return {
    sessionSecret: cookies(request)[SESSION_COOKIE] as OpaqueSecret | undefined,
    csrfToken: header(request, 'x-csrf-token') as OpaqueSecret | undefined,
    origin: request.headers.origin,
  }
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function cookies(request: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!name) continue
    try {
      result[name] = decodeURIComponent(value)
    } catch {
      continue
    }
  }
  return result
}

function cookie(name: string, value: string, config: AppConfig, maxAge: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    config.secureCookies ? 'Secure' : '',
  ].filter(Boolean).join('; ')
}

function clearCookie(name: string, config: AppConfig): string {
  return cookie(name, '', config, 0)
}

function clearSessionCookie(response: ServerResponse, config: AppConfig) {
  response.setHeader('set-cookie', clearCookie(SESSION_COOKIE, config))
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  )
}

type HttpFault = IdentityFault | SpaceFault | BoardFault

function sendFault(response: ServerResponse, fault: HttpFault) {
  const mapped = mapFault(fault)
  sendJson(response, mapped.status, { error: mapped.message, fault })
}

function mapFault(fault: HttpFault): { status: number; message: string } {
  switch (fault.kind) {
    case 'not-authenticated': return { status: 401, message: 'Sign in required' }
    case 'csrf': return { status: 403, message: 'Request verification failed' }
    case 'forbidden': return { status: 403, message: 'Not allowed' }
    case 'not-found': return { status: 404, message: 'Not found' }
    case 'read-only': return { status: 409, message: 'This Space is read-only' }
    case 'conflict': return {
      status: 409,
      message: 'reason' in fault && fault.reason === 'space-key-unavailable'
        ? 'That Space key is unavailable'
        : 'The request conflicts with an earlier change',
    }
    case 'invalid': return { status: 400, message: 'Check the submitted values' }
    case 'sign-in-failed': return {
      status: 400,
      message: fault.reason === 'provider-unavailable' ? 'Sign-in provider unavailable' : 'Sign-in failed',
    }
    case 'rule-violation': return { status: 409, message: 'The change violates a Board rule' }
    case 'cursor-expired': return { status: 409, message: 'Reload this view and try again' }
    case 'rate-limited': return { status: 429, message: 'Too many requests' }
    case 'temporarily-unavailable': return { status: 503, message: 'Temporarily unavailable' }
  }
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function main() {
  const config = loadConfig()
  if (!config.oidc) throw new Error('OpenID Connect is not configured')
  const db = createDatabase(config.databaseUrl)
  const oidc = new ProductionOidcAdapter(config.oidc)
  const identity = new IdentityModuleImplementation(db, oidc, {
    redirectUri: config.oidc.redirectUri,
    allowedOrigins: config.allowedOrigins,
    installationAdministrators: config.installationAdministrators,
    sessionHmacSecret: config.sessionHmacSecret,
  })
  const space = new SpaceModuleImplementation(db)
  const board = new BoardModuleImplementation(db)
  const server = createTeamServer({ identity, space, board }, config)
  server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ event: 'server-listening', host: config.host, port: config.port }))
  })

  const shutdown = () => {
    server.close(async () => {
      await db.end()
    })
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
