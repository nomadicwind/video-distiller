# M7 人工标注体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把人工 L0 标注打磨为一等工作流：撤销/重做安全网、实时打点反馈、A-B 区间循环跟打、标记试听验证、跨层参考线；并把"L0 只能人工标注或执行日志回灌、画面不可推断按键"固化为项目方法论。

**Architecture:** 全前端 + 文档（后端零改动）。撤销栈落在 actions 层（记录逆操作，复用既有 API）；A-B 循环与试听在 Player 模块加受控循环状态；参考线与入出点是时间轴绘制层的可开关叠加；反馈动画由 store 短时状态驱动。

**Tech Stack:** 既有栈，无新依赖。

**Spec:** 本计划 Global Constraints 即契约。方法论依据：设计 spec §13.2（L0 是推断而非观察）与用户裁定（2026-08-21）：**L0 完全由人标注，画面信息不得用于推断按键；执行日志回灌因来自真实事件而豁免**。

## Global Constraints

- **后端零改动**（backend/ 不触碰；后端 181 测试终验跑一次证明未动）
- **方法论红线**（文档任务落地）：L0 标记来源仅两种——人工标注、执行日志回灌（provenance=execution_log）；任何"从画面/视频推断按键序列"的功能永不加入；CONTEXT.md 与 README 明文化
- 撤销/重做为**会话级**（刷新即清），覆盖四类操作：插入标记、删除标记、移动标记（拖动与 , . 微移）、holding 切换；Cmd/Ctrl+Z 撤销、Cmd/Ctrl+Shift+Z 重做；栈上限 100；不含 take/tally 操作（YAGNI）
- 撤销实现方式：actions 层每次成功 API 调用后压入逆操作描述（如插入→逆=删除该 id；删除→逆=以原字段重插（新 id，栈内引用随之更新）；移动→逆=patch 回原 t_ms；holding→逆=反向 patch）；撤销执行时同样走 API+本地 store 更新，保证前后端一致
- A-B 循环：I 设入点、O 设出点（取当前播放头，帧取整）、L 开关循环；循环开启且有 A<B 时播放越过 B 即 seek 回 A；入出点在标尺下沿绘制角标与浅色区带；清除 = 再按 I/O 于同一点或 Shift+L 清空
- 试听验证：选中标记按 P → seek 到 t_ms-400ms 播放至 t_ms+400ms 自动暂停（边界钳制）；期间播放头正常驱动
- 跨层参考线：L0 泳道内可开关显示当前分析 L1 当前选中 take 各标记时刻的垂直参考虚线（--lane-l1 色 30%、顶部小三角），默认关，快捷键 R 切换，工具栏有开关按钮（tip 注明"仅显示参考，不产生数据"）
- 实时反馈：新插入标记 300ms 放大淡入动画（canvas 侧用 store 记录 {markId, bornAt} 短时态）；录入模式下 StatusBar 左侧显示最近按键与本 take 计数（如 `E · 本 take 第 7 个`）；键帽面板对应键 120ms 按压态
- 快捷键新增（I/O/L/P/R/Cmd+Z/Cmd+Shift+Z）全部登记到 hotkeyList.ts 单源（浮层自动同步）；文本输入守卫沿用 isTextEntryTarget；既有绑定全保留
- 每任务收尾 `cd frontend && pnpm build && pnpm test`（52 起点）全绿；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；无裸 hex；hooks 高于早返回

---

## File Structure

- Create `frontend/src/state/undo.ts`（撤销栈：类型、push、undo/redo 执行器）
- Modify `frontend/src/actions.ts`（四类操作接入栈）、`frontend/src/hotkeys.ts`、`frontend/src/shell/hotkeyList.ts`
- Modify `frontend/src/player/Player.tsx`（A-B 循环与试听的播放控制辅助）、`frontend/src/state/store.ts`（abLoop{aMs,bMs,on}、refLinesOn、flashMarks、lastEntry 短时态）
- Modify `frontend/src/timeline/{draw.ts,Toolbar.tsx,Timeline.tsx}`（入出点角标/区带、参考虚线、闪烁动画、R 开关按钮）
- Modify `frontend/src/shell/StatusBar.tsx` 接线处（Workbench 传录入反馈）
- Modify `CONTEXT.md`（L0 词条方法论红线）、`README.md`（标注方法论 + M7 段）
- Test: `frontend/src/state/undo.test.ts`（新）、client.test.ts 不动

---

### 任务 1：撤销/重做栈

**Files:**
- Create: `frontend/src/state/undo.ts`
- Modify: `frontend/src/actions.ts`、`frontend/src/hotkeys.ts`、`frontend/src/shell/hotkeyList.ts`
- Test: `frontend/src/state/undo.test.ts`

**Interfaces（Produces）:**

```ts
// state/undo.ts —— 模块级栈（非 React 状态；会话级）
export type UndoEntry =
  | { kind: 'insert'; markId: string }                                  // 逆=删除
  | { kind: 'delete'; takeId: string; snapshot: MarkSnapshot }          // 逆=重插
  | { kind: 'move'; markId: string; fromTMs: number; toTMs: number }    // 逆=patch 回 from
  | { kind: 'holding'; markId: string; patch: HoldPatch; inverse: HoldPatch }
export interface MarkSnapshot { t_ms: number; end_ms: number | null; kind: 'input' | 'release'; label: string | null }

export function pushUndo(e: UndoEntry): void          // 压栈（清空 redo 栈；上限 100 丢最旧）
export async function undo(): Promise<boolean>        // 弹栈执行逆操作（API+store 本地更新）；空栈 false
export async function redo(): Promise<boolean>
export function _resetForTest(): void
```

