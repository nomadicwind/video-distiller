import { expect, test } from 'vitest'
import { stripPxToMs } from './stripMath'

test('stripW <= 0 collapses to 0', () => {
  expect(stripPxToMs(50, 0, 10_000)).toBe(0)
  expect(stripPxToMs(50, -10, 10_000)).toBe(0)
})

test('px < 0 clamps ratio to 0', () => {
  expect(stripPxToMs(-100, 1000, 10_000)).toBe(0)
})

test('px > stripW clamps ratio to 1 (durationMs)', () => {
  expect(stripPxToMs(5000, 1000, 10_000)).toBe(10_000)
})

test('midpoint px maps to durationMs / 2 (rounded)', () => {
  expect(stripPxToMs(500, 1000, 10_000)).toBe(5000)
  expect(stripPxToMs(500, 1000, 9_999)).toBe(Math.round(9_999 / 2))
})
