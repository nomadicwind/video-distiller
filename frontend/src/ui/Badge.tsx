import type { ReactNode } from 'react'

export function Badge({
  kind,
  children,
}: {
  kind: 'accent' | 'success' | 'warn' | 'danger' | 'neutral' | 'lane-l1'
  children: ReactNode
}): JSX.Element {
  return <span className={`badge badge-${kind}`}>{children}</span>
}
