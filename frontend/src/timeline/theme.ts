/**
 * Canvas color/font source of truth for the timeline (spec §2/§6). Reads the
 * design tokens (styles/tokens.css custom properties) off the document root
 * exactly once and caches the result — canvas 2D has no CSS var() support,
 * so every draw.ts fillStyle/strokeStyle/font must come from here rather
 * than a literal hex/rgb string.
 */

export interface TlTheme {
  bgApp: string
  bgPanel: string
  bgElevated: string
  bgControl: string
  bgControlHover: string
  bgInset: string
  border: string
  borderSubtle: string
  text1: string
  text2: string
  text3: string
  accent: string
  accentSoft: string
  success: string
  warn: string
  danger: string
  selection: string
  /** 轨道色相，index by Lane.layer */
  laneColors: Record<'L0' | 'L1' | 'L2', string>
  fontUi: string
  fontMono: string
}

let cached: TlTheme | null = null

const read = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function tlTheme(): TlTheme {
  if (cached) return cached
  cached = {
    bgApp: read('--bg-app'),
    bgPanel: read('--bg-panel'),
    bgElevated: read('--bg-elevated'),
    bgControl: read('--bg-control'),
    bgControlHover: read('--bg-control-hover'),
    bgInset: read('--bg-inset'),
    border: read('--border'),
    borderSubtle: read('--border-subtle'),
    text1: read('--text-1'),
    text2: read('--text-2'),
    text3: read('--text-3'),
    accent: read('--accent'),
    accentSoft: read('--accent-soft'),
    success: read('--success'),
    warn: read('--warn'),
    danger: read('--danger'),
    selection: read('--selection'),
    laneColors: {
      L0: read('--lane-l0'),
      L1: read('--lane-l1'),
      L2: read('--lane-l2'),
    },
    fontUi: read('--font-ui'),
    fontMono: read('--font-mono'),
  }
  return cached
}

/**
 * Escape hatch to force the next tlTheme() call to re-read the CSS custom
 * properties instead of returning the cached snapshot. Not wired to
 * anything yet (no theme-switcher exists) — reserved for when one does.
 */
export function invalidate(): void {
  cached = null
}

/**
 * hex ("#rrggbb") -> "rgba(r, g, b, alpha)". All tokens.css color tokens
 * this file reads are opaque hex (accent-soft is the one exception, already
 * an rgba() string token, and is returned unchanged by the regex miss below)
 * — this is how draw.ts derives the translucent variants spec §6.2 calls
 * for (ghost takes, IQR bands, holding bars, selection glow, ...) without
 * hardcoding a parallel rgba palette.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
