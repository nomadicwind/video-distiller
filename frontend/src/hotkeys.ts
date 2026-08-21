import { useEffect } from 'react'
import { deleteSelected, insertAtPlayhead, nudgeSelected, tallyAtPlayhead } from './actions'
import type { Video } from './api/types'
import { auditionMark, frameStep, seekMs, togglePlay } from './player/Player'
import { currentTake, useSession } from './state/store'
import { redo, undo } from './state/undo'
import { clampMs, frameRound } from './time/frames'

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
        // (this is also why R's ref-lines toggle below never fires while
        // entry mode + L0 are both active: R matches /^[a-z0-9]$/i and gets
        // claimed here first, same as every other L0_KEYS letter/digit.)
        e.preventDefault()
        const label = e.key.toUpperCase()
        void insertAtPlayhead('input', label).then(() => {
          // 打点成功后才记 —— 鼠标点击 EntryPanel 里的键帽走的是另一条路径
          // （直接调用 insertAtPlayhead），不经过这里，所以不会驱动
          // lastEntry；这是有意的，见 store.ts recordEntry 的注释。
          useSession.getState().recordEntry(label)
        })
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
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
      } else if (e.key === 'r' || e.key === 'R') {
        // e.repeat guard: a one-shot toggle, not something to spam while the
        // key is held (same reasoning as I/O/L/P below). The entry-mode+L0
        // branch above already claims 'r'/'R' first when both are active —
        // see its comment — so this only ever fires otherwise.
        if (e.repeat) return
        st.toggleRefLines()
      } else if (e.key === 'Home') {
        // 浏览器默认把 Home 当作"滚动到页面顶部"处理，需要显式拦截。
        e.preventDefault()
        seekMs(0)
      } else if (e.key === 'i' || e.key === 'I') {
        // e.repeat guard (here and in the O/L/P branches below): I/O/L/P are
        // one-shot toggles/actions, not something that should spam-fire while
        // the key is held down (autorepeat), unlike frame-step's [ / ].
        if (e.repeat) return
        const rounded = clampMs(frameRound(st.playheadMs, fps), durationMs)
        if (st.abLoop.aMs === rounded) {
          // 同点再按清除（brief §要点）：新值等于已设值则视为"取消"。
          st.setLoopA(null)
        } else if (!st.setLoopA(rounded)) {
          // a>=b 无效（round 1 review：否则 L 打开后播放会在 A==B 处卡死）
          // —— store 的 setLoopA 拒绝并原样返回 false，这里只负责给提示。
          st.setHintText('入点须在出点之前')
        }
      } else if (e.key === 'o' || e.key === 'O') {
        if (e.repeat) return
        const rounded = clampMs(frameRound(st.playheadMs, fps), durationMs)
        if (st.abLoop.bMs === rounded) {
          st.setLoopB(null)
        } else if (!st.setLoopB(rounded)) {
          // b<=a 无效：忽略设置，复用 StatusBar 左侧提示位给出瞬时反馈。
          st.setHintText('出点须在入点之后')
        }
      } else if (e.key.toLowerCase() === 'l') {
        if (e.repeat) return
        if (e.shiftKey) st.clearLoop()
        else st.toggleLoop()
      } else if (e.key === 'p' || e.key === 'P') {
        if (e.repeat) return
        const take = currentTake(st)
        const mark = take?.marks.find(m => m.id === st.selectedMarkId)
        if (mark) auditionMark(mark.t_ms, durationMs)
      }
      // '?' 打开快捷键浮层由 shell/HotkeyOverlay.tsx 自带的全局监听处理——
      // 该浮层不受 Workbench 挂载与否影响（资料库页也要能打开），若这里也
      // 处理同一个按键，Workbench 内会被两个监听器各触发一次，开了又关。
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fps, durationMs])
}
