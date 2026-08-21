/**
 * 全局快捷键单一数据源（M5 复查修复 #5）：HotkeyOverlay（'?' 浮层）和
 * StatusBar 中央提示条过去各自维护一份快捷键清单，容易走样。这里统一成
 * 一份——HotkeyOverlay 渲染全部行；StatusBar 只挑 `statusbar: true` 的
 * 子集。两个界面历史上对同一个键给出的措辞并不总相同（比如空格在浮层里
 * 是"播放/暂停"，状态条里只写"播放"），为了不改动今天的可见文案，允许用
 * `statusbarLabel` 覆盖 StatusBar 那一份的文字；缺省时两处共用 `label`。
 */
export interface HotkeyRow {
  keys: string[]
  label: string
  /** 是否也出现在 StatusBar 中央提示条。 */
  statusbar?: boolean
  /** StatusBar 一侧的文案覆盖（历史上比浮层里的说明更短）；不填则用 label。 */
  statusbarLabel?: string
}

export const HOTKEYS: HotkeyRow[] = [
  { keys: ['空格'], label: '播放/暂停', statusbar: true, statusbarLabel: '播放' },
  { keys: ['[', ']'], label: '逐帧', statusbar: true },
  { keys: [',', '.'], label: '微移 ±10ms' },
  { keys: ['Delete'], label: '删除标记' },
  { keys: ['⌘/Ctrl + Z'], label: '撤销' },
  { keys: ['⌘/Ctrl + Shift + Z'], label: '重做' },
  { keys: ['T'], label: '打表', statusbar: true },
  { keys: ['E'], label: '录入模式', statusbar: true, statusbarLabel: '录入' },
  { keys: ['A'], label: '聚合' },
  { keys: ['S'], label: '吸附' },
  // M7 任务 3：跨层参考线（仅展示 L1 当前 take 的标记位置，不产生数据）。
  { keys: ['R'], label: 'L1 参考线（仅展示）' },
  { keys: ['Home'], label: '跳开头' },
  // M7 任务 2：A-B 区间循环 + 试听。
  { keys: ['I'], label: '设入点 A（同点再按清除）' },
  { keys: ['O'], label: '设出点 B（同点再按清除）' },
  { keys: ['L', 'Shift + L'], label: '循环 A-B ／ 清空循环' },
  { keys: ['P'], label: '试听所选标记' },
  // 滚轮平移/缩放发现性修复（M5 复查修复 #4）：Timeline.onWheel 早已支持，
  // 只是浮层和工具栏提示都没写出来。
  { keys: ['滚轮'], label: '平移时间轴' },
  { keys: ['⌘/Ctrl + 滚轮'], label: '缩放时间轴' },
  { keys: ['?'], label: '本浮层', statusbar: true, statusbarLabel: '全部' },
]
