import { beforeEach, expect, test, vi } from 'vitest'
import type { AnalysisTree, Mark } from './api/types'
import { useSession } from './state/store'

vi.mock('./api/client', () => ({
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
        id: 'mk_new', take_id: takeId, t_ms: m.t_ms as number, end_ms: null,
        kind: m.kind as 'input' | 'release', label: (m.label as string) ?? null,
        provenance: 'human_manual', confidence: 1,
      } satisfies Mark)),
    addTally: vi.fn((analysisId: string, t_ms: number) =>
      Promise.resolve({ id: 'tm_new', analysis_id: analysisId, t_ms })),
  },
}))

import { deleteSelected, insertAtPlayhead, nudgeSelected, tallyAtPlayhead, toggleHolding } from './actions'
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