- actions.ts 接入点：`insertAtPlayhead` 成功后 push insert；`deleteSelected` 删除前取快照 push delete；`nudgeSelected` 与 Timeline 拖动提交（`moveMark`，在 actions 中）push move；`toggleHolding` push holding（正/逆 patch 由 holdingPatch 推导）
- delete 的逆操作重插会产生**新 id**：重插成功后需扫描两栈，把旧 id 引用替换为新 id（栈内一致性；测试覆盖）
- undo/redo 期间不再压 undo 栈（执行器内部走底层 api+store，不走 actions 包装；redo 栈由 undo 压入）
- hotkeys：Cmd/Ctrl+Z → undo，Cmd/Ctrl+Shift+Z → redo（文本输入守卫沿用；`e.metaKey||e.ctrlKey` 判断）；hotkeyList 增两行（statusbar 不展示，浮层展示）

- [ ] **Step 1: 失败测试**（undo.test.ts：mock api 层（vi.mock client），断言四类操作的逆操作调用序列、栈上限丢弃、redo 清空语义、delete→undo 重插后 id 引用替换、空栈返回 false）
- [ ] **Step 2: 实现 → Step 3: `pnpm build && pnpm test` 全绿 → Step 4: Commit** `feat(frontend): session undo redo stack`

---

### 任务 2：A-B 区间循环与试听验证

**Files:**
- Modify: `frontend/src/state/store.ts`（`abLoop: { aMs: number | null; bMs: number | null; on: boolean }` + setA/setB/toggleLoop/clearLoop）、`frontend/src/player/Player.tsx`（循环检查：timeupdate/rVFC 回调里 `on && a!=null && b!=null && cur>b → seekMs(a)`；试听 `auditionMark(tMs)`：seek(t-400) 播放，到 t+400 自动 pause——用一次性监听）
- Modify: `frontend/src/hotkeys.ts`（I/O 取播放头帧取整设点、同点再按清除；L 切换、Shift+L 清空；P 对选中标记试听）、`frontend/src/shell/hotkeyList.ts`（+4 行）
- Modify: `frontend/src/timeline/draw.ts`（标尺下沿：A/B 角标（accent 小旗）+ A-B 浅色区带 8% accent）、`frontend/src/timeline/Timeline.tsx`（传 abLoop 入 TimelineData）

**要点:** 循环边界帧取整；b<=a 时设置 b 无效（忽略并在 StatusBar 短暂提示"出点须在入点之后"——复用现有提示位，无新组件）；试听期间按任意播放控制立即取消自动暂停监听。

- [ ] **Step 1: store 状态 + Player 辅助 → Step 2: hotkeys/绘制 → Step 3: `pnpm build && pnpm test` + 浏览器自查（设 A/B、循环回跳、P 试听自动停） → Step 4: Commit** `feat(frontend): ab loop and mark audition`

---

### 任务 3：跨层参考线与实时打点反馈

**Files:**
- Modify: `frontend/src/state/store.ts`（`refLinesOn: boolean` + toggle；`flashMarks: Record<string, number>`（markId→bornAt，insertMarkLocal 时写入）；`lastEntry: { label: string; count: number } | null`）
- Modify: `frontend/src/timeline/draw.ts`（L0 泳道内绘制 L1 当前 take 各标记的垂直虚线（--lane-l1 30% + 顶部小三角）；flash 标记按 `min(1, (now-bornAt)/300)` 插值半径 8→5 与透明度）、`frontend/src/timeline/Timeline.tsx`（flash 存在期间 rAF 连续重绘 300ms）、`frontend/src/timeline/Toolbar.tsx`（R 开关按钮，tip"L1 参考线（仅显示，不产生数据）· R"）
- Modify: `frontend/src/panel/EntryPanel.tsx`（键帽 120ms 按压态：录入模式按键时对应 Keycap 加 .keycap-pressed 类——store lastEntry 驱动）、`frontend/src/hotkeys.ts`（录入模式插入成功后更新 lastEntry；R 绑定）、StatusBar 接线（Workbench 传 left：录入模式时显示 `录入模式 · 最近 {label} · 本 take 第 {count} 个`）、`frontend/src/shell/hotkeyList.ts`（+1 行 R）

**要点:** 参考线取 L1 泳道**当前选中 take**（与聚合无关）；L1 无标记时开关仍可用但无线；count = 当前 take 本会话插入计数（简单自增，切 take 归零）。

- [ ] **Step 1: store 短时态 → Step 2: 绘制与反馈 → Step 3: `pnpm build && pnpm test` + 浏览器自查（开 R 见虚线、打点见闪烁、状态栏计数、键帽按压） → Step 4: Commit** `feat(frontend): cross-layer reference lines and live entry feedback`

---

### 任务 4：方法论文档与收尾

**Files:**
- Modify: `CONTEXT.md`（L0/标记相关词条追加红线句："L0 标记只能来自人工标注或执行日志回灌；从视频画面推断按键序列被明确禁止（用户裁定 2026-08-21，spec §13.2）"——按词表现有格式融入，不破坏词表纯粹性）
- Modify: `README.md`（新增"标注方法论"小节：L0 人工性红线、多 Take 聚合与对齐校验是为人工误差设计、执行日志回灌豁免缘由；"M7 · 人工标注体验"段：撤销重做/AB 循环/试听/参考线/实时反馈 + 全部新快捷键表）

- [ ] **Step 1: 写作 → Step 2: 双套件全量（后端 181 证明未动 + 前端全绿） → Step 3: Commit** `docs: manual-only L0 methodology and m7 features`

---

## 计划外（明确不做）

- 任何形式的画面→按键推断（永久排除，非本里程碑限定）
- 波形/音频辅助；Take 差异对比视图；速度斜坡；打点音效
- take/tally 操作入撤销栈；跨会话撤销持久化
