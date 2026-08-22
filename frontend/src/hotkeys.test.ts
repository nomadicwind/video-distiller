import { beforeEach, expect, test, vi } from 'vitest'
import type { AnalysisTree, Mark } from './api/types'
import { useSession } from './state/store'

// Same mocking shape as actions.test.ts/undo.test.ts (vi.mock('./api/client')
// with a stateless newMark stub) — handleEntryInsert below drives the REAL
// insertAtPlayhead (frontend/src/actions.ts), not a re-implementation, so
// this is a genuine regression test for the round-1 review finding: a
// precheck-rejected keystroke must not fire recordEntry.
vi.mock('./api/client', () => ({
  api: {
    newMark: vi.fn((takeId: string, m: Record<string, unknown>) =>
      Promise.resolve({
        id: 'mk_new', take_id: takeId, t_ms: m.t_ms as number, end_ms: null,
        kind: m.kind as 'input' | 'release', label: (m.label as string) ?? null,
        provenance: 'human_manual', confidence: 1,
      } satisfies Mark)),
  },
}))

import { api } from './api/client'
import { handleEntryInsert } from './hotkeys'

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
  useSession.getState().setAnalysis(structuredClone(tree))
  useSession.getState().setFrameMs(34)
})

test('handleEntryInsert records lastEntry when the keystroke actually inserts a mark', async () => {
  useSession.getState().setPlayhead(5000) // far from the only existing mark (t_ms=100)
  await handleEntryInsert('Q')
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 5000, kind: 'input', label: 'Q' })
  expect(useSession.getState().lastEntry).toEqual({ label: 'Q', count: 1 })
})

// Critical regression (task-2 round 1 review): the old code chained a bare
// `.then(() => recordEntry(...))` straight onto insertAtPlayhead, which fires
// unconditionally on resolve — including a precheck-hit, which resolves
// normally (no throw) rather than rejecting. That meant a REJECTED keystroke
// (same-frame as an existing mark) still bumped the StatusBar "本 take 第 N
// 个" counter and flashed the keycap as if it had landed. handleEntryInsert
// now gates on insertAtPlayhead's boolean return, so this must NOT happen.
test('handleEntryInsert does NOT record lastEntry when the min-gap precheck rejects the keystroke', async () => {
  useSession.getState().setPlayhead(110) // |110-100| = 10 < frameMs(34) -> precheck hit
  await handleEntryInsert('W')
  expect(api.newMark).not.toHaveBeenCalled()
  expect(useSession.getState().lastEntry).toBeNull()
  expect(useSession.getState().hintText).toBe('该位置与相邻标记过近（同一帧内），未打点')
})

test('handleEntryInsert does not record lastEntry when insertAtPlayhead fails outright (e.g. a race the server 400s)', async () => {
  useSession.getState().setPlayhead(5000)
  vi.mocked(api.newMark).mockRejectedValueOnce(new Error('API 400: 与相邻标记距离过近（同一帧内）'))
  await handleEntryInsert('Q')
  expect(useSession.getState().lastEntry).toBeNull()
})
