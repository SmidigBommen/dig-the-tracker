import { setTimeout as pause } from 'node:timers/promises'
import { inTransaction, type Database } from '../../db.js'
import type { BoardFault, BoardFeedItem, BoardUpdate, FollowOptions } from '../../contracts/board.js'
import { inspectAuthorizedSpace } from '../private-capabilities.js'
import type { AuthorizedSpace } from '../space/space-module.js'
import { isDatabaseError, type ChangeSequence, type Result } from '../shared.js'
import { recheckAccess } from './private-access.js'

// Subscribers pull one update at a time. No database connection survives a poll.
const MAX_BACKLOG = 200
const POLL_MILLISECONDS = 1000

export async function followBoard(db: Database, access: AuthorizedSpace<'board-follow'>,
  options: FollowOptions): Promise<Result<AsyncIterable<BoardFeedItem>, BoardFault>> {
  const claims = inspectAuthorizedSpace(access)
  if (!claims || claims.use !== 'board-follow') return { ok: false, fault: { kind: 'forbidden' } }
  if (options.after !== undefined && (!Number.isSafeInteger(options.after) || options.after < 0)) {
    return { ok: false, fault: { kind: 'invalid', issues: [{ field: 'after', message: 'Use a non-negative change sequence.' }] } }
  }
  try {
    const initial = await readNext(options.after)
    if (!initial.ok) return initial
    let cursor = options.after ?? initial.latest
    const cancelled = new AbortController()
    const iterator = stream()
    return { ok: true, value: {
      [Symbol.asyncIterator]: () => ({
        next: () => iterator.next(),
        return: async () => { cancelled.abort(); return iterator.return() },
      }),
    } }

    async function* stream(): AsyncGenerator<BoardFeedItem, void> {
      while (!cancelled.signal.aborted) {
        const next = await readNext(cursor)
        if (cancelled.signal.aborted) return
        if (!next.ok) {
          if (next.fault.kind === 'temporarily-unavailable') throw new Error('Board feed unavailable')
          yield { kind: 'closed', reason: next.fault.kind === 'read-only' ? 'space-archived' : 'access-revoked' }
          return
        }
        if (cursor > next.latest || next.latest - cursor > MAX_BACKLOG
          || cursor < next.latest && next.update?.sequence !== cursor + 1) {
          yield { kind: 'snapshot-required', latest: next.latest }
          return
        }
        if (next.update) {
          cursor = next.update.sequence
          yield { kind: 'update', update: next.update }
        } else {
          await pause(POLL_MILLISECONDS, undefined, { signal: cancelled.signal }).catch((error: unknown) => {
            if (!cancelled.signal.aborted) throw error
          })
        }
      }
    }
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
    throw error
  }

  async function readNext(after?: number): Promise<
    { ok: true; latest: ChangeSequence; update?: BoardUpdate } | { ok: false; fault: BoardFault }
  > {
    try {
      return await inTransaction(db, async (client) => {
        const permitted = await recheckAccess(client, claims!)
        if (!permitted.ok) return permitted
        const board = await client.query<{ change_sequence: string }>('select change_sequence from team.boards where space_id = $1 for share', [claims!.spaceId])
        if (!board.rows[0]) return { ok: false, fault: { kind: 'not-found' } }
        const latest = Number(board.rows[0].change_sequence) as ChangeSequence
        if (after === undefined || after >= latest || latest - after > MAX_BACKLOG) return { ok: true, latest }
        const found = await client.query<{ update: BoardUpdate }>('select update from team.board_updates where space_id = $1 and sequence > $2 order by sequence limit 1', [claims!.spaceId, after])
        const update = found.rows[0]?.update
        // Preserve the sequence even when every personal change is filtered out.
        return { ok: true, latest, update: update ? { ...update, changes: update.changes.filter((change) =>
          change.kind !== 'notification-upserted' && (change.kind !== 'notifications-read' || change.memberId === claims!.memberId)) } : undefined }
      })
    } catch (error) {
      if (isDatabaseError(error)) return { ok: false, fault: { kind: 'temporarily-unavailable' } }
      throw error
    }
  }
}
