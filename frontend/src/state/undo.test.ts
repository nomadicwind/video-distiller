import { beforeEach, expect, test, vi } from 'vitest'
import type { AnalysisTree, Mark } from '../api/types'
import { useSession } from './store'

vi.mock('../api/client', () => ({
  api: {
    patchMark: vi.fn((id: string, patch: Record<string, unknown>) =>
      Promise.resolve({
        id, take_id: 'tk_a', t_ms: (patch.t_ms as number) ?? 100,
        end_ms: patch.clear_end ? null : (patch.end_ms as number) ?? null,
        kind: 'input', label: '2', provenance: 'human_edited', confidence: 1,
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
import { _resetForTest, pushUndo, redo, undo } from './undo'

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
