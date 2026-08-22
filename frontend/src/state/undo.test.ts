import { beforeEach, expect, test, vi } from 'vitest'
import type { AnalysisTree, Mark } from '../api/types'
import { useSession } from './store'

vi.mock('../api/client', () => ({
  api: {
    patchMark: vi.fn((id: string, patch: Record<string, unknown>) =>
      Promise.resolve({
        id, take_id: 'tk_a', t_ms: (patch.t_ms as number) ?? 100,
        end_ms: patch.clear_end ? null : (patch.end_ms as number) ?? null,
        kind: 'input',
        // 'label' in patch (not just `patch.label ?? '2'`) so an explicit
        // `null` (relabel's inverse patching back to a mark whose original
        // label was null) isn't mistaken for "not provided" and defaulted.
        label: 'label' in patch ? (patch.label as string | null) : '2',
        provenance: 'human_edited', confidence: 1,
      } satisfies Mark)),
    deleteMark: vi.fn(() => Promise.resolve({ ok: true })),
    newMark: vi.fn((takeId: string, m: Record<string, unknown>) =>
      Promise.resolve({
        id: 'mk_new', take_id: takeId, t_ms: m.t_ms as number,
        end_ms: (m.end_ms as number | null) ?? null,
        kind: m.kind as 'input' | 'release', label: (m.label as string | null) ?? null,
        provenance: 'human_manual', confidence: 1,
      } satisfies Mark)),
  },
}))

import { api } from '../api/client'
import { _debugStacks, _resetForTest, pushUndo, redo, undo } from './undo'

const tree: AnalysisTree = {
  id: 'an_1', video_id: 'v', name: 'n', tally: [],
  lanes: [{
    id: 'ln_0', layer: 'L0',
    takes: [{
      id: 'tk_a', idx: 1,
      marks: [{ id: 'm1', take_id: 'tk_a', t_ms: 100, end_ms: null, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 }],
    }],
  }],
  keymap_id: null, keymap_version: null,
  compare_video_id: null, compare_offset_ms: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTest()
  useSession.getState().setAnalysis(structuredClone(tree))
})

test('undo/redo on empty stacks return false', async () => {
  expect(await undo()).toBe(false)
  expect(await redo()).toBe(false)
})

test('insert entry: undo deletes the mark, redo reinserts it', async () => {
  pushUndo({ kind: 'insert', markId: 'm1' })

  expect(await undo()).toBe(true)
  expect(api.deleteMark).toHaveBeenCalledWith('m1')
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks).toEqual([])

  expect(await redo()).toBe(true)
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 100, kind: 'input', label: '2', end_ms: null })
  const marks = useSession.getState().analysis!.lanes[0].takes[0].marks
  expect(marks.some(m => m.id === 'mk_new')).toBe(true)
  expect(marks.some(m => m.id === 'm1')).toBe(false)
})

test('delete entry: undo reinserts the mark, redo deletes it again', async () => {
  pushUndo({
    kind: 'delete', takeId: 'tk_a', markId: 'm1',
    snapshot: { t_ms: 100, end_ms: null, kind: 'input', label: '2' },
  })
  // Mirrors deleteSelected(): the mark is already gone from the store by the
  // time the entry sits on the stack.
  useSession.getState().removeMarkLocal('m1')

  expect(await undo()).toBe(true)
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 100, kind: 'input', label: '2', end_ms: null })
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks.some(m => m.id === 'mk_new')).toBe(true)

  expect(await redo()).toBe(true)
  expect(api.deleteMark).toHaveBeenCalledWith('mk_new')
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks).toEqual([])
})

test('move entry: undo patches back to fromTMs, redo patches forward to toTMs', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 150 })

  expect(await undo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 100 })

  expect(await redo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 150 })
})

test('move entry inverse also carries a holder mark along (mirrors applyMarkMove)', async () => {
  const withHold: AnalysisTree = structuredClone(tree)
  withHold.lanes[0].takes[0].marks = [
    { id: 'm1', take_id: 'tk_a', t_ms: 100, end_ms: 340, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 },
    { id: 'm2', take_id: 'tk_a', t_ms: 340, end_ms: null, kind: 'input', label: '3', provenance: 'human_manual', confidence: 1 },
  ]
  useSession.getState().setAnalysis(withHold)
  // Simulates the forward move having already happened: m2 moved 300 -> 340,
  // and m1 (which held until m2) was carried along to end_ms: 340.
  pushUndo({ kind: 'move', markId: 'm2', fromTMs: 300, toTMs: 340 })

  expect(await undo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m2', { t_ms: 300 })
  expect(api.patchMark).toHaveBeenCalledWith('m1', { end_ms: 300 })
})

test('holding entry: undo applies the inverse patch, redo re-applies the original patch', async () => {
  pushUndo({ kind: 'holding', markId: 'm1', patch: { end_ms: 400 }, inverse: { clear_end: true } })

  expect(await undo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { clear_end: true })

  expect(await redo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { end_ms: 400 })
})

test('relabel entry: undo patches back to fromLabel, redo patches forward to toLabel', async () => {
  pushUndo({ kind: 'relabel', markId: 'm1', fromLabel: '2', toLabel: 'Q' })

  expect(await undo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { label: '2' })
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks[0].label).toBe('2')

  expect(await redo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { label: 'Q' })
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks[0].label).toBe('Q')
})

