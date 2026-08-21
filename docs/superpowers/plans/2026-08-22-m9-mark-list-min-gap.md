# M9 标记列表与最小间距 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①人工标注拒绝同帧级贴近的标记（服务端权威 + 前端友好预检）；②右侧标注面板去重复：移除与时间轴沟槽重复的泳道卡，主体更替为所选泳道当前 take 的标记列表，点选任一条目内联编辑（标签/时刻/按住/删除）。

**Architecture:** 后端：store 层最小间距校验（帧长 = 1000/视频 fps，联表取 fps），插入与移动生效，**execution_log 来源豁免**（真实事件如和弦天然同帧，不得裁剪）。前端：store 增 frameMs；actions 预检出提示（hintText）避免红色错误吐司；EntryPanel 重构为 MarkList + 内联编辑器，编辑走既有 patchMark/moveMark/delete 管线并接入 undo（新增 relabel 撤销类）。

**Tech Stack:** 既有栈，无新依赖。

**Spec:** 本计划 Global Constraints 即契约。间距阈值的原理依据：spec §4.4 测量精度 = ±1 帧——同帧内两标记超出系统自身分辨力。

## Global Constraints

- **最小间距规则**：同一 take 内，任意两标记 `|t1-t2| < frameMs`（frameMs = round(1000/fps)，fps 缺省 30）即拒绝；作用于**人工插入与移动**；`provenance='execution_log'` 的写入路径**豁免**（回灌真实事件不裁剪——和弦 down/tap 同帧是合法观察）；已有存量数据不迁移不追溯
- 服务端为权威：store.insert_mark / update_mark(t_ms 变更时) 抛 `ValueError("与相邻标记距离过近（同一帧内）")` → 既有 ValueError→400 映射（若插入/更新路由缺该映射则补齐，语义与相邻路由一致）
- 前端预检：actions 在调 API 前用 store 内当前 take 标记 + frameMs 同步判定；命中则 `setHintText('该位置与相邻标记过近（同一帧内），未打点')` 并**不发请求**（避免 j() 的红色错误吐司）；预检与服务端规则同式（纯函数共享测试）
- 面板重构边界：**移除泳道卡**（时间轴沟槽已承担泳道选择与状态显示）；保留 take 行（chips/新 Take/聚合）、录入开关、修饰芯片与键帽区（M8 成果，非重复项）、L1/L2 技能名输入；新增主体 = 标记列表（当前泳道当前 take，按 t 排序，占满剩余高度滚动）
- 列表行：mono 时码（fmtTc）+ kind 徽章（input/release→打点/空标记）+ 标签 + 按住锁形（end_ms 非空时）；点击行 = selectMark + seekMs（与时间轴选中双向同步，selectedMarkId 单源）；选中行自动 scrollIntoView（block:'nearest'）
- 内联编辑器（仅选中行展开）：标签 text 输入（L1/L2 带既有 used-labels datalist；失焦/Enter 提交，空值不提交）、时刻 number 输入(ms) + [−1帧][+1帧] 按钮、按住状态显示 + 「解除按住」（end_ms 非空时，走 clear_end）、删除（danger 图标）
- **undo 全覆盖**：时刻编辑复用既有 move 路径；删除/按住复用既有类；标签编辑新增 `relabel` 撤销类（{markId, fromLabel, toLabel}，逆=patch 回 fromLabel；rewriteMarkId 泛扫 markId 字段天然覆盖）
- hooks 高于早返回；无裸 hex；ui 套件复用；后端测试基线 181、前端 96，全程绿；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

- Modify `backend/src/vd/store.py`（`_take_frame_ms` 联表助手 + insert/update 校验）、`backend/src/vd/api.py`（仅当路由缺 ValueError→400 时补）
- Test `backend/tests/test_api.py` 或新 `test_min_gap.py`
- Create `frontend/src/entry/gap.ts`（`violatesMinGap(tMs, marks, frameMs, excludeId?)` 纯函数）+ 测试
- Modify `frontend/src/state/store.ts`（`frameMs` + setter；Workbench 挂载时设置）、`frontend/src/actions.ts`（insert/move 预检）、`frontend/src/App.tsx`（传 frameMs）
- Modify `frontend/src/state/undo.ts`（relabel 类）+ `undo.test.ts`
- Create `frontend/src/panel/MarkList.tsx`；Modify `frontend/src/panel/EntryPanel.tsx`（移除泳道卡、嵌入 MarkList）
- Modify `README.md`

---

### 任务 1：后端最小间距校验

**Files:**
- Modify: `backend/src/vd/store.py`、必要时 `backend/src/vd/api.py`
- Test: `backend/tests/test_min_gap.py`（新）

**Interfaces（Produces）:**

```python
def _take_frame_ms(conn, take_id) -> int
# takes→lanes→analyses→videos 联表取 fps（NULL→30），返回 round(1000/fps)

# insert_mark：_validate_mark 之后、写入之前：
#   provenance != 'execution_log' 且存在 |existing.t_ms - t_ms| < frame → ValueError("与相邻标记距离过近（同一帧内）")
# update_mark：仅当 fields 含 t_ms 时执行同检（排除自身 id；同 take）
```

- [ ] **Step 1: 失败测试**

