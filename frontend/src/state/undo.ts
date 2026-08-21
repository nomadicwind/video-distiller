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

export type UndoEntry =
  | { kind: 'insert'; markId: string } // 逆 = 删除
  | { kind: 'delete'; takeId: string; markId: string; snapshot: MarkSnapshot } // 逆 = 重插
  | { kind: 'move'; markId: string; fromTMs: number; toTMs: number } // 逆 = patch 回 from
  | { kind: 'holding'; markId: string; patch: HoldPatch; inverse: HoldPatch }

const MAX_STACK = 100

let undoStack: UndoEntry[] = []
let redoStack: UndoEntry[] = []

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
  const rewrite = (e: UndoEntry): UndoEntry =>
    e.markId === oldId ? { ...e, markId: newId } : e
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
      const snapshot: MarkSnapshot = found
        ? { t_ms: found.mark.t_ms, end_ms: found.mark.end_ms, kind: found.mark.kind, label: found.mark.label }
        : { t_ms: 0, end_ms: null, kind: 'input', label: null }
      const takeId = found?.take.id ?? ''
      await api.deleteMark(entry.markId)
      useSession.getState().removeMarkLocal(entry.markId)
      return { kind: 'delete', takeId, markId: entry.markId, snapshot }
    }
    case 'delete': {
      const created = await api.newMark(entry.takeId, {
        t_ms: entry.snapshot.t_ms, kind: entry.snapshot.kind,
        label: entry.snapshot.label, end_ms: entry.snapshot.end_ms,
      })
      useSession.getState().insertMarkLocal(created)
      rewriteMarkId(entry.markId, created.id)
      return { kind: 'insert', markId: created.id }
    }
    case 'move': {
      await patchMarkMove(entry.markId, entry.fromTMs)
      return { kind: 'move', markId: entry.markId, fromTMs: entry.toTMs, toTMs: entry.fromTMs }
    }
    case 'holding': {
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

/** Pops and inverts the most recent undo entry. Returns false on an empty stack. */
export async function undo(): Promise<boolean> {
  const entry = undoStack.pop()
  if (!entry) return false
  const opposite = await applyInverse(entry)
  capPush(redoStack, opposite)
  return true
}

/** Pops and inverts the most recent redo entry. Returns false on an empty stack. */
export async function redo(): Promise<boolean> {
  const entry = redoStack.pop()
  if (!entry) return false
  const opposite = await applyInverse(entry)
  capPush(undoStack, opposite)
  return true
}

/** Test-only: clears both stacks so cases don't leak state into each other. */
export function _resetForTest(): void {
  undoStack = []
  redoStack = []
}
