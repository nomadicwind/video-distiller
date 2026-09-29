import { expect, test } from 'vitest'
import { blocksToPattern, patternToBlocks, type Block } from './patternBlocks'

test('blocksToPattern: tap/gap/hold blocks map 1:1 to PatternItem shape', () => {
  const blocks: Block[] = [
    { op: 'tap', key: 'Q' },
    { op: 'gap', ms: 300, tol_ms: 80 },
    { op: 'hold', button: 'LMB', ms: 300 },
  ]
  expect(blocksToPattern(blocks)).toEqual([
    { op: 'tap', key: 'Q' },
    { op: 'gap', ms: 300, tol_ms: 80 },
    { op: 'hold', button: 'LMB', ms: 300 },
  ])
})

test('patternToBlocks: supported pattern (tap/gap/hold only) round-trips losslessly', () => {
  const pattern = [
    { op: 'tap' as const, key: 'Q' },
    { op: 'gap' as const, ms: 300, tol_ms: 80 },
    { op: 'hold' as const, button: 'LMB', ms: 300 },
  ]
  const result = patternToBlocks(pattern)
  expect(result.supported).toBe(true)
  if (result.supported) {
    expect(result.blocks).toEqual(pattern)
    expect(blocksToPattern(result.blocks)).toEqual(pattern)
  }
})

test('patternToBlocks: hold with key instead of button is preserved', () => {
  const pattern = [{ op: 'hold' as const, key: 'Space', ms: 500, tol_ms: 50 }]
  const result = patternToBlocks(pattern)
  expect(result).toEqual({ supported: true, blocks: pattern })
})

test('patternToBlocks: empty pattern is trivially supported with no blocks', () => {
  expect(patternToBlocks([])).toEqual({ supported: true, blocks: [] })
})

test('patternToBlocks: a skill-ref op falls back to unsupported (JSON-advanced only)', () => {
  expect(patternToBlocks([
    { op: 'tap', key: 'Q' },
    { op: 'skill', ref: 'sk_xxx' },
  ])).toEqual({ supported: false })
})

test('patternToBlocks: chord/wheel ops also fall back to unsupported', () => {
  expect(patternToBlocks([{ op: 'chord', keys: ['Ctrl', 'Q'] }])).toEqual({ supported: false })
  expect(patternToBlocks([{ op: 'wheel', button: 'MWheelUp' }])).toEqual({ supported: false })
})

test('patternToBlocks: a tap item missing key falls back to unsupported', () => {
  expect(patternToBlocks([{ op: 'tap' }])).toEqual({ supported: false })
})

test('patternToBlocks: a gap item missing ms falls back to unsupported', () => {
  expect(patternToBlocks([{ op: 'gap' }])).toEqual({ supported: false })
})