// A release ('空标记') mark's original label is null — the inverse patch
// must send an explicit `{ label: null }`, not silently skip the field.
test('relabel entry: fromLabel of null patches back to null', async () => {
  pushUndo({ kind: 'relabel', markId: 'm1', fromLabel: null, toLabel: 'Q' })

  expect(await undo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { label: null })
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks[0].label).toBeNull()
})

test('pushUndo clears the redo stack', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 110 })
  await undo() // redo stack now holds one entry

  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 999 }) // fresh action clears redo
  expect(await redo()).toBe(false)
})

test('undo stack caps at 100 entries, dropping the oldest', async () => {
  for (let i = 0; i < 101; i++) pushUndo({ kind: 'move', markId: 'm1', fromTMs: i, toTMs: i + 1 })

  let successes = 0
  for (let i = 0; i < 101; i++) {
    if (await undo()) successes++
  }
  expect(successes).toBe(100)
  expect(await undo()).toBe(false)
  // Positively confirm the oldest entry (i=0, fromTMs=0) was evicted, not
  // merely that the count landed at 100 by coincidence: its distinctive
  // patchMark call must never have fired among the 100 undos above.
  expect(api.patchMark).not.toHaveBeenCalledWith('m1', { t_ms: 0 })
})

test('delete -> undo reinsert rewrites the old mark id to the new id across both stacks', async () => {
  // A move recorded on m1 before it was deleted — still below the delete
  // entry once it's pushed.
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 })
  pushUndo({
    kind: 'delete', takeId: 'tk_a', markId: 'm1',
    snapshot: { t_ms: 100, end_ms: null, kind: 'input', label: '2' },
  })
  useSession.getState().removeMarkLocal('m1')

  expect(await undo()).toBe(true) // undoes delete -> reinserts as 'mk_new', rewrites the move entry below
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 100, kind: 'input', label: '2', end_ms: null })

  vi.clearAllMocks()
  expect(await undo()).toBe(true) // now undoes the rewritten move entry
  expect(api.patchMark).toHaveBeenCalledWith('mk_new', { t_ms: 50 })
  expect(api.patchMark).not.toHaveBeenCalledWith('m1', expect.anything())
})

test('id rewrite also reaches a stale entry sitting in the REDO stack', async () => {
  // Build up: insert m1, then move it, then undo the move (parking a 'move'
  // entry on the redo stack), then undo the insert too (deleting m1, which
  // pushes a 'delete' entry onto the redo stack above the parked move).
  pushUndo({ kind: 'insert', markId: 'm1' })
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 })

  expect(await undo()).toBe(true) // undoes the move -> redo stack: [move(m1)]
  expect(await undo()).toBe(true) // undoes the insert (deletes m1) -> redo stack: [move(m1), delete(m1)]

  expect(await redo()).toBe(true) // redoes the delete -> reinserts as 'mk_new'; must rewrite the parked move(m1) too
  // The first undo() already patched m1's t_ms down to 50 (the move's
  // fromTMs), so that's the live value the second undo() (of the insert)
  // snapshots before deleting it.
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 50, kind: 'input', label: '2', end_ms: null })

  vi.clearAllMocks()
  expect(await redo()).toBe(true) // redoes the (rewritten) move entry
  expect(api.patchMark).toHaveBeenCalledWith('mk_new', { t_ms: 100 })
  expect(api.patchMark).not.toHaveBeenCalledWith('m1', expect.anything())
})

