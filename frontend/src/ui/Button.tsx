import type { ReactNode } from 'react'
import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Tooltip } from './Tooltip'

/* forwardRef (additive, no existing call site passes a ref today): needed so
   ConfirmDialog (M14 任务 1) can set initial keyboard focus on its 取消
   button without duplicating <button className="btn ..."> markup. */
export const Button = forwardRef<HTMLButtonElement, {
  variant?: 'primary' | 'ghost' | 'danger' | 'icon'
  size?: 'md' | 'sm'
  icon?: ReactNode
  tip?: string
  disabled?: boolean
  active?: boolean
  /** M14 任务 4 小扩展：长耗时操作（上传、拉取远端视频……）进行中时传
   * true——图标替换为旋转的 Loader2（.btn-spinner，遵 prefers-reduced-motion
   * 全站归零规则）、按钮自动禁用，调用方不用额外传 disabled。 */
  loading?: boolean
  onClick?: () => void
  children?: ReactNode
}>(function Button(props, ref) {
  const { variant = 'ghost', size = 'md', icon, tip, disabled, active, loading, onClick, children } = props
  const isDisabled = disabled || loading
  const shownIcon = loading ? <Loader2 className="btn-spinner" /> : icon
  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    active ? 'is-active' : '',
    shownIcon && !children ? 'btn-icon-only' : '',
  ].filter(Boolean).join(' ')

  // Icon-only button: the tooltip text is the only human-readable label,
  // so it must also reach assistive tech via aria-label (a bare icon glyph
  // has no accessible name otherwise).
  const ariaLabel = tip && shownIcon && !children ? tip : undefined

  const button = (
    <button
      ref={ref}
      type="button"
      className={classes}
      disabled={isDisabled}
      aria-pressed={active}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {shownIcon ? <span className="btn-icon-glyph">{shownIcon}</span> : null}
      {children ? <span className="btn-label">{children}</span> : null}
    </button>
  )

  if (tip) {
    return <Tooltip tip={tip}>{button}</Tooltip>
  }
  return button
})
