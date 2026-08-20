import type { ReactNode } from 'react'

export function Tooltip({ tip, children }: { tip: string; children: ReactNode }): JSX.Element {
  return (
    <span className="tip" data-tip={tip}>
      {children}
    </span>
  )
}
