import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  text,
  action,
}: {
  icon: ReactNode
  text: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-text">{text}</div>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
