import { useEffect, useRef } from 'react'
import { Button } from './Button'

/**
 * 破坏性操作确认对话框（M14 任务 1：只建组件，接线在任务 3/4——目前没有
 * 任何调用点）。无 portal：fixed 定位 div 足够，这个应用没有嵌套 overflow
 * 裁切上下文需要跳出。
 *
 * Esc 关闭：自己的 keydown 监听器在冒泡阶段 stopPropagation，防止事件继续
 * 冒泡到 window 上的全局热键监听器（hotkeys.ts/HotkeyOverlay.tsx 都挂在
 * window，冒泡阶段——弹层在 DOM 树里更靠内层，先于 window 收到事件）。
 *
 * 焦点：挂载时聚焦一次到"取消"（effect 依赖数组为空，父组件重渲染/传入新
 * 的内联 onCancel 不会重新跑这个 effect、抢走用户已经移动到别处的焦点）；
 * Esc 要读到的是"当前那次"onCancel，不是挂载时闭包住的那份，所以走
 * onCancelRef（每次渲染都更新，effect 本身不依赖它）。Tab/Shift+Tab 在
 * 取消/确认两个可聚焦元素之间循环（复查修复 #2：焦点陷阱）。
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        onCancelRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const first = cancelRef.current
      const last = confirmRef.current
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 id="confirm-dialog-title" className="confirm-title">{title}</h2>
        <p className="confirm-body">{body}</p>
        <div className="confirm-actions">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>取消</Button>
          <Button ref={confirmRef} variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
