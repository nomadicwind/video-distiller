import type { ReactNode } from 'react'

export function Card({
  title,
  extra,
  children,
  accent,
}: {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  accent?: string
}): JSX.Element {
  return (
    <div className="card" style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      {(title || extra) && (
        <div className="card-head">
          {title ? <div className="card-title">{title}</div> : <span />}
          {extra ? <div className="card-extra">{extra}</div> : null}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  )
}
