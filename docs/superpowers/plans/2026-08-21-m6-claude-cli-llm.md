# M6 本机 Claude CLI 推理后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `agent` 模块可用本机已登录的 `claude` CLI（headless）作推理后端——无 API key 也能获得自动命名与方案编排；并补上循环重命名入口，使纯降级路径自洽。

**Architecture:** `agent.py` 增加后端解析（显式 `VD_LLM` > 有 key 走 API > PATH 有 `claude` 走 CLI > 无后端即降级）与 `_cli_generate`（subprocess 调 `claude -p --output-format json`，解析信封取 `result`，剥围栏后用既有 Pydantic 模型校验）；两个调用点（命名/编排）的 try/except 降级壳完全不动。循环重命名 = store 部分更新 + PATCH 路由 + 方案页内联改名。

**Tech Stack:** 既有栈；无新依赖（subprocess + shutil.which）。

**Spec:** 本计划 Global Constraints 即契约（微型里程碑，无独立 spec；上游为 docs/superpowers/specs/2026-08-20-video-distiller-design.md §7.1 职责边界与"失败无副作用"原则）。

## Global Constraints

- **降级语义一字不变**：`name_candidate`/`compose_playbook` 的对外签名、返回形状（`{"ok": bool, ...}`/`{"ok": False, "error": str}`）与 try/except 结构保持现状；任何后端失败（含超时、信封 `is_error`、JSON 不合法、无后端）都走既有降级，不新增异常外泄
- **后端解析顺序**（`_resolve_backend()`）：`VD_LLM` 显式值（`api`|`claude-cli`|`off`）优先；未设则 `ANTHROPIC_API_KEY` 存在 → `api`；否则 `shutil.which("claude")` 命中 → `claude-cli`；都无 → `None`（立即降级）。`off` 强制降级（可测试、可关断）
- **CLI 信封契约**（2026-08 实测 v2.1.220）：`claude -p <prompt> --output-format json` 输出单个 JSON 对象，成功时 `subtype=="success"` 且 `is_error==false`，正文在 `result` 字段（字符串）；`result` 可能带 ```json 围栏须剥除。subprocess 以 `cwd=数据根目录` 运行（避免吸入仓库 CLAUDE.md 上下文），timeout 120s
- **测试零真实调用**：CI 中 CLI 路径一律 monkeypatch `subprocess.run`；API 路径沿用 FakeLLM。真实 CLI 端到端由控制器验收执行
- **既有测试全绿**：后端 169 → +新增；前端 51 → +新增；`cd backend && uv run pytest`、`cd frontend && pnpm build && pnpm test`
- 重命名校验：name 去空白后非空，否则 400；404 on missing；note 可置空（显式 null 清除）
- Conventional commits + 尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；前端遵循既有 UI 套件与令牌纪律（无裸 hex）

---

## File Structure

- Modify `backend/src/vd/agent.py`（后端解析 + `_cli_generate` + 两调用点分支）
- Modify `backend/src/vd/store.py`（`update_rotation`）、`backend/src/vd/api.py`（PATCH 路由）
- Modify `frontend/src/api/client.ts`（`patchRotation`）、`frontend/src/pages/PlaybooksPage.tsx`（内联改名）
- Modify `README.md`（LLM 后端一节）
- Test: `backend/tests/test_agent_cli.py`（新）、`backend/tests/test_api.py`（追加）、`frontend/src/api/client.test.ts`（追加）

---

### 任务 1：agent.py CLI 后端

**Files:**
- Modify: `backend/src/vd/agent.py`
- Test: `backend/tests/test_agent_cli.py`（新建）

**Interfaces（Produces）:**

```python
def _resolve_backend() -> str | None
# 'api' | 'claude-cli' | None，规则见 Global Constraints

