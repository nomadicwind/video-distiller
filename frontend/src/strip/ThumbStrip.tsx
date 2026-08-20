import { api } from '../api/client'
import type { Video } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'

export function ThumbStrip({ video }: { video: Video }) {
  const playheadMs = useSession(s => s.playheadMs)
  const count = video.sprite_count ?? 1
  const thumbW = video.thumb_w ?? 96
  const thumbH = video.thumb_h ?? 54
  const w = thumbW * count
  const durationMs = video.duration_ms ?? 1
  const x = (playheadMs / durationMs) * w

  return (
    <div
      className="strip"
      style={{ overflowX: 'auto', position: 'relative', height: thumbH }}
      onClick={e => {
        const el = e.currentTarget
        const px = e.clientX - el.getBoundingClientRect().left + el.scrollLeft
        seekMs((px / w) * durationMs)
      }}
    >
      <img src={api.spriteUrl(video.id)} width={w} height={thumbH} draggable={false} alt="缩略图带" />
      <div style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 2, background: 'red' }} />
    </div>
  )
}
