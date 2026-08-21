import { useEffect, useRef, useState } from 'react'
import type { Aggregate, Tally, Video } from '../api/types'
import { moveMark, toggleHolding } from '../actions'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { Toolbar } from './Toolbar'
import { draw, timelineHeight, type DragPreview } from './draw'
import {
  GUTTER_W, hitTestMark, holdingPatch, inRect, intervals, LANE_H, msToPx, panned, pillRect, pxToMs,
  RULER_H, snapMs, zoomed,
} from './layout'
import type { MarkLite, Viewport } from './layout'

const frameRound = (ms: number, fps: number): number => {
  const frame = 1000 / fps
  return Math.round(ms / frame) * frame
}

const clampMs = (ms: number, durationMs: number): number => Math.max(0, Math.min(ms, durationMs))

/**
 * Magnets a dragged mark can snap to (spec §6.3: "吸附开时对打表 marker/相邻
 * 标记 ±6px 吸附"): every tally flag's t_ms, plus the dragged mark's
 * immediate neighbors (by t_ms order) within its own take — not every mark
 * in the lane, which would make "adjacent" meaningless.
 */
function magnetsFor(marks: { id: string; t_ms: number }[], markId: string, tally: Tally[]): number[] {
  const magnets = tally.map(t => t.t_ms)
  const idx = marks.findIndex(m => m.id === markId)
  if (idx < 0) return magnets
  if (idx > 0) magnets.push(marks[idx - 1].t_ms)
  if (idx + 1 < marks.length) magnets.push(marks[idx + 1].t_ms)
  return magnets
}

/**
 * Δ 药丸命中测试，span-limited (code review): pillRect gets each interval's
 * own on-screen width so its hit-rect can never reach into a neighboring
 * interval or (for a 0ms-delta pair sharing an x) collide with a mark's own
 * hit-test. Shared by onPointerDown (must run BEFORE hitTestMark — see
 * onPointerDown's comment) and handleClick's fallback pill check.
 */
function findHitPill(marks: MarkLite[], v: Viewport, laneY: number, x: number, y: number) {
  for (const iv of intervals(marks)) {
    const spanPx = msToPx(v, iv.endMs) - msToPx(v, iv.startMs)
    if (inRect(pillRect(iv.midMs, v, laneY, spanPx), x, y)) return iv
  }
  return null
}

type DragState =
  | { kind: 'ruler' }
  | { kind: 'mark'; markId: string; startX: number; startY: number; moved: boolean; origTMs: number; pointerId: number }
  | { kind: 'click' }
  | null

