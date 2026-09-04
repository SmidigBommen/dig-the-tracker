import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from '../../db.js'
import { inTransaction } from '../../db.js'
import type { OidcPort } from '../../adapters/oidc/oidc-port.js'
import { OidcRejectedError, OidcUnavailableError } from '../../adapters/oidc/oidc-port.js'
import { inspectAuthenticatedIdentity, makeAuthenticatedIdentity } from '../private-capabilities.js'
import { createSessionSecret, csrfTokenFor, digestSessionSecret } from './private-session-secrets.js'
import {
  SESSION_ABSOLUTE_MILLISECONDS,
  SESSION_IDLE_MILLISECONDS,
  SIGN_IN_ATTEMPT_MILLISECONDS,
} from '../session-policy.js'
import {
  isDatabaseError,
  type BrowserSessionDirective,
  type IdentityId,
  type IdentityView,
  type Instant,
  type LocalApplicationPath,
  type OpaqueSecret,
  type RequestId,
  type Result,
  type SessionId,
} from '../shared.js'

declare const authenticatedIdentityBrand: unique symbol

export interface AuthenticatedIdentity {
  readonly [authenticatedIdentityBrand]: true
}

export interface SessionEvidence {
  sessionSecret?: OpaqueSecret
  csrfToken?: OpaqueSecret
  origin?: string
}

export type SignInRequest =
  | { kind: 'begin'; returnTo?: LocalApplicationPath }
  | {
      kind: 'complete'
      callback: { code?: string; state?: string; error?: string }
      attemptSecret: OpaqueSecret
    }

export type SignInReceipt =
  | {
      kind: 'redirect'
      authorizationUrl: string
      attemptSecret: OpaqueSecret
      attemptExpiresAt: Instant
    }
  | {
      kind: 'established'
      identity: AuthenticatedIdentity
      identityView: IdentityView
      session: Extract<BrowserSessionDirective, { kind: 'establish' | 'replace' }>
      returnTo: LocalApplicationPath
    }

export type SessionRequest =
  | { kind: 'resolve'; evidence: SessionEvidence; use: 'read' | 'change' | 'stream' }
  | { kind: 'end'; evidence: SessionEvidence; requestId: RequestId }

export type SessionReceipt =
  | {
      kind: 'resolved'
      identity: AuthenticatedIdentity
      identityView: IdentityView
      csrfToken: OpaqueSecret
      absoluteExpiresAt: Instant
      session: Extract<BrowserSessionDirective, { kind: 'unchanged' }>
    }
  | { kind: 'ended'; session: Extract<BrowserSessionDirective, { kind: 'clear' }> }

export type IdentityFault =
  | { kind: 'not-authenticated' }
  | { kind: 'csrf' }
  | { kind: 'sign-in-failed'; reason: 'invalid-return' | 'invalid-callback' | 'provider-unavailable' }
  | { kind: 'temporarily-unavailable' }

export interface IdentityModule {
  signIn(request: SignInRequest): Promise<Result<SignInReceipt, IdentityFault>>
  session(request: SessionRequest): Promise<Result<SessionReceipt, IdentityFault>>
}

export interface IdentityModuleConfig {
  redirectUri: string
  allowedOrigins: Set<string>
  installationAdministrators: Set<string>
  sessionHmacSecret: string
  now?: () => Date
}

interface AttemptRow {
  state: string
  secret_hash: string
  nonce: string
  code_verifier: string
  return_to: string
  expires_at: Date
  consumed_at: Date | null
}

interface SessionRow {
  session_id: string
  identity_id: string
  oidc_issuer: string
  oidc_subject: string
  display_name: string
  secret_hash: string
  last_active_at: Date
  absolute_expires_at: Date
  revoked_at: Date | null
}

export class IdentityModuleImplementation implements IdentityModule {
  private readonly now: () => Date

  constructor(
    private readonly db: Database,
    private readonly oidc: OidcPort,
    private readonly config: IdentityModuleConfig,
  ) {
    this.now = config.now ?? (() => new Date())
  }

