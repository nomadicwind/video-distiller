import { expect, test } from 'vitest'
import { coverageOf } from './readiness'

test('no labels -> nothing covered, nothing uncovered', () => {
  expect(coverageOf([], { sk_a: ['Q'] })).toEqual({ covered: [], uncovered: [] })
})

test('label present in some skill bind list -> covered', () => {
  expect(coverageOf(['Q'], { sk_a: ['Q', 'Shift+2'] })).toEqual({ covered: ['Q'], uncovered: [] })
})

test('label absent from every bind list -> uncovered', () => {
  expect(coverageOf(['Q'], { sk_a: ['W'] })).toEqual({ covered: [], uncovered: ['Q'] })
})

test('mixed covered/uncovered labels split correctly, preserving input order', () => {
  expect(coverageOf(['Q', 'W', 'Shift+2'], { sk_a: ['Q'], sk_b: ['Shift+2'] }))
    .toEqual({ covered: ['Q', 'Shift+2'], uncovered: ['W'] })
})

test('duplicate labels in input are de-duplicated in the result', () => {
  expect(coverageOf(['Q', 'Q', 'W'], { sk_a: ['Q'] })).toEqual({ covered: ['Q'], uncovered: ['W'] })
})

test('a label covered by ANY skill\'s bind list counts, not just the first', () => {
  expect(coverageOf(['E'], { sk_a: ['Q'], sk_b: ['E'] })).toEqual({ covered: ['E'], uncovered: [] })
})

test('empty binds object -> every label uncovered', () => {
  expect(coverageOf(['Q', 'W'], {})).toEqual({ covered: [], uncovered: ['Q', 'W'] })
})
