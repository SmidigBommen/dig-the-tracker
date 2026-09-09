import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button.tsx'

export function Dialog({ title, onClose, actions, children, focusTitle = false }: { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode; focusTitle?: boolean }) {
  const element = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const titleId = useId()
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = element.current!
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]'))
      .filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]') && !element.closest('fieldset:disabled') && !element.closest('details:not([open]) > div'))
    const initial = focusTitle ? dialog.querySelector<HTMLElement>('[name="title"]:not(:disabled)') ?? dialog : dialog
    initial.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const targets = focusable(), first = targets[0], last = targets.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    const focusin = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.addEventListener('keydown', keydown)
    document.addEventListener('focusin', focusin)
    return () => {
      dialog.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin)
      document.body.style.overflow = previousOverflow; previous?.focus()
    }
  }, [focusTitle])
  return <div className="task-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={element} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="dig-dialog task-dialog" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current() }
    }}>
    <header className="dig-dialog-header"><h2 id={titleId}>{title}</h2><div className="task-dialog-actions">{actions}<Button variant="ghost" className="dig-icon-button" aria-label="Close Task dialog" onClick={onClose}>×</Button></div></header>
    <div className="dig-dialog-body">{children}</div>
  </div></div>
}
