import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
  compare_video_id: null, compare_offset_ms: null,
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

test('setLoopA/setLoopB set independent endpoints', () => {
  const s = useSession.getState()
  s.setLoopA(1000)
  s.setLoopB(3000)
  expect(useSession.getState().abLoop).toEqual({ aMs: 1000, bMs: 3000, on: false })
})

// Round 1 review: I (setLoopA) had no ordering guard, so setting A at/after
// an existing B produced an inverted range that froze playback (Player's
// loop-check re-seeks to A every frame since ms>bMs is permanently true).
// The guard now lives in the store so every entry point is safe by
// construction, not just the hotkeys.ts I/O branches.
test('setLoopA rejects a>=b when a bMs already exists, leaving state unchanged', () => {
  const s = useSession.getState()
  s.setLoopB(2000)
  expect(s.setLoopA(2000)).toBe(false) // a === b: still invalid, not just a > b
  expect(useSession.getState().abLoop).toEqual({ aMs: null, bMs: 2000, on: false })
  expect(s.setLoopA(5000)).toBe(false) // a > b
  expect(useSession.getState().abLoop).toEqual({ aMs: null, bMs: 2000, on: false })
  expect(s.setLoopA(1000)).toBe(true) // a < b: valid
  expect(useSession.getState().abLoop.aMs).toBe(1000)
})

test('setLoopB rejects b<=a when an aMs already exists, leaving state unchanged', () => {
  const s = useSession.getState()
  s.setLoopA(2000)
  expect(s.setLoopB(2000)).toBe(false)
  expect(useSession.getState().abLoop).toEqual({ aMs: 2000, bMs: null, on: false })
  expect(s.setLoopB(500)).toBe(false)
  expect(useSession.getState().abLoop).toEqual({ aMs: 2000, bMs: null, on: false })
  expect(s.setLoopB(3000)).toBe(true)
  expect(useSession.getState().abLoop.bMs).toBe(3000)
})

test('setLoopA/setLoopB always accept null (clear), even with the other endpoint set', () => {
  const s = useSession.getState()
  s.setLoopA(1000)
  s.setLoopB(3000)
  expect(s.setLoopA(null)).toBe(true)
  expect(useSession.getState().abLoop.aMs).toBeNull()
})

// Defensive/belt-and-braces (round 1 review): even though the setters above
// make an inverted range unreachable through normal use, toggleLoop refuses
// to arm the loop if it's ever handed one anyway (e.g. a forced setState in
// a test, or a future code path that bypasses the setters).
test('toggleLoop refuses to turn on an inverted (aMs>=bMs) range', () => {
  useSession.setState({ abLoop: { aMs: 5000, bMs: 2000, on: false } })
  useSession.getState().toggleLoop()
  expect(useSession.getState().abLoop.on).toBe(false)
  // Turning off, though, is always allowed even from a (forced) inverted+on state.
  useSession.setState({ abLoop: { aMs: 5000, bMs: 2000, on: true } })
  useSession.getState().toggleLoop()
  expect(useSession.getState().abLoop.on).toBe(false)
})

test('toggleLoop only takes effect once both endpoints are set', () => {
  const s = useSession.getState()
  s.setLoopA(1000)
  s.toggleLoop()
  expect(useSession.getState().abLoop.on).toBe(false) // guarded: bMs still null
  s.setLoopB(3000)
  s.toggleLoop()
  expect(useSession.getState().abLoop.on).toBe(true)
  s.toggleLoop()
  expect(useSession.getState().abLoop.on).toBe(false)
})

test('clearLoop resets both endpoints and the switch', () => {
  const s = useSession.getState()
  s.setLoopA(1000)
  s.setLoopB(3000)
  s.toggleLoop()
  s.clearLoop()
  expect(useSession.getState().abLoop).toEqual({ aMs: null, bMs: null, on: false })
})

test('setAnalysis and clearAnalysis both reset an in-progress A-B loop', () => {
  const s = useSession.getState()
  s.setLoopA(1000)
  s.setLoopB(3000)
  s.clearAnalysis()
  expect(useSession.getState().abLoop).toEqual({ aMs: null, bMs: null, on: false })

  s.setLoopA(1000)
  s.setLoopB(3000)
  s.setAnalysis(structuredClone(tree))
  expect(useSession.getState().abLoop).toEqual({ aMs: null, bMs: null, on: false })
})

