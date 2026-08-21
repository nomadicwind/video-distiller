import { api } from '../api/client'
import type { Mark, Take } from '../api/types'
import { useSession } from './store'

/**
 * 会话级撤销/重做栈（M7 任务 1）。故意不放进 zustand —— 这不是需要触发
 * React 重渲染的 UI 状态，只是"最近发生过什么"的记录；undo()/redo() 执行时
 * 直接调 api.* + store 的 *Local 方法（与 actions.ts 各接入点走的是同一条
 * 链路），绕开 actions.ts 的包装函数，避免撤销/重做本身又把自己压回栈里。
 */

export interface MarkSnapshot {
  t_ms: number; end_ms: number | null; kind: 'input' | 'release'; label: string | null
}

export interface HoldPatch { end_ms?: number; clear_end?: boolean }

/** A holder mark's end_ms just before it was cleared as the side effect of deleting the mark it held until. */
export interface HolderSnapshot { markId: string; endMs: number }

export type UndoEntry =
  | { kind: 'insert'; markId: string } // 逆 = 删除
  | {
      kind: 'delete'; takeId: string; markId: string; snapshot: MarkSnapshot
      // 删除前若存在 holder（前一个 mark hold 到本 mark 的 t_ms），deleteSelected
      // 会先把 holder.end_ms clear 掉——这是删除操作的第二个 mutation，必须和
      // 主 mark 的快照一起记下来，重插时才能把 holder 的 hold 状态一并恢复。
      holder?: HolderSnapshot
    } // 逆 = 重插（+ 恢复 holder）
  | { kind: 'move'; markId: string; fromTMs: number; toTMs: number } // 逆 = patch 回 from
  | { kind: 'holding'; markId: string; patch: HoldPatch; inverse: HoldPatch }

const MAX_STACK = 100

let undoStack: UndoEntry[] = []
let redoStack: UndoEntry[] = []
/** Reentrancy guard: undo()/redo() are async and mutate module state across
 * `await` points, so two overlapping calls could both pop the same entry (or
 * interleave their api calls) if not serialized. */
let busy = false

function capPush(stack: UndoEntry[], entry: UndoEntry): void {
  stack.push(entry)
  if (stack.length > MAX_STACK) stack.shift()
}

/**
 * Finds a mark and its owning take anywhere in the current analysis tree,
 * regardless of which lane/take happens to be selected right now — undo/redo
 * can fire after the user has navigated elsewhere.
 */
function findMarkAndTake(markId: string): { mark: Mark; take: Take } | null {
  const a = useSession.getState().analysis
  if (!a) return null
  for (const lane of a.lanes) {
    for (const take of lane.takes) {
      const mark = take.marks.find(m => m.id === markId)
      if (mark) return { mark, take }
    }
  }
  return null
}

/**
 * Re-implements applyMarkMove's holder-carrying logic (frontend/src/actions.ts)
 * independently instead of importing it: undo/redo must apply the same
 * api.* + store local-update pairs WITHOUT going through actions.ts's
 * wrappers, since those wrappers are the ones that call pushUndo — routing
 * through them here would risk a recursive push. A small, self-contained
 * copy is the simpler, safer seam.
 */
async function patchMarkMove(markId: string, newTMs: number): Promise<void> {
  const found = findMarkAndTake(markId)
  if (!found) return
  const { mark, take } = found
  const holder = take.marks.find(m => m.id !== mark.id && m.end_ms === mark.t_ms) ?? null
  const updated = await api.patchMark(mark.id, { t_ms: newTMs })
  useSession.getState().updateMarkLocal(updated)
  if (holder) {
    const updatedHolder = await api.patchMark(holder.id, { end_ms: newTMs })
    useSession.getState().updateMarkLocal(updatedHolder)
  }
}

/**
 * Rewrites every `markId` reference across BOTH stacks from `oldId` to
 * `newId`. Needed only after a 'delete' entry's inverse (reinsert) mints a
 * brand-new mark id: any older entry still sitting in either stack (e.g. a
 * 'move' recorded before the mark was deleted) would otherwise keep pointing
 * at an id that no longer exists in the DB once it's popped later.
 */
function rewriteMarkId(oldId: string, newId: string): void {
  const rewrite = (e: UndoEntry): UndoEntry => {
    const withMarkId = e.markId === oldId ? { ...e, markId: newId } : e
    // A 'delete' entry's `holder` field carries a markId of its own (a
    // different mark than the one that was deleted) — if THAT mark was
    // itself deleted-and-reinserted at some other point, its id could also
    // be stale here.
    if (withMarkId.kind === 'delete' && withMarkId.holder?.markId === oldId) {
      return { ...withMarkId, holder: { ...withMarkId.holder, markId: newId } }
    }
    return withMarkId
  }
  undoStack = undoStack.map(rewrite)
  redoStack = redoStack.map(rewrite)
}

