import { useEffect, useRef, useState } from 'react'
import type { Aggregate, Video } from '../api/types'
import { useSession } from '../state/store'
import { draw, timelineHeight } from './draw'
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

  if (!s.analysis) return null
  return <canvas ref={canvasRef} />
}
