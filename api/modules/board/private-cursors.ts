import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { OpaqueCursor } from '../shared.js'
import type { BoardFault } from '../../contracts/board.js'

// Restarting the process expires cursor chains; clients reload bounded first pages.
const key = randomBytes(32)

export class BoardRejection extends Error {
  constructor(readonly fault: BoardFault) { super(fault.kind) }
}

export function encodeCursor(scope: string, revision: number, last: string): OpaqueCursor {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const data = Buffer.concat([cipher.update(JSON.stringify({ scope, revision, last, expires: Date.now() + 3_600_000 })), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url') as OpaqueCursor
}

export function decodeCursor(cursor: OpaqueCursor | undefined, scope: string, revision: number): string | undefined {
  if (cursor === undefined) return undefined
  try {
    if (typeof cursor !== 'string' || cursor.length > 2000) throw new Error('Invalid cursor')
    const data = Buffer.from(cursor, 'base64url')
    const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
    cipher.setAuthTag(data.subarray(12, 28))
    const value = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString())
    if (value.scope !== scope || value.revision !== revision || value.expires <= Date.now() || typeof value.last !== 'string') {
      throw new Error('Expired cursor')
    }
    return value.last
  } catch {
    throw new BoardRejection({ kind: 'cursor-expired' })
  }
}

export function pageSize(size?: number): number {
  if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 200)) {
    throw new BoardRejection({ kind: 'invalid', issues: [{ field: 'page.size', message: 'Use a value from 1 to 200.' }] })
  }
  return size ?? 50
}
