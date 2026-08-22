import { beforeEach, expect, test, vi } from 'vitest'
import type { AnalysisTree, Mark } from './api/types'
import { useSession } from './state/store'

vi.mock('./api/client', () => ({
  api: {
    patchMark: vi.fn((id: string, patch: Record<string, unknown>) =>
      Promise.resolve({
        id, take_id: 'tk_a', t_ms: (patch.t_ms as number) ?? 100,
        end_ms: patch.clear_end ? null : (patch.end_ms as number) ?? null,
        kind: 'input',
        label: 'label' in patch ? (patch.label as string | null) : '2',
        provenance: 'human_edited', confidence: 1,
      } satisfies Mark)),
    deleteMark: vi.fn(() => Promise.resolve({ ok: true })),
    newMark: vi.fn((takeId: string, m: Record<string, unknown>) =>
      Promise.resolve({
        id: 'mk_new', take_id: takeId, t_ms: m.t_ms as number, end_ms: null,
        kind: m.kind as 'input' | 'release', label: (m.label as string) ?? null,
        provenance: 'human_manual', confidence: 1,
      } satisfies Mark)),
    addTally: vi.fn((analysisId: string, t_ms: number) =>
      Promise.resolve({ id: 'tm_new', analysis_id: analysisId, t_ms })),
  },
}))

import {
  deleteSelected, insertAtPlayhead, moveMark, nudgeSelected, relabelMark, tallyAtPlayhead, toggleHolding,
} from './actions'
import { api } from './api/client'

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

// m1 holds until m2 (m1.end_ms === m2.t_ms) — used to test that the holder
// stays attached when the held endpoint (m2) is nudged or deleted.
const treeWithHold: AnalysisTree = {
  id: 'an_1', video_id: 'v', name: 'n', tally: [],
  lanes: [{
    id: 'ln_0', layer: 'L0',
    takes: [{
      id: 'tk_a', idx: 1,
      marks: [
        { id: 'm1', take_id: 'tk_a', t_ms: 100, end_ms: 300, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 },
        { id: 'm2', take_id: 'tk_a', t_ms: 300, end_ms: null, kind: 'input', label: '3', provenance: 'human_manual', confidence: 1 },
      ],
    }],
  }],
  keymap_id: null, keymap_version: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useSession.getState().setAnalysis(structuredClone(tree))
  useSession.getState().selectMark('m1')
})

test('nudgeSelected patches t_ms and updates store', async () => {
  await nudgeSelected(10)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 110 })
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks[0].t_ms).toBe(110)
})

test('deleteSelected removes mark', async () => {
  await deleteSelected()
  expect(api.deleteMark).toHaveBeenCalledWith('m1')
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks).toEqual([])
})

test('toggleHolding applies patch result', async () => {
  await toggleHolding('m1', { end_ms: 400 })
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks[0].end_ms).toBe(400)
})

test('insertAtPlayhead posts mark at current playhead into current take', async () => {
  useSession.getState().setPlayhead(1234.6)
  await insertAtPlayhead('input', 'Q')
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 1235, kind: 'input', label: 'Q' })
  const marks = useSession.getState().analysis!.lanes[0].takes[0].marks
  expect(marks.some(m => m.id === 'mk_new')).toBe(true)
})

test('tallyAtPlayhead posts marker and stores locally', async () => {
  useSession.getState().setPlayhead(2500.2)
  await tallyAtPlayhead()
  expect(api.addTally).toHaveBeenCalledWith('an_1', 2500)
  expect(useSession.getState().analysis!.tally.map(t => t.t_ms)).toEqual([2500])
})

test('nudgeSelected also patches the holder mark end_ms when it moves the held endpoint', async () => {
  useSession.getState().setAnalysis(structuredClone(treeWithHold))
  useSession.getState().selectMark('m2')
  await nudgeSelected(10)
  expect(api.patchMark).toHaveBeenCalledWith('m2', { t_ms: 310 })
  expect(api.patchMark).toHaveBeenCalledWith('m1', { end_ms: 310 })
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks.find(m => m.id === 'm1')!.end_ms).toBe(310)
  expect(take.marks.find(m => m.id === 'm2')!.t_ms).toBe(310)
})

test('moveMark patches the given mark to an absolute t_ms regardless of selection', async () => {
  // m1 is selected (per beforeEach) but we move m2's precursor — a plain
  // single-mark tree here, so use m1 directly with an unrelated selection
  // to prove moveMark doesn't rely on s.selectedMarkId.
  useSession.getState().selectMark(null)
  await moveMark('m1', 250)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 250 })
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks[0].t_ms).toBe(250)
})

