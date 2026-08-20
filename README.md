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
