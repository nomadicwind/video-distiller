import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { Video } from '../api/types'
import { useSession } from '../state/store'
import { stepFrame } from '../time/frames'

export function videoEl(): HTMLVideoElement | null {
  return document.getElementById('vd-video') as HTMLVideoElement | null
}

export function frameStep(dir: 1 | -1, fps: number, durationMs: number): void {
  const v = videoEl()
  if (!v) return
  v.pause()
  v.currentTime = stepFrame(v.currentTime, fps, dir, durationMs / 1000)
}

export function seekMs(tMs: number): void {
  const v = videoEl()
  if (v) v.currentTime = tMs / 1000
}

/**
 * Renders just the <video> element inside the monitor frame (black inset,
 * object-fit: contain). Playback controls live in sibling Transport, which
 * drives this element through the exported videoEl()/frameStep()/seekMs()
 * functions above — their signatures are load-bearing for hotkeys.ts,
 * Timeline, ThumbStrip and InferPanel, and stay unchanged here.
 */
export function Player({ video }: { video: Video }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const setPlayhead = useSession(s => s.setPlayhead)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    let handle = 0
    const loop = (_now: number, meta: VideoFrameCallbackMetadata) => {
      setPlayhead(meta.mediaTime * 1000)
      handle = v.requestVideoFrameCallback(loop)
    }
    handle = v.requestVideoFrameCallback(loop)
    return () => v.cancelVideoFrameCallback(handle)
  }, [setPlayhead, video.id])

  const ratio = video.width && video.height ? `${video.width} / ${video.height}` : '16 / 9'

  return (
    <div className="monitor" style={{ aspectRatio: ratio }}>
      <video ref={ref} id="vd-video" src={api.videoFileUrl(video.id)} />
    </div>
  )
}
