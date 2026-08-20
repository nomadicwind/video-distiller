import { expect, test } from 'vitest'
import { fmtTc, frameOf, frameToSeekTime, stepFrame } from './frames'

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

test('fmtTc formats ms precision', () => {
  expect(fmtTc(0)).toBe('00:00.000')
  expect(fmtTc(21437)).toBe('00:21.437')
  expect(fmtTc(61001)).toBe('01:01.001')
})
