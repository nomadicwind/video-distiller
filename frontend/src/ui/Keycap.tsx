export function Keycap({ label, onClick, wide, inert, pressed, armed }: {
  label: string
  onClick?: () => void
  wide?: boolean
  /** Display-only keycap (e.g. ChordPreview/HotkeyOverlay): drops it from the tab order — it has no onClick, so a focusable, keyboard-activatable button there is a screen-reader/keyboard trap with no effect. */
  inert?: boolean
  /**
   * M7 任务 3：录入模式下物理键盘打点成功时，EntryPanel 给对应键帽临时
   * (120ms) 加上的按压态——不同于鼠标点击自带的 :active 伪类（那只在鼠标
   * 真正按住这枚键帽时生效），这个 prop 是由 store 的 lastEntry 驱动的，
   * 键盘打点根本没碰这枚 DOM 元素也能看到反馈。
   */
  pressed?: boolean
  /**
   * M8 任务 2：面板 Ctrl/Alt/Shift 修饰 chip 的粘滞点亮态——EntryPanel 的
   * 本地 armed 状态驱动，持续到某个基键键帽消费它为止（不像 `pressed` 那样
   * 120ms 自动摘除）。视觉上也要与 `pressed` 区分：这是静态高亮，不做下沉
   * 位移，所以两者可以同时出现在同一枚 chip 上互不冲突（见 .keycap-armed）。
   */
  armed?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className={`keycap${wide ? ' keycap-wide' : ''}${inert ? ' keycap-inert' : ''}${pressed ? ' keycap-pressed' : ''}${armed ? ' keycap-armed' : ''}`}
      tabIndex={inert ? -1 : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
