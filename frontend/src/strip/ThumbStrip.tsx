import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { Video } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { clampMs, fmtTc, frameRound } from '../time/frames'
import { stripPxToMs } from './stripMath'

const STRIP_H = 56

export function ThumbStrip({ video }: { video: Video }): JSX.Element {
  const playheadMs = useSession(s => s.playheadMs)
  const thumbH = video.thumb_h ?? 54
  const durationMs = video.duration_ms || 1
  const fps = video.fps ?? 30
  const progress = Math.min(1, Math.max(0, playheadMs / durationMs))

  // 悬停/拖动时码气泡：{px, ms} 一起存——px 用于气泡跟随光标定位，ms 用
  // fmtTc 显示。两者都在 pointer 事件里用当次 getBoundingClientRect().width
  // （渲染宽度，见 measure 下方）算出，量级小不需要 rAF 节流。
  const [hover, setHover] = useState<{ px: number; ms: number } | null>(null)
  const dragging = useRef(false)

  // 精灵图按原生宽度（thumbW*count）铺满，早前用它做 px↔ms 换算——但缩略图
  // 带现在用 width:100% 撑满容器（不再横向滚动），换算必须用容器的渲染宽度
  // （getBoundingClientRect().width），否则点击带内 50% 处会算成整段视频的
  // 前 15%（controller 报告的 gap）。px 也不再叠加 scrollLeft（带内已无滚动）。
  const measure = (e: React.PointerEvent<HTMLDivElement>): { px: number; ms: number } => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const ms = clampMs(frameRound(stripPxToMs(px, rect.width, durationMs), fps), durationMs)
    return { px, ms }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    const m = measure(e)
    setHover(m)
    seekMs(m.ms)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = measure(e)
    setHover(m)
    if (dragging.current) seekMs(m.ms)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragging.current = false
  }

  // 捕获期间浏览器仍会派发 move，不影响拖动本身——leave 时直接清悬停即可。
  const onPointerLeave = () => setHover(null)

  return (
    <div
      className="strip"
      style={{ height: STRIP_H }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={onPointerLeave}
    >
      {/* width:100% 撑满容器（不再按精灵原生宽度铺满导致横向滚动）——缩略
          图会被压扁/拉伸，但这里只是导航用的纹理条，真实画面看监视器。 */}
      <img src={api.spriteUrl(video.id)} height={thumbH} draggable={false} alt="缩略图带" />
      <div className="strip-progress" style={{ width: `${progress * 100}%` }} />
      <div className="strip-needle" style={{ left: `${progress * 100}%` }} />
      {hover != null && (
        <div className="strip-hover-tc mono" style={{ left: hover.px }}>{fmtTc(hover.ms)}</div>
      )}
    </div>
  )
}
