import { create } from 'zustand'
import type { AnalysisTree, Mark, Take, Tally } from '../api/types'
import { clearUndoHistory } from './undo'

/** A-B 循环入/出点（M7 任务 2）：均为 null 时不生效；`on` 仅在两者都设置时才有意义（见 toggleLoop）。 */
export interface AbLoop {
  aMs: number | null
  bMs: number | null
  on: boolean
}

const emptyAbLoop = (): AbLoop => ({ aMs: null, bMs: null, on: false })

export interface Session {
  analysis: AnalysisTree | null
  laneId: string | null
  takeId: string | null
  selectedMarkId: string | null
  playheadMs: number
  entryMode: boolean
  showAggregate: boolean
  /** 时间轴吸附开关（磁铁图标，默认开，快捷键 S）— Toolbar + hotkeys 共用。 */
  snapOn: boolean
  /** ? 快捷键浮层开关位（浮层本身在任务 12 实现）。 */
  showHotkeys: boolean
  /** A-B 循环入/出点 + 开关（M7 任务 2）— Player 的播放头更新流据此回跳，Timeline 据此画区带。 */
  abLoop: AbLoop
  /** StatusBar 左侧的一次性短提示（M7 任务 2，如"出点须在入点之后"）；3s 后自动清空，无需专门的 toast 组件。 */
  hintText: string | null

  setAnalysis: (a: AnalysisTree) => void
  clearAnalysis: () => void
  selectLane: (laneId: string) => void
  selectTake: (takeId: string) => void
  addTakeLocal: (laneId: string, take: Take) => void
  setPlayhead: (ms: number) => void
  selectMark: (id: string | null) => void
  insertMarkLocal: (m: Mark) => void
  updateMarkLocal: (m: Mark) => void
  removeMarkLocal: (id: string) => void
  addTallyLocal: (t: Tally) => void
  clearTallyLocal: () => void
  toggleEntryMode: () => void
  toggleAggregate: () => void
  toggleSnap: () => void
  toggleHotkeys: () => void
  /** Sets/clears the loop-in point. Returns false (state unchanged) when a
   * bMs already exists and `ms` would land at or after it — callers surface
   * that as a hint rather than allowing an inverted A>=B range. Passing
   * null always clears and always succeeds. */
  setLoopA: (ms: number | null) => boolean
  /** Mirrors setLoopA: rejects (returns false, unchanged) an `ms` at or
   * before an existing aMs. */
  setLoopB: (ms: number | null) => boolean
  toggleLoop: () => void
  clearLoop: () => void
  setHintText: (text: string | null) => void
}

const mapMarks = (a: AnalysisTree, takeId: string, f: (marks: Mark[]) => Mark[]): AnalysisTree => ({
  ...a,
  lanes: a.lanes.map(l => ({
    ...l,
    takes: l.takes.map(t => (t.id === takeId ? { ...t, marks: f(t.marks) } : t)),
  })),
})

const byT = <T extends { t_ms: number }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.t_ms - b.t_ms)

/** Module-level so it survives across store actions without leaking into React re-render state; mirrors clearUndoHistory's non-store bookkeeping in ./undo. */
let hintTimer: ReturnType<typeof setTimeout> | null = null

