export const LANE_H = 64
export const TOP_H = 16

export interface Viewport { startMs: number; endMs: number; widthPx: number }

export interface MarkLite {
  id: string; t_ms: number; end_ms: number | null
  kind: 'input' | 'release'; label: string | null
}

export const msToPx = (v: Viewport, tMs: number): number =>
  ((tMs - v.startMs) / (v.endMs - v.startMs)) * v.widthPx

export const pxToMs = (v: Viewport, x: number): number =>
  Math.round(v.startMs + (x / v.widthPx) * (v.endMs - v.startMs))

export interface Interval {
  fromId: string; toId: string
  startMs: number; endMs: number; deltaMs: number
  holding: boolean; midMs: number
}

export const intervals = (marks: MarkLite[]): Interval[] => {
  const out: Interval[] = []
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1]
    out.push({
      fromId: a.id, toId: b.id, startMs: a.t_ms, endMs: b.t_ms,
      deltaMs: b.t_ms - a.t_ms, holding: a.end_ms === b.t_ms,
      midMs: Math.round((a.t_ms + b.t_ms) / 2),
    })
  }
  return out
}

export const hitTestMark = (marks: MarkLite[], v: Viewport, x: number, tolPx = 6): string | null => {
  let best: string | null = null
  let bestD = tolPx + 1
  for (const m of marks) {
    const d = Math.abs(msToPx(v, m.t_ms) - x)
    if (d < bestD) { bestD = d; best = m.id }
  }
  return bestD <= tolPx ? best : null
}

export const zoomed = (v: Viewport, factor: number, focusMs: number, durationMs: number): Viewport => {
  const span = (v.endMs - v.startMs) * factor
  const clamped = Math.min(Math.max(span, 500), durationMs)
  let start = focusMs - (focusMs - v.startMs) * (clamped / (v.endMs - v.startMs))
  start = Math.max(0, Math.min(start, durationMs - clamped))
  return { ...v, startMs: Math.round(start), endMs: Math.round(start + clamped) }
}

export const panned = (v: Viewport, deltaMs: number, durationMs: number): Viewport => {
  const span = v.endMs - v.startMs
  const start = Math.max(0, Math.min(v.startMs + deltaMs, durationMs - span))
  return { ...v, startMs: Math.round(start), endMs: Math.round(start + span) }
}

/** holding 勾选切换 → 应发给后端的 patch（勾选 = from 的键按住到 to 时刻） */
export const holdingPatch = (
  iv: Interval, checked: boolean,
): { markId: string; patch: { end_ms?: number; clear_end?: boolean } } =>
  checked
    ? { markId: iv.fromId, patch: { end_ms: iv.endMs } }
    : { markId: iv.fromId, patch: { clear_end: true } }

export interface Rect { x: number; y: number; w: number; h: number }

export const checkboxRect = (midMs: number, v: Viewport, laneY: number): Rect =>
  ({ x: msToPx(v, midMs) - 5, y: laneY + LANE_H / 2 + 10, w: 10, h: 10 })

export const inRect = (r: Rect, px: number, py: number): boolean =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
