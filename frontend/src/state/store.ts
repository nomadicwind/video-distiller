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
  /** 跨层参考线开关（M7 任务 3，快捷键 R）：开启时在 L0 泳道内叠画 L1 当前选中 take 各标记的参考竖线，纯展示、不产生数据。 */
  refLinesOn: boolean
  /** 刚打点标记的"出生"时刻（M7 任务 3）：markId → bornAt(ms epoch)，驱动 draw.ts 里 300ms 的插入闪烁反馈；insertMarkLocal 写入，超过 1s 的旧条目惰性清理（下次 insertMarkLocal 时顺手过滤，不用定时器）。 */
  flashMarks: Record<string, number>
  /** 录入模式下"最近一次打点"的标签与本 take 内的插入序号（M7 任务 3）：EntryPanel 据此给对应键帽加 120ms 按压态，StatusBar 据此显示"本 take 第 N 个"。切 take / 切视频都应清零 —— 见 selectTake/setAnalysis/clearAnalysis。 */
  lastEntry: { label: string; count: number } | null

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
  toggleRefLines: () => void
  /** 录入模式打点成功后调用（仅 hotkeys.ts 的键盘打点路径，鼠标点击键帽已有原生 :active 反馈，不需要这个）：count 在 lastEntry 上自增，切 take/切视频时 lastEntry 被清空，故从 1 重新起数。 */
  recordEntry: (label: string) => void
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
  refLinesOn: false, flashMarks: {}, lastEntry: null,

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
      // lastEntry's count is scoped to "this take, this session" (brief
      // §要点) — a different video's take shares none of that context.
      // flashMarks likewise references markIds from THIS tree — a stale
      // entry pointing at an id that no longer exists is harmless (draw.ts's
      // findMark just skips it) but pointless to carry across a video switch.
      lastEntry: null, flashMarks: {},
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
      lastEntry: null, flashMarks: {},
    })
  },
  // 换泳道也隐含换 take（见下方 takeId 赋值）—— lastEntry 同样要归零，理由
  // 同 selectTake 的注释。
  selectLane: laneId => {
    const lane = get().analysis?.lanes.find(l => l.id === laneId)
    const take = lane?.takes[lane.takes.length - 1]
    set({ laneId, takeId: take?.id ?? null, selectedMarkId: null, lastEntry: null })
  },
  // takeId 切换即视为切 take —— lastEntry 的 count 按"本 take 本会话"计数
  // （brief §要点），换 take 必须归零，否则会把上一个 take 的插入序号带过来。
  selectTake: takeId => set({ takeId, selectedMarkId: null, lastEntry: null }),
  addTakeLocal: (laneId, take) =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l =>
          l.id === laneId ? { ...l, takes: [...l.takes, take] } : l),
      },
      laneId, takeId: take.id, selectedMarkId: null, lastEntry: null,
    })),
  setPlayhead: ms => set({ playheadMs: ms }),
  selectMark: id => set({ selectedMarkId: id }),
  insertMarkLocal: m =>
    set(s => {
      const now = Date.now()
      // 惰性清理：借这次写入的机会把 1s 前的旧闪烁条目一并筛掉，不需要专门
      // 的定时器/清理副作用——反正 flashMarks 只在 insertMarkLocal 时增长。
      const flashMarks: Record<string, number> = {}
      for (const [id, bornAt] of Object.entries(s.flashMarks)) {
        if (now - bornAt < 1000) flashMarks[id] = bornAt
      }
      flashMarks[m.id] = now
      return {
        analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks => byT([...marks, m])),
        selectedMarkId: m.id,
        flashMarks,
      }
    }),
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
  toggleRefLines: () => set(s => ({ refLinesOn: !s.refLinesOn })),
  // lastEntry doubles as its own counter: it's reset to null on take/video
  // switches (selectLane/selectTake/addTakeLocal/setAnalysis/clearAnalysis),
  // so reading its prior count here and falling back to 0 is all "简单自增，
  // 切 take 归零" needs — no separate module-level counter to keep in sync.
  recordEntry: label => set(s => ({ lastEntry: { label, count: (s.lastEntry?.count ?? 0) + 1 } })),
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
