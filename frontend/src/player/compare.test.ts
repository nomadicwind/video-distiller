import { describe, expect, test } from 'vitest'
import { computeOffset, decideResync, followTarget } from './compare'

describe('computeOffset', () => {
  test('rounds a fractional difference down when the fraction is below .5', () => {
    expect(computeOffset(1000, 3000.4)).toBe(2000)
  })

  test('rounds a fractional difference up when the fraction is .5 or above', () => {
    expect(computeOffset(1000, 3000.6)).toBe(2001)
  })

  test('supports a negative offset when B precedes A', () => {
    expect(computeOffset(5000, 2000)).toBe(-3000)
  })

  test('rounds a negative fractional difference to the nearest integer', () => {
    expect(computeOffset(3000.6, 1000)).toBe(-2001) // tB - tA = -2000.6 -> -2001
  })

  test('returns 0 when A and B are at the same instant', () => {
    expect(computeOffset(1500, 1500)).toBe(0)
  })
})

describe('followTarget', () => {
  const durBMs = 5000

  test('tB === 0 is a legal boundary (inRange true, no clamp needed)', () => {
    expect(followTarget(1000, -1000, durBMs)).toEqual({ tBMs: 0, inRange: true })
  })

  test('tB === durB is a legal boundary (inRange true, no clamp needed)', () => {
    expect(followTarget(6000, -1000, durBMs)).toEqual({ tBMs: 5000, inRange: true })
  })

  test('tB === -1 is out of range and clamps to 0', () => {
    expect(followTarget(999, -1000, durBMs)).toEqual({ tBMs: 0, inRange: false })
  })

  test('tB === durB + 1 is out of range and clamps to durB', () => {
    expect(followTarget(6001, -1000, durBMs)).toEqual({ tBMs: 5000, inRange: false })
  })

  test('a mid-range target is legal and passes through unclamped', () => {
    expect(followTarget(2000, 500, durBMs)).toEqual({ tBMs: 2500, inRange: true })
  })
})

describe('decideResync', () => {
  test('drift exactly at the 80ms threshold while playing does not resync', () => {
    expect(decideResync(1000, 1080, true)).toBe('none')
  })

  test('drift of 81ms while playing triggers a resync', () => {
    expect(decideResync(1000, 1081, true)).toBe('resync')
  })

  test('a negative drift is compared by magnitude: -80ms does not resync', () => {
    expect(decideResync(1080, 1000, true)).toBe('none')
  })

  test('a negative drift of -81ms triggers a resync', () => {
    expect(decideResync(1081, 1000, true)).toBe('resync')
  })

  test('paused is always none, regardless of drift magnitude', () => {
    expect(decideResync(1000, 5000, false)).toBe('none')
  })

  test('paused with zero drift is still none', () => {
    expect(decideResync(1000, 1000, false)).toBe('none')
  })
})