def _cli_generate(prompt: str, timeout_s: int = 120) -> str
# 成功返回 result 正文（已剥 ```json 围栏与首尾空白）；一切失败 raise RuntimeError(简短中文说明)
```

- 两调用点改造模式（以 name_candidate 为例；compose_playbook 同构）：try 内首行 `backend = _resolve_backend()`；`backend is None` → `raise RuntimeError("未配置 LLM 后端（API key 或 claude CLI 均不可用）")`；`backend == 'api'` → 现有 messages.parse 路径原样；`backend == 'claude-cli'` → 组装 prompt =《现系统提示》+ 空行 +《现用户内容》+ 空行 + "只输出一个符合下述结构的 JSON 对象，不要输出任何其他文字：" + 该 Pydantic 模型的字段说明一行；`data = json.loads(_cli_generate(prompt))` → `RotationNaming.model_validate(data)`（编排为 `PlaybookPlan.model_validate`）后走与 API 路径相同的后续。注入的 `client` 参数仅作用于 api 路径（测试兼容不变）
- `_cli_generate` 实现要点：`subprocess.run(["claude","-p",prompt,"--output-format","json"], capture_output=True, text=True, timeout=timeout_s, cwd=str(config.data_root()))`；非零退出/超时/stdout 非 JSON/`is_error` 真/`subtype != "success"` → RuntimeError；取 `env["result"]`，剥围栏：若以 ``` 开头则去掉首行围栏与末尾 ``` 行

- [ ] **Step 1: 失败测试（monkeypatch subprocess.run 与 shutil.which/环境变量）**

```python
# backend/tests/test_agent_cli.py
import json
import subprocess
import pytest
from vd import agent


class FakeCompleted:
    def __init__(self, stdout, returncode=0):
        self.stdout = stdout
        self.returncode = returncode
        self.stderr = ""


def _envelope(result: str, ok=True):
    return json.dumps({
        "is_error": not ok, "subtype": "success" if ok else "error_during_execution",
        "result": result,
    })


def test_resolve_backend_order(monkeypatch):
    monkeypatch.delenv("VD_LLM", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    assert agent._resolve_backend() == "api"
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(agent.shutil, "which", lambda _: "/usr/local/bin/claude")
    assert agent._resolve_backend() == "claude-cli"
    monkeypatch.setattr(agent.shutil, "which", lambda _: None)
    assert agent._resolve_backend() is None
    monkeypatch.setenv("VD_LLM", "off")
    assert agent._resolve_backend() is None
    monkeypatch.setenv("VD_LLM", "claude-cli")
    assert agent._resolve_backend() == "claude-cli"


def test_cli_generate_strips_fences(monkeypatch):
    payload = '```json\n{"name":"剑势连击","note":null}\n```'
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope(payload)))
    assert json.loads(agent._cli_generate("x")) == {"name": "剑势连击", "note": None}


def test_cli_generate_envelope_error(monkeypatch):
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope("boom", ok=False)))
    with pytest.raises(RuntimeError):
        agent._cli_generate("x")


def test_cli_generate_timeout(monkeypatch):
    def boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="claude", timeout=120)
    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(RuntimeError):
        agent._cli_generate("x")


def test_name_candidate_via_cli(monkeypatch):
    monkeypatch.setenv("VD_LLM", "claude-cli")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeCompleted(
        _envelope('{"name":"剑势连击","note":"起手段"}')))
    out = agent.name_candidate({"body": [], "occurrences": []}, {})
    assert out["ok"] and out["name"] == "剑势连击"


def test_name_candidate_cli_bad_json_degrades(monkeypatch):
    monkeypatch.setenv("VD_LLM", "claude-cli")
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope("这不是 JSON")))
    out = agent.name_candidate({"body": [], "occurrences": []}, {})
    assert out["ok"] is False and "error" in out


