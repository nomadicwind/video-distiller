import { api } from './api/client'
import { currentTake, useSession } from './state/store'

export async function nudgeSelected(deltaMs: number): Promise<void> {
  const s = useSession.getState()
  const mark = currentTake(s)?.marks.find(m => m.id === s.selectedMarkId)
  if (!mark) return
  const updated = await api.patchMark(mark.id, { t_ms: mark.t_ms + deltaMs })
  useSession.getState().updateMarkLocal(updated)
}

export async function deleteSelected(): Promise<void> {
  const s = useSession.getState()
  if (!s.selectedMarkId) return
  await api.deleteMark(s.selectedMarkId)
  useSession.getState().removeMarkLocal(s.selectedMarkId)
}

export async function toggleHolding(
  markId: string, patch: { end_ms?: number; clear_end?: boolean },
): Promise<void> {
  const updated = await api.patchMark(markId, patch)
  useSession.getState().updateMarkLocal(updated)
}

export async function insertAtPlayhead(
  kind: 'input' | 'release', label: string | null,
): Promise<void> {
  const s = useSession.getState()
  if (!s.takeId) return
  const mark = await api.newMark(s.takeId, {
    t_ms: Math.round(s.playheadMs), kind, label,
  })
  useSession.getState().insertMarkLocal(mark)
}

export async function tallyAtPlayhead(): Promise<void> {
  const s = useSession.getState()
  if (!s.analysis) return
  const t = await api.addTally(s.analysis.id, Math.round(s.playheadMs))
  useSession.getState().addTallyLocal(t)
}
