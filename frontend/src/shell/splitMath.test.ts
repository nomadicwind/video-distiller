import { expect, test } from 'vitest'
import { clampTlHeight } from './splitMath'

test('below min clamps to 180', () => {
  expect(clampTlHeight(50, 1000)).toBe(180)
  expect(clampTlHeight(0, 1000)).toBe(180)
  expect(clampTlHeight(-40, 1000)).toBe(180)
})

test('above max clamps to viewportH - 320', () => {
  expect(clampTlHeight(2000, 1000)).toBe(680)
})

test('within range rounds through', () => {
  expect(clampTlHeight(400.4, 1000)).toBe(400)
  expect(clampTlHeight(400.6, 1000)).toBe(401)
})

test('very small viewportH (max < min) clamps to min', () => {
  expect(clampTlHeight(300, 400)).toBe(180)
  expect(clampTlHeight(180, 400)).toBe(180)
})