export function Timeline({ video, aggregate }: { video: Video; aggregate: Aggregate | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const s = useSession()
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 10_000
  const [viewport, setViewport] = useState<Viewport>({
    startMs: 0, endMs: Math.min(10_000, durationMs), widthPx: 800,
  })

  // 悬停幽灵线（ghost line）/ 标尺气泡时码 — pointermove 期间 rAF 节流更新
  // （spec §9.4: 60fps；避免原生 pointermove 事件密度超过刷新率造成多余渲染）。
  const [hoverMs, setHoverMsState] = useState<number | null>(null)
  const hoverRaf = useRef<number | null>(null)
  const hoverPending = useRef<number | null>(null)
  const scheduleHover = (ms: number | null) => {
    hoverPending.current = ms
    if (hoverRaf.current != null) return
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = null
      setHoverMsState(hoverPending.current)
    })
  }

  // 标记拖动实时预览 — 同样 rAF 节流。
  const [dragPreview, setDragPreviewState] = useState<DragPreview | null>(null)
  const dragRaf = useRef<number | null>(null)
  const dragPending = useRef<DragPreview | null>(null)
  const scheduleDragPreview = (p: DragPreview | null) => {
    dragPending.current = p
    if (dragRaf.current != null) return
    dragRaf.current = requestAnimationFrame(() => {
      dragRaf.current = null
      setDragPreviewState(dragPending.current)
    })
  }

  // 播放头时码气泡的专用可见性信号（区别于 hoverMs 的幽灵线气泡）：标尺/手柄
  // scrub 拖动中为 true；标记拖动中由 dragPreview!==null 驱动（见 draw.ts）。
  const [scrubbing, setScrubbing] = useState(false)

  const dragStateRef = useRef<DragState>(null)

  // 容器尺寸变化（窗口缩放、面板分割拖动等）→ 立即重排画布（T7 遗留：挂载瞬
  // 间的初始尺寸短暂 150px、窗口缩放不重排，两任评审均见）。观察父元素而非
  // canvas 本身，因为下面的绘制 effect 正是靠 canvas.parentElement.clientWidth
  // 取内容宽度的。这里只需触发一次重渲染让该 effect（无依赖数组，每次渲染都
  // 跑）重新读取当前宽度——用一个从不被读取的计数器即可，state 本身不携带
  // 尺寸值。rAF 节流合并同一帧内的多次 ResizeObserver 回调，避免抖动。
  const [, setResizeTick] = useState(0)
  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    let raf: number | null = null
    const ro = new ResizeObserver(() => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        setResizeTick(t => t + 1)
      })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [])

  // 播放头出视口 → 自动跟随
  useEffect(() => {
    if (s.playheadMs < viewport.startMs || s.playheadMs > viewport.endMs) {
      const span = viewport.endMs - viewport.startMs
      const start = Math.max(0, Math.min(s.playheadMs - span / 4, durationMs - span))
      setViewport(v => ({ ...v, startMs: Math.round(start), endMs: Math.round(start + span) }))
    }
  }, [s.playheadMs])  // eslint-disable-line react-hooks/exhaustive-deps

  // 每次渲染重绘（store 订阅驱动）— requestAnimationFrame 统一节流（spec §9.4）。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !s.analysis) return
      const totalWidth = canvas.parentElement?.clientWidth ?? 800
      const contentWidth = Math.max(0, totalWidth - GUTTER_W)
      const v = { ...viewport, widthPx: contentWidth }
      const h = timelineHeight(s.analysis.lanes.length)
      const dpr = window.devicePixelRatio || 1
      canvas.width = totalWidth * dpr
      canvas.height = h * dpr
      canvas.style.width = `${totalWidth}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      draw(ctx, {
        lanes: s.analysis.lanes,
        currentLaneId: s.laneId,
        currentTakeId: s.takeId,
        selectedMarkId: s.selectedMarkId,
        playheadMs: s.playheadMs,
        tally: s.analysis.tally,
        aggregate,
        viewport: v,
        hoverMs,
        dragPreview,
        snapOn: s.snapOn,
        scrubbing,
      })
    })
    return () => cancelAnimationFrame(raf)
  })

  // Viewport.widthPx is track CONTENT width — the gutter (GUTTER_W) is
  // rendered by draw.ts inside the same canvas but is not part of it.
  const vp = (): Viewport => {
    const totalWidth = canvasRef.current?.parentElement?.clientWidth ?? 800
    return { ...viewport, widthPx: Math.max(0, totalWidth - GUTTER_W) }
  }

  const eventPos = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left - GUTTER_W, y: e.clientY - rect.top }
  }

  const seekToX = (x: number, v: Viewport) => {
    const raw = pxToMs(v, x)
    seekMs(clampMs(frameRound(raw, fps), durationMs))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const a = s.analysis
    const canvas = canvasRef.current
    if (!a || !canvas) return
    const { x, y } = eventPos(e)
    const v = vp()

    // 标尺区 / 播放头手柄（手柄全然落在标尺高度内）：立即 seek + 进入连续 scrub。
    if (y < RULER_H && x >= 0) {
      canvas.setPointerCapture(e.pointerId)
      dragStateRef.current = { kind: 'ruler' }
      setScrubbing(true)
      seekToX(x, v)
      return
    }

    if (y < RULER_H) { dragStateRef.current = null; return }

    const laneIdx = Math.floor((y - RULER_H) / LANE_H)
    const lane = a.lanes[laneIdx]
    if (!lane) { dragStateRef.current = null; return }
    if (lane.id !== s.laneId) {
      s.selectLane(lane.id)
      dragStateRef.current = null
      return
    }
    const take = lane.takes.find(t => t.id === s.takeId)
    if (!take) { dragStateRef.current = null; return }

    // Δ 药丸优先于标记命中测试：hitTestMark 只按 x 距离判断（±6px），完全不看
    // y，所以像 0ms-delta 相邻标记对这种 pill 与标记共享同一 x 的情形，会被
    // hitTestMark 抢先命中而吞掉药丸点击（code review repro）。药丸的 y 带
    // 固定在标记行下方（PILL_Y_OFFSET=18，与标记点 ±7px 的 y 带不重叠，参见
    // layout.ts），所以这里提前判断不会误伤正常的标记点击。
    if (findHitPill(take.marks, v, RULER_H + laneIdx * LANE_H, x, y)) {
      dragStateRef.current = { kind: 'click' }
      return
    }

    const hit = hitTestMark(take.marks, v, x)
    if (hit) {
      const m = take.marks.find(mm => mm.id === hit)!
      canvas.setPointerCapture(e.pointerId)
      dragStateRef.current = {
        kind: 'mark', markId: hit, startX: x, startY: y, moved: false,
        origTMs: m.t_ms, pointerId: e.pointerId,
      }
      return
    }

    // 空白 / Δ 药丸：既非标尺也非可拖动标记，语义留到 pointerup（原点击行为）。
    dragStateRef.current = { kind: 'click' }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const a = s.analysis
    const canvas = canvasRef.current
    if (!a || !canvas) return
    const { x, y } = eventPos(e)
    const v = vp()
    const drag = dragStateRef.current

    if (drag?.kind === 'ruler') {
      canvas.style.cursor = 'col-resize'
      seekToX(x, v)
      return
    }

    if (drag?.kind === 'mark') {
      const dx = x - drag.startX
      const dy = y - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < 3) return
      if (!drag.moved) {
        drag.moved = true
        s.selectMark(drag.markId)
        canvas.style.cursor = 'grabbing'
      }
      const lane = a.lanes.find(l => l.id === s.laneId)
      const take = lane?.takes.find(t => t.id === s.takeId)
      if (!take) return
      const raw = pxToMs(v, x)
      const magnets = s.snapOn ? magnetsFor(take.marks, drag.markId, a.tally) : []
      const snapped = snapMs(raw, fps, magnets, v)
      scheduleDragPreview({ markId: drag.markId, tMs: clampMs(snapped, durationMs) })
      return
    }

    // 无拖动进行中：更新 hover 幽灵线 + 光标反馈（grab/col-resize/默认）。
    // x<0 表示悬停在沟槽列（左侧轨道头），不属于时间轴内容区，不显示幽灵线。
    if (x < 0) {
      canvas.style.cursor = ''
      scheduleHover(null)
      return
    }
    if (y < RULER_H) {
      canvas.style.cursor = 'col-resize'
      scheduleHover(pxToMs(v, x))
      return
    }
    const laneIdx = Math.floor((y - RULER_H) / LANE_H)
    const lane = a.lanes[laneIdx]
    const take = lane?.id === s.laneId ? lane.takes.find(t => t.id === s.takeId) : undefined
    const overMark = take ? hitTestMark(take.marks, v, x) : null
    canvas.style.cursor = overMark ? 'grab' : ''
    scheduleHover(pxToMs(v, x))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    const drag = dragStateRef.current
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)

    if (drag?.kind === 'ruler') {
      setScrubbing(false)
      if (canvas) canvas.style.cursor = ''
      dragStateRef.current = null
      return
    }

    if (drag?.kind === 'mark') {
      if (canvas) canvas.style.cursor = ''
      if (drag.moved) {
        const finalTMs = dragPending.current?.tMs ?? drag.origTMs
        scheduleDragPreview(null)
        void moveMark(drag.markId, finalTMs)
      } else {
        // 未拖动过阈值 → 原点击语义：选中 + seek
        s.selectMark(drag.markId)
        seekMs(drag.origTMs)
      }
      dragStateRef.current = null
      return
    }

    if (drag?.kind === 'click') handleClick(e)
    dragStateRef.current = null
  }

  const onPointerLeave = () => {
    scheduleHover(null)
    if (canvasRef.current) canvasRef.current.style.cursor = ''
  }

  /** 空白处 seek（按帧取整）/ Δ 药丸 holding 切换 — 未拖动的原点击语义。 */
  const handleClick = (e: React.PointerEvent) => {
    const a = s.analysis
    if (!a) return
    const { x, y } = eventPos(e)
    if (y < RULER_H) return
    const laneIdx = Math.floor((y - RULER_H) / LANE_H)
    const lane = a.lanes[laneIdx]
    if (!lane || lane.id !== s.laneId) return
    const take = lane.takes.find(t => t.id === s.takeId)
    if (!take) return
    const v = vp()

    const hitIv = findHitPill(take.marks, v, RULER_H + laneIdx * LANE_H, x, y)
    if (hitIv) {
      const { markId, patch } = holdingPatch(hitIv, !hitIv.holding)
      void toggleHolding(markId, patch)
      return
    }

    // 已选中轨的空白处：播放头 seek 到点击处（按帧取整）— 不改变当前选中标记。
    const raw = pxToMs(v, x)
    seekMs(clampMs(frameRound(raw, fps), durationMs))
  }

  const onWheel = (e: React.WheelEvent) => {
    const v = vp()
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - GUTTER_W
    if (e.ctrlKey || e.metaKey) {
      setViewport(zoomed(v, e.deltaY > 0 ? 1.25 : 0.8, pxToMs(v, x), durationMs))
    } else {
      setViewport(panned(v, Math.round((e.deltaY + e.deltaX) * (v.endMs - v.startMs) / 1000), durationMs))
    }
  }

  if (!s.analysis) return null
  return (
    <>
      <Toolbar
        snapOn={s.snapOn}
        onSnap={s.toggleSnap}
        viewport={viewport}
        durationMs={durationMs}
        onViewport={setViewport}
      />
      <div className="tl-canvas-wrap">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
        />
      </div>
    </>
  )
}
