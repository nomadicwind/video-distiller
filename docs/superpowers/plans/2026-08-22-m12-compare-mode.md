# M12 对比模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增对比模式：在练习视频（主视频 A）的工作台里选择一个教学视频（对比视频 B），并排双画面同步播放；因两段视频不对齐，提供「双侧独立定位 → 一键以当前两帧对齐」的偏移校准（另有 ms 微调与 ±1 帧），偏移持久化到分析。用户裁定 2026-08-22：呈现 = 并排双画面同步；分析深度 = 目视对比为主（不做自动时序差报告）；偏移设定 = 双侧定位后一键对齐。

**Architecture:** 后端小步：analyses 增 `compare_video_id`/`compare_offset_ms` 两列 + PATCH 端点（设定/清除）。前端：跟随式第二 `<video>`（B 永远是从动方——主播放头经 `tB = tA + offset` 驱动 B 的 seek/play/pause/rate，播放中按阈值纠漂移）；监视器在对比开启时左右分栏；校准态下 B 暂时脱离跟随、用自己的小定位条独立走帧，「以当前两帧对齐」计算 `offset = tB − tA` 并保存。

**Tech Stack:** 既有栈，无新依赖。

**Spec:** 本计划 Global Constraints 即契约；AskUserQuestion 三项裁定（2026-08-22）如 Goal 所述。

## Global Constraints

- **偏移语义唯一**：`offset_ms`（整数，可负）满足 `tB = tA + offset_ms`；A 播放头（含 scrub/逐帧/AB 循环/试听）任何变化都据此驱动 B；`tB` 出 `[0, durB]` 时 B 暂停并显示「超出对比视频范围」遮罩（不 clamp 到端点画面死撑）
- **B 永远从动**：B 元素无原生 controls、**恒定 muted**、任何 B 端交互不反向驱动 A；校准态是唯一例外（B 临时脱离跟随、可独立定位），退出校准即恢复跟随
- **漂移纠正**：播放中每次主播放头更新对比 `expected = tA + offset` 与 `B.currentTime`，`|drift| > 80ms` 时回写 `B.currentTime`（暂停态 seek 直接精确同步，无阈值）；纠漂移判定为纯函数可测
- **校准流**：进入校准 → B 显示独立定位条（点击/拖动 seek B + [−1帧][+1帧]，帧长按 B 的 fps 计）→ 两侧各自停在同一动作瞬间 → 「以当前两帧对齐」= `offset = round(tB − tA)`，保存并退出校准；校准态下主播放暂停（避免 A 边跑边校）
- **持久化**：PATCH `/api/analyses/{analysis_id}/compare`，body `{video_id: string | null, offset_ms: int}`；`video_id: null` = 清除对比配置（offset 一并清空）；video_id 必须存在且 status=ready，否则 400；GET analysis 返回两字段；存量库列迁移沿用项目现有 schema 演进方式（与既有 store 建表/迁移写法一致）
- **UI 位置**：Transport 行之下新增一条对比条（auto 高度行，仅对比开启时占位；监视器行弹性吸收）：`[对比 Switch] [选择视频 ▾(仅 ready，含 video-N 名)] [校准] [偏移 {n}ms 数字输入] [−1帧][+1帧] [B 时码 mono]`；监视器分栏 = flex row 两格各 50%、各自 object-fit: contain，A 左 B 右；全屏（M11）作用于整个监视器容器（双画面一起全屏）
- **既有行为零回归**：单视频模式下 DOM/行为与 M11 完全一致（B 元素与对比条不渲染）；快捷键全部只作用于 A；videoEl() 语义不变（仍指主视频）
- **100vh 无滚动框架**保持；1280×800 与 1440×860 双查
- 每个指针捕获拖动面带 pointercancel 清理与 `e.button === 0` 守卫（M11 惯例）；hooks 高于早返回；无裸 hex；ui 套件复用
- 测试基线：前端 129 / 后端 186，只增不减；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

