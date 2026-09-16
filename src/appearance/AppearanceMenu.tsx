import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Palette, ThemeMode } from '../../api/contracts/appearance.ts'
import type { AppearanceSession } from './appearance-session.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import './AppearanceMenu.css'

const palettes: { value: Palette; label: string; description: string }[] = [
  { value: 'nature',label: 'Nature',description: 'Forest greens and mint' },
  { value: 'neutral',label: 'Neutral',description: 'Quiet greys and green accents' },
  { value: 'tokyo-night',label: 'Tokyo Night',description: 'Blue and purple city lights' },
]
const modes: { value: ThemeMode; label: string }[] = [{ value: 'system',label: 'System' },{ value: 'light',label: 'Light' },{ value: 'dark',label: 'Dark' }]

export function AppearanceMenu({ session,displayName,onSignOut,onConnections,busy }: {
  session: AppearanceSession; displayName: string; onSignOut: () => void; onConnections?: () => void; busy: boolean
}) {
  const state = useSyncExternalStore(session.subscribe,session.getSnapshot)
  const [menu,setMenu] = useState(false)
  const [chooser,setChooser] = useState(false)
  const element = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => { if (!element.current?.contains(event.target as Node)) setMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false);trigger.current?.focus() } }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return () => { document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape) }
  },[menu])
  return <>
    <div className="personal-menu" ref={element}>
      <button type="button" className="quiet-button personal-menu-trigger" ref={trigger} aria-label="Personal menu" aria-expanded={menu} aria-controls={id} onClick={() => setMenu(!menu)}>
        <span className="personal-name">{displayName}</span><span aria-hidden="true">⌄</span>
      </button>
      {menu && <div className="personal-actions" id={id}>
        <Button variant="ghost" onClick={() => { trigger.current?.focus();setMenu(false);setChooser(true) }}>Appearance</Button>
        {onConnections && <Button variant="ghost" onClick={() => { trigger.current?.focus();setMenu(false);onConnections() }}>Agent connections</Button>}
        <Button variant="ghost" onClick={onSignOut} disabled={busy}>Sign out</Button>
      </div>}
    </div>
    {state.error && !chooser && <div className="appearance-error" role="alert">{state.error} <Button variant="ghost" onClick={() => { trigger.current?.focus();setChooser(true) }}>Open Appearance</Button></div>}
    {chooser && <Dialog title="Appearance" closeLabel="Close Appearance dialog" onClose={() => setChooser(false)}>
      <div className="appearance-chooser">
        <p className="appearance-intro">Your appearance across every Space. Changes apply immediately and save to your account.</p>
        <fieldset disabled={!state.ready}>
          <legend>Palette</legend>
          <div className="palette-choices">{palettes.map(palette => <label className="palette-option" data-selected={state.palette === palette.value} key={palette.value}>
            <input type="radio" name={`${id}-palette`} aria-label={palette.label} checked={state.palette === palette.value} onChange={() => session.choose({ palette: palette.value,mode: state.mode })} />
            <strong>{palette.label}</strong>
            <span className="palette-preview" data-palette={palette.value} data-scheme={state.mode === 'system' ? document.documentElement.dataset.scheme : state.mode} aria-hidden="true">
              <span className="preview-sidebar" /><span className="preview-card"><span /><span /></span><span className="preview-accent" />
            </span>
            <span className="palette-description">{palette.description}</span>
            <span className="palette-selected">{state.palette === palette.value ? 'Selected' : '\u00a0'}</span>
          </label>)}</div>
        </fieldset>
        <fieldset disabled={!state.ready} className="appearance-modes">
          <legend>Mode</legend>
          <div>{modes.map(mode => <label key={mode.value}>
            <input type="radio" name={`${id}-mode`} checked={state.mode === mode.value} onChange={() => session.choose({ palette: state.palette,mode: mode.value })} />{mode.label}
          </label>)}</div>
          <p>System follows this device’s light or dark appearance.</p>
        </fieldset>
        <p className="appearance-status" role="status">{state.error ? 'Appearance needs attention' : !state.ready ? 'Loading appearance…' : state.saving ? 'Saving appearance…' : 'Appearance saved'}</p>
        {state.error && <div className="appearance-error" role="alert"><p>{state.error}</p><Button onClick={() => session.retry()}>Retry</Button></div>}
      </div>
    </Dialog>}
  </>
}
