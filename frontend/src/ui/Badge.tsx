import type { ReactNode } from 'react'

export function Badge({
  kind,
  children,
}: {
  kind: 'accent' | 'success' | 'warn' | 'danger' | 'neutral'
  children: ReactNode
}): JSX.Element {
  return <span className={`badge badge-${kind}`}>{children}</span>
}
