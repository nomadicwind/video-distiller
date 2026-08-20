import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useSession } from '../state/store'
import { stepFrame } from '../time/frames'

const RATES = [0.25, 0.5, 1, 2]

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

export function Player({ videoId, fps, durationMs }: { videoId: string; fps: number; durationMs: number }) {
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
  }, [setPlayhead, videoId])

  return (
    <div className="player">
      <video ref={ref} id="vd-video" src={api.videoFileUrl(videoId)} />
      <div className="player-controls">
        {RATES.map(r => (
          <button key={r} onClick={() => { const v = videoEl(); if (v) v.playbackRate = r }}>
            {r}×
          </button>
        ))}
        <button onClick={() => frameStep(-1, fps, durationMs)}>◀ 上一帧 [</button>
        <button onClick={() => frameStep(1, fps, durationMs)}>] 下一帧 ▶</button>
      </div>
    </div>
  )
}
