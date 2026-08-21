import { beforeEach, expect, test } from 'vitest'
import type { AnalysisTree, Mark } from '../api/types'
import { currentTake, useSession } from './store'

const tree: AnalysisTree = {
  id: 'an_1', video_id: 'vid_1', name: 'video-1_km-default-v1_a1',
  lanes: [
    { id: 'ln_0', layer: 'L0', takes: [{ id: 'tk_a', idx: 1, marks: [] }, { id: 'tk_b', idx: 2, marks: [] }] },
    { id: 'ln_1', layer: 'L1', takes: [{ id: 'tk_c', idx: 1, marks: [] }] },
  ],
  tally: [],
  keymap_id: null, keymap_version: null,
}
const mark = (id: string, t: number): Mark =>
  ({ id, take_id: 'tk_a', t_ms: t, end_ms: null, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 })

beforeEach(() => useSession.getState().setAnalysis(structuredClone(tree)))

test('setAnalysis selects first lane and its latest take', () => {
  const s = useSession.getState()
  expect(s.laneId).toBe('ln_0')
  expect(s.takeId).toBe('tk_b')
})

test('selectLane switches to its latest take', () => {
  useSession.getState().selectLane('ln_1')
  expect(useSession.getState().takeId).toBe('tk_c')
})

test('insertMarkLocal keeps marks sorted and selects it', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m2', 500))
  s.insertMarkLocal(mark('m1', 100))
  const take = currentTake(useSession.getState())!
  expect(take.marks.map(m => m.id)).toEqual(['m1', 'm2'])
  expect(useSession.getState().selectedMarkId).toBe('m1')
})

test('updateMarkLocal re-sorts after time change', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m1', 100))
  s.insertMarkLocal(mark('m2', 500))
  s.updateMarkLocal({ ...mark('m1', 900) })
  expect(currentTake(useSession.getState())!.marks.map(m => m.id)).toEqual(['m2', 'm1'])
})

test('removeMarkLocal clears selection if selected', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m1', 100))
  s.removeMarkLocal('m1')
  expect(currentTake(useSession.getState())!.marks).toEqual([])
  expect(useSession.getState().selectedMarkId).toBeNull()
})

test('tally local ops keep sorted', () => {
  const s = useSession.getState()
  s.addTallyLocal({ id: 't2', t_ms: 500 })
  s.addTallyLocal({ id: 't1', t_ms: 100 })
  expect(useSession.getState().analysis!.tally.map(t => t.id)).toEqual(['t1', 't2'])
  s.clearTallyLocal()
  expect(useSession.getState().analysis!.tally).toEqual([])
})

test('toggleSnap and toggleHotkeys flip their booleans (default snapOn=true, showHotkeys=false)', () => {
  const s = useSession.getState()
  expect(s.snapOn).toBe(true)
  expect(s.showHotkeys).toBe(false)
  s.toggleSnap()
  expect(useSession.getState().snapOn).toBe(false)
  s.toggleSnap()
  expect(useSession.getState().snapOn).toBe(true)
  s.toggleHotkeys()
  expect(useSession.getState().showHotkeys).toBe(true)
  s.toggleHotkeys()
  expect(useSession.getState().showHotkeys).toBe(false)
})

test('clearAnalysis resets the session window to its empty state', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m1', 100))
  s.setPlayhead(1234)
  s.toggleAggregate()
  s.clearAnalysis()
  const after = useSession.getState()
  expect(after.analysis).toBeNull()
  expect(after.laneId).toBeNull()
  expect(after.takeId).toBeNull()
  expect(after.selectedMarkId).toBeNull()
  expect(after.playheadMs).toBe(0)
  expect(after.showAggregate).toBe(false)
})
