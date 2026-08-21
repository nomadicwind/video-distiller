export const GUTTER_W = 112
export const RULER_H = 28
export const LANE_H = 72
export const TOOLBAR_H = 28

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

/** Δ 药丸 sizing (spec §6.2: 热区 ≥ 18×18, replacing the old 10×10 checkbox). */
const PILL_H = 18
/**
 * Fixed width estimate for a typical "Δ123ms"-style mono-10px label. This is
 * an estimate, not a text measurement — pillRect has no canvas context (and
 * no label string) to measure against, so draw.ts's rendered pill and this
 * hit-rect are only approximately the same width by design (spec: "宽 max(36,
 * 文本宽度估算)").
 */
const PILL_W_ESTIMATE = 56
/**
 * Floor applied to the width when a `spanPx` constraint is given (a very
 * tight pair of marks would otherwise force the pill narrower than this is
 * usable as a click target — code review ruling, see pillRect below).
 */
const PILL_W_SPAN_FLOOR = 12
/**
 * Vertical offset of the pill's center BELOW the lane's vertical midline.
 * The space above the midline is reserved for the mark's own label pill
 * (spec §6.2: 8px above the dot) — stacking the Δ pill there too would
 * collide with it, so the Δ pill instead sits in the free band between the
 * marks row and the ghost-take ticks at the very bottom of the lane.
 */
const PILL_Y_OFFSET = 18

/**
 * Δ 药丸命中矩形（含渲染定位）：替代原 checkboxRect 的 10×10 复选框。
 *
 * `spanPx` (optional) is the interval's own on-screen width (endMs-startMs
 * in px) — when given, the pill's width is capped to `spanPx - 4` (floored
 * at PILL_W_SPAN_FLOOR) so two tightly-adjacent intervals' hit-rects can
 * never overlap into each other (code review: a fixed 56px pill was wide
 * enough to reach into a neighboring interval and steal its click, or — for
 * a 0ms-delta pair sharing an x — to sit exactly on top of a mark's own
 * hit-test). Omitted (e.g. the layout.test.ts unit test), it falls back to
 * the plain PILL_W_ESTIMATE, unconstrained.
 */
export const pillRect = (midMs: number, v: Viewport, laneY: number, spanPx?: number): Rect => {
  const w = spanPx === undefined
    ? PILL_W_ESTIMATE
    : Math.min(PILL_W_ESTIMATE, Math.max(PILL_W_SPAN_FLOOR, spanPx - 4))
  const cx = msToPx(v, midMs)
  const cy = laneY + LANE_H / 2 + PILL_Y_OFFSET
  return { x: cx - w / 2, y: cy - PILL_H / 2, w, h: PILL_H }
}

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
