# M10 序列视图与打点条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 右侧面板去掉打点输入区，全部空间让给标记列表并升级为"操作序列"类时间轴视图（保留 M9 内联编辑）；打点输入（键帽/修饰芯片/空标记/录入开关/L1-L2 技能输入）下沉为时间轴面板内的一条紧凑"打点条"。

**Architecture:** 纯前端两步改造：①时间轴面板在工具栏与标尺之间插入 34px 打点条（EntryStrip 组件，L0 显示修饰芯片+小号键帽+空标记+录入开关，L1/L2 显示技能名输入；行为与状态管线原样迁移）；②EntryPanel 缩减为 take 行 + MarkList，MarkList 改为序列视图（左侧竖轨 + 相邻标记 Δ 间隔标注 + 键帽风格标签 + 按住区段指示），编辑器逻辑不动。canvas 高度计算与 100vh 无滚动框架同步调整。

**Tech Stack:** 既有栈，无新依赖。

**Spec:** 本计划 Global Constraints 即契约；用户裁定 2026-08-22（打点入口并入时间轴、右栏专注序列视图与编辑）。

## Global Constraints

- **行为零变**：打点语义（insertAtPlayhead 布尔返回、min-gap 预检与提示、修饰芯片粘滞与自清、keycap 按压/armed 反馈、录入模式拦截与 recordEntry、L1/L2 技能插入含 datalist）全部原样迁移，仅位置改变；相关既有测试（hotkeys/actions/gap/undo）不改断言
- **打点条（EntryStrip）**：置于时间轴工具栏之下、标尺之上，高 34px 单行；L0 泳道选中时：`[录入 Switch] [Ctrl][Alt][Shift] │ [1]…[Wheel] [空标记]`（键帽 sm 尺寸 24px 高；1440px 内单行放下，窄屏容器 overflow-x auto）；L1/L2 选中时：`[技能名输入 + 插入]`；无泳道选中隐藏。keycap 按压闪烁与修饰 armed 态样式沿用
- **右栏（标注页签）**：仅剩 take 行（chips/新 Take/聚合 Switch）+ MarkList（flex:1 滚动）；「在播放头处打点」标题与键帽区、录入开关整块从面板移除
- **序列视图**：列表左侧 2px 竖轨贯穿；每行一个节点圆点（轨道色）；相邻两行之间在轨上显示 Δ 间隔小字（mono，如 `+2500ms`）；标签渲染为 inert Keycap 风格小帽（含组合键整串）；kind=release 显示空心点与"空标记"；holding（end_ms 非空）行下附着按住区段条（轨道色 32% 圆角短条 + `按住 XXXms`）；选中行高亮与展开编辑器沿用 M9（编辑器四项功能与撤销覆盖不动）
- 100vh 无滚动框架保持：时间轴面板高度增加打点条后，监视器行弹性吸收；1280×800 与 1440×860 双查无页面滚动
- StatusBar 录入提示、hotkeyList/浮层与 README 中涉及"面板打点区"的表述同步更正（事实性）
- hooks 高于早返回；无裸 hex；ui 套件复用；前端 121 测试基线全绿 +（组件迁移不加断言仅保绿）；后端零改动（186 终验一跑）；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

- Create `frontend/src/timeline/EntryStrip.tsx`（自 EntryPanel 迁移打点入口整块逻辑）
- Modify `frontend/src/panel/EntryPanel.tsx`（缩减为 take 行 + MarkList）、`frontend/src/panel/MarkList.tsx`（序列视图渲染层，编辑器不动）
- Modify `frontend/src/App.tsx` 或时间轴容器（EntryStrip 挂载于 .workbench-timeline 内、Toolbar 与 canvas 之间）、`frontend/src/styles.css`/`ui.css`（strip 与序列视图样式）
- Modify `README.md`（打点条位置、序列视图说明；修正旧表述）
- 必要时 `frontend/src/shell/hotkeyList.ts` 表述（仅当文案提及面板位置）

---

### 任务 1：打点条下沉（EntryStrip）

