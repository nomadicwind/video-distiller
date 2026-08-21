import { api } from './api/client'
import type { Mark, Take } from './api/types'
import { currentTake, useSession } from './state/store'

/**
 * Commits `mark`'s t_ms to `newTMs` (PATCH + local store update). A previous
 * mark may be "holding" until this mark's current t_ms (a.end_ms ===
 * mark.t_ms, see timeline/layout.ts `intervals`) — moving the endpoint
 * without moving the hold would strand a.end_ms in the DB as an orphan the
 * UI no longer renders as held, so its end_ms is patched to follow along.
 * Shared by nudgeSelected (relative, hotkey-driven) and moveMark (absolute,
 * drag-driven).
 */
async function applyMarkMove(mark: Mark, newTMs: number, take: Take | null): Promise<void> {
  const holder = take?.marks.find(m => m.id !== mark.id && m.end_ms === mark.t_ms) ?? null
  const updated = await api.patchMark(mark.id, { t_ms: newTMs })
  useSession.getState().updateMarkLocal(updated)
  if (holder) {
    const updatedHolder = await api.patchMark(holder.id, { end_ms: newTMs })
    useSession.getState().updateMarkLocal(updatedHolder)
  }
}

export async function nudgeSelected(deltaMs: number): Promise<void> {
  const s = useSession.getState()
  const take = currentTake(s)
  const mark = take?.marks.find(m => m.id === s.selectedMarkId)
  if (!mark) return
  await applyMarkMove(mark, mark.t_ms + deltaMs, take)
}

/** Commits a timeline drag: `markId` (not necessarily the selected mark) moves to the absolute `newTMs`. */
export async function moveMark(markId: string, newTMs: number): Promise<void> {
  const s = useSession.getState()
  const take = currentTake(s)
  const mark = take?.marks.find(m => m.id === markId)
  if (!mark) return
  await applyMarkMove(mark, newTMs, take)
}

export async function deleteSelected(): Promise<void> {
  const s = useSession.getState()
  if (!s.selectedMarkId) return
  const take = currentTake(s)
  const mark = take?.marks.find(m => m.id === s.selectedMarkId)
  // Same orphan-hold hazard as nudgeSelected: if a previous mark holds
  // until the mark being deleted, clear its end_ms first so it doesn't
  // point at a t_ms that no longer belongs to any mark.
  const holder = mark
    ? take?.marks.find(m => m.id !== mark.id && m.end_ms === mark.t_ms) ?? null
    : null
  if (holder) {
    const updatedHolder = await api.patchMark(holder.id, { clear_end: true })
    useSession.getState().updateMarkLocal(updatedHolder)
  }
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