export const useSession = create<Session>((set, get) => ({
  analysis: null, laneId: null, takeId: null, selectedMarkId: null,
  playheadMs: 0, entryMode: false, showAggregate: false,
  snapOn: true, showHotkeys: false,
  abLoop: emptyAbLoop(), hintText: null,

  setAnalysis: a => {
    const lane = a.lanes[0] ?? null
    const take = lane ? lane.takes[lane.takes.length - 1] : null
    // A new analysis tree means a different (or freshly reloaded) video —
    // any undo/redo history from before this belongs to marks/takes that
    // don't exist in the new tree, so it must not survive the switch.
    clearUndoHistory()
    set({
      analysis: a, laneId: lane?.id ?? null, takeId: take?.id ?? null, selectedMarkId: null,
      // A-B loop marks are per-video too — carrying them into a different
      // analysis would loop/audition around timestamps that mean nothing there.
      abLoop: emptyAbLoop(),
    })
  },
  // Clears the per-video session window. `entryMode` is intentionally left
  // untouched — it's a persistent UI preference, not video-scoped state, so
  // switching videos shouldn't silently drop the annotator out of it.
  clearAnalysis: () => {
    clearUndoHistory()
    set({
      analysis: null, laneId: null, takeId: null, selectedMarkId: null,
      playheadMs: 0, showAggregate: false, abLoop: emptyAbLoop(),
    })
  },
  selectLane: laneId => {
    const lane = get().analysis?.lanes.find(l => l.id === laneId)
    const take = lane?.takes[lane.takes.length - 1]
    set({ laneId, takeId: take?.id ?? null, selectedMarkId: null })
  },
  selectTake: takeId => set({ takeId, selectedMarkId: null }),
  addTakeLocal: (laneId, take) =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l =>
          l.id === laneId ? { ...l, takes: [...l.takes, take] } : l),
      },
      laneId, takeId: take.id, selectedMarkId: null,
    })),
  setPlayhead: ms => set({ playheadMs: ms }),
  selectMark: id => set({ selectedMarkId: id }),
  insertMarkLocal: m =>
    set(s => ({
      analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks => byT([...marks, m])),
      selectedMarkId: m.id,
    })),
  updateMarkLocal: m =>
    set(s => ({
      analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks =>
        byT(marks.map(x => (x.id === m.id ? m : x)))),
    })),
  removeMarkLocal: id =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l => ({
          ...l,
          takes: l.takes.map(t => ({ ...t, marks: t.marks.filter(m => m.id !== id) })),
        })),
      },
      selectedMarkId: s.selectedMarkId === id ? null : s.selectedMarkId,
    })),
  addTallyLocal: t =>
    set(s => ({
      analysis: s.analysis && { ...s.analysis, tally: byT([...s.analysis.tally, t]) },
    })),
  clearTallyLocal: () =>
    set(s => ({ analysis: s.analysis && { ...s.analysis, tally: [] } })),
  toggleEntryMode: () => set(s => ({ entryMode: !s.entryMode })),
  toggleAggregate: () => set(s => ({ showAggregate: !s.showAggregate })),
  toggleSnap: () => set(s => ({ snapOn: !s.snapOn })),
  toggleHotkeys: () => set(s => ({ showHotkeys: !s.showHotkeys })),
  // Ordering guard lives HERE (not in hotkeys.ts) so both entry points —
  // the I/O hotkeys today, anything else calling these later — are safe by
  // construction: it's impossible to reach an inverted A>=B range through
  // these setters, which is what let Player's loop-check spin forever
  // (round 1 review: L on + A set after an existing earlier B pinned
  // playback at A==B with no escape, since ms>bMs was permanently true).
  setLoopA: ms => {
    if (ms == null) { set(s => ({ abLoop: { ...s.abLoop, aMs: null } })); return true }
    const { bMs } = get().abLoop
    if (bMs != null && ms >= bMs) return false
    set(s => ({ abLoop: { ...s.abLoop, aMs: ms } }))
    return true
  },
  setLoopB: ms => {
    if (ms == null) { set(s => ({ abLoop: { ...s.abLoop, bMs: null } })); return true }
    const { aMs } = get().abLoop
    if (aMs != null && ms <= aMs) return false
    set(s => ({ abLoop: { ...s.abLoop, bMs: ms } }))
    return true
  },
  // Only meaningful once both endpoints exist AND are correctly ordered —
  // belt-and-braces alongside the setters above (defensive: even if some
  // future path ever set an inverted pair directly, toggleLoop itself still
  // refuses to arm the loop). Turning OFF is always allowed, no ordering
  // check needed.
  toggleLoop: () => set(s => {
    if (s.abLoop.on) return { abLoop: { ...s.abLoop, on: false } }
    const canEnable = s.abLoop.aMs != null && s.abLoop.bMs != null && s.abLoop.aMs < s.abLoop.bMs
    return canEnable ? { abLoop: { ...s.abLoop, on: true } } : {}
  }),
  clearLoop: () => set({ abLoop: emptyAbLoop() }),
  setHintText: text => {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    set({ hintText: text })
    if (text !== null) {
      hintTimer = setTimeout(() => { hintTimer = null; set({ hintText: null }) }, 3000)
    }
  },
}))

export const currentTake = (s: Session): Take | null => {
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  return lane?.takes.find(t => t.id === s.takeId) ?? null
}
