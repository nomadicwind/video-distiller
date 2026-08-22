# M11 全面拖动定位与监视器放大 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复用户裁定的两个严重可用性问题（2026-08-22）：①视频监视器太小且无放大手段；②鼠标拖动找时间几乎不可用——scrub 只存在于 28px 标尺带，缩略图带仅单击、泳道画布空白拖动无响应、默认视口只显示前 10s 导致播放时视口整页跳动。

**Architecture:** 纯前端三步：①ThumbStrip 升级为全长 scrubber（指针捕获拖动 + 播放头针线 + 悬停时码），Timeline 默认视口改为全长；②时间轴画布全表面 scrub——把标尺现行为（按下即 seek + 捕获连续拖动 + 时码气泡）扩展到泳道内容区空白，命中优先级 Δ药丸 > 标记 > 空白 scrub 不变；③监视器/时间轴之间加水平分割条（拖动调时间轴面板高度、localStorage 持久化、双击复位）+ 监视器全屏（按钮 + 双击）。

**Tech Stack:** 既有栈，无新依赖。

**Spec:** 本计划 Global Constraints 即契约；用户裁定 2026-08-22（视频太小看不清；时间轴无法拖动找时间、前后定位困难）。

## Global Constraints

- **后端零改动**（backend/ 不触碰；186 测试终验一跑证明未动）
- **既有语义不动**：标记拖动/吸附磁铁/Δ药丸 holding/AB 循环角标/参考线/undo 管线/录入打点全部保持；既有前端测试不改断言（任务 1 起点以 `pnpm test` 实际输出为准，预期 121，全程只增不减）
- **scrub 统一语义**：以标尺现行为为基准（pointerdown 立即 seek（帧取整 clamp）+ setPointerCapture 连续 scrub + scrubbing 时码气泡 + `col-resize` 光标），扩展到泳道内容区空白与 ThumbStrip；**命中优先级不变**：Δ药丸 > 标记 > 空白 scrub（药丸/标记仍只在选中泳道当前 take 命中）
- 沟槽列（x<0，泳道头）保持纯选择语义，不触发 scrub
- **默认视口 = 全长**：Timeline 挂载初始 viewport 为 `{startMs: 0, endMs: durationMs}`（等价打开即"适配全长"）；播放头出视口自动跟随逻辑保持不动
- **分割条**：位于缩略图带行与时间轴面板行之间，6px、`cursor: row-resize`；拖动设置时间轴面板高度，`clampTlHeight` 纯函数 clamp（min 180px，max = 视口高−320px，max<min 时取 min）；localStorage key `vd.tl-h` 持久化；双击复位为 auto（内容自然高度）并清除存储；时间轴面板小于内容高度时 `.tl-canvas-wrap` 纵向滚动（加 `overflow-y: auto`）
- **全屏**：监视器容器（`.monitor` div）`requestFullscreen`；入口 = Transport 右侧按钮（Maximize 图标，lucide）+ 视频双击；Esc 走原生退出；**不新增键盘快捷键**（F 已被键帽录入占用）；`document.fullscreenElement` 存在时按钮/双击执行 `exitFullscreen`
- hooks 高于早返回；无裸 hex（色值走 tokens.css 变量）；ui 套件复用；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

- Create `frontend/src/strip/stripMath.ts`（`stripPxToMs` 纯函数）+ `frontend/src/strip/stripMath.test.ts`
- Modify `frontend/src/strip/ThumbStrip.tsx`（scrubber 化）、strip 相关 CSS（.strip 所在文件，针线/气泡类）
- Modify `frontend/src/timeline/Timeline.tsx`（默认视口全长；空白 scrub；handleClick 缩减为仅药丸）
- Create `frontend/src/shell/splitMath.ts`（`clampTlHeight` 纯函数）+ `frontend/src/shell/splitMath.test.ts`
- Modify `frontend/src/App.tsx`（Workbench 分割条行 + 时间轴行高受控）、`frontend/src/styles.css`（grid 行调整、splitter、canvas-wrap overflow-y、fullscreen 态）
- Modify `frontend/src/player/Player.tsx`（`toggleMonitorFullscreen` 导出 + monitor 双击）、`frontend/src/player/Transport.tsx`（全屏按钮）
- Modify `README.md`（M11 段 + 旧表述更正注记）；StatusBar 常态提示文案核对（"点击时间轴定位" → 如实改为拖动定位表述）