```python
# backend/tests/test_min_gap.py 要点（用既有 test_api 的 client/analysis 助手风格）：
# 1) 插入 t=1000 后再插 t=1010（30fps 帧长 33ms）→ 400，报文含 "距离过近"
# 2) 插 t=1033 → 200（>= 帧长）
# 3) PATCH 移动至距邻 <33ms → 400；移回合法 → 200；对自身原位（t 不变）→ 200
# 4) execution_log 豁免：store.insert_mark(..., provenance='execution_log') 同 t_ms 两条 → 均成功（直连 store 层测）
# 5) 回灌回归：模拟含和弦的执行日志（down Shift 与 tap 2 同 t_ms）经 exec_backfeed 全量入库不 500（复用既有 exec 测试 monkeypatch 模式，构造 session.log 后调 backfeed）
```

- [ ] **Step 2: 确认失败 → Step 3: 实现（校验 SQL：`SELECT 1 FROM marks WHERE take_id=? AND id != ? AND ABS(t_ms - ?) < ? LIMIT 1`）→ Step 4: `uv run pytest` 全绿（181+5）→ Step 5: Commit** `feat(backend): reject sub-frame mark spacing for human annotation`

---

### 任务 2：前端预检与提示

**Files:**
- Create: `frontend/src/entry/gap.ts` + `frontend/src/entry/gap.test.ts`
- Modify: `frontend/src/state/store.ts`（`frameMs: number`（默认 34）+ `setFrameMs`；setAnalysis/clearAnalysis 不重置——由 Workbench 每次挂载设置）、`frontend/src/App.tsx`（Workbench 挂载 effect：`setFrameMs(Math.round(1000 / (video.fps ?? 30)))`）、`frontend/src/actions.ts`

**Interfaces:**

```ts
// entry/gap.ts
export function violatesMinGap(tMs: number, marks: { id: string; t_ms: number }[],
                               frameMs: number, excludeId?: string): boolean
```

- actions.insertAtPlayhead：POST 前取当前 take marks + frameMs 判定；命中 → `setHintText('该位置与相邻标记过近（同一帧内），未打点')` 并 return（不 POST、不入 undo）
- actions 的移动路径（applyMarkMove/moveMark 与 nudgeSelected 共用点）：同检（excludeId=被移标记）；命中 → hint `目标位置与相邻标记过近（同一帧内），未移动`，本地不变
- 测试：纯函数边界（差=frameMs-1 违规、=frameMs 合法、excludeId 生效、空列表合法）；actions 预检不发请求（vi.mock client 断言未调用）

- [ ] **Step 1: 失败测试 → Step 2: 实现 → Step 3: `pnpm build && pnpm test` 全绿（96+新）→ Step 4: Commit** `feat(frontend): client-side min-gap precheck with hint`

---

### 任务 3：面板重构（MarkList + 内联编辑 + relabel 撤销）

**Files:**
- Create: `frontend/src/panel/MarkList.tsx`
- Modify: `frontend/src/panel/EntryPanel.tsx`、`frontend/src/state/undo.ts`、`frontend/src/actions.ts`（`relabelMark(markId, newLabel)`）、`frontend/src/state/undo.test.ts`（追加）

**要点:**
- EntryPanel：删除泳道卡整块（含其样式引用）；布局改为「take 行 → 打点入口（录入开关/修饰芯片/键帽或技能输入，保持 M8 现状）→ MarkList（flex:1 滚动）」
- MarkList({ lane, take })：行渲染与交互按 Global Constraints；编辑器提交路径：
  - 标签：`relabelMark` = pushUndo({kind:'relabel',...}) 后 `api.patchMark(id,{label})` + `updateMarkLocal`（顺序与既有 actions 一致：成功后入栈——对齐 insert 的“成功后 push”模式）
  - 时刻：直接调既有 moveMark（含预检+吸附不适用——列表输入为精确值，仅走任务 2 的 min-gap 预检）；[±1帧] = moveMark(current ± frameMs)
  - 解除按住：复用 toggleHolding 逆向（clear_end patch + undo holding 类）
  - 删除：复用 deleteSelected 语义（但按 markId 而非全局 selected——抽 `deleteMark(markId)` 或先 selectMark 再删，取改动小者，报告说明）
- undo.ts：`{kind:'relabel'; markId; fromLabel: string|null; toLabel: string|null}`；applyInverse patch 回 fromLabel（found 守卫同 holding 类）；redo 对称；rewriteMarkId 覆盖（泛 markId 字段已扫）
- 键盘可用性：编辑器内输入框天然受 isTextEntryTarget 保护（快捷键不误触）
- 测试：undo relabel 往返（含 found 守卫）；MarkList 无组件测试（沿用页面无组件测试惯例），行为由控制器抽查

- [ ] **Step 1: undo relabel 失败测试 → Step 2: 实现全部 → Step 3: `pnpm build && pnpm test` 全绿 → Step 4: 浏览器自查（列表点选↔时间轴同步、标签改名、±1帧、解除按住、删除、全部可撤销；清理测试痕迹恢复基线）→ Step 5: Commit** `feat(frontend): mark list panel with inline editing`

---

### 任务 4：README

**Files:**
- Modify: `README.md`（M9 段：最小间距规则一句（含 execution_log 豁免与原理 ±1 帧）、标注面板改版说明（泳道选择归时间轴、标记列表+内联编辑）；如实描述，勿夸大）

- [ ] **Step 1: 写作 → Step 2: 双套件全量 → Step 3: Commit** `docs: m9 mark list and min-gap`

---

## 计划外（明确不做）

- 存量数据的间距迁移/清洗；跨 take 间距约束
- 列表多选/批量操作；虚拟滚动（当前数据量不需要）
- end_ms（按住终点）在编辑器内的任意值编辑（仍由相邻标记推导语义主导）
- 标签编辑的键位表联动校验
