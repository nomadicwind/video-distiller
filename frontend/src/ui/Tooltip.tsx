import type { ReactNode } from 'react'

export function Tooltip({ tip, children, wrap }: {
  tip: string
  children: ReactNode
  /** M5 复查修复 #1：长文本（原始 LLM/鉴权错误串）不能挤成一行冲出视口——
   * 传 wrap 换成换行+限宽的变体（见 ui.css `.tip-wrap`）。 */
  wrap?: boolean
}): JSX.Element {
  return (
    <span className={wrap ? 'tip tip-wrap' : 'tip'} data-tip={tip}>
      {children}
    </span>
  )
}
