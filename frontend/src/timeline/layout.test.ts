import { expect, test } from 'vitest'
import {
  checkboxRect, hitTestMark, holdingPatch, inRect, intervals,
  msToPx, panned, pxToMs, zoomed, type MarkLite, type Viewport,
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

test('checkboxRect hit', () => {
  const r = checkboxRect(250, v, 16)
  expect(inRect(r, msToPx(v, 250), 16 + 64 / 2 + 15)).toBe(true)
  expect(inRect(r, msToPx(v, 250) + 50, r.y + 5)).toBe(false)
})
