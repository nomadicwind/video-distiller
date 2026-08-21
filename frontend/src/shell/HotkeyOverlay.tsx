import { useEffect } from 'react'
import { isTextEntryTarget } from '../hotkeys'
import { useSession } from '../state/store'
import { Card } from '../ui/Card'
import { Keycap } from '../ui/Keycap'

/** spec §4 StatusBar / §8#7 快捷键发现修复：完整快捷键清单，两列展示。 */
const HOTKEYS: { keys: string[]; label: string }[] = [
  { keys: ['空格'], label: '播放/暂停' },
  { keys: ['[', ']'], label: '逐帧' },
  { keys: [',', '.'], label: '微移 ±10ms' },
  { keys: ['Delete'], label: '删除标记' },
  { keys: ['T'], label: '打表' },
  { keys: ['E'], label: '录入模式' },
  { keys: ['A'], label: '聚合' },
  { keys: ['S'], label: '吸附' },
  { keys: ['Home'], label: '跳开头' },
  { keys: ['?'], label: '本浮层' },
]

/**
 * 全局快捷键浮层（spec §4/§8#7）：`useSession.showHotkeys` 受控，挂载在
 * App.tsx 顶层——不像 useHotkeys(video) 那样只在 Workbench 存在，因此这里
 * 自带一份最小的全局 keydown 监听来处理开/关，覆盖资料库等无视频页面。
 *
 * '?' 的处理只在这一处：hotkeys.ts 的 useHotkeys 特意不再响应 '?'，否则
 * Workbench 内会被两个监听器各触发一次、开了又关（见 hotkeys.ts 注释）。
 *
 * 焦点分流（code review fix）：'?' 走 isTextEntryTarget 守卫——聚焦在真正
 * 的文本输入框时（如资料库的 B 站 URL 框，`?p=2` 这类查询串很常见）必须让
 * 字符正常输入，不能既吞掉字符又弹出浮层。Escape 则不受此守卫：浮层是模态
 * 遮罩，即便焦点恰好落在某个输入框里，按 Escape 也该照样把它关掉——这与
 * "文本框里单键字母不触发快捷键"是两条不同的规则，前者关乎"会打字"，后者
 * 关乎"关闭一个正盖在整个页面上的模态"。
 */
export function HotkeyOverlay(): JSX.Element | null {
  const show = useSession(s => s.showHotkeys)
  const toggleHotkeys = useSession(s => s.toggleHotkeys)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useSession.getState().showHotkeys) toggleHotkeys()
        return
      }
      if (e.key === '?' && !isTextEntryTarget(e.target)) {
        e.preventDefault()
        toggleHotkeys()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleHotkeys])

  if (!show) return null
  return (
    <div className="hotkey-mask" onClick={() => toggleHotkeys()}>
      {/* stopPropagation：点击卡片本体不应算作点遮罩关闭 */}
      <div className="hotkey-mask-inner" onClick={e => e.stopPropagation()}>
        <Card title="快捷键">
          <div className="hotkey-grid">
            {HOTKEYS.map((row, i) => (
              <div className="hotkey-row" key={i}>
                <span className="hotkey-keys">
                  {row.keys.map((k, ki) => <Keycap key={ki} label={k} inert />)}
                </span>
                <span className="hotkey-label">{row.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
