# Video Distiller

游戏操作录像蒸馏工作台。设计文档见 `docs/superpowers/specs/`，术语表见 `CONTEXT.md`。

## 运行（M1）

前置：`brew install ffmpeg uv pnpm`

    uv run --project backend uvicorn vd.api:app --port 8000   # 后端
    pnpm --dir frontend dev                                   # 前端 → http://localhost:5173

数据目录：`~/VideoDistiller`（环境变量 `VD_DATA_DIR` 覆盖；备份 = 拷贝该目录）。

## 测试

    cd backend && uv run pytest
    cd frontend && pnpm test
