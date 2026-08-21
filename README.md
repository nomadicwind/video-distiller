# Video Distiller

游戏操作录像蒸馏工作台。设计文档见 `docs/superpowers/specs/`，术语表见 `CONTEXT.md`。

## 运行

前置：`brew install ffmpeg uv pnpm`

    uv run --project backend uvicorn vd.api:app --port 8000   # 后端
    pnpm --dir frontend dev                                   # 前端 → http://localhost:5173

数据目录：`~/VideoDistiller`（环境变量 `VD_DATA_DIR` 覆盖；备份 = 拷贝该目录）。

## 测试

    cd backend && uv run pytest
    cd frontend && pnpm test

## M2 功能

- 技能目录 / 键位（版本化）：首页入口
- 工作台右栏「推断」：运行对齐（三方冲突、键位反推、补区间）与发现循环（LLM 命名 + 覆盖率验证报告，接受后入 Rotation 库）
- LLM 命名需 `ANTHROPIC_API_KEY`（或 `ant auth login`）；未配置时提案仍产出，名称为「未命名循环」
- Prompt 质量评测：`cd backend && uv run python -m vd.eval`

## M3 功能

- 首页「循环与方案」：L3/L4 列表与 md/ahk 导出
- 方案块编辑器：段落/块行内编辑、pinned、版本链与回滚、文档与 AHK 并排预览
- 工作台「编排方案」：LLM 把已接受的循环编排成分段方案（无 API key 时确定性兜底为单段），提案逐块勾选裁决
- AHK 产物为 AutoHotkey v2；真机运行验收属 M4（Windows）

## M4 · 执行与采集

- **执行台**：选循环/方案 → 开始/暂停/单步/停止；仅执行不判断成败；Windows 上 F12 全局急停并释放按键（AHK v2 worker）。macOS 无注入（Mock 供开发）。
- **执行日志回灌**：执行结束后可回灌为目标分析 L0 泳道的新 Take（`provenance=execution_log`，不参与聚合中位数），与人工标注并排对比。
- **新导出后端**：`plan`（注入计划 JSON）与 `razer`（Synapse 宏 XML；格式未经官方验证，导入由用户在 Windows 验证）。
- **屏幕采集**：`/api/capture/start|stop`，停止后自动 CFR 入库（Windows ddagrab / macOS avfoundation）。
- **Windows 真机注入未在本机验证**（macOS 开发环境）；MockHost 覆盖全链路测试。

## M5 · UI/UX 升级

对标剪映专业版（CapCut Desktop，深色专业剪辑三区布局）、辅以 DaVinci Resolve 的时间轴密度与吸附语义，把工作台从"能用"升级到"专业剪辑器手感"——设计规格见 `docs/superpowers/specs/2026-08-21-ui-ux-upgrade.md`。

十项修复摘要（详见规格 §8）：

| # | 路径 | 修复前 | 修复后 |
|---|---|---|---|
| 1 | 选轨 | 高亮仅 11px 标签变色 | 沟槽条 + 行底色 + 卡片态三重高亮，Inspector 轨道卡同步 |
| 2 | 打点定位 | 需 `[` `]` 逐帧逼近，点时间轴不动播放头 | 标尺/轨道点击与拖动即 seek + 悬停幽灵线 + 帧吸附 |
| 3 | 打点入口 | 键帽区无说明，录入模式藏在长文案 checkbox | 键帽标题"在播放头处打点" + Switch + 状态栏模式提示 |
| 4 | 移动标记 | 仅 `,` `.` 键 ±10ms，不可拖 | 拖动标记 + 吸附 + 实时 Δ（打表旁常显，无需展开弹层） |
| 5 | holding | 10px 画布 checkbox 难点中 | Δ 药丸整体为开关（≥18px 热区） |
| 6 | 缩放 | 仅 Ctrl+滚轮，无提示 | 工具栏缩放控件 + 适配全长按钮 + 快捷键提示 |
| 7 | 快捷键发现 | 无任何提示面 | 按钮 tooltip 标注快捷键 + StatusBar 精简条 + `?` 完整浮层 |
| 8 | 提案噪声 | 原始错误 JSON 整段进卡片 | 错误折叠为 warn Badge + tooltip 详情 |
| 9 | 全局导航 | 每页自带返回/按钮堆 | TopBar 常驻导航，不再逐页维护返回逻辑 |
| 10 | 状态可见性 | 转码中仅文字 status | Badge + 卡片进度态；执行台进度条 |

两条原始抱怨路径的前后对比截图（选轨可见性、点击对齐打点）：`docs/screenshots/m5-before-workbench.png`（升级前）/ `docs/screenshots/m5-after-workbench.png`（升级后）。
