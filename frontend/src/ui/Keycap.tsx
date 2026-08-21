export function Keycap({ label, onClick, wide, inert }: {
  label: string
  onClick?: () => void
  wide?: boolean
  /** Display-only keycap (e.g. ChordPreview/HotkeyOverlay): drops it from the tab order — it has no onClick, so a focusable, keyboard-activatable button there is a screen-reader/keyboard trap with no effect. */
  inert?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className={`keycap${wide ? ' keycap-wide' : ''}${inert ? ' keycap-inert' : ''}`}
      tabIndex={inert ? -1 : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
