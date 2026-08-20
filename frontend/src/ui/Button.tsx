import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'

export function Button(props: {
  variant?: 'primary' | 'ghost' | 'danger' | 'icon'
  size?: 'md' | 'sm'
  icon?: ReactNode
  tip?: string
  disabled?: boolean
  active?: boolean
  onClick?: () => void
  children?: ReactNode
}): JSX.Element {
  const { variant = 'ghost', size = 'md', icon, tip, disabled, active, onClick, children } = props
  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    active ? 'is-active' : '',
    icon && !children ? 'btn-icon-only' : '',
  ].filter(Boolean).join(' ')

  const button = (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon ? <span className="btn-icon-glyph">{icon}</span> : null}
      {children ? <span className="btn-label">{children}</span> : null}
    </button>
  )

  if (tip) {
    return <Tooltip tip={tip}>{button}</Tooltip>
  }
  return button
}
