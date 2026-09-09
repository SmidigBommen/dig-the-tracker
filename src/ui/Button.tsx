import type { ButtonHTMLAttributes } from 'react'

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button {...props} type={type} className={`dig-button dig-button-${variant} ${className}`} />
}