  async signIn(request: SignInRequest): Promise<Result<SignInReceipt, IdentityFault>> {
    try {
      if (request.kind === 'begin') return await this.beginSignIn(request.returnTo)
      return await this.completeSignIn(request)
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  async session(request: SessionRequest): Promise<Result<SessionReceipt, IdentityFault>> {
    try {
      if (request.kind === 'end') return await this.endSession(request.evidence)
      return await this.resolveSession(request.evidence, request.use)
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }

  private async beginSignIn(returnToValue?: LocalApplicationPath): Promise<Result<SignInReceipt, IdentityFault>> {
    const returnTo = safeLocalPath(returnToValue)
    if (!returnTo) return { ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-return' } }

    const now = this.now()
    const attemptSecret = secret() as OpaqueSecret
    const state = secret()
    const nonce = secret()
    const codeVerifier = secret()
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const expiresAt = new Date(now.getTime() + SIGN_IN_ATTEMPT_MILLISECONDS)

    let authorizationUrl: string
    try {
      authorizationUrl = await this.oidc.begin({
        state,
        nonce,
        codeChallenge,
        redirectUri: this.config.redirectUri,
      })
    } catch {
      return { ok: false, fault: { kind: 'sign-in-failed', reason: 'provider-unavailable' } }
    }

    await this.db.query(
      `insert into team.sign_in_attempts
        (state, secret_hash, nonce, code_verifier, return_to, expires_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [state, digest(attemptSecret), nonce, codeVerifier, returnTo, expiresAt],
    )

    return {
      ok: true,
      value: {
        kind: 'redirect',
        authorizationUrl,
        attemptSecret,
        attemptExpiresAt: expiresAt.toISOString() as Instant,
      },
    }
  }

  private async completeSignIn(
    request: Extract<SignInRequest, { kind: 'complete' }>,
  ): Promise<Result<SignInReceipt, IdentityFault>> {
    const code = request.callback.code
    const state = request.callback.state
    const attemptSecret = request.attemptSecret
    if (request.callback.error || !code || !state || !attemptSecret) {
      return { ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } }
    }

    const attemptResult = await this.db.query<AttemptRow>(
      `select state, secret_hash, nonce, code_verifier, return_to, expires_at, consumed_at
       from team.sign_in_attempts where state = $1`,
      [state],
    )
    const attempt = attemptResult.rows[0]
    const now = this.now()
    if (!attempt || attempt.consumed_at || attempt.expires_at.getTime() <= now.getTime()
      || !equalSecrets(attempt.secret_hash, digest(attemptSecret))) {
      return { ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } }
    }

    let external
    try {
      external = await this.oidc.redeem({
        code,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
        redirectUri: this.config.redirectUri,
      })
    } catch (error) {
      if (error instanceof OidcUnavailableError) {
        return { ok: false, fault: { kind: 'sign-in-failed', reason: 'provider-unavailable' } }
      }
      if (error instanceof OidcRejectedError) {
        return { ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } }
      }
      return { ok: false, fault: { kind: 'temporarily-unavailable' } }
    }

    const sessionSecret = createSessionSecret()
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MILLISECONDS)
    const established = await inTransaction(this.db, async (client) => {
      const consumed = await client.query(
        `update team.sign_in_attempts set consumed_at = $1
         where state = $2 and consumed_at is null and expires_at > $1
         returning state`,
        [now, state],
      )
      if (!consumed.rows[0]) return null

      const identityResult = await client.query<{
        id: string
        oidc_issuer: string
        oidc_subject: string
        display_name: string
      }>(
        `insert into team.identities (oidc_issuer, oidc_subject, display_name, email)
         values ($1,$2,$3,$4)
         on conflict (oidc_issuer, oidc_subject) do update
         set display_name = excluded.display_name, email = excluded.email, updated_at = $5
         returning id, oidc_issuer, oidc_subject, display_name`,
        [external.issuer, external.subject, external.displayName, external.email, now],
      )
      const row = identityResult.rows[0]
      const sessionResult = await client.query<{ id: string }>(
        `insert into team.browser_sessions
          (identity_id, secret_hash, created_at, last_active_at, absolute_expires_at)
         values ($1,$2,$3,$3,$4) returning id`,
        [row.id, digestSessionSecret(sessionSecret), now, absoluteExpiresAt],
      )
      return { row, sessionId: sessionResult.rows[0].id }
    })
    if (!established) return { ok: false, fault: { kind: 'sign-in-failed', reason: 'invalid-callback' } }

    const installationAdministrator = this.isInstallationAdministrator(
      established.row.oidc_issuer,
      established.row.oidc_subject,
    )
    const identity = makeAuthenticatedIdentity({
      sessionId: established.sessionId as SessionId,
      identityId: established.row.id as IdentityId,
      oidcIssuer: established.row.oidc_issuer,
      oidcSubject: established.row.oidc_subject,
      displayName: established.row.display_name,
      installationAdministrator,
      absoluteExpiresAt,
    })
    return {
      ok: true,
      value: {
        kind: 'established',
        identity,
        identityView: identityView(identity),
        session: {
          kind: 'establish',
          sessionSecret,
          csrfToken: csrfTokenFor(this.config.sessionHmacSecret, established.sessionId as SessionId),
          absoluteExpiresAt: absoluteExpiresAt.toISOString() as Instant,
        },
        returnTo: attempt.return_to as LocalApplicationPath,
      },
    }
  }

  private async resolveSession(
    evidence: SessionEvidence,
    use: 'read' | 'change' | 'stream',
  ): Promise<Result<SessionReceipt, IdentityFault>> {
    if (!evidence.sessionSecret) return { ok: false, fault: { kind: 'not-authenticated' } }
    const result = await this.db.query<SessionRow>(
      `select session.id as session_id, session.identity_id, session.secret_hash,
              session.last_active_at, session.absolute_expires_at, session.revoked_at,
              identity.oidc_issuer, identity.oidc_subject, identity.display_name
       from team.browser_sessions session
       join team.identities identity on identity.id = session.identity_id
       where session.secret_hash = $1`,
      [digestSessionSecret(evidence.sessionSecret)],
    )
    const row = result.rows[0]
    const now = this.now()
    if (!row || row.revoked_at || row.absolute_expires_at.getTime() <= now.getTime()
      || row.last_active_at.getTime() + SESSION_IDLE_MILLISECONDS <= now.getTime()) {
      if (row && !row.revoked_at) {
        await this.db.query('update team.browser_sessions set revoked_at = $1 where id = $2', [now, row.session_id])
      }
      return { ok: false, fault: { kind: 'not-authenticated' } }
    }

    if (use !== 'read' && (!evidence.origin || !this.config.allowedOrigins.has(evidence.origin))) {
      return { ok: false, fault: { kind: 'csrf' } }
    }
    if (use === 'change') {
      if (!evidence.csrfToken
        || !equalSecrets(csrfTokenFor(this.config.sessionHmacSecret, row.session_id as SessionId), evidence.csrfToken)) {
        return { ok: false, fault: { kind: 'csrf' } }
      }
    }

    await this.db.query('update team.browser_sessions set last_active_at = $1 where id = $2', [now, row.session_id])
    const identity = makeAuthenticatedIdentity({
      sessionId: row.session_id as SessionId,
      identityId: row.identity_id as IdentityId,
      oidcIssuer: row.oidc_issuer,
      oidcSubject: row.oidc_subject,
      displayName: row.display_name,
      installationAdministrator: this.isInstallationAdministrator(row.oidc_issuer, row.oidc_subject),
      absoluteExpiresAt: row.absolute_expires_at,
    })
    return {
      ok: true,
      value: {
        kind: 'resolved',
        identity,
        identityView: identityView(identity),
        csrfToken: csrfTokenFor(this.config.sessionHmacSecret, row.session_id as SessionId),
        absoluteExpiresAt: row.absolute_expires_at.toISOString() as Instant,
        session: { kind: 'unchanged' },
      },
    }
  }

  private async endSession(evidence: SessionEvidence): Promise<Result<SessionReceipt, IdentityFault>> {
    if (!evidence.sessionSecret) {
      return { ok: true, value: { kind: 'ended', session: { kind: 'clear' } } }
    }
    const result = await this.db.query<{ id: string }>(
      'select id from team.browser_sessions where secret_hash = $1 and revoked_at is null',
      [digestSessionSecret(evidence.sessionSecret)],
    )
    const row = result.rows[0]
    if (!row) return { ok: true, value: { kind: 'ended', session: { kind: 'clear' } } }
    if (!evidence.origin || !this.config.allowedOrigins.has(evidence.origin)
      || !evidence.csrfToken
      || !equalSecrets(csrfTokenFor(this.config.sessionHmacSecret, row.id as SessionId), evidence.csrfToken)) {
      return { ok: false, fault: { kind: 'csrf' } }
    }
    await this.db.query('update team.browser_sessions set revoked_at = $1 where id = $2', [this.now(), row.id])
    return { ok: true, value: { kind: 'ended', session: { kind: 'clear' } } }
  }

  private isInstallationAdministrator(issuer: string, subject: string): boolean {
    return this.config.installationAdministrators.has(`${issuer}|${subject}`)
  }
}

function identityView(identity: AuthenticatedIdentity): IdentityView {
  const claims = inspectAuthenticatedIdentity(identity)
  if (!claims) throw new Error('Invalid authenticated identity')
  return {
    id: claims.identityId,
    displayName: claims.displayName,
    installationAdministrator: claims.installationAdministrator,
  }
}

function safeLocalPath(value: LocalApplicationPath = '/' as LocalApplicationPath): LocalApplicationPath | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  try {
    const parsed = new URL(value, 'https://dig.local')
    if (parsed.origin !== 'https://dig.local') return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}` as LocalApplicationPath
  } catch {
    return null
  }
}

function secret(): string {
  return randomBytes(32).toString('base64url')
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function equalSecrets(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
