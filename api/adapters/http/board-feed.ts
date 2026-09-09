import type { ServerResponse } from 'node:http'
import type { BoardFeedItem } from '../../contracts/board.js'

export async function sendBoardFeed(response: ServerResponse, feed: AsyncIterable<BoardFeedItem>, shutdown?: AbortSignal) {
  if (response.destroyed) return
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  response.write('event: ready\ndata: {}\n\n')
  const iterator = feed[Symbol.asyncIterator]()
  let stopped = false
  const stop = () => { stopped = true; void iterator.return?.().catch(() => undefined) }
  const drain = () => {
    if (stopped) return
    response.end(encode({ kind: 'closed', reason: 'server-draining' }))
    stop()
  }
  response.once('close', stop)
  shutdown?.addEventListener('abort', drain, { once: true })
  const heartbeat = setInterval(() => {
    if (!stopped && !response.writableNeedDrain) response.write(': heartbeat\n\n')
  }, 10_000)
  heartbeat.unref()
  try {
    if (shutdown?.aborted) drain()
    while (!stopped) {
      const next = await iterator.next()
      if (next.done || stopped) break
      if (!response.write(encode(next.value)) && !await waitForDrain(response)) break
      if (next.value.kind !== 'update') break
    }
  } catch {
    // Headers have already been sent. Reconnect through a fresh authenticated read.
    response.destroy()
  } finally {
    clearInterval(heartbeat)
    shutdown?.removeEventListener('abort', drain)
    response.off('close', stop)
    stop()
    await iterator.return?.().catch(() => undefined)
    if (!response.writableEnded && !response.destroyed) response.end()
  }
}

function encode(item: BoardFeedItem) {
  return `event: board\n${item.kind === 'update' ? `id: ${item.update.sequence}\n` : ''}data: ${JSON.stringify(item)}\n\n`
}

function waitForDrain(response: ServerResponse): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timeout)
      response.off('drain', drained)
      response.off('close', closed)
      resolve(ready)
    }
    const drained = () => finish(true), closed = () => finish(false)
    const timeout = setTimeout(() => { response.destroy(); finish(false) }, 5000)
    response.once('drain', drained)
    response.once('close', closed)
  })
}