---

### 任务 1：ThumbStrip 全长 scrubber + 默认视口全长

**Files:**
- Create: `frontend/src/strip/stripMath.ts`、`frontend/src/strip/stripMath.test.ts`
- Modify: `frontend/src/strip/ThumbStrip.tsx`、strip 样式所在 CSS、`frontend/src/timeline/Timeline.tsx`（仅 viewport 初值一处）

**Interfaces（Produces）:**

```ts
// strip/stripMath.ts
export function stripPxToMs(px: number, stripW: number, durationMs: number): number
// stripW <= 0 → 0；px/stripW 比例 clamp 到 [0,1]；返回 Math.round(ratio * durationMs)
```

**要点:**
- ThumbStrip 改指针事件：`onPointerDown` = `setPointerCapture` + 立即 seek + `dragging.current = true`；`onPointerMove` = 更新悬停时码位置，dragging 时连续 seek；`onPointerUp`/`onPointerCancel` = 释放捕获、dragging false；`onPointerLeave` 清悬停（捕获期间浏览器仍派发 move，不影响拖动）
- seek 路径与标尺一致：`seekMs(clampMs(frameRound(stripPxToMs(px, w, durationMs), fps), durationMs))`（fps = `video.fps ?? 30`；`clampMs`/`frameRound` 自 `time/frames`）；px 计算沿用现 onClick 的 `clientX - rect.left + scrollLeft`
- 视觉：进度遮罩保留；新增播放头针线（2px、`var(--accent)`、绝对定位于 `progress * w`，含顶部小握把圆点）+ 悬停时码气泡（mono 小字、跟随光标 x，dragging 或 hover 时显示）；`cursor: col-resize`
- Timeline.tsx 仅改一处：`useState<Viewport>` 初值 `endMs: Math.min(10_000, durationMs)` → `endMs: durationMs`（打开即全长；durationMs 挂载时已知）
- stripMath 测试：stripW=0 → 0；px<0 → 0；px>stripW → durationMs；中点 → durationMs/2（round）；负 durationMs 不需支持（上游保证 ≥0，注释说明即可）

- [ ] **Step 1: stripMath 失败测试 → Step 2: 实现全部 → Step 3: `pnpm build && pnpm test` 全绿（基线+新） → Step 4: Commit** `feat(frontend): thumbstrip full-length scrubber and fit-all default viewport`

---

### 任务 2：时间轴画布全表面 scrub

**Files:**
- Modify: `frontend/src/timeline/Timeline.tsx`

**要点:**
- `onPointerDown` 泳道分支重构（标尺分支、药丸分支、标记分支原样不动）：
  - `x < 0`（沟槽列）：`lane.id !== s.laneId` 时 `s.selectLane(lane.id)`；`dragStateRef.current = null`；return——纯选择
  - 内容区、未选中泳道：`s.selectLane(lane.id)` 后**继续进入 scrub**（不再提前 return）：`setPointerCapture` + `{kind:'ruler'}` + `setScrubbing(true)` + `seekToX(x, v)`（选中 + 定位一步完成；此按下不做药丸/标记命中——它们本就只在选中泳道命中）
  - 内容区、已选中泳道：药丸命中 → `{kind:'click'}`（原样）；标记命中 → mark 拖动（原样）；**空白 → scrub**（同上标尺四件套，替换原 `{kind:'click'}`）
  - take 缺失（`!take`）时空白同样进入 scrub（定位不依赖 take）
- `handleClick` 缩减：只保留 Δ药丸 holding 切换分支；空白 seek 分支删除（已由按下即 seek 取代）；方法注释同步
- `onPointerMove` 无拖动态的光标：泳道内容区空白悬停光标改 `col-resize`（与可 scrub 语义一致；标记悬停仍 `grab`）
- 既有测试不改断言；`pnpm build && pnpm test` 全绿

