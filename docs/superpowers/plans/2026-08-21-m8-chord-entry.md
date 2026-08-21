# M8 组合键录入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 录入模式与键帽面板支持组合键打点（如 `Shift+2`、`Ctrl+Q`、`Shift+LMB`），产出既定的单字符串标签约定，与键位表/匹配器/导出层现有 chord 支持贯通。

**Architecture:** 键盘链路：纯函数 `composeEntryLabel` 从 `e.code` 取物理基键（免移位字符陷阱）+ Ctrl/Alt/Shift 规范序前缀；键帽面板：粘滞修饰键 chip（点亮一次、用后自清）。下游（对齐/键位匹配/emit）自 M1/M2 起已按 `"Shift+2"` 单字符串工作，零改动。

**Tech Stack:** 既有栈，无新依赖；纯前端。

**Spec:** 本计划 Global Constraints 即契约。标签约定沿用 CONTEXT.md 既有词条（组合键写成单字符串，`+` 连接）。

## Global Constraints

- **标签规范序**：修饰键按 `Ctrl+Alt+Shift` 固定顺序，基键在末（如 `Ctrl+Shift+2`）；单键行为与现状完全一致（大写字母/数字）
- **基键来源改为 `e.code`**（`Digit0-9`→数字、`KeyA-Z`→大写字母），修复 Shift+数字产生移位字符（`@`）被丢弃的缺陷；非 QWERTY 布局下按物理键位记号（README 注明）
- **Cmd/meta 组合一律不参与录入**（保留给应用/系统快捷键）；`Ctrl+Z`/`Ctrl+Shift+Z` 因 undo 分支先于录入分支执行天然不可达（现有顺序不动，评审核验）
- 键帽面板：Ctrl/Alt/Shift 三枚修饰 chip，点选点亮（可多选），点任意基键键帽（含 LMB/RMB/Wheel）后合成插入并自动清除点亮；空标记不受修饰影响；点亮态有明确视觉（accent）
- recordEntry/lastEntry、undo 栈、闪烁反馈对组合键标签自然生效（复用现链路，评审核验无特判遗漏）
- 后端零改动；`cd frontend && pnpm build && pnpm test`（89 起点）全绿；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；无裸 hex；hooks 高于早返回

---

## File Structure

- Create `frontend/src/entry/chord.ts`（composeEntryLabel 纯函数）+ `frontend/src/entry/chord.test.ts`
- Modify `frontend/src/hotkeys.ts`（录入分支改用 composeEntryLabel）
- Modify `frontend/src/panel/EntryPanel.tsx`（粘滞修饰 chip）
- Modify `README.md`（录入组合键说明）

---

### 任务 1：composeEntryLabel 与键盘链路

**Files:**
- Create: `frontend/src/entry/chord.ts`、`frontend/src/entry/chord.test.ts`
- Modify: `frontend/src/hotkeys.ts`

**Interfaces（Produces）:**

```ts
// entry/chord.ts
export interface ChordKeyEvent {
  code: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean
}
export function composeEntryLabel(e: ChordKeyEvent): string | null
// metaKey → null；code 非 Digit0-9/KeyA-Z → null；
// 前缀按 Ctrl,Alt,Shift 序拼接，'+' 连接基键；无修饰 → 纯基键
```

- hotkeys.ts 录入分支：`/^[a-z0-9]$/i.test(e.key)` 判定替换为 `const label = composeEntryLabel(e); if (label !== null) { ... }`（preventDefault/insert/recordEntry 逻辑不变，label 换为合成值）。注意：原判定用 `e.key`，Shift+2 的 `e.key === '@'` 不匹配故漏掉；新判定基于 `e.code`，Shift+2 命中——这正是本任务修复点
- 测试（全部纯函数级）：`{code:'Digit2',shiftKey:true}` → `'Shift+2'`；`{code:'KeyQ',ctrlKey:true}` → `'Ctrl+Q'`；三修饰全开 `code:'KeyA'` → `'Ctrl+Alt+Shift+A'`；无修饰 `Digit5` → `'5'`、`KeyE` → `'E'`；`metaKey:true` → null；`code:'Tab'`/`'Space'`/`'Comma'` → null；顺序无关性（shift+ctrl 与 ctrl+shift 同输出）

- [ ] **Step 1: 失败测试 → Step 2: 实现 → Step 3: `pnpm build && pnpm test` 全绿（89+新） → Step 4: Commit** `feat(frontend): chord entry via keyboard`

---

### 任务 2：键帽面板粘滞修饰键

**Files:**
- Modify: `frontend/src/panel/EntryPanel.tsx`（+ 少量 ui.css/styles.css 类）

**要点:**
- L0 键帽区顶部加一行三枚修饰 chip（Keycap 复用或小按钮）：Ctrl / Alt / Shift；本地 `useState<Set<'Ctrl'|'Alt'|'Shift'>>` 管理点亮（hooks 高于早返回）
- 基键键帽 onClick：`const label = [...(['Ctrl','Alt','Shift'] as const).filter(m => armed.has(m)), k].join('+')`；insertAtPlayhead 后 `setArmed(new Set())`；recordEntry 同步（面板路径现不 recordEntry——维持现状注释语义，不改）
- 点亮视觉：`.keycap-armed`（accent 边框 + accent-soft 底），与按压态区分
- 空标记按钮不受 armed 影响（点击也不清除 armed——只有基键消费才清）
- 提示文案：键帽区标题"在播放头处打点"后补小字"（点亮修饰键可组合）"

- [ ] **Step 1: 实现 → Step 2: `pnpm build && pnpm test` 全绿 + 浏览器自查（点 Shift → 点 2 → 标记 label 为 Shift+2 且修饰自清；Shift+LMB 同理；空标记不消费 armed；完成后删除测试标记恢复基线） → Step 3: Commit** `feat(frontend): sticky modifier keycaps`

---

### 任务 3：README

**Files:**
- Modify: `README.md`（录入相关段落：组合键支持、`Ctrl+Alt+Shift` 规范序、e.code 物理键位说明、Cmd 组合不参与、键帽粘滞修饰用法一句）

- [ ] **Step 1: 写作 → Step 2: 双套件全量 → Step 3: Commit** `docs: chord entry`

---

## 计划外（明确不做）

- 修饰键单独作为标记（纯 Shift 按下不产生标记）
- 组合键的按住（hold）语义（holding 仍由相邻标记 + 勾选推导，与单键一致）
- 键位表编辑器联动校验（已支持 chord 字符串，无需改）
- Meta/Cmd 组合录入
