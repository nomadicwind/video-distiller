import type { ReactNode } from 'react'

/**
 * Styled-checkbox switch (spec §5.2/§3: "Switch = 样式化 checkbox"). A native
 * <input type="checkbox"> stays the source of truth (keyboard/a11y toggling
 * works for free) — the track/thumb are pure CSS siblings driven by
 * `:checked` (see ui.css), and the whole row brightens with --accent-soft
 * while checked so the active state reads from across the panel.
 */
export function Switch({ checked, onChange, label, hint }: {
  checked: boolean
  onChange: () => void
  label: ReactNode
  hint?: ReactNode
}): JSX.Element {
  return (
    <label className={`switch-row${checked ? ' is-active' : ''}`}>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="switch-track"><span className="switch-thumb" /></span>
      </span>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </span>
    </label>
  )
}