- [ ] **Step 1: 实现 → Step 2: `pnpm build && pnpm test` 全绿 → Step 3: Commit** `feat(frontend): whole-surface timeline scrubbing`

---

### 任务 3：分割条 + 监视器全屏 + 文档

**Files:**
- Create: `frontend/src/shell/splitMath.ts`、`frontend/src/shell/splitMath.test.ts`
- Modify: `frontend/src/App.tsx`、`frontend/src/styles.css`、`frontend/src/player/Player.tsx`、`frontend/src/player/Transport.tsx`、`README.md`

**Interfaces（Produces）:**

```ts
// shell/splitMath.ts
export function clampTlHeight(px: number, viewportH: number): number
// min=180；max=Math.max(min, viewportH-320)；返回 Math.min(max, Math.max(min, Math.round(px)))
```

```ts
// player/Player.tsx 新增导出
export function toggleMonitorFullscreen(): void
// document.fullscreenElement 有值 → exitFullscreen；否则对 videoEl() 的父容器（.monitor）requestFullscreen；videoEl() 为 null 时 no-op
```

**要点:**
- **分割条**：Workbench 状态 `tlH: number | null`（初值读 `localStorage['vd.tl-h']`，无效/缺失 → null）；`.workbench-grid` 行模板改为内联样式五行 `minmax(0,1fr) auto auto 6px ${tlH != null ? clampTlHeight(tlH, window.innerHeight) + 'px' : 'auto'}`；新增 `.workbench-splitter` div（grid-column 1/-1、grid-row 4、`cursor: row-resize`、hover 高亮 `var(--accent)` 细线）；`.workbench-timeline` grid-row 4 → 5（CSS 同步）；inspector `grid-row: 1 / 4` 不变
- 拖动：splitter `onPointerDown` 捕获，`onPointerMove` 以 grid 容器 `getBoundingClientRect().bottom - e.clientY` 为新高度经 `clampTlHeight` 后 `setTlH`；`onPointerUp` 释放并写 localStorage；`onDoubleClick` → `setTlH(null)` + 移除存储
- `.tl-canvas-wrap` 增 `overflow-y: auto`（面板矮于内容时内部纵向滚动，100vh 无页滚动框架不破）
- **全屏**：Player.tsx 导出 `toggleMonitorFullscreen`；`.monitor` div 加 `onDoubleClick={toggleMonitorFullscreen}`；Transport 右端（时码之后）加 ghost 小按钮（`Maximize` 图标，tip「全屏 · 双击画面同效」）调用同函数；CSS `.monitor:fullscreen { border-radius: 0; }`
- splitMath 测试：小于 min → 180；大于 max → viewportH−320；区间内取整通过；viewportH 极小（如 400 → max=180）→ 180
- StatusBar 常态提示 `点击时间轴定位 · 键帽或录入模式打点` → `拖动时间轴或缩略图带定位 · 键帽或录入模式打点`（App.tsx 内字符串，如实描述新交互）
- README：新增「M11 · 拖动定位与监视器」段（全表面 scrub、缩略图带 scrubber、默认全长视口、分割条、全屏）；旧段中"点击标尺定位"表述处加一行更正注记（不重写旧段）

- [ ] **Step 1: splitMath 失败测试 → Step 2: 实现全部 → Step 3: `pnpm build && pnpm test` 全绿 + 后端 `uv run pytest` 终验（186，证明未动） → Step 4: Commit** `feat(frontend): timeline splitter and monitor fullscreen`

---

## 计划外（明确不做）

- 时间轴内嵌视频缩略图轨（剪映式 clip 轨）；ThumbStrip 与时间轴合并
- 播放中自动跟随的平滑滚动动画；跟随开关
- 监视器画中画（PiP）；播放器原生 controls
- 分割条的左右向（inspector 宽度）拖动
- 触屏/双指手势
