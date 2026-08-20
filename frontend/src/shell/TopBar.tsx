import type { ReactNode } from 'react'
import { Clapperboard } from 'lucide-react'

export type NavPage = 'library' | 'catalog' | 'keymap' | 'playbooks' | 'exec'

const NAV_ITEMS: { key: NavPage; label: string }[] = [
  { key: 'library', label: '资料库' },
  { key: 'catalog', label: '技能目录' },
  { key: 'keymap', label: '键位' },
  { key: 'playbooks', label: '循环与方案' },
  { key: 'exec', label: '执行台' },
]

export function TopBar({ page, onNav, context }: {
  page: string
  onNav: (p: NavPage) => void
  context?: ReactNode
}): JSX.Element {
  // `page` is one of NavPage while a top-level page is showing. When the
  // Workbench or PlaybookEditor is open, App.tsx passes a sentinel value
  // ('workbench' / 'editor') that matches none of the nav keys — that's
  // our signal to dim and disable the whole nav strip.
  const navEnabled = NAV_ITEMS.some(item => item.key === page)

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <Clapperboard size={20} />
        <span>Distiller</span>
      </div>
      <div className={`topbar-nav${navEnabled ? '' : ' is-disabled'}`} role="tablist">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === page}
            className={`topbar-nav-btn${item.key === page ? ' is-active' : ''}`}
            disabled={!navEnabled}
            onClick={() => onNav(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="topbar-context">{context}</div>
    </div>
  )
}
