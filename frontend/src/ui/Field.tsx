import type { ReactNode } from 'react'

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </label>
  )
}
