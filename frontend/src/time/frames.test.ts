import { expect, test } from 'vitest'
import { clampMs, fmtTc, frameOf, frameRound, frameToSeekTime, stepFrame } from './frames'

test('frameOf rounds to nearest frame', () => {
  expect(frameOf(1000, 30)).toBe(30)
  expect(frameOf(16, 60)).toBe(1)
})

test('frameToSeekTime targets frame midpoint', () => {
  expect(frameToSeekTime(0, 30)).toBeCloseTo(0.5 / 30)
  expect(frameToSeekTime(29, 30)).toBeCloseTo(29.5 / 30)
})

test('stepFrame moves exactly one frame and clamps', () => {
  const t0 = frameToSeekTime(10, 30)
  expect(stepFrame(t0, 30, 1, 60)).toBeCloseTo(frameToSeekTime(11, 30))
  expect(stepFrame(t0, 30, -1, 60)).toBeCloseTo(frameToSeekTime(9, 30))
  expect(stepFrame(0, 30, -1, 60)).toBeCloseTo(frameToSeekTime(0, 30))
})

test('frameRound snaps to the nearest frame-boundary ms', () => {
  const frame = 1000 / 30 // 33.33ms
  expect(frameRound(0, 30)).toBe(0)
  expect(frameRound(frame * 3, 30)).toBeCloseTo(frame * 3)
  expect(frameRound(frame * 3 + 2, 30)).toBeCloseTo(frame * 3) // rounds down within tolerance
  expect(frameRound(frame * 3 + frame / 2 + 1, 30)).toBeCloseTo(frame * 4) // rounds up past the midpoint
})

test('clampMs bounds to [0, durationMs]', () => {
  expect(clampMs(-100, 5000)).toBe(0)
  expect(clampMs(6000, 5000)).toBe(5000)
  expect(clampMs(2500, 5000)).toBe(2500)
})

test('fmtTc formats ms precision', () => {
  expect(fmtTc(0)).toBe('00:00.000')
  expect(fmtTc(21437)).toBe('00:21.437')
  expect(fmtTc(61001)).toBe('01:01.001')
})
