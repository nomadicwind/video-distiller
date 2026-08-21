import { describe, expect, it } from 'vitest'
import { decidePlayheadAction } from './Player'

// M7 final review fix: audition (one-shot explicit intent) must win over the
// ambient AB loop for its whole window, even when that window crosses past B.
describe('decidePlayheadAction', () => {
  const loopOn = { on: true, aMs: 1000, bMs: 2000 }
  const loopOff = { on: false, aMs: 1000, bMs: 2000 }
  const loopIncomplete = { on: true, aMs: 1000, bMs: null }

  it('audition pending + ms >= end -> audition-pause even when ms > bMs', () => {
    expect(decidePlayheadAction(2500, loopOn, 2400)).toBe('audition-pause')
  })

  it('audition pending + ms < end -> null even when ms > bMs (loop suppressed)', () => {
    expect(decidePlayheadAction(2200, loopOn, 2400)).toBeNull()
  })

  it('no audition + loop on + ms > b -> loop-seek', () => {
    expect(decidePlayheadAction(2100, loopOn, null)).toBe('loop-seek')
  })

  it('no audition + loop incomplete (bMs null) -> null', () => {
    expect(decidePlayheadAction(2100, loopIncomplete, null)).toBeNull()
  })

  it('no audition + loop off -> null', () => {
    expect(decidePlayheadAction(2100, loopOff, null)).toBeNull()
  })

  it('no audition + loop on + ms <= b -> null', () => {
    expect(decidePlayheadAction(1500, loopOn, null)).toBeNull()
  })
})
