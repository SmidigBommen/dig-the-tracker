import type { DbClient } from '../../db.js'
import type {
  BrowserSessionDirective,
  IdentityId,
  SessionId,
} from '../shared.js'
import { createSessionSecret, csrfTokenFor, digestSessionSecret } from './private-session-secrets.js'

interface CurrentSession {
  sessionId: SessionId
  identityId: IdentityId
  absoluteExpiresAt: Date
}

export class PrivateSessionCoordinator {
  constructor(private readonly hmacSecret: string) {}

  async replaceCurrent(
    client: DbClient,
    current: CurrentSession,
    now: Date,
  ): Promise<Extract<BrowserSessionDirective, { kind: 'establish' | 'replace' }> & { kind: 'replace' }> {
    await this.revokeAll(client, current.identityId, now)
    const sessionSecret = createSessionSecret()
    const created = await client.query<{ id: string }>(
      `insert into team.browser_sessions
        (identity_id, secret_hash, created_at, last_active_at, absolute_expires_at)
       values ($1,$2,$3,$3,$4) returning id`,
      [current.identityId, digestSessionSecret(sessionSecret), now, current.absoluteExpiresAt],
    )
    return {
      kind: 'replace',
      sessionSecret,
      csrfToken: csrfTokenFor(this.hmacSecret, created.rows[0].id as SessionId),
      absoluteExpiresAt: current.absoluteExpiresAt.toISOString() as import('../shared.js').Instant,
    }
  }

  async revokeAll(client: DbClient, identityId: IdentityId, now: Date): Promise<void> {
    await client.query(
      'update team.browser_sessions set revoked_at = $1 where identity_id = $2 and revoked_at is null',
      [now, identityId],
    )
  }

}
