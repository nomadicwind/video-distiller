import { useEffect } from 'react'
import type { Video } from './api/types'
import { frameStep, videoEl } from './player/Player'

export function useHotkeys(video: Video): void {
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') {
        e.preventDefault()
        const v = videoEl()
        if (v) v.paused ? void v.play() : v.pause()
      } else if (e.key === '[') {
        frameStep(-1, fps, durationMs)
      } else if (e.key === ']') {
        frameStep(1, fps, durationMs)
      }
      // 后续任务在此追加：, . Delete（任务 19）；录入模式与 E（任务 20）；T（任务 21）；A（任务 22）
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fps, durationMs])
}
