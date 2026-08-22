import { expect, test } from 'vitest'
import { violatesMinGap } from './gap'

const mk = (id: string, t_ms: number): { id: string; t_ms: number } => ({ id, t_ms })

test('empty mark list is always legal', () => {
  expect(violatesMinGap(1000, [], 34)).toBe(false)
})

test('a diff of frameMs-1 violates (sub-frame spacing)', () => {
  const marks = [mk('m1', 1000)]
  expect(violatesMinGap(1000 + 33, marks, 34)).toBe(true)
  expect(violatesMinGap(1000 - 33, marks, 34)).toBe(true)
})

test('a diff of exactly frameMs is legal (matches server ABS < frameMs semantics)', () => {
  const marks = [mk('m1', 1000)]
  expect(violatesMinGap(1000 + 34, marks, 34)).toBe(false)
  expect(violatesMinGap(1000 - 34, marks, 34)).toBe(false)
})

test('excludeId skips the mark being moved, so its own prior position never counts as a conflict', () => {
  const marks = [mk('m1', 1000)]
  // Without exclude, landing back on its own t_ms would violate (diff 0 < 34).
  expect(violatesMinGap(1000, marks, 34)).toBe(true)
  expect(violatesMinGap(1000, marks, 34, 'm1')).toBe(false)
})

test('excludeId only skips the named mark — a genuine neighbor still conflicts', () => {
  const marks = [mk('m1', 1000), mk('m2', 1010)]
  expect(violatesMinGap(1010, marks, 34, 'm1')).toBe(true)
})

test('checks against the nearest of multiple marks, not just the first in the list', () => {
  const marks = [mk('m1', 0), mk('m2', 5000)]
  expect(violatesMinGap(5010, marks, 34)).toBe(true)
  expect(violatesMinGap(2500, marks, 34)).toBe(false)
})
