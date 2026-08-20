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
