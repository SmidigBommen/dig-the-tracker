import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button.tsx'

export function SpaceExportButton({ spaceKey }: { spaceKey: string }) {
  const [state,setState] = useState<'idle' | 'preparing' | 'downloaded'>('idle')
  const [error,setError] = useState<string>()
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(),[spaceKey])
  const download = async () => {
    const controller = new AbortController()
    request.current = controller
    setState('preparing');setError(undefined)
    try {
      const response = await fetch(`/api/spaces/${encodeURIComponent(spaceKey)}/export`,{ credentials: 'same-origin',signal: controller.signal })
      if (!response.ok) throw new Error(response.status === 429 ? 'Another export is running. Try again shortly.' : response.status === 401 || response.status === 403 ? 'Sign in as a Space administrator to export.' : 'Could not export this Space. Try again.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url;link.download = `${spaceKey}-${new Date().toISOString().slice(0,10)}.json`
      document.body.append(link);link.click();link.remove()
      setTimeout(() => URL.revokeObjectURL(url),30_000)
      setState('downloaded')
    } catch (failure) {
      if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Could not export this Space. Try again.');setState('idle') }
    }
  }
  return <section className="space-settings" aria-labelledby="space-export-title">
    <h2 id="space-export-title">Export Space</h2>
    <p>Download Tasks, comments, workflow, and history as JSON, including archived work.</p>
    <Button variant="secondary" disabled={state === 'preparing'} onClick={() => void download()}>{state === 'preparing' ? 'Preparing export…' : 'Download JSON'}</Button>
    {state === 'downloaded' && <p role="status">Export ready. Check your downloads.</p>}
    {error && <p className="team-error" role="alert">{error}</p>}
  </section>
}