def test_no_backend_degrades(monkeypatch):
    monkeypatch.delenv("VD_LLM", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(agent.shutil, "which", lambda _: None)
    out = agent.name_candidate({"body": [], "occurrences": []}, {})
    assert out["ok"] is False
```

（`name_candidate` 实际签名以现文件为准——若参数不同，按现签名适配测试调用，断言不变。compose 侧同理补一条 `test_compose_via_cli` 与坏 JSON 降级，Fake 信封 result 用真实 rotation id 结构 `{"name":"x","sections":[{"name":"s","rotation_ids":[]}]}`——以现 PlaybookPlan 字段为准。）

- [ ] **Step 2: 跑测试确认失败**（`uv run pytest tests/test_agent_cli.py -v` → import/属性错误即失败态）
- [ ] **Step 3: 实现**（`import shutil, subprocess`；`_resolve_backend`/`_cli_generate` 按 Interfaces；两调用点分支；CLI 提示词复用现有系统/用户内容常量）
- [ ] **Step 4: 全量**：`uv run pytest` 全绿（169 + 新增）
- [ ] **Step 5: Commit** `feat(backend): claude cli llm backend with auto resolution`

---

### 任务 2：循环重命名（store + 路由）

**Files:**
- Modify: `backend/src/vd/store.py`、`backend/src/vd/api.py`
- Test: `backend/tests/test_api.py`（追加）

**Interfaces（Produces）:**

```python
# store.py
def update_rotation(conn, rotation_id, *, name=None, note=..., ):
# name: None=不改；str 去空白后须非空否则 ValueError
# note: 未传=不改；传 None=清空；传 str=更新（哨兵用 _UNSET = object()）
# 返回更新后的 rotation dict；不存在 → None

# api.py
class RotationPatch(BaseModel):
    name: str | None = None
    note: str | None = None
    clear_note: bool = False

@app.patch("/api/rotations/{rotation_id}")
# 404 不存在；400 ValueError；note 语义：clear_note=True → 清空，否则 note 非 None 才更新
```

- [ ] **Step 1: 失败测试**

```python
def test_rotation_rename_roundtrip(client):
    rot, _pb = _make_playbook(client, ...)   # 复用既有助手取得 rotation（按现签名适配）
    r = client.patch(f"/api/rotations/{rot['id']}", json={"name": "新名字"})
    assert r.status_code == 200 and r.json()["name"] == "新名字"
    assert client.patch("/api/rotations/nope", json={"name": "x"}).status_code == 404
    assert client.patch(f"/api/rotations/{rot['id']}", json={"name": "  "}).status_code == 400
    r2 = client.patch(f"/api/rotations/{rot['id']}", json={"clear_note": True})
    assert r2.json()["note"] is None
```

- [ ] **Step 2: 确认失败 → Step 3: 实现 → Step 4: `uv run pytest` 全绿 → Step 5: Commit** `feat(backend): rotation rename route`

---

### 任务 3：前端改名入口

**Files:**
- Modify: `frontend/src/api/client.ts`、`frontend/src/pages/PlaybooksPage.tsx`
- Test: `frontend/src/api/client.test.ts`（追加）

**要点:**
- client：`patchRotation: (id: string, patch: { name?: string; clear_note?: boolean }) => ...`（走既有 j/post 风格，PATCH 方法；测试断言 URL/method/body）
- PlaybooksPage 循环表：名称单元格旁加 icon Button（lucide `Pencil`，tip"重命名"）；点击后该单元格切换为内联 `<input>`（初值为现名，autoFocus，Enter 保存 / Esc 取消 / blur 保存）；保存调 `patchRotation` 后刷新列表；空名不提交。样式与既有表格一致，无裸 hex
- 保持既有导出 chips/备注列不动

- [ ] **Step 1: client 测试失败 → Step 2: 实现 → Step 3: `pnpm build && pnpm test` 全绿 → Step 4: Commit** `feat(frontend): rotation inline rename`

---

### 任务 4：README

**Files:**
- Modify: `README.md`（"LLM 后端"一节，置于既有 M 段落之后）

内容要点（照写）：三种形态表（API key / 本机 claude CLI / 无后端降级）、自动解析顺序、`VD_LLM=api|claude-cli|off` 覆盖、CLI 形态依赖（安装并登录 claude，走订阅额度）、真实调用只发生在运行期而非 CI。

- [ ] **Step 1: 写作 → Step 2: 全量验证（后端+前端）→ Step 3: Commit** `docs: llm backend resolution and cli mode`

---

## 计划外（明确不做）

- CLI 输出的 stream-json/逐步进度；并发调用队列
- 方案（playbook）重命名入口（编辑器 PUT 已支持 name，UI 后续需要再加）
- API/CLI 双后端结果对比或路由策略
