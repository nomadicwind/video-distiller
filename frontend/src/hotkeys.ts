import { useEffect } from 'react'
import { deleteSelected, insertAtPlayhead, nudgeSelected, tallyAtPlayhead } from './actions'
import type { Video } from './api/types'
import { frameStep, seekMs, videoEl } from './player/Player'
import { useSession } from './state/store'
import { redo, undo } from './state/undo'

/**
 * Only genuine text-entry targets swallow single-key hotkeys entirely
 * (typing '?' in the B站 URL box, digits in a "keymap id" field, etc. must
 * reach the field, not fire a shortcut). Radio/checkbox/button/range/file
 * inputs (e.g. the lane radios and the entry-mode checkbox in EntryPanel)
 * are NOT text entry — focusing one must not kill every hotkey until the
 * user clicks elsewhere. Shared by useHotkeys and HotkeyOverlay's global
 * '?' listener (code review: HotkeyOverlay had no guard, so '?' typed into
 * a plain input both lost the character and popped the overlay open).
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === 'TEXTAREA') return true
  return target instanceof HTMLInputElement
    && !['radio', 'checkbox', 'button', 'range', 'file'].includes(target.type)
}

export function useHotkeys(video: Video): void {
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target)) return
      // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z checked first (and unconditionally on
      // entryMode) so a modifier-held Z is never swallowed by the L0
      // single-letter entry-mode branch below, and so it also overrides the
      // browser's own undo — hence preventDefault regardless of stack state.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.repeat) return // ignore key-autorepeat from a held-down combo
        if (e.shiftKey) void redo()
        else void undo()
        return
      }
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
      } else if (e.key === 's' || e.key === 'S') {
        st.toggleSnap()
      } else if (e.key === 'Home') {
        // 浏览器默认把 Home 当作"滚动到页面顶部"处理，需要显式拦截。
        e.preventDefault()
        seekMs(0)
      }
      // '?' 打开快捷键浮层由 shell/HotkeyOverlay.tsx 自带的全局监听处理——
      // 该浮层不受 Workbench 挂载与否影响（资料库页也要能打开），若这里也
      // 处理同一个按键，Workbench 内会被两个监听器各触发一次，开了又关。
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fps, durationMs])
}