/**
 * Executes the inverse of `entry` (the api+store side effects) and returns
 * the entry that should land on the OPPOSITE stack, so that popping it again
 * later — via undo() or redo(), both of which share this function — replays
 * the original action. Each returned entry is symmetric with its source:
 * insert <-> delete, move's from/to swap, holding's patch/inverse swap.
 */
async function applyInverse(entry: UndoEntry): Promise<UndoEntry> {
  switch (entry.kind) {
    case 'insert': {
      const found = findMarkAndTake(entry.markId)
      // No-op guard: the mark isn't in the currently-loaded analysis at all
      // (e.g. the user switched videos and this entry is stale — though
      // setAnalysis/clearAnalysis now also clear both stacks outright, this
      // is a second line of defense). Firing deleteMark unconditionally here
      // would silently delete whatever mark id happens to collide, or 404
      // against a mark that belongs to a different session entirely.
      if (!found) return entry
      const { mark, take } = found
      const snapshot: MarkSnapshot = { t_ms: mark.t_ms, end_ms: mark.end_ms, kind: mark.kind, label: mark.label }
      // Mirrors deleteSelected's orphan-hold guard: if some other mark holds
      // until this one's t_ms, clear it first, remembering its prior end_ms
      // so a later reinsert (undo of this delete) can restore it.
      const holderMark = take.marks.find(m => m.id !== mark.id && m.end_ms === mark.t_ms) ?? null
      let holder: HolderSnapshot | undefined
      if (holderMark) {
        holder = { markId: holderMark.id, endMs: holderMark.end_ms as number }
        const updatedHolder = await api.patchMark(holderMark.id, { clear_end: true })
        useSession.getState().updateMarkLocal(updatedHolder)
      }
      await api.deleteMark(entry.markId)
      useSession.getState().removeMarkLocal(entry.markId)
      return { kind: 'delete', takeId: take.id, markId: entry.markId, snapshot, holder }
    }
    case 'delete': {
      const created = await api.newMark(entry.takeId, {
        t_ms: entry.snapshot.t_ms, kind: entry.snapshot.kind,
        label: entry.snapshot.label, end_ms: entry.snapshot.end_ms,
      })
      useSession.getState().insertMarkLocal(created)
      rewriteMarkId(entry.markId, created.id)
      if (entry.holder) {
        const updatedHolder = await api.patchMark(entry.holder.markId, { end_ms: entry.holder.endMs })
        useSession.getState().updateMarkLocal(updatedHolder)
      }
      return { kind: 'insert', markId: created.id }
    }
    case 'move': {
      await patchMarkMove(entry.markId, entry.fromTMs)
      return { kind: 'move', markId: entry.markId, fromTMs: entry.toTMs, toTMs: entry.fromTMs }
    }
    case 'holding': {
      // Same no-op guard as 'insert': skip the patch entirely if the mark
      // isn't in the current analysis.
      if (!findMarkAndTake(entry.markId)) return entry
      const updated = await api.patchMark(entry.markId, entry.inverse)
      useSession.getState().updateMarkLocal(updated)
      return { kind: 'holding', markId: entry.markId, patch: entry.inverse, inverse: entry.patch }
    }
  }
}

/**
 * Records that `e` just happened. A fresh action invalidates whatever redo
 * history existed, so the redo stack is cleared; the undo stack is capped at
 * 100 entries, dropping the oldest.
 */
export function pushUndo(e: UndoEntry): void {
  redoStack = []
  capPush(undoStack, e)
}

/**
 * Pops and inverts the most recent undo entry. Returns false on an empty
 * stack, and also — via the `busy` reentrancy guard — on a call that
 * overlaps an undo()/redo() already in flight, so two near-simultaneous
 * triggers (e.g. a held-down key producing overlapping calls before either
 * awaits resolve) can't both pop and act on stack state at once.
 */
export async function undo(): Promise<boolean> {
  if (busy) return false
  busy = true
  try {
    const entry = undoStack.pop()
    if (!entry) return false
    const opposite = await applyInverse(entry)
    capPush(redoStack, opposite)
    return true
  } finally {
    busy = false
  }
}

/** Pops and inverts the most recent redo entry. Returns false on an empty stack, or while undo()/redo() is already in flight (see undo() above). */
export async function redo(): Promise<boolean> {
  if (busy) return false
  busy = true
  try {
    const entry = redoStack.pop()
    if (!entry) return false
    const opposite = await applyInverse(entry)
    capPush(undoStack, opposite)
    return true
  } finally {
    busy = false
  }
}

function resetStacks(): void {
  undoStack = []
  redoStack = []
  busy = false
}

/**
 * Clears both stacks. Called by the store whenever the loaded analysis
 * changes (setAnalysis for a different video/session, or clearAnalysis) —
 * entries from a previous analysis reference mark/take ids that don't exist
 * in the new one, so history from before the switch is meaningless (and, if
 * ever replayed, potentially dangerous — see the no-op guards in
 * applyInverse above).
 */
export function clearUndoHistory(): void {
  resetStacks()
}

/** Test-only: clears both stacks so cases don't leak state into each other. */
export function _resetForTest(): void {
  resetStacks()
}
