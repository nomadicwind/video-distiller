import { useEffect } from 'react'
import { deleteSelected, insertAtPlayhead, nudgeSelected, tallyAtPlayhead } from './actions'
import type { Video } from './api/types'
import { frameStep, videoEl } from './player/Player'
import { useSession } from './state/store'

export function useHotkeys(video: Video): void {
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only genuine text-entry targets swallow hotkeys. Radio/checkbox/
      // button/range/file inputs (e.g. the lane radios and the entry-mode
      // checkbox in EntryPanel) must not — focusing one shouldn't kill
      // every hotkey until the user clicks elsewhere.
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA') return
      if (target instanceof HTMLInputElement
          && !['radio', 'checkbox', 'button', 'range', 'file'].includes(target.type)) return
      const st = useSession.getState()
      const lane = st.analysis?.lanes.find(l => l.id === st.laneId)
      if (st.entryMode && lane?.layer === 'L0' && /^[a-z0-9]$/i.test(e.key)) {
        // 录入模式下字母/数字优先作为 L0 打点，不再触发其他单键快捷键
        // (only while the current lane is L0 — other lanes don't render
        // the entry-mode panel/exit checkbox, so interception there would
        // trap the user with no way to turn it off from that lane)
        e.preventDefault()
        void insertAtPlayhead('input', e.key.toUpperCase())
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        const v = videoEl()
        if (v) v.paused ? void v.play() : v.pause()
      } else if (e.key === '[') {
        frameStep(-1, fps, durationMs)
      } else if (e.key === ']') {
        frameStep(1, fps, durationMs)
      } else if (e.key === ',') {
        void nudgeSelected(-10)
      } else if (e.key === '.') {
        void nudgeSelected(10)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        void deleteSelected()
      } else if (e.key === 'e' || e.key === 'E') {
        st.toggleEntryMode()
      } else if (e.key === 't' || e.key === 'T') {
        void tallyAtPlayhead()
      } else if (e.key === 'a' || e.key === 'A') {
        st.toggleAggregate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fps, durationMs])
}
