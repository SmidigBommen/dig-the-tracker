import { foreignReferences } from './adapters/http/task-references.js'
import { startMaintenance } from './runtime/maintenance.js'
import { InvalidBoardRequest, parseBoardChange, parseBoardQuery } from './adapters/http/board-requests.js'
import { sendBoardFeed } from './adapters/http/board-feed.js'
import { createReadStream } from 'node:fs'
import { setMaxListeners } from 'node:events'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductionOidcAdapter } from './adapters/oidc/production-oidc-adapter.js'
import { loadConfig, type AppConfig } from './config.js'
import { createDatabase } from './db.js'
import { migrate } from './migrate.js'
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
  type MemberRole,
  type SpaceCommand,
  type SpaceFault,
  type SpaceLocator,
  type SpaceModule,
} from './modules/space/space-module.js'
import type {
  LocalApplicationPath,
  InvitationId,
  MemberId,
  OpaqueCursor,
  OpaqueSecret,
  RequestId,
  Revision,
  SpaceId,
  SpaceKey,
  ChangeSequence,
} from './modules/shared.js'

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

export function createTeamServer(
  modules: ServerModules,
  config: AppConfig,
  isReady: () => Promise<boolean> = async () => false,
  shutdown?: AbortSignal,
) {
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

      if (method === 'GET' && pathname === '/health/live') {
        sendJson(response, 200, { status: 'alive' })
        return
      }
      if (method === 'GET' && pathname === '/health/ready') {
        const ready = await isReady().catch(() => false)
        response.setHeader('cache-control', 'no-store')
        sendJson(response, ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' })
        return
      }

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
        const include = url.searchParams.get('include') ?? 'active'
        if (include !== 'active' && include !== 'archived') throw new RequestError(400, 'Invalid Space list')
        const result = await modules.space.read(identity, { kind: 'switcher', include })
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
        if (result.value.result.kind !== 'space-created') {
          sendFault(response, { kind: 'temporarily-unavailable' })
          return
        }
        sendJson(response, 201, result.value.result.space)
        return
      }
      const invitationIssueMatch = pathname.match(/^\/api\/spaces\/([^/]+)\/invitations$/)
      if (method === 'POST' && invitationIssueMatch) {
        const identity = await requireIdentity(request, response, modules.identity, 'change')
        if (!identity) return
        const body = await readJson(request)
        const result = await modules.space.change(identity, {
          requestId: requestIdFrom(body),
          command: {
            kind: 'issue-invitation',
            space: { kind: 'key', spaceKey: decodeURIComponent(invitationIssueMatch[1]) as SpaceKey },
          },
        })
        if (!result.ok) {
          sendFault(response, result.fault)
          return
        }
        if (result.value.result.kind !== 'invitation-issued') {
          sendFault(response, { kind: 'temporarily-unavailable' })
          return
        }
        sendJson(response, 201, {
          invitation: result.value.result.invitation,
          invitationPath: `/invitations/${encodeURIComponent(result.value.result.invitationSecret)}`,
        })
        return
      }
      const invitationAcceptMatch = pathname.match(/^\/api\/invitations\/([^/]+)\/accept$/)
      if (method === 'POST' && invitationAcceptMatch) {
        const identity = await requireIdentity(request, response, modules.identity, 'change')
        if (!identity) return
        const body = await readJson(request)
        const result = await modules.space.change(identity, {
          requestId: requestIdFrom(body),
          command: {
            kind: 'accept-invitation',
            invitationSecret: decodeURIComponent(invitationAcceptMatch[1]) as OpaqueSecret,
          },
        })
        if (!result.ok) {
          sendFault(response, result.fault)
          return
        }
        if (result.value.result.kind !== 'invitation-accepted') {
          sendFault(response, { kind: 'temporarily-unavailable' })
          return
        }
        const browser = applySessionDirective(response, config, result.value.session)
        sendJson(response, 200, { space: result.value.result.space, ...browser })
        return
      }
      const managementMatch = pathname.match(/^\/api\/spaces\/([^/]+)\/management$/)
      if (method === 'POST' && managementMatch) {
        const identity = await requireIdentity(request, response, modules.identity, 'change')
        if (!identity) return
        const body = await readJson(request)
        const spaceKey = decodeURIComponent(managementMatch[1]) as SpaceKey
        const locator = { kind: 'key' as const, spaceKey }
        let command: SpaceCommand
        const expectedRevision = (typeof body.expectedRevision === 'number' ? body.expectedRevision : 0) as Revision
        if (body.action === 'set-member-role') {
          if (body.role !== 'member' && body.role !== 'space-administrator') {
            throw new RequestError(400, 'Invalid Member role')
          }
          command = {
            kind: 'set-member-role',
            space: locator,
            member: {
              memberId: (typeof body.memberId === 'string' ? body.memberId : '') as MemberId,
              expectedRevision,
            },
            role: body.role as MemberRole,
          }
        } else if (body.action === 'remove-member') {
          command = {
            kind: 'remove-member',
            space: locator,
            member: {
              memberId: (typeof body.memberId === 'string' ? body.memberId : '') as MemberId,
              expectedRevision,
            },
          }
        } else if (body.action === 'leave-space') {
          command = { kind: 'leave-space', space: locator }
        } else if (body.action === 'revoke-invitation') {
          command = {
            kind: 'revoke-invitation', space: locator,
            invitationId: (typeof body.invitationId === 'string' ? body.invitationId : '') as InvitationId,
          }
        } else if (body.action === 'revise-space') {
          command = {
            kind: 'revise-space',
            space: { spaceId: await resolveSpaceId(modules.space, identity, locator), expectedRevision },
            changes: {
              displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
              timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined,
            },
          }
        } else if (body.action === 'archive-space' || body.action === 'restore-space'
          || body.action === 'schedule-space-deletion' || body.action === 'cancel-space-deletion') {
          const kinds = {
            'archive-space': 'archive-space',
            'restore-space': 'restore-space',
            'schedule-space-deletion': 'schedule-space-deletion',
            'cancel-space-deletion': 'cancel-space-deletion',
          } as const
          command = {
            kind: kinds[body.action],
            space: { spaceId: await resolveSpaceId(modules.space, identity, locator), expectedRevision },
          }
        } else {
          throw new RequestError(400, 'Unknown Space management action')
        }
        const result = await modules.space.change(identity, {
          requestId: requestIdFrom(body),
          command,
        })
        if (!result.ok) {
          sendFault(response, result.fault)
          return
        }
        const browser = applySessionDirective(response, config, result.value.session)
        sendJson(response, 200, { result: result.value.result, ...browser })
        return
      }
      if (method === 'GET' && managementMatch) {
        const identity = await requireIdentity(request, response, modules.identity, 'read')
        if (!identity) return
        const space = { kind: 'key' as const, spaceKey: decodeURIComponent(managementMatch[1]) as SpaceKey }
        const membersAfter = url.searchParams.get('membersAfter') as OpaqueCursor | null
        const invitationsAfter = url.searchParams.get('invitationsAfter') as OpaqueCursor | null
        const auditAfter = url.searchParams.get('auditAfter') as OpaqueCursor | null
        const [details, members, invitations, audit] = await Promise.all([
          modules.space.read(identity, { kind: 'space', space }),
          modules.space.read(identity, { kind: 'members', space, page: { after: membersAfter ?? undefined } }),
          modules.space.read(identity, { kind: 'invitations', space, page: { after: invitationsAfter ?? undefined } }),
          modules.space.read(identity, { kind: 'audit', space, page: { after: auditAfter ?? undefined } }),
        ])
        const failed = [details, members, invitations, audit].find((entry) => !entry.ok)
        if (failed && !failed.ok) {
          sendFault(response, failed.fault)
          return
        }
        if (!details.ok || details.value.kind !== 'space'
          || !members.ok || members.value.kind !== 'members'
          || !invitations.ok || invitations.value.kind !== 'invitations'
          || !audit.ok || audit.value.kind !== 'audit') {
          sendFault(response, { kind: 'temporarily-unavailable' })
          return
        }
        sendJson(response, 200, {
          space: details.value.space,
          members: members.value.members,
          invitations: invitations.value.invitations,
          audit: audit.value.entries,
          next: {
            members: members.value.next,
            invitations: invitations.value.next,
            audit: audit.value.next,
          },
        })
        return
      }
      const boardFeed = pathname.match(/^\/api\/spaces\/([^/]+)\/board\/events$/)
      if (method === 'GET' && boardFeed) {
        const identity = await requireIdentity(request, response, modules.identity, 'read')
        if (!identity) return
        const after = url.searchParams.get('after') ?? request.headers['last-event-id']
        if (after !== undefined && (typeof after !== 'string' || !/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) {
          throw new InvalidBoardRequest('Invalid change sequence')
        }
        const authorized = await modules.space.authorize(identity, {
          space: { kind: 'key', spaceKey: decodeURIComponent(boardFeed[1]) as SpaceKey }, use: 'board-follow',
        })
        if (!authorized.ok) { sendFault(response, authorized.fault); return }
        const result = await modules.board.follow(authorized.value, { after: after === undefined ? undefined : Number(after) as ChangeSequence })
        if (!result.ok) { sendFault(response, result.fault); return }
        await sendBoardFeed(response, result.value, shutdown)
        return
      }
      const boardOperation = pathname.match(/^\/api\/spaces\/([^/]+)\/board\/(views|changes)$/)
      if (boardOperation && ((method === 'GET' && boardOperation[2] === 'views') || (method === 'POST' && boardOperation[2] === 'changes'))) {
        const changing = method === 'POST'
        const identity = await requireIdentity(request, response, modules.identity, changing ? 'change' : 'read')
        if (!identity) return
        const space = { kind: 'key' as const, spaceKey: decodeURIComponent(boardOperation[1]) as SpaceKey }
        if (changing) {
          const authorized = await modules.space.authorize(identity, { space, use: 'board-change' })
          if (!authorized.ok) { sendFault(response, authorized.fault); return }
          const result = await modules.board.change(authorized.value, parseBoardChange(await readJson(request)))
          if (!result.ok) sendFault(response, result.fault)
          else sendJson(response, 200, result.value)
        } else {
          const authorized = await modules.space.authorize(identity, { space, use: 'board-read' })
          if (!authorized.ok) { sendFault(response, authorized.fault); return }
          let query: unknown
          try { query = JSON.parse(url.searchParams.get('query') ?? '{}') }
          catch { throw new InvalidBoardRequest('Invalid Board query') }
          const parsed = parseBoardQuery(query)
          const result = await modules.board.read(authorized.value, parsed)
          if (result.ok && result.value.kind === 'references' && parsed.kind === 'references') {
            result.value.value.push(...await foreignReferences(modules,identity,space.spaceKey,parsed.keys))
          }
          if (!result.ok) sendFault(response, result.fault)
          else sendJson(response, 200, result.value)
        }
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
      if (error instanceof InvalidBoardRequest) {
        sendJson(response, 400, { error: error.message })
      } else if (error instanceof RequestError) {
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

async function resolveSpaceId(
  spaceModule: SpaceModule,
  identity: AuthenticatedIdentity,
  locator: SpaceLocator,
): Promise<SpaceId> {
  const result = await spaceModule.read(identity, { kind: 'space', space: locator })
  if (!result.ok) {
    const fault = mapFault(result.fault)
    throw new RequestError(fault.status, fault.message)
  }
  if (result.value.kind !== 'space') throw new RequestError(500, 'Internal server error')
  return result.value.space.id
}

function evidence(request: IncomingMessage): SessionEvidence {
  return {
    sessionSecret: cookies(request)[SESSION_COOKIE] as OpaqueSecret | undefined,
    csrfToken: header(request, 'x-csrf-token') as OpaqueSecret | undefined,
    origin: request.headers.origin,
  }
}

function requestIdFrom(body: Record<string, unknown>): RequestId {
  return (typeof body.requestId === 'string' ? body.requestId : '') as RequestId
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

function applySessionDirective(
  response: ServerResponse,
  config: AppConfig,
  directive: import('./modules/shared.js').BrowserSessionDirective,
): { csrfToken?: OpaqueSecret; absoluteExpiresAt?: import('./modules/shared.js').Instant; signedOut?: true } {
  if (directive.kind === 'clear') {
    clearSessionCookie(response, config)
    return { signedOut: true }
  }
  if (directive.kind === 'unchanged') return {}
  response.setHeader('set-cookie', cookie(SESSION_COOKIE, directive.sessionSecret, config, 30 * 24 * 60 * 60))
  return { csrfToken: directive.csrfToken, absoluteExpiresAt: directive.absoluteExpiresAt }
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
    case 'invalid-invitation': return { status: 400, message: 'This invitation is invalid or no longer available' }
    case 'last-administrator': return { status: 409, message: 'Promote another Member before changing the last administrator' }
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
  await migrate(config.databaseUrl)
  const db = createDatabase(config.databaseUrl)
  db.on('error', () => console.error(JSON.stringify({ event: 'database-connection-error' })))
  const oidc = new ProductionOidcAdapter(config.oidc)
  const identity = new IdentityModuleImplementation(db, oidc, {
    redirectUri: config.oidc.redirectUri,
    allowedOrigins: config.allowedOrigins,
    installationAdministrators: config.installationAdministrators,
    sessionHmacSecret: config.sessionHmacSecret,
  })
  const space = new SpaceModuleImplementation(db, {
    invitationHmacSecret: config.sessionHmacSecret,
    sessionHmacSecret: config.sessionHmacSecret,
  })
  const board = new BoardModuleImplementation(db)
  const stopMaintenance = startMaintenance(db, config.installationAdministrators, (result) => {
    if (!result) console.error(JSON.stringify({ event: 'maintenance-failed' }))
    else if (result.archivedTasks || result.deletedSpaces) console.log(JSON.stringify({ event: 'maintenance-completed', ...result }))
  })
  const feedShutdown = new AbortController()
  setMaxListeners(0, feedShutdown.signal)
  let draining = false
  const server = createTeamServer({ identity, space, board }, config, async () => {
    if (draining) return false
    // pg supports a per-query timeout, which its QueryConfig type omits.
    const probe = { text: 'select 1', query_timeout: 2_000 }
    await db.query(probe)
    return !draining
  }, feedShutdown.signal)
  server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ event: 'server-listening', host: config.host, port: config.port }))
  })

  const shutdown = () => {
    if (draining) return
    draining = true
    feedShutdown.abort()
    const maintenanceStopped = stopMaintenance()
    const deadline = setTimeout(() => process.exit(1), 30_000)
    deadline.unref()
    server.close(async () => {
      try {
        await maintenanceStopped
        await db.end()
      } finally {
        clearTimeout(deadline)
      }
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
