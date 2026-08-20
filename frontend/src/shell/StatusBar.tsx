import type { ReactNode } from 'react'

export function StatusBar({ left, right }: {
  left?: ReactNode
  right?: ReactNode
}): JSX.Element {
  return (
    <div className="statusbar">
      <div className="statusbar-left">{left}</div>
      <div className="statusbar-center">
        <span><b>空格</b> 播放</span>
        <span className="statusbar-sep">·</span>
        <span><b>[ ]</b> 逐帧</span>
        <span className="statusbar-sep">·</span>
        <span><b>T</b> 打表</span>
        <span className="statusbar-sep">·</span>
        <span><b>E</b> 录入</span>
        <span className="statusbar-sep">·</span>
        <span><b>?</b> 全部</span>
      </div>
      <div className="statusbar-right">{right}</div>
    </div>
  )
}
