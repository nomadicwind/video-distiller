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
  /** 录入模式下"最近一次打点"的标签与本 take 内的插入序号（M7 任务 3）：EntryStrip 据此给对应键帽加 120ms 按压态，StatusBar 据此显示"本 take 第 N 个"。切 take / 切视频都应清零 —— 见 selectTake/setAnalysis/clearAnalysis。 */
  lastEntry: { label: string; count: number } | null
  /**
   * 当前视频一帧的时长（ms），供 entry/gap.ts 的最小间距预检使用（M9 任务
   * 2，语义与 backend/src/vd/store.py `_take_frame_ms` 一致：
   * round(1000/fps)）。默认 34，直到 Workbench 挂载 effect 按
   * `video.fps ?? 30` 算出真实值并调用 setFrameMs。
   *
   * 与 lastEntry 不同，这里刻意不在 setAnalysis/clearAnalysis 里重置——那两个
   * 在每次切视频时触发，而 setFrameMs 由 Workbench 挂载 effect 独立调用；若
   * 在这里重置就可能在 effect 跑之前把值抢回默认值，产生竞态。
   */
  frameMs: number

  /**
   * 对比模式（M12 任务 2）。`compareVideoId`/`compareOffsetMs` 是会话级镜像
   * ——独立于 `analysis.compare_video_id`/`compare_offset_ms`（同样在
   * setCompareConfig/clearCompareConfig 里保持同步），这样 Task 3 的 UI 可以
   * 直接订阅这两个顶层字段，不必每次都下钻 analysis。
   *
   * `compareOn` 是会话内开关（离开页面/切视频不持久化到后端）：配置存在
   * （compareVideoId != null）才可能为 true —— toggleCompareOn 据此拒绝在
   * 无配置时开启（见下方守卫，同 setLoopA/setLoopB 的既有惯例）。
   *
   * `calibrating` 是校准态标志：真值时 B 暂时脱离跟随、可独立定位
   * （global-constraints §校准流），且主播放头据此暂停（Task 3 消费）。
   */
  compareVideoId: string | null
  compareOffsetMs: number
  compareOn: boolean
  calibrating: boolean

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
  /** Workbench 挂载 effect 按当前视频 fps 调用（见 App.tsx），供 entry/gap.ts 预检使用；不受 setAnalysis/clearAnalysis 影响，见 frameMs 字段注释。 */
  setFrameMs: (ms: number) => void
  /**
   * 保存/更新一份对比配置（saveCompare 在 PATCH 成功后调用，见
   * actions.ts）。与 setAnalysis 不同，这里只动对比相关字段，不触碰
   * laneId/takeId/selectedMarkId 等标注位置状态——切换/校准对比视频不应该
   * 把用户从当前泳道/take 甩回去。同步写回 analysis.compare_* 字段，保持
   * 与顶层镜像一致。设置一份新配置隐含"现在应该开着"，故 compareOn 一并
   * 置 true（与 setAnalysis 的初始化规则一致）。
   */
  setCompareConfig: (videoId: string, offsetMs: number) => void
  /** clearCompare（actions.ts）在 PATCH 清除成功后调用；同样只复位对比字段。 */
  clearCompareConfig: () => void
  /** 会话内开关；无配置（compareVideoId 为 null）时拒绝开启，关闭则始终允许——与 toggleLoop 的守卫惯例一致。 */
  toggleCompareOn: () => void
  /** 进入/退出校准态；退出即恢复跟随（global-constraints §B 永远从动）。 */
  setCalibrating: (on: boolean) => void
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
  refLinesOn: false, flashMarks: {}, lastEntry: null, frameMs: 34,
  compareVideoId: null, compareOffsetMs: 0, compareOn: false, calibrating: false,

  setAnalysis: a => {
    const lane = a.lanes[0] ?? null
    const take = lane ? lane.takes[lane.takes.length - 1] : null
    // A new analysis tree means a different (or freshly reloaded) video —
    // any undo/redo history from before this belongs to marks/takes that
    // don't exist in the new tree, so it must not survive the switch.
    clearUndoHistory()
    // hintText (e.g. "入点须在出点之前") is per-video transient feedback too —
    // and its setTimeout must be cancelled here, not just the field cleared,
    // or a hint scheduled just before the switch would still land ~3s later
    // and clear whatever the new video's own hint set in the meantime.
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    // M12 任务 3 复查修复：a *refetch* of the SAME analysis id (e.g.
    // WorkbenchTopContext's keymap-bind handler does
    // api.getAnalysis(id).then(setAnalysis)) must not clobber a compareOn
    // the user already toggled off in this session — re-deriving compareOn
    // from a.compare_video_id unconditionally silently reverted a user's
    // "关闭对比" back to on every time an unrelated PATCH round-tripped
    // through setAnalysis. Only a genuinely different analysis (a real video
    // switch) re-derives compareOn from whether a compare config exists on
    // the incoming tree; compareVideoId/compareOffsetMs still always mirror
    // the incoming tree either way, same as before.
    const prev = get()
    const sameAnalysis = prev.analysis?.id === a.id
    const compareVideoId = a.compare_video_id ?? null
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
      lastEntry: null, flashMarks: {}, hintText: null,
      // M12: a new analysis carries its own compare config (or none) — a
      // stale compareVideoId/compareOffsetMs from the previous video would
      // otherwise point B at a video/offset that means nothing here. Having
      // a config defaults compareOn to true on a genuine switch (brief
      // §要点); on a same-id refetch the user's current compareOn survives
      // instead (see comment above) — clamped to false if the refetch
      // somehow shows no config, since compareOn can never be true without
      // one (same invariant toggleCompareOn enforces). calibrating is
      // per-session UI state, always false on any setAnalysis call.
      compareVideoId,
      compareOffsetMs: a.compare_offset_ms ?? 0,
      compareOn: sameAnalysis ? (prev.compareOn && compareVideoId != null) : compareVideoId != null,
      calibrating: false,
    })
  },
  // Clears the per-video session window. `entryMode` is intentionally left
  // untouched — it's a persistent UI preference, not video-scoped state, so
  // switching videos shouldn't silently drop the annotator out of it.
  clearAnalysis: () => {
    clearUndoHistory()
    // Same reasoning as setAnalysis above: cancel the pending hint timer, not
    // just the field, so a stale hint can't reappear ~3s after the clear.
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    set({
      analysis: null, laneId: null, takeId: null, selectedMarkId: null,
      playheadMs: 0, showAggregate: false, abLoop: emptyAbLoop(),
      lastEntry: null, flashMarks: {}, hintText: null,
      // M12 §要点: "clearAnalysis 全部复位" — no analysis means no compare
      // config, so all four fields go back to their empty defaults.
      compareVideoId: null, compareOffsetMs: 0, compareOn: false, calibrating: false,
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
  setFrameMs: ms => set({ frameMs: ms }),
  // See interface doc: deliberately narrow — only touches compare fields
  // (+ their analysis.compare_* mirror) so saving/updating a compare config
  // never disturbs the user's current lane/take/selection, unlike a full
  // setAnalysis replace.
  setCompareConfig: (videoId, offsetMs) => set(s => ({
    compareVideoId: videoId, compareOffsetMs: offsetMs, compareOn: true,
    analysis: s.analysis && { ...s.analysis, compare_video_id: videoId, compare_offset_ms: offsetMs },
  })),
  clearCompareConfig: () => set(s => ({
    compareVideoId: null, compareOffsetMs: 0, compareOn: false, calibrating: false,
    analysis: s.analysis && { ...s.analysis, compare_video_id: null, compare_offset_ms: null },
  })),
  // Same guarded-toggle shape as toggleLoop: turning off always succeeds;
  // turning on requires a config to already exist (compareVideoId != null).
  // Off also resets calibrating — otherwise switching off mid-calibration
  // (B frozen, A unpaused, 「以当前两帧对齐」 armed) then back on would
  // silently re-enter calibration with B remounted fresh at 0 (final review
  // F1).
  toggleCompareOn: () => set(s => {
    if (s.compareOn) return { compareOn: false, calibrating: false }
    return s.compareVideoId != null ? { compareOn: true } : {}
  }),
  setCalibrating: on => set({ calibrating: on }),
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
