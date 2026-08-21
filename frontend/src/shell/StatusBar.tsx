import type { ReactNode } from 'react'
import { Fragment } from 'react'
import { HOTKEYS } from './hotkeyList'

/** M5 复查修复 #5：这条中央提示只挑 hotkeyList 里 `statusbar: true` 的行，
 * 不再自己维护一份独立清单。文案（`statusbarLabel` 覆盖、`keys.join(' ')`
 * 拼出的按键文本）与今天上线的可见字符逐字节一致。 */
const STATUSBAR_HOTKEYS = HOTKEYS.filter(h => h.statusbar)

export function StatusBar({ left, right }: {
  left?: ReactNode
  right?: ReactNode
}): JSX.Element {
  return (
    <div className="statusbar">
      <div className="statusbar-left">{left}</div>
      <div className="statusbar-center">
        {STATUSBAR_HOTKEYS.map((h, i) => (
          <Fragment key={i}>
            <span><b>{h.keys.join(' ')}</b> {h.statusbarLabel ?? h.label}</span>
            {i < STATUSBAR_HOTKEYS.length - 1 && <span className="statusbar-sep">·</span>}
          </Fragment>
        ))}
      </div>
      <div className="statusbar-right">{right}</div>
    </div>
  )
}