test('delete entry with a holder: undo restores BOTH the reinserted mark and the holder end_ms; redo re-clears it', async () => {
  const withHold: AnalysisTree = structuredClone(tree)
  withHold.lanes[0].takes[0].marks = [
    { id: 'm1', take_id: 'tk_a', t_ms: 50, end_ms: 100, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 },
    { id: 'm2', take_id: 'tk_a', t_ms: 100, end_ms: null, kind: 'input', label: '3', provenance: 'human_manual', confidence: 1 },
  ]
  useSession.getState().setAnalysis(withHold)

  // Mirrors deleteSelected(): m1 holds until m2 (m1.end_ms === m2.t_ms), so
  // deleting m2 clears m1's hold first — both mutations must be captured.
  useSession.getState().updateMarkLocal({ ...withHold.lanes[0].takes[0].marks[0], end_ms: null })
  useSession.getState().removeMarkLocal('m2')
  pushUndo({
    kind: 'delete', takeId: 'tk_a', markId: 'm2',
    snapshot: { t_ms: 100, end_ms: null, kind: 'input', label: '3' },
    holder: { markId: 'm1', endMs: 100 },
  })

  expect(await undo()).toBe(true)
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 100, kind: 'input', label: '3', end_ms: null })
  expect(api.patchMark).toHaveBeenCalledWith('m1', { end_ms: 100 })
  const afterUndo = useSession.getState().analysis!.lanes[0].takes[0].marks
  expect(afterUndo.some(m => m.id === 'mk_new')).toBe(true)
  expect(afterUndo.find(m => m.id === 'm1')!.end_ms).toBe(100)

  vi.clearAllMocks()
  expect(await redo()).toBe(true)
  expect(api.deleteMark).toHaveBeenCalledWith('mk_new')
  expect(api.patchMark).toHaveBeenCalledWith('m1', { clear_end: true })
})

test('undo of insert/holding no-ops safely when the mark is missing from the current analysis (no api calls fire)', async () => {
  pushUndo({ kind: 'insert', markId: 'ghost' })
  expect(await undo()).toBe(true) // stack wasn't empty, but there was nothing to act on
  expect(api.deleteMark).not.toHaveBeenCalled()

  pushUndo({ kind: 'holding', markId: 'ghost', patch: { end_ms: 400 }, inverse: { clear_end: true } })
  expect(await undo()).toBe(true)
  expect(api.patchMark).not.toHaveBeenCalled()

  pushUndo({ kind: 'relabel', markId: 'ghost', fromLabel: '2', toLabel: 'Q' })
  expect(await undo()).toBe(true)
  expect(api.patchMark).not.toHaveBeenCalled()
})

test('switching to a different analysis clears both stacks', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 110 })
  await undo() // populate the redo stack too, to prove both get cleared

  useSession.getState().setAnalysis({ ...structuredClone(tree), id: 'an_2' })

  expect(await undo()).toBe(false)
  expect(await redo()).toBe(false)
})

test('clearing the analysis also clears both stacks', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 110 })
  useSession.getState().clearAnalysis()
  expect(await undo()).toBe(false)
})

// Round 1 review hardening: a mid-flight applyInverse failure (e.g. the
// server's own min-gap check 400ing a restore that's since become sub-frame-
// adjacent to another mark) must not silently drop the popped entry from
// both stacks. It should land back on the stack it was popped from, undo()/
// redo() should report false, and a distinct hint (not just the generic
// error-store toast api.ts's j() already pushed) should tell the user their
// undo/redo didn't take effect.
test('undo restores the popped entry to undoStack when applyInverse throws, and sets a distinct hint', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 })
  vi.mocked(api.patchMark).mockRejectedValueOnce(new Error('API 400: 与相邻标记距离过近（同一帧内）'))

  expect(await undo()).toBe(false)
  expect(useSession.getState().hintText).toBe('撤销失败：目标位置已不合法')
  expect(_debugStacks()).toEqual({
    undo: [{ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 }],
    redo: [],
  })

  // And it's genuinely retryable — a subsequent undo() (mock no longer
  // rejecting) succeeds exactly as if the failed attempt never happened.
  expect(await undo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 50 })
  expect(_debugStacks()).toEqual({
    undo: [],
    redo: [{ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 50 }],
  })
})

test('redo restores the popped entry to redoStack when applyInverse throws, and sets a distinct hint', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 })
  expect(await undo()).toBe(true) // redoStack now holds move(fromTMs:100, toTMs:50)
  vi.clearAllMocks()

  vi.mocked(api.patchMark).mockRejectedValueOnce(new Error('API 400: 与相邻标记距离过近（同一帧内）'))
  expect(await redo()).toBe(false)
  expect(useSession.getState().hintText).toBe('重做失败：目标位置已不合法')
  expect(_debugStacks()).toEqual({
    undo: [],
    redo: [{ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 50 }],
  })

  expect(await redo()).toBe(true)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 100 })
})

test('a failed undo() still releases the busy guard (finally runs) so a subsequent call is not spuriously blocked', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 })
  vi.mocked(api.patchMark).mockRejectedValueOnce(new Error('API 400'))
  expect(await undo()).toBe(false)
  // If `busy` were left true, this would return false too even though the
  // mock now resolves normally.
  expect(await undo()).toBe(true)
})

test('concurrent undo() calls are serialized: the overlapping call no-ops while the first is in flight', async () => {
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 100, toTMs: 110 })
  pushUndo({ kind: 'move', markId: 'm1', fromTMs: 50, toTMs: 100 })

  const [r1, r2] = await Promise.all([undo(), undo()])
  expect([r1, r2].sort()).toEqual([false, true])
  expect(api.patchMark).toHaveBeenCalledTimes(1)
})
