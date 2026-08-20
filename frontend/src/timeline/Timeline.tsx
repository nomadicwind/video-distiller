import { useEffect, useRef, useState } from 'react'
import type { Aggregate, Video } from '../api/types'
import { toggleHolding } from '../actions'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { draw, timelineHeight } from './draw'
import { checkboxRect, hitTestMark, holdingPatch, inRect, intervals, LANE_H, panned, pxToMs, TOP_H, zoomed } from './layout'
import type { Viewport } from './layout'

export function Timeline({ video, aggregate }: { video: Video; aggregate: Aggregate | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const s = useSession()
  const durationMs = video.duration_ms ?? 10_000
  const [viewport, setViewport] = useState<Viewport>({
    startMs: 0, endMs: Math.min(10_000, durationMs), widthPx: 800,
  })

  // 播放头出视口 → 自动跟随
  useEffect(() => {
    if (s.playheadMs < viewport.startMs || s.playheadMs > viewport.endMs) {
      const span = viewport.endMs - viewport.startMs
      const start = Math.max(0, Math.min(s.playheadMs - span / 4, durationMs - span))
      setViewport(v => ({ ...v, startMs: Math.round(start), endMs: Math.round(start + span) }))
    }
  }, [s.playheadMs])  // eslint-disable-line react-hooks/exhaustive-deps

  // 每次渲染重绘（store 订阅驱动）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !s.analysis) return
    const width = canvas.parentElement?.clientWidth ?? 800
    const v = { ...viewport, widthPx: width }
    const h = timelineHeight(s.analysis.lanes.length)
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = h * dpr
    canvas.style.width = `${width}px`
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
    })
  })

  const vp = (): Viewport =>
    ({ ...viewport, widthPx: canvasRef.current?.parentElement?.clientWidth ?? 800 })

  const onClick = (e: React.MouseEvent) => {
    const a = s.analysis
    const canvas = canvasRef.current
    if (!a || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const yPos = e.clientY - rect.top
    const laneIdx = Math.floor((yPos - TOP_H) / LANE_H)
    const lane = a.lanes[laneIdx]
    if (!lane) return
    if (lane.id !== s.laneId) { s.selectLane(lane.id); return }
    const take = lane.takes.find(t => t.id === s.takeId)
    if (!take) return
    const v = vp()
    for (const iv of intervals(take.marks)) {
      if (inRect(checkboxRect(iv.midMs, v, TOP_H + laneIdx * LANE_H), x, yPos)) {
        const { markId, patch } = holdingPatch(iv, !iv.holding)
        void toggleHolding(markId, patch)
        return
      }
    }
    const hit = hitTestMark(take.marks, v, x)
    s.selectMark(hit)
    if (hit) {
      const m = take.marks.find(mm => mm.id === hit)!
      seekMs(m.t_ms)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const v = vp()
    const rect = canvasRef.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      setViewport(zoomed(v, e.deltaY > 0 ? 1.25 : 0.8, pxToMs(v, e.clientX - rect.left), durationMs))
    } else {
      setViewport(panned(v, Math.round((e.deltaY + e.deltaX) * (v.endMs - v.startMs) / 1000), durationMs))
    }
  }

  if (!s.analysis) return null
  return <canvas ref={canvasRef} onClick={onClick} onWheel={onWheel} />
}