- Modify `backend/src/vd/store.py`（analyses 两列 + `set_compare(conn, analysis_id, video_id, offset_ms)` + get_analysis_tree 返回字段）、`backend/src/vd/api.py`（PATCH compare 路由 + Pydantic 模型）
- Test `backend/tests/test_compare.py`（新）
- Create `frontend/src/player/compare.ts`（纯函数：`followTarget`、`decideResync`、`computeOffset`）+ `frontend/src/player/compare.test.ts`
- Create `frontend/src/player/ComparePlayer.tsx`（从动 video 元素 + 跟随引擎 + 校准定位条 + 遮罩）
- Modify `frontend/src/state/store.ts`（compare 状态）、`frontend/src/actions.ts`（保存/清除 compare 调 API）、`frontend/src/api/client.ts` + `frontend/src/api/types.ts`（端点与字段）
- Modify `frontend/src/player/Player.tsx`（监视器分栏容器；主播放头更新时通知跟随引擎）、`frontend/src/App.tsx`（对比条行）、`frontend/src/player/player.css`/`styles.css`
- Modify `README.md`（M12 段）、`CONTEXT.md`（对比模式/偏移 词条）

---

### 任务 1：后端 compare 持久化

**Files:**
- Modify: `backend/src/vd/store.py`、`backend/src/vd/api.py`
- Test: `backend/tests/test_compare.py`（新）

**Interfaces（Produces）:**

```python
# store.py
def set_compare(conn, analysis_id: str, video_id: str | None, offset_ms: int) -> None
# video_id 非 None 时校验视频存在且 status='ready'，否则 ValueError("对比视频不存在或未就绪")
# video_id None → 两列都写 NULL（清除）；否则写入 video_id 与 offset_ms
# get_analysis_tree 的返回 dict 增加 compare_video_id / compare_offset_ms（无配置时 None）

# api.py
class ComparePatch(BaseModel):
    video_id: str | None
    offset_ms: int = 0
# PATCH /api/analyses/{analysis_id}/compare → 校验 analysis 存在(404)；ValueError→400；返回更新后完整 analysis tree
```

- [ ] **Step 1: 失败测试**

```python
# test_compare.py 要点（沿用既有 test_api client/analysis 助手风格）：
# 1) PATCH 设定 {video_id: <ready视频>, offset_ms: 5200} → 200，返回体含两字段；重 GET analysis 亦含
# 2) offset_ms 可负：-3000 → 200
# 3) video_id 不存在 → 400 报文含 "不存在或未就绪"；transcoding 状态视频 → 400
# 4) 清除：{video_id: null} → 200，两字段回 None
# 5) analysis 不存在 → 404
```

- [ ] **Step 2: 确认失败 → Step 3: 实现（列迁移与既有 schema 演进写法一致）→ Step 4: `uv run pytest` 全绿（186+5）→ Step 5: Commit** `feat(backend): compare video and offset on analysis`

---

### 任务 2：跟随引擎与纯函数（前端逻辑层）

**Files:**
- Create: `frontend/src/player/compare.ts`、`frontend/src/player/compare.test.ts`
- Modify: `frontend/src/state/store.ts`、`frontend/src/api/client.ts`、`frontend/src/api/types.ts`、`frontend/src/actions.ts`

**Interfaces（Produces）:**

```ts
// player/compare.ts —— 全部纯函数
export function computeOffset(tAMs: number, tBMs: number): number      // round(tB - tA)
export function followTarget(tAMs: number, offsetMs: number, durBMs: number):
  { tBMs: number; inRange: boolean }
// tB = tA + offset；inRange = 0 <= tB <= durB；出界时 tBMs 为 clamp 值（供遮罩态停帧用）
export function decideResync(expectedMs: number, actualMs: number, playing: boolean):
  'resync' | 'none'
// playing && |expected-actual| > 80 → 'resync'；暂停态由调用方直接精确 seek，不走此判定

// state/store.ts 增：
// compareVideoId: string | null; compareOffsetMs: number; compareOn: boolean（会话内开关，配置存在才可开）
// calibrating: boolean; setCompareConfig(videoId, offsetMs)/clearCompareConfig()/toggleCompareOn/setCalibrating
// setAnalysis 时从 analysis 的 compare_* 字段初始化（有配置默认 compareOn=true）；clearAnalysis 全部复位

// api/client.ts 增 patchCompare(analysisId, videoId, offsetMs)；types.ts Analysis 增两字段
// actions.ts 增 saveCompare(videoId, offsetMs)（PATCH 成功后 setAnalysis 更新）与 clearCompare()
```

