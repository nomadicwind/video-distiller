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
