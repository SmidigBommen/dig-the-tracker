import type { BoardFeedItem, FollowOptions } from '../../../api/contracts/board.ts'
import type { BoardFeedObserver } from '../../board-session/board-session.ts'

export function followBoard(path: string, options: FollowOptions, observer: BoardFeedObserver): () => void {
  const controller = new AbortController()
  let stopped = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const heartbeat = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 20000) }
  heartbeat()
  void (async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await fetch(`${path}/events${options.after === undefined ? '' : `?after=${options.after}`}`, {
        credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal: controller.signal,
      })
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) return
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!stopped) {
        const chunk = await reader.read()
        if (chunk.done) break
        heartbeat()
        buffer += decoder.decode(chunk.value, { stream: true })
        if (buffer.length > 2_000_000) throw new Error('Feed frame too large')
        let boundary: number
        while (!stopped && (boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const lines = frame.split('\n')
          const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
          const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
          if (event === 'ready') observer.open()
          else if (event === 'board' && data) observer.item(JSON.parse(data) as BoardFeedItem)
        }
      }
    } catch { /* The session owns recovery and its retained drafts. */ }
    finally {
      clearTimeout(timeout)
      await reader?.cancel().catch(() => undefined)
      reader?.releaseLock()
      if (!stopped) observer.disconnected()
    }
  })()
  return () => { stopped = true; clearTimeout(timeout); controller.abort() }
}
