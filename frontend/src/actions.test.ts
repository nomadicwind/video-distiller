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
  },
}))

import { deleteSelected, nudgeSelected, toggleHolding } from './actions'
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
