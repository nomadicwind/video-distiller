# Video Distiller 设计系统 — 墨金武侠·影调暗色（M14）

> Master 全局真源。页面级偏差写 `design-system/pages/<page>.md`（存在即覆盖 Master 对应条目）。
> 产出自 ui-ux-pro-max 设计系统流程（2026-09-29，用户裁定方向 A）；实现唯一色值入口仍是 `frontend/src/tokens.css`——本文件是规范与理由，tokens.css 是代码真源，两者字段一一对应。

## 定位

中文界面、桌面优先（1280+ 主战场，900px 以下降级不破版）、长时段标注作业的专业暗色工具。气质对标：燕云十六声的水墨+鎏金；克制的影调，不做赛博 HUD。

## 色彩（语义令牌）

| 令牌 | 值 | 用途 |
|---|---|---|
| --bg-app | #0a0a0f | 应用底（body 线性渐变起点，168deg） |
| --bg-app-deep | #050506 | 应用底渐变终点（body 168deg 渐变的深端） |
| --bg-panel | #121217 | 面板 |
| --bg-elevated | #17171f | 卡片/行 |
| --bg-inset | #060609 | 内嵌（监视器槽、日志、输入框底） |
| --bg-control | #1e1e28 | 控件底 |
| --bg-control-hover | #262633 | 控件悬停 |
| --accent | #d4a24e | 鎏金主强调（选中、主按钮、播放头、焦点环） |
| --accent-hover | #e0b566 | 强调悬停 |
| --accent-soft | rgba(212,162,78,.14) | 强调弱底 |
| --on-accent | #14100a | 金底上的文字/图标色（深墨），对 --accent 8.19:1、对 --accent-hover 9.9:1——金面禁用 --text-1（1.88:1，不合格） |
| --border | rgba(255,255,255,.10) | 常规描边 |
| --border-subtle | rgba(255,255,255,.06) | 发丝线 |
| --scrim | rgba(0,0,0,.5) | 模态/浮层遮罩底（ConfirmDialog、HotkeyOverlay 统一） |
| --text-1 | #ece7dc | 主文（暖白，衬影调底） |
| --text-2 | #a8a294 | 次文 |
| --text-3 | #6b675d | 弱文 |
| --danger | #e5544b | 危险（删除、错误） |
| --warn | #d9873a | 警告 |
| --success | #7fae62 | 成功 |
| --lane-l0 | #5aa8d8 | L0 泳道（青蓝，与金区分） |
| --lane-l1 | #b083d8 | L1 泳道（紫） |
| --lane-l2 | #6cbf8e | L2 泳道（绿） |
| --selection | #ffd54a | 时间轴标记选中态高亮（画布内，非通用语义令牌）——例外沿用既有黄，刻意与 --accent 金色播放头/发光配额区分，选中态不应与播放头视觉混同 |

约束：组件内禁裸 hex（tokens.css 唯一定义点）；正文对比 ≥4.5:1、次文 ≥3:1（上表已按 #121217 底验算）；功能色必须配图标/文字，不得只靠颜色。

## 字体

| 角色 | 字族 | 回退 |
|---|---|---|
| 品牌/页标题（h1、TopBar 品牌） | "Noto Serif SC" 600/700 | "Songti SC", "SimSun", serif |
| 正文/UI（--font-ui） | "Noto Sans SC" 400/500 | "PingFang SC", "Microsoft YaHei", system-ui, sans-serif |
| 时码/数据（--font-mono） | "JetBrains Mono" 400/500 | ui-monospace, "SF Mono", Consolas, monospace |

加载：Google Fonts `@import` + `font-display: swap`；**离线必须可用**——回退栈本身即完整方案，断网时零布局灾难（serif 标题回退宋体族，气质保持）。字号阶梯 11/12/13(基准)/14/16/20；行高正文 1.5-1.6；数据列 `font-variant-numeric: tabular-nums`。

## 形态与效果

- 圆角：卡片/面板 12px（--radius-l）、控件 8px（--radius-m）、小件 5px（--radius-s）
- 层级靠表面色阶+发丝线表达，阴影只给浮层（Popover/Toast/模态：`0 8px 32px rgba(0,0,0,.5)`）
- 辉光**仅限三处**且各 ≤ `0 0 10px` 金色 20%：播放头针线、录入模式激活的键帽、当前选中泳道头；其余一律不发光
- 焦点环：`2px solid var(--accent)` offset 1px，全键盘可达
- 过渡 140-240ms ease-out 进 / ease-in 出；尊重 `prefers-reduced-motion`（动画归零）
- 图标：lucide 单一族，描边 1.5-2 统一，禁 emoji 做图标

## 交互语言

- 每屏一个金色主 CTA，次操作 ghost/描边；危险操作红且与主操作物理隔开、必确认
- 可点元素 cursor-pointer + 悬停底色变化 + 按压 scale(0.98)
- 空态 = 一句说明 + 一个行动按钮（禁纯灰字死端）；>1s 的加载给骨架/进度，禁纯转圈超过 3s
- 表单：标签常显（禁 placeholder 当标签）、错误贴字段下方、提交态 loading→成功/失败反馈
- 提示层级：hintText（状态栏，被动）< toast（3-5s 自消）< 确认对话框（破坏性）

## 页面覆盖（pages/ 偏差文件按需建）

工作台（信息密度最高，8-12px 间距档）；资料库/循环与方案（卡片列表，16px 档）；技能目录/键位（表单页，遵表单规范）；执行台（状态机页，状态色语义严格）。
