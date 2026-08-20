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
