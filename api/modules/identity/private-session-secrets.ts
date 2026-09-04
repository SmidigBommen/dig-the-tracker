import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { OpaqueSecret, SessionId } from '../shared.js'

export function createSessionSecret(): OpaqueSecret {
  return randomBytes(32).toString('base64url') as OpaqueSecret
}

export function digestSessionSecret(value: OpaqueSecret): string {
  return createHash('sha256').update(value).digest('hex')
}

export function csrfTokenFor(hmacSecret: string, sessionId: SessionId): OpaqueSecret {
  return createHmac('sha256', hmacSecret).update(`csrf:${sessionId}`).digest('base64url') as OpaqueSecret
}