**Files:**
- Create: `frontend/src/timeline/EntryStrip.tsx`
- Modify: `frontend/src/panel/EntryPanel.tsx`（删除打点区块）、`frontend/src/App.tsx`（时间轴容器插入 EntryStrip）、样式文件

**要点:**
- EntryStrip 内容 = EntryPanel 现打点区的**逻辑原样迁移**（armed Set 状态、composeLabel 拼接、insertAtPlayhead 调用、keycap pressed/armed 类、空标记、录入 Switch、L1/L2 技能输入+datalist+插入按钮）；迁移即剪切，不留双份；lastEntry 驱动的按压反馈跟随键帽走
- 布局：`.entry-strip { height:34px; display:flex; gap:6px; align-items:center; overflow-x:auto; }` 键帽用现 Keycap sm/紧凑变体（若无则加 `compact` prop：高 24、padding 收紧——套件级小扩展，报告说明）
- 泳道分支：读 s.laneId 对应 lane.layer 渲染 L0/L1L2/隐藏三态；hooks 全部于早返回上
- 挂载点：`.workbench-timeline` 内 Toolbar 之后、canvas 容器之前；canvas 高度计算不含 strip（DOM 流式自然占位），但需复核 100vh 框架双分辨率无页滚动
- 既有测试保绿（组件迁移不动 actions/hotkeys 逻辑）

- [ ] **Step 1: 实现迁移 → Step 2: `pnpm build && pnpm test`（121 绿）→ Step 3: 浏览器双分辨率自查（无页滚动、L0 条打点/组合/空标记/录入开关全通、L1 技能插入通、按压反馈在场；清理测试标记恢复基线）→ Step 4: Commit** `feat(frontend): entry strip merged into timeline panel`

---

### 任务 2：序列视图（MarkList 渲染层）

**Files:**
- Modify: `frontend/src/panel/MarkList.tsx`、`frontend/src/panel/EntryPanel.tsx`（面板仅剩 take 行 + 列表）、样式文件

**要点:**
- 渲染层重构（编辑器、选择/seek/scrollIntoView、撤销管线一律不动）：
  - 竖轨：列表容器 `::before` 或每行左栏 2px 轨道色 30% 竖线；行节点 = 8px 实心圆（轨道色；release 空心）
  - 行间 Δ：相邻标记 `t2-t1` 在两行之间的轨侧小字 `+{delta}ms`（mono 10px --text-3；列表为序列视图的核心表达）
  - 标签 = inert Keycap compact（组合键整串一帽）；时码 mono 沿用；kind 徽章保留或并入节点形状（release 空心点即语义，徽章可省——择一，报告说明）
  - holding 行：节点下方短条（轨道色 32% 圆角，长度固定 24px）+ `按住 {end_ms - t_ms}ms` 小字
  - 选中行展开编辑器与 M9 完全一致
- 「在播放头处打点」标题移除后，列表上方给一行轻标题 `操作序列 · {n} 条`（--text-2 12px）

- [ ] **Step 1: 实现 → Step 2: `pnpm build && pnpm test` 绿 → Step 3: 浏览器自查（L1 15 条序列视图：竖轨/Δ 间隔/键帽标签/点选编辑往返；截图）→ Step 4: Commit** `feat(frontend): sequence view mark list`

---

### 任务 3：文档与表述更正

**Files:**
- Modify: `README.md`（M10 段：打点条位置、序列视图；并更正 M8「Entry Panel 键帽区顶部」与 M9 面板描述中的位置表述——加一行"自 M10 起打点入口位于时间轴打点条"式的更正注记，不重写旧段）
- 必要时 hotkeyList/StatusBar 文案核对（录入提示文案如提及面板则更正）

- [ ] **Step 1: 写作与核对 → Step 2: 双套件全量（前端 121+、后端 186）→ Step 3: Commit** `docs: m10 sequence panel and entry strip`

---

## 计划外（明确不做）

- 序列视图的横向时间轴布局（保持纵向列表形态的序列表达）
- Δ 间隔的可编辑（间隔由标记时刻推导，编辑走时刻输入）
- 打点条的自定义键位配置；键帽集合变更
- 虚拟滚动
