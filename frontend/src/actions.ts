import { api } from './api/client'
import type { Mark, Take } from './api/types'
import { violatesMinGap } from './entry/gap'
import { currentTake, useSession } from './state/store'
import { pushUndo } from './state/undo'
import type { HoldPatch, HolderSnapshot } from './state/undo'

/**
 * Commits `mark`'s t_ms to `newTMs` (PATCH + local store update). A previous
 * mark may be "holding" until this mark's current t_ms (a.end_ms ===
 * mark.t_ms, see timeline/layout.ts `intervals`) — moving the endpoint
 * without moving the hold would strand a.end_ms in the DB as an orphan the
 * UI no longer renders as held, so its end_ms is patched to follow along.
 * Shared by nudgeSelected (relative, hotkey-driven) and moveMark (absolute,
 * drag-driven). Pushes a single 'move' undo entry (fromTMs/toTMs) — the
 * holder's end_ms isn't tracked separately, since undo.ts's own move
 * executor recomputes the same holder relationship from live state when it
 * patches the mark back, carrying the holder along symmetrically.
 *
 * This is also the single choke point for the M9 task 2 client-side
 * min-gap precheck: nudgeSelected (relative, hotkey-driven), moveMark
 * (absolute, drag-driven), and any future list-editor move all funnel
 * through here, so checking here — rather than duplicating the check in
 * each caller — covers all of them by construction. `excludeId: mark.id`
 * means landing back on the mark's own current t_ms (e.g. a nudge that
 * nets to zero) is never mistaken for a collision with itself. The server
 * (backend task 1) remains authoritative — a race that slips past this
 * precheck still gets rejected there, surfacing as a 400 toast via j().
 */
async function applyMarkMove(mark: Mark, newTMs: number, take: Take | null): Promise<void> {
  const s = useSession.getState()
  if (violatesMinGap(newTMs, take?.marks ?? [], s.frameMs, mark.id)) {
    s.setHintText('目标位置与相邻标记过近（同一帧内），未移动')
    return
  }
  const fromTMs = mark.t_ms
  const holder = take?.marks.find(m => m.id !== mark.id && m.end_ms === mark.t_ms) ?? null
  const updated = await api.patchMark(mark.id, { t_ms: newTMs })
  useSession.getState().updateMarkLocal(updated)
  if (holder) {
    const updatedHolder = await api.patchMark(holder.id, { end_ms: newTMs })
    useSession.getState().updateMarkLocal(updatedHolder)
  }
  pushUndo({ kind: 'move', markId: mark.id, fromTMs, toTMs: newTMs })
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
  if (!mark || !take) return
  // Same orphan-hold hazard as nudgeSelected: if a previous mark holds
  // until the mark being deleted, clear its end_ms first so it doesn't
  // point at a t_ms that no longer belongs to any mark. Its prior end_ms is
  // captured into the undo entry so undoing the delete can restore the hold.
  const holderMark = take.marks.find(m => m.id !== mark.id && m.end_ms === mark.t_ms) ?? null
  let holder: HolderSnapshot | undefined
  if (holderMark) {
    holder = { markId: holderMark.id, endMs: holderMark.end_ms as number }
    const updatedHolder = await api.patchMark(holderMark.id, { clear_end: true })
    useSession.getState().updateMarkLocal(updatedHolder)
  }
  await api.deleteMark(mark.id)
  useSession.getState().removeMarkLocal(mark.id)
  pushUndo({
    kind: 'delete', takeId: take.id, markId: mark.id,
    snapshot: { t_ms: mark.t_ms, end_ms: mark.end_ms, kind: mark.kind, label: mark.label },
    holder,
  })
}

export async function toggleHolding(
  markId: string, patch: HoldPatch,
): Promise<void> {
  const s = useSession.getState()
  const take = currentTake(s)
  const prevEndMs = take?.marks.find(m => m.id === markId)?.end_ms ?? null
  const updated = await api.patchMark(markId, patch)
  useSession.getState().updateMarkLocal(updated)
  const inverse: HoldPatch = prevEndMs === null ? { clear_end: true } : { end_ms: prevEndMs }
  pushUndo({ kind: 'holding', markId, patch, inverse })
}

export async function insertAtPlayhead(
  kind: 'input' | 'release', label: string | null,
): Promise<void> {
  const s = useSession.getState()
  if (!s.takeId) return
  const tMs = Math.round(s.playheadMs)
  // M9 task 2 precheck: mirrors the server's min-gap check (backend task 1)
  // against the current take's marks before POSTing, so the common case
  // never round-trips just to get rejected. On a hit: hint, no POST, no undo
  // entry — local state is untouched. The server stays authoritative for
  // the rare race that slips past this (400 toasts via j(), not suppressed).
  const take = currentTake(s)
  if (violatesMinGap(tMs, take?.marks ?? [], s.frameMs)) {
    s.setHintText('该位置与相邻标记过近（同一帧内），未打点')
    return
  }
  const mark = await api.newMark(s.takeId, { t_ms: tMs, kind, label })
  useSession.getState().insertMarkLocal(mark)
  pushUndo({ kind: 'insert', markId: mark.id })
}

export async function tallyAtPlayhead(): Promise<void> {
  const s = useSession.getState()
  if (!s.analysis) return
  const t = await api.addTally(s.analysis.id, Math.round(s.playheadMs))
  useSession.getState().addTallyLocal(t)
}
