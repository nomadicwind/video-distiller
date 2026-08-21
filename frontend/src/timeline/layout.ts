export const GUTTER_W = 112
export const RULER_H = 28
export const LANE_H = 72
export const TOOLBAR_H = 28
/** @deprecated compat alias for RULER_H; kept until draw.ts/Timeline.tsx are rewritten (task 5) */
export const TOP_H = RULER_H

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

const NICE_STEPS = [1, 2, 5]

/**
 * Picks a "nice" major tick interval (1-2-5 × 10^n series, n>=0) such that the
 * resulting major-tick pixel spacing is at least 80px, choosing the smallest
 * such interval. minorMs is always majorMs/5.
 *
 * Guards against non-positive or NaN inputs (e.g. a 0×0 mount-time transient
 * before layout/resize has produced real measurements): falls back to a sane
 * default of majorMs=1000/minorMs=200 rather than looping forever or
 * returning Infinity.
 */
export const niceTickInterval = (spanMs: number, widthPx: number): { majorMs: number; minorMs: number } => {
  if (!(spanMs > 0) || !(widthPx > 0)) return { majorMs: 1000, minorMs: 200 }
  const threshold = (80 * spanMs) / widthPx
  let majorMs = NICE_STEPS[0]
  for (let exp = 0; ; exp++) {
    const pow10 = 10 ** exp
    let found = false
    for (const step of NICE_STEPS) {
      const candidate = step * pow10
      if (candidate >= threshold) {
        majorMs = candidate
        found = true
        break
      }
    }
    if (found) break
  }
  return { majorMs, minorMs: majorMs / 5 }
}

/**
 * Snaps a raw ms timestamp: first rounds to the nearest frame boundary
 * (frame = 1000/fps), then — if any magnet (mark/keyframe timestamp) lies
 * within tolPx pixels of that frame-rounded position — snaps to the magnet
 * instead.
 *
 * Note: does NOT clamp rawMs to [0, duration] — callers (tasks 5-6) are
 * responsible for clamping before/after calling this.
 */
export const snapMs = (
  rawMs: number, fps: number, magnets: number[], v: Viewport, tolPx = 6,
): number => {
  const frame = 1000 / fps
  const frameMs = Math.round(Math.round(rawMs / frame) * frame)
  let best = frameMs
  let bestDist = Infinity
  for (const m of magnets) {
    const dPx = Math.abs(msToPx(v, frameMs) - msToPx(v, m))
    if (dPx <= tolPx && dPx < bestDist) {
      bestDist = dPx
      best = m
    }
  }
  return best
}
