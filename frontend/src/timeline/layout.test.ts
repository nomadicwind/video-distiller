import { describe, expect, it, test } from 'vitest'
import {
  hitTestMark, holdingPatch, inRect, intervals,
  msToPx, niceTickInterval, panned, pillRect, pxToMs, snapMs, zoomed,
  type MarkLite, type Viewport,
} from './layout'

const v: Viewport = { startMs: 0, endMs: 10_000, widthPx: 1000 }
const mk = (id: string, t: number, end: number | null = null): MarkLite =>
  ({ id, t_ms: t, end_ms: end, kind: 'input', label: '2' })

test('ms↔px roundtrip', () => {
  expect(msToPx(v, 5000)).toBe(500)
  expect(pxToMs(v, 500)).toBe(5000)
  expect(pxToMs(v, msToPx(v, 1234))).toBe(1234)
})

test('intervals compute delta and holding', () => {
  const [iv] = intervals([mk('a', 100, 400), mk('b', 400)])
  expect(iv).toMatchObject({ fromId: 'a', toId: 'b', deltaMs: 300, holding: true, midMs: 250 })
  const [iv2] = intervals([mk('a', 100), mk('b', 400)])
  expect(iv2.holding).toBe(false)
})

test('hitTestMark picks nearest within tolerance', () => {
  const marks = [mk('a', 1000), mk('b', 2000)]
  expect(hitTestMark(marks, v, msToPx(v, 1010))).toBe('a')
  expect(hitTestMark(marks, v, msToPx(v, 1500))).toBeNull()
})

test('zoom keeps focus and clamps to duration', () => {
  const z = zoomed(v, 0.5, 5000, 10_000)
  expect(z.endMs - z.startMs).toBe(5000)
  expect(z.startMs).toBeGreaterThanOrEqual(0)
  const zoomOut = zoomed(v, 4, 5000, 10_000)
  expect(zoomOut.endMs - zoomOut.startMs).toBe(10_000)
})

test('pan clamps to bounds', () => {
  expect(panned(v, -500, 10_000).startMs).toBe(0)
  const right = panned({ ...v, startMs: 5000, endMs: 10_000 }, 9999, 10_000)
  expect(right.endMs).toBe(10_000)
})

test('holdingPatch emits set or clear', () => {
  const [iv] = intervals([mk('a', 100), mk('b', 400)])
  expect(holdingPatch(iv, true)).toEqual({ markId: 'a', patch: { end_ms: 400 } })
  expect(holdingPatch(iv, false)).toEqual({ markId: 'a', patch: { clear_end: true } })
})

test('pillRect hit', () => {
  const r = pillRect(250, v, 16)
  // spec §6.2: 热区 ≥ 18×18 (was a 10×10 checkbox)
  expect(r.w).toBeGreaterThanOrEqual(36)
  expect(r.h).toBe(18)
  expect(inRect(r, r.x + r.w / 2, r.y + r.h / 2)).toBe(true)
  expect(inRect(r, r.x + r.w + 10, r.y)).toBe(false)
})

test('pillRect spanPx clamps width so adjacent short intervals do not overlap (code review)', () => {
  // Two adjacent short intervals: a-b (100ms wide) and b-c (300ms wide).
  // Without the spanPx clamp, both pills default to a fixed 56px width and
  // heavily overlap here — the reviewer's live repro clicked at one
  // interval's own midpoint and had it PATCH the neighboring interval's mark
  // instead, because the earlier (in array order) interval's oversized rect
  // still contained that point.
  const marks = [mk('a', 1000), mk('b', 1100), mk('c', 1400)]
  const [ivAB, ivBC] = intervals(marks)
  const spanAB = msToPx(v, ivAB.endMs) - msToPx(v, ivAB.startMs)
  const spanBC = msToPx(v, ivBC.endMs) - msToPx(v, ivBC.startMs)
  const rAB = pillRect(ivAB.midMs, v, 16, spanAB)
  const rBC = pillRect(ivBC.midMs, v, 16, spanBC)

  // The two hit-rects must not overlap at all.
  expect(rAB.x + rAB.w).toBeLessThanOrEqual(rBC.x)

  // Clicking at bc's own midpoint hits ONLY bc, not ab.
  const bcMidPx = msToPx(v, ivBC.midMs)
  expect(inRect(rBC, bcMidPx, rBC.y + rBC.h / 2)).toBe(true)
  expect(inRect(rAB, bcMidPx, rAB.y + rAB.h / 2)).toBe(false)

  // And clicking at ab's own midpoint hits ONLY ab, not bc.
  const abMidPx = msToPx(v, ivAB.midMs)
  expect(inRect(rAB, abMidPx, rAB.y + rAB.h / 2)).toBe(true)
  expect(inRect(rBC, abMidPx, rBC.y + rBC.h / 2)).toBe(false)
})

test('pillRect spanPx floors width at 12px for very tight intervals', () => {
  const r = pillRect(1000, v, 16, 2) // spanPx=2 → 2-4=-2 → floored to 12
  expect(r.w).toBe(12)
})

describe('niceTickInterval', () => {
  it('picks 1-2-5 series with >=80px major spacing', () => {
    expect(niceTickInterval(10_000, 800).majorMs).toBe(1000) // 1000ms→80px
    expect(niceTickInterval(10_000, 400).majorMs).toBe(2000)
    expect(niceTickInterval(60_000, 800).majorMs).toBe(10_000)
    expect(niceTickInterval(1_000, 800).majorMs).toBe(100)
  })
  it('minor is major/5', () => {
    expect(niceTickInterval(10_000, 800).minorMs).toBe(200)
  })
  it('falls back to a sane default for degenerate 0x0 input instead of looping forever', () => {
    // threshold = 80*0/0 = NaN; the guard must catch this before the loop runs.
    // The test completing (returning) at all is the termination proof.
    expect(niceTickInterval(0, 0)).toEqual({ majorMs: 1000, minorMs: 200 })
  })
  it('returns finite values when widthPx is 0', () => {
    // threshold = 80*10000/0 = Infinity; guard catches widthPx<=0 before the loop.
    const r = niceTickInterval(10_000, 0)
    expect(Number.isFinite(r.majorMs)).toBe(true)
    expect(Number.isFinite(r.minorMs)).toBe(true)
  })
  it('returns finite values when spanMs is negative', () => {
    // threshold = 80*-5/800 = -0.5; guard catches spanMs<=0 before the loop.
    const r = niceTickInterval(-5, 800)
    expect(Number.isFinite(r.majorMs)).toBe(true)
    expect(Number.isFinite(r.minorMs)).toBe(true)
  })
})

describe('snapMs', () => {
  const v2 = { startMs: 0, endMs: 10_000, widthPx: 1000 } // 1px = 10ms
  it('rounds to frame first', () => {
    // 30fps: frame=1000/30=33.333...; 517/33.333=15.51 -> round 16 -> 16*33.333=533.333 -> round 533
    expect(snapMs(517, 30, [], v2)).toBe(533)
  })
  it('magnet wins within tolerance', () => {
    // frame-rounded 1230 -> 1233; |1233-1200|=33ms=3.3px <= 6px tol
    expect(snapMs(1230, 30, [1200], v2)).toBe(1200)
  })
  it('magnet ignored outside tolerance', () => {
    // frame-rounded 1300 -> 1300 (exact); |1300-1200|=100ms=10px > 6px tol
    expect(snapMs(1300, 30, [1200], v2)).not.toBe(1200)
  })
})
