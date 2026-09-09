import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current!
    const resize = () => {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight + 2}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [props.value])
  return <textarea {...props} ref={input} className={`dig-auto-textarea ${props.className ?? ''}`} />
}
