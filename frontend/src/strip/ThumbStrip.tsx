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
  const count = video.sprite_count ?? 1
  const thumbW = video.thumb_w ?? 96
  const thumbH = video.thumb_h ?? 54
  const w = thumbW * count
  const durationMs = video.duration_ms || 1
  const fps = video.fps ?? 30
  const progress = Math.min(1, Math.max(0, playheadMs / durationMs))

  // 悬停/拖动时码气泡的水平像素位置（content 坐标系，含 scrollLeft，见
  // pxFromEvent）——组件内 state 即可，量级小不需要 rAF 节流（对照标尺
  // 那份 ghost line 的节流写法，此处 spec 明确"保持简单"）。
  const [hoverPx, setHoverPx] = useState<number | null>(null)
  const dragging = useRef(false)

  const pxFromEvent = (e: React.PointerEvent<HTMLDivElement>): number => {
    const el = e.currentTarget
    return e.clientX - el.getBoundingClientRect().left + el.scrollLeft
  }

  // seek 路径与标尺一致：帧取整 + clamp，px 计算沿用原 onClick 的
  // clientX - rect.left + scrollLeft（支持横向滚动后的缩略图带）。
  const seekToPx = (px: number) => {
    seekMs(clampMs(frameRound(stripPxToMs(px, w, durationMs), fps), durationMs))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    const px = pxFromEvent(e)
    setHoverPx(px)
    seekToPx(px)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const px = pxFromEvent(e)
    setHoverPx(px)
    if (dragging.current) seekToPx(px)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragging.current = false
  }

  // 捕获期间浏览器仍会派发 move，不影响拖动本身——leave 时直接清悬停即可。
  const onPointerLeave = () => setHoverPx(null)

  const hoverMs = hoverPx != null ? clampMs(frameRound(stripPxToMs(hoverPx, w, durationMs), fps), durationMs) : null

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
      <img src={api.spriteUrl(video.id)} width={w} height={thumbH} draggable={false} alt="缩略图带" />
      <div className="strip-progress" style={{ width: progress * w }} />
      <div className="strip-needle" style={{ left: progress * w }} />
      {hoverMs != null && (
        <div className="strip-hover-tc mono" style={{ left: hoverPx! }}>{fmtTc(hoverMs)}</div>
      )}
    </div>
  )
}