- 测试：computeOffset 取整与负值；followTarget 边界（tB=0、=durB 合法，-1、durB+1 出界且 clamp 正确）；decideResync 阈值 80 边界（=80 none、81 resync、暂停态恒 none）；store 初始化/复位路径（沿用既有 store 测试写法，若无则仅纯函数测试并在报告说明）

- [ ] **Step 1: 失败测试 → Step 2: 实现 → Step 3: `pnpm build && pnpm test` 全绿（129+新）→ Step 4: Commit** `feat(frontend): compare follow engine and state`

---

### 任务 3：对比 UI（分栏监视器 + 对比条 + 校准）与文档

**Files:**
- Create: `frontend/src/player/ComparePlayer.tsx`
- Modify: `frontend/src/player/Player.tsx`、`frontend/src/App.tsx`、`frontend/src/player/player.css`、`frontend/src/styles.css`、`README.md`、`CONTEXT.md`

**要点:**
- **ComparePlayer**（compareOn 且配置存在时由 Player 的监视器容器渲染在右格）：
  - `<video muted playsInline>` src=api.videoFileUrl(compareVideoId)，无 controls；元素 id 固定 `vd-video-b`
  - 跟随：订阅主播放头（Player 现有 onPlayheadUpdate 漏斗处调用一个导出的 `syncCompare(tAMs, playing)`，或 ComparePlayer 内部监听 store playheadMs——取与现架构最小侵入者，报告说明）；暂停/seek → 精确 `B.currentTime = tB/1000`；播放 → `B.play()` 并按 `decideResync` 纠漂移；rate 跟随 `A.playbackRate`
  - 出界（followTarget.inRange=false）：B.pause() + 半透明遮罩「超出对比视频范围」（--text-2 小字居中）
  - 校准态：B 停止跟随；下沿覆盖一条独立定位条（点击/拖动 seek B、[−1帧][+1帧] 按 B fps、mono 时码；指针捕获 + pointercancel + e.button 守卫）；校准中主视频 pause()
- **监视器分栏**：`.monitor` 内 flex row 两格各 flex:1、min-width:0，各自内嵌 video object-fit:contain；compareOn=false 时不渲染 B 格与分栏包装（单视频 DOM 与 M11 一致）；全屏仍作用于 .monitor 容器
- **对比条**（App.tsx Transport 行之下，grid 新 auto 行，compare 配置区仅工作台有）：
  - `[对比 Switch]`：无配置时点击引导先选视频；有配置切 compareOn
  - `[选择视频 ▾]`：列出 ready 视频（video-N + 名称截断），选中即 `saveCompare(id, 0)` 并开启；含「清除对比」项 → clearCompare()
  - `[校准]` 按钮：toggle calibrating（无配置禁用）
  - `[以当前两帧对齐]`（仅校准态显示）：`saveCompare(videoId, computeOffset(playheadMs, bCurrentMs))` 并退出校准
  - `[偏移 ms 输入][−1帧][+1帧]`（帧长按 A fps）：变更即 saveCompare；`[B 时码]` mono 实时显示
- **文档**：README「M12 · 对比模式」段（并排同步/偏移语义 tB=tA+offset/校准流/持久化；如实，不夸大）；CONTEXT.md 增「对比模式」「对比偏移」词条（纯词表格式：偏移语义一句 + B 从动红线一句）
- 布局双查 1280×800 / 1440×860 无页滚动；浏览器自查用鼠标（**禁触键盘/录入模式**——防数据污染）

- [ ] **Step 1: 实现 → Step 2: `pnpm build && pnpm test` 全绿 + 后端 `uv run pytest` 终验（191，证明任务 1 后未再动）→ Step 3: 浏览器自查（选 video-2 为对比、校准对齐、同步播放跟随、出界遮罩、偏移微调、刷新后配置仍在；清理测试配置恢复基线）→ Step 4: Commit** `feat(frontend): side-by-side compare mode with offset calibration`

---

## 计划外（明确不做）

- 自动时序差报告（两侧 L1 配对与逐招 Δms——用户裁定暂不做，架构不排除未来加）
- 跨视频标记参考线叠加；B 侧标注/打点
- B 独立变速/独立缩放；音频混合（B 恒 muted）
- 多于两路的对比；对比配置的多套保存
