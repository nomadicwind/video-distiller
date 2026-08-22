# M13 Windows 打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Video Distiller 打包成 Windows 可直接运行的程序（解压 zip → 双击 run.bat → 浏览器打开工作台），供用户在 Windows 真机做验证（docs/windows-verification.md）。

**Architecture:** ①后端打包适配：FastAPI 挂载已构建前端静态文件（同源服务，前端本就走相对 `/api`）、`yt-dlp` 调用的冻结兼容（PyInstaller 下 `sys.executable -m yt_dlp` 失效）、`vd.serve` 启动入口（编程式 uvicorn + 自动开浏览器）；②打包管道：PyInstaller spec（onedir）+ GitHub Actions `windows-latest` 工作流（macOS 无法交叉编译 exe——本机只做 spec 冒烟，真实出包在 CI），产物 zip 内含 exe 目录、ffmpeg.exe/ffprobe.exe、run.bat、使用说明；③文档与验证清单更新。

**Tech Stack:** PyInstaller（新 dev 依赖）、GitHub Actions（workflow_dispatch 手动触发）；ffmpeg 用 gyan.dev release-essentials 构建随包分发。

**Spec:** 本计划 Global Constraints 即契约；用户指令 2026-08-23（打包成 Windows 可运行程序，用户真机验证）。

## Global Constraints

- **冻结兼容红线**：打包产物内不得出现 `sys.executable -m yt_dlp` 子进程调用（冻结后 sys.executable 是 exe 自身）；冻结态（`getattr(sys, 'frozen', False)`）改走 `yt_dlp` Python API；非冻结路径与现有 runner 注入测试模式保持不变
- **静态服务不遮蔽 API**：前端静态挂载在全部 API 路由定义之后、路径 `/`（html=True）；`/api/*` 行为与现状逐字节一致；静态目录解析顺序 = 环境变量 `VD_WEB_DIST` 显式 > 冻结态 exe 内打包目录 `webdist/` > 仓库开发路径 `frontend/dist`（存在才挂，缺失时纯 API 模式与现状一致）
- **入口**：`python -m vd.serve`（新模块）= argparse `--port`（默认 8000）`--no-browser`；启动 uvicorn（编程式，非子进程）并在就绪后默认打开 `http://127.0.0.1:{port}`；PyInstaller 入口即此模块
- **打包在 CI**：GitHub Actions `windows-latest`、`workflow_dispatch` 手动触发（不随 push 自动跑）；产物 `VideoDistiller-win64.zip` 以 artifact 上传；zip 结构：`VideoDistiller/`（PyInstaller onedir 全部内容，内含 `webdist/` 前端）、`ffmpeg/ffmpeg.exe` + `ffmpeg/ffprobe.exe`（自 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip 提取）、`run.bat`、`使用说明.txt`
- **run.bat**：`set "PATH=%~dp0ffmpeg;%PATH%"` 后启动 `VideoDistiller\VideoDistiller.exe`（ffmpeg/ffprobe 解析仍走 PATH，media.py 零改动）
- **Windows 语义不动**：`VD_HOST` 缺省时 win32 自动选 WindowsHost（host.py 现状）；使用说明与 README 必须明示——真实按键注入仅在用户主动运行执行台方案时发生，验证清单第一项是 F12 急停响应；claude CLI 在 Windows 上可选（无则循环命名优雅降级"未命名"，M6 现状）
- **本机验证边界**：macOS 上 PyInstaller 冒烟（onedir 产物可启动、`/` 返回前端、`/api/videos` 200）证明 spec/隐藏导入/数据打包机制正确；Windows exe 的最终证据 = CI 工作流跑绿 + artifact 存在（控制器 gh 触发并盯完）
- 后端测试基线 191 只增不减；前端代码零改动（161 终验一跑证明未动）；无裸 hex 不适用（无前端改动）；conventional commit + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## File Structure

- Modify `backend/src/vd/ingest.py`（冻结态 yt-dlp Python API 路径）、`backend/src/vd/api.py`（静态挂载）
- Create `backend/src/vd/serve.py`（入口模块）
- Modify `backend/pyproject.toml`（dev 组 + `pyinstaller>=6`）
- Test `backend/tests/test_serve_static.py`（新）
- Create `packaging/vd.spec`（PyInstaller onedir spec）、`packaging/run.bat`、`packaging/使用说明.txt`
- Create `.github/workflows/windows-package.yml`
- Modify `README.md`（M13 段）、`docs/windows-verification.md`（zip 运行路径）

---

### 任务 1：后端打包适配（静态服务 + 冻结兼容 + 入口）

**Files:**
- Modify: `backend/src/vd/ingest.py`、`backend/src/vd/api.py`、`backend/pyproject.toml`
- Create: `backend/src/vd/serve.py`
- Test: `backend/tests/test_serve_static.py`

**Interfaces（Produces）:**

