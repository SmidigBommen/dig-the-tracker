import { useId, type ReactNode } from 'react'

export function Tabs({ label, options, value, onChange, children }: {
  label: string; options: readonly string[]; value: string; onChange: (value: string) => void; children: ReactNode
}) {
  const id = useId()
  return <div className="dig-tabs">
    <div role="tablist" aria-label={label} onKeyDown={(event) => {
      const index = options.indexOf(value)
      const next = event.key === 'ArrowRight' ? (index + 1) % options.length
        : event.key === 'ArrowLeft' ? (index + options.length - 1) % options.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1
      if (next < 0) return
      event.preventDefault()
      onChange(options[next])
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus()
    }}>{options.map((option) => <button key={option} type="button" role="tab" id={`${id}-${option}`} aria-controls={`${id}-panel`}
      aria-selected={option === value} tabIndex={option === value ? 0 : -1} onClick={() => onChange(option)}>{option}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} tabIndex={0}>{children}</div>
  </div>
}
