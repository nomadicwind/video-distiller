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
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 id="confirm-dialog-title" className="confirm-title">{title}</h2>
        <p className="confirm-body">{body}</p>
        <div className="confirm-actions">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>取消</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
