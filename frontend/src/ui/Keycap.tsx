export function Keycap({ label, onClick, wide }: { label: string; onClick?: () => void; wide?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={`keycap${wide ? ' keycap-wide' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