```python
# api.py 末尾（全部路由之后）：
def _web_dist() -> Path | None
# VD_WEB_DIST 显式 > 冻结态 Path(getattr(sys, '_MEIPASS', sys.executable 所在目录))/'webdist'
# > Path(__file__).resolve().parents[3]/'frontend'/'dist'；存在 index.html 才返回
# 返回非 None 时：app.mount("/", StaticFiles(directory=..., html=True), name="web")

# ingest.py：
def _run_ytdlp(argv: list[str]) -> None
# 冻结态：yt_dlp Python API（YoutubeDL 或 yt_dlp.main 等价参数）执行同语义下载
# 非冻结：现状 sys.executable -m yt_dlp 子进程；runner 注入测试口径不变

# serve.py：
def main(argv: list[str] | None = None) -> None
# --port int 默认 8000；--no-browser flag；uvicorn.run(vd.api:app 对象, host="127.0.0.1", port=port)
# 浏览器打开用 threading.Timer(1.5, webbrowser.open) 于 uvicorn.run 前注册（run 阻塞）
if __name__ == "__main__": main()
```

- [ ] **Step 1: 失败测试**（test_serve_static.py：①tmp dist 含 index.html + VD_WEB_DIST 指向它 → 重建 app 后 GET `/` 200 且含 index 内容、GET `/api/videos` 仍 200；②无 dist → GET `/` 404、API 正常；③serve.main 参数解析（--port/--no-browser，mock uvicorn.run 断言入参）；④冻结态 _run_ytdlp 走 Python API（monkeypatch sys.frozen + 假 yt_dlp 模块断言被调），非冻结走子进程 runner）
- [ ] **Step 2: 确认失败 → Step 3: 实现 → Step 4: `uv run pytest` 全绿（191+新）→ Step 5: Commit** `feat(backend): static web serving, frozen ytdlp path, serve entry`

---

### 任务 2：PyInstaller spec 与 CI 打包工作流

**Files:**
- Create: `packaging/vd.spec`、`packaging/run.bat`、`packaging/使用说明.txt`、`.github/workflows/windows-package.yml`

**要点:**
- `vd.spec`：Analysis 入口 `backend/src/vd/serve.py`；`datas=[('../frontend/dist', 'webdist')]`（spec 相对仓库 packaging/）；hiddenimports 覆盖 `uvicorn.logging/uvicorn.loops.auto/uvicorn.protocols.*`（uvicorn[standard] 惯例集）、`yt_dlp`、`anthropic`；onedir、name `VideoDistiller`、console=True（日志可见；使用说明注明关窗即停）
- `run.bat`（UTF-8 无 BOM，CRLF）：
  ```bat
  @echo off
  set "PATH=%~dp0ffmpeg;%PATH%"
  start "" "%~dp0VideoDistiller\VideoDistiller.exe"
  ```
- `使用说明.txt`：解压 → 双击 run.bat → 浏览器自动打开 http://127.0.0.1:8000；数据目录 `%USERPROFILE%\VideoDistiller`；ffmpeg 已内置；B 站拉取需网络；claude CLI 可选（循环命名）；**执行台会真实注入按键——先按 docs/windows-verification.md 清单验证 F12 急停**；关闭 = 关命令行窗口
- workflow（`windows-package.yml`）：`on: workflow_dispatch`；jobs.package：windows-latest；steps：checkout → pnpm/action-setup + setup-node（cache pnpm，`pnpm --dir frontend install --frozen-lockfile && pnpm --dir frontend build`）→ setup-python 3.12 → `pip install ./backend pyinstaller` → `pyinstaller packaging/vd.spec --distpath dist-pack` → PowerShell 下载 gyan.dev release-essentials zip、解出 `ffmpeg.exe`/`ffprobe.exe` 至 `stage/ffmpeg/` → 组装 `stage/`（`VideoDistiller/`=dist-pack/VideoDistiller、`ffmpeg/`、`run.bat`、`使用说明.txt`）→ `Compress-Archive` 成 `VideoDistiller-win64.zip` → `actions/upload-artifact@v4`（retention 14 天）
- 冒烟（本机 macOS，机制验证）：`cd frontend && pnpm build`；`uv run --project backend pyinstaller packaging/vd.spec --distpath /tmp 冒烟目录`；启动产物二进制（--no-browser、空闲端口），curl `/` 200 含前端、`/api/videos` 200；杀进程清理。产物不提交
- [ ] **Step 1: 写 spec/bat/说明/workflow → Step 2: macOS 冒烟通过 → Step 3: Commit** `feat(packaging): pyinstaller spec and windows ci workflow` **→ Step 4: 报告说明 CI 触发留给控制器**（分支推送与 workflow_dispatch 由控制器执行并盯绿）

---

### 任务 3：文档

**Files:**
- Modify: `README.md`（「M13 · Windows 打包」段：workflow_dispatch 触发方式、artifact 下载、zip 结构、run.bat 运行、数据目录、ffmpeg 内置、claude CLI 可选、注入红线与 F12 提醒；如实）
- Modify: `docs/windows-verification.md`（顶部加「方式 A：打包 zip 运行」——解压/run.bat/浏览器；原源码方式保留为方式 B；清单本体不动）

- [ ] **Step 1: 写作 → Step 2: 双套件全量（后端 191+新 终验、前端 161 证明未动）→ Step 3: Commit** `docs: m13 windows packaging`

---

## 计划外（明确不做）

- 代码签名/安装器（MSI/NSIS）；自动更新
- macOS/Linux 打包产物
- 托盘图标/无控制台窗口模式（console=True 即交付形态）
- ffmpeg 许可证再分发审查之外的裁剪（essentials 构建原样附带其 LICENSE 随 zip）
- 随 push/tag 自动发布 Release（仅 workflow_dispatch + artifact）