test('moveMark also patches the holder mark end_ms when it moves the held endpoint', async () => {
  useSession.getState().setAnalysis(structuredClone(treeWithHold))
  useSession.getState().selectMark(null)
  await moveMark('m2', 320)
  expect(api.patchMark).toHaveBeenCalledWith('m2', { t_ms: 320 })
  expect(api.patchMark).toHaveBeenCalledWith('m1', { end_ms: 320 })
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks.find(m => m.id === 'm1')!.end_ms).toBe(320)
  expect(take.marks.find(m => m.id === 'm2')!.t_ms).toBe(320)
})

// M9 任务 2: client-side min-gap precheck (entry/gap.ts) runs before the
// insert/move API calls fire. On a hit, no network call is made and no undo
// entry is pushed — the mark's local state (or lack thereof) is left exactly
// as it was, matching the server's authoritative check (backend task 1) so
// the common case never round-trips just to get rejected.
test('insertAtPlayhead precheck: hint + no POST + no local insert when within frameMs of a neighbor', async () => {
  useSession.getState().setFrameMs(34)
  useSession.getState().setPlayhead(110) // |110-100| = 10 < 34
  await insertAtPlayhead('input', 'W')
  expect(api.newMark).not.toHaveBeenCalled()
  expect(useSession.getState().hintText).toBe('该位置与相邻标记过近（同一帧内），未打点')
  const marks = useSession.getState().analysis!.lanes[0].takes[0].marks
  expect(marks.map(m => m.id)).toEqual(['m1'])
})

test('insertAtPlayhead precheck: a gap of exactly frameMs is legal and still posts', async () => {
  useSession.getState().setFrameMs(34)
  useSession.getState().setPlayhead(134) // |134-100| = 34, not < 34
  await insertAtPlayhead('input', 'W')
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 134, kind: 'input', label: 'W' })
})

test('nudgeSelected precheck: hint + no PATCH + local state unchanged when the target is within frameMs of a neighbor', async () => {
  useSession.getState().setFrameMs(34)
  useSession.getState().setAnalysis(structuredClone(treeWithHold)) // m1@100, m2@300
  useSession.getState().selectMark('m1')
  await nudgeSelected(210) // 100+210=310, |310-300|=10 < 34 (m2 is the neighbor)
  expect(api.patchMark).not.toHaveBeenCalled()
  expect(useSession.getState().hintText).toBe('目标位置与相邻标记过近（同一帧内），未移动')
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks.find(m => m.id === 'm1')!.t_ms).toBe(100)
})

test('nudgeSelected precheck excludes the mark itself: nudging by 0 back onto its own t_ms is legal', async () => {
  useSession.getState().setFrameMs(34)
  await nudgeSelected(0)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 100 })
})

test('moveMark precheck: hint + no PATCH + local state unchanged on a same-frame collision', async () => {
  useSession.getState().setFrameMs(34)
  useSession.getState().setAnalysis(structuredClone(treeWithHold)) // m1@100, m2@300
  await moveMark('m2', 110) // |110-100| = 10 < 34 (m1 is the neighbor)
  expect(api.patchMark).not.toHaveBeenCalled()
  expect(useSession.getState().hintText).toBe('目标位置与相邻标记过近（同一帧内），未移动')
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks.find(m => m.id === 'm2')!.t_ms).toBe(300)
})

test('deleteSelected clears the holder mark end_ms before deleting the held endpoint', async () => {
  useSession.getState().setAnalysis(structuredClone(treeWithHold))
  useSession.getState().selectMark('m2')
  await deleteSelected()
  expect(api.patchMark).toHaveBeenCalledWith('m1', { clear_end: true })
  expect(api.deleteMark).toHaveBeenCalledWith('m2')
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks.map(m => m.id)).toEqual(['m1'])
  expect(take.marks[0].end_ms).toBeNull()
})

// M9 任务 3: MarkList 内联标签编辑器提交路径。
test('relabelMark patches the label and updates the store', async () => {
  await relabelMark('m1', 'W')
  expect(api.patchMark).toHaveBeenCalledWith('m1', { label: 'W' })
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks[0].label).toBe('W')
})

test('relabelMark trims surrounding whitespace before comparing/submitting', async () => {
  await relabelMark('m1', '  W  ')
  expect(api.patchMark).toHaveBeenCalledWith('m1', { label: 'W' })
})

test('relabelMark no-ops on an empty (or whitespace-only) label: no PATCH, no store change', async () => {
  await relabelMark('m1', '   ')
  expect(api.patchMark).not.toHaveBeenCalled()
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks[0].label).toBe('2')
})

test('relabelMark no-ops when the trimmed label is unchanged from the current one', async () => {
  await relabelMark('m1', '2')
  expect(api.patchMark).not.toHaveBeenCalled()
})