test('setHintText sets the transient hint and auto-clears it after 3s', () => {
  vi.useFakeTimers()
  try {
    const s = useSession.getState()
    s.setHintText('出点须在入点之后')
    expect(useSession.getState().hintText).toBe('出点须在入点之后')
    vi.advanceTimersByTime(2999)
    expect(useSession.getState().hintText).toBe('出点须在入点之后')
    vi.advanceTimersByTime(1)
    expect(useSession.getState().hintText).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('setHintText restarts the 3s countdown when called again before it elapses', () => {
  vi.useFakeTimers()
  try {
    const s = useSession.getState()
    s.setHintText('first')
    vi.advanceTimersByTime(2000)
    s.setHintText('second')
    vi.advanceTimersByTime(2000)
    expect(useSession.getState().hintText).toBe('second') // first's timer must not fire early
    vi.advanceTimersByTime(1000)
    expect(useSession.getState().hintText).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

// M7 任务 3: toggleRefLines / flashMarks / lastEntry.

test('toggleRefLines flips refLinesOn (default false)', () => {
  expect(useSession.getState().refLinesOn).toBe(false)
  useSession.getState().toggleRefLines()
  expect(useSession.getState().refLinesOn).toBe(true)
  useSession.getState().toggleRefLines()
  expect(useSession.getState().refLinesOn).toBe(false)
})

test('insertMarkLocal stamps flashMarks with bornAt and lazily prunes entries older than 1s', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(0)
    const s = useSession.getState()
    s.selectTake('tk_a')
    s.insertMarkLocal(mark('m1', 100))
    expect(useSession.getState().flashMarks).toEqual({ m1: 0 })

    vi.setSystemTime(500)
    s.insertMarkLocal(mark('m2', 200))
    // m1 is only 500ms old here — still inside the 1s window, so it must survive this prune pass.
    expect(useSession.getState().flashMarks).toEqual({ m1: 0, m2: 500 })

    vi.setSystemTime(1600)
    s.insertMarkLocal(mark('m3', 300))
    // m1 (1600ms old) and m2 (1100ms old) are both past the 1s window now; only the fresh m3 remains.
    expect(useSession.getState().flashMarks).toEqual({ m3: 1600 })
  } finally {
    vi.useRealTimers()
  }
})

test('recordEntry increments a per-take counter on lastEntry, independent of label', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  expect(useSession.getState().lastEntry).toBeNull()
  s.recordEntry('Q')
  expect(useSession.getState().lastEntry).toEqual({ label: 'Q', count: 1 })
  s.recordEntry('W') // a different label still bumps the same running count
  expect(useSession.getState().lastEntry).toEqual({ label: 'W', count: 2 })
})

// Brief §要点: "count = 当前 take 本会话插入计数...切 take 归零" — every path
// that changes which take is "current" must reset lastEntry back to null so
// the next recordEntry starts counting from 1 again, not carry over a count
// that belongs to a take/video no longer in view.
test('lastEntry resets to null on selectTake/selectLane/addTakeLocal/setAnalysis/clearAnalysis', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.recordEntry('Q')
  s.selectTake('tk_b')
  expect(useSession.getState().lastEntry).toBeNull()

  s.recordEntry('W')
  s.selectLane('ln_1')
  expect(useSession.getState().lastEntry).toBeNull()

  s.selectLane('ln_0')
  s.recordEntry('E')
  s.addTakeLocal('ln_0', { id: 'tk_new', idx: 3, marks: [] })
  expect(useSession.getState().lastEntry).toBeNull()

  s.recordEntry('R')
  s.setAnalysis(structuredClone(tree))
  expect(useSession.getState().lastEntry).toBeNull()

  s.recordEntry('F')
  s.clearAnalysis()
  expect(useSession.getState().lastEntry).toBeNull()
})

// M9 任务 2: frameMs backs the client-side min-gap precheck (entry/gap.ts,
// actions.ts). It defaults to 34 before Workbench has had a chance to derive
// the real per-video value from fps (App.tsx's mount effect calls
// setFrameMs(Math.round(1000/(video.fps??30)))), and — unlike lastEntry
// above — must NOT be reset by setAnalysis/clearAnalysis: those fire on
// every video switch, but Workbench's mount effect (which owns setFrameMs)
// runs independently and would otherwise race a reset back to the stale
// default.
test('frameMs defaults to 34 and setFrameMs updates it', () => {
  expect(useSession.getState().frameMs).toBe(34)
  useSession.getState().setFrameMs(33)
  expect(useSession.getState().frameMs).toBe(33)
})

test('frameMs survives setAnalysis and clearAnalysis (not video-scoped like lastEntry)', () => {
  useSession.getState().setFrameMs(50)
  useSession.getState().setAnalysis(structuredClone(tree))
  expect(useSession.getState().frameMs).toBe(50)
  useSession.getState().clearAnalysis()
  expect(useSession.getState().frameMs).toBe(50)
})

// M12 任务 2: 对比模式字段初始化/复位路径。

test('setAnalysis with no compare config leaves compare state at its empty defaults', () => {
  const s = useSession.getState()
  expect(s.compareVideoId).toBeNull()
  expect(s.compareOffsetMs).toBe(0)
  expect(s.compareOn).toBe(false)
  expect(s.calibrating).toBe(false)
})

test('setAnalysis with a compare config present initializes compareOn=true from analysis.compare_*', () => {
  const s = useSession.getState()
  // Different id from beforeEach's fixture — a genuine video switch, not a
  // same-id refetch (see the two tests below for that distinction).
  s.setAnalysis(structuredClone({ ...tree, id: 'an_2', compare_video_id: 'vid_2', compare_offset_ms: 1500 }))
  const after = useSession.getState()
  expect(after.compareVideoId).toBe('vid_2')
  expect(after.compareOffsetMs).toBe(1500)
  expect(after.compareOn).toBe(true)
})

test('setAnalysis resets calibrating to false even mid-calibration on the previous video', () => {
  const s = useSession.getState()
  s.setCalibrating(true)
  s.setAnalysis(structuredClone(tree))
  expect(useSession.getState().calibrating).toBe(false)
})

test('clearAnalysis resets all four compare fields regardless of prior state', () => {
  const s = useSession.getState()
  s.setCompareConfig('vid_2', 2000)
  s.setCalibrating(true)
  s.clearAnalysis()
  const after = useSession.getState()
  expect(after.compareVideoId).toBeNull()
  expect(after.compareOffsetMs).toBe(0)
  expect(after.compareOn).toBe(false)
  expect(after.calibrating).toBe(false)
})

test('setCompareConfig sets videoId/offset, forces compareOn=true, and mirrors into analysis.compare_*', () => {
  const s = useSession.getState()
  s.setCompareConfig('vid_2', -3000)
  const after = useSession.getState()
  expect(after.compareVideoId).toBe('vid_2')
  expect(after.compareOffsetMs).toBe(-3000)
  expect(after.compareOn).toBe(true)
  expect(after.analysis!.compare_video_id).toBe('vid_2')
  expect(after.analysis!.compare_offset_ms).toBe(-3000)
})

test('clearCompareConfig resets fields and clears analysis.compare_* back to null', () => {
  const s = useSession.getState()
  s.setCompareConfig('vid_2', 500)
  s.clearCompareConfig()
  const after = useSession.getState()
  expect(after.compareVideoId).toBeNull()
  expect(after.compareOffsetMs).toBe(0)
  expect(after.compareOn).toBe(false)
  expect(after.analysis!.compare_video_id).toBeNull()
  expect(after.analysis!.compare_offset_ms).toBeNull()
})

test('toggleCompareOn refuses to turn on without a compareVideoId, but off always succeeds', () => {
  const s = useSession.getState()
  s.toggleCompareOn()
  expect(useSession.getState().compareOn).toBe(false) // guarded: no config yet
  s.setCompareConfig('vid_2', 0)
  expect(useSession.getState().compareOn).toBe(true) // setCompareConfig already turned it on
  s.toggleCompareOn()
  expect(useSession.getState().compareOn).toBe(false) // off always allowed
  s.toggleCompareOn()
  expect(useSession.getState().compareOn).toBe(true) // config now exists, on is allowed again
})

test('setAnalysis with the SAME analysis id (a refetch) preserves a manually-toggled-off compareOn', () => {
  const s = useSession.getState()
  // Establish a fresh analysis (different id from beforeEach's fixture — a
  // genuine video switch) with a compare config already on the tree, then
  // the user turns compareOn off in this session.
  s.setAnalysis(structuredClone({ ...tree, id: 'an_2', compare_video_id: 'vid_2', compare_offset_ms: 1500 }))
  expect(useSession.getState().compareOn).toBe(true)
  s.toggleCompareOn()
  expect(useSession.getState().compareOn).toBe(false)
  // A refetch of the SAME analysis id (e.g. keymap rebind's
  // getAnalysis().then(setAnalysis)) with the same compare config must not
  // silently flip compareOn back on.
  s.setAnalysis(structuredClone({ ...tree, id: 'an_2', compare_video_id: 'vid_2', compare_offset_ms: 1500 }))
  const after = useSession.getState()
  expect(after.compareOn).toBe(false)
  expect(after.compareVideoId).toBe('vid_2')
  expect(after.compareOffsetMs).toBe(1500)
})

test('setAnalysis with a DIFFERENT analysis id still re-derives compareOn from the new tree', () => {
  const s = useSession.getState()
  s.setAnalysis(structuredClone({ ...tree, id: 'an_2', compare_video_id: 'vid_2', compare_offset_ms: 1500 }))
  expect(useSession.getState().compareOn).toBe(true)
  s.toggleCompareOn()
  expect(useSession.getState().compareOn).toBe(false)
  s.setAnalysis(structuredClone({ ...tree, id: 'an_3', compare_video_id: 'vid_3', compare_offset_ms: 0 }))
  const after = useSession.getState()
  expect(after.compareOn).toBe(true) // genuine switch: re-derived from the new tree's config
  expect(after.compareVideoId).toBe('vid_3')
})

test('setCalibrating flips the flag independently of compare config', () => {
  const s = useSession.getState()
  expect(s.calibrating).toBe(false)
  s.setCalibrating(true)
  expect(useSession.getState().calibrating).toBe(true)
  s.setCalibrating(false)
  expect(useSession.getState().calibrating).toBe(false)
})

afterEach(() => useSession.getState().setHintText(null))
