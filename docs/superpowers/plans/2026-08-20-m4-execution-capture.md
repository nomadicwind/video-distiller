# M4 执行与采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 HostAdapter 三实现、`plan`/`razer` 导出后端、注入执行器（控制台 + F12 急停）、执行日志回灌为 Take、屏幕采集入库，使 IR 在 Windows 上可执行、执行结果可回灌对比。

**Architecture:** `host.py` 是全系统唯一平台相关模块（MockHost 保证 macOS 全链路可测）；`emit/plan.py` 把 IR 压平为定时事件序列（`razer.py` 复用同一压平器）；`executor.py` 用后台线程驱动 `HostAdapter.inject_input` 并记录实际发出的事件；回灌把日志按既有 Take/Mark 格式写入 L0 泳道（`provenance='execution_log'`，不参与聚合中位数）。

**Tech Stack:** Python 3.11 + FastAPI + sqlite3（uv）· threading（执行线程）· ffmpeg CLI（ddagrab / avfoundation 采集）· AutoHotkey v2 worker 子进程（仅 Windows 注入）· React 19 + TS + Zustand（pnpm）

**Spec:** docs/superpowers/specs/2026-08-20-video-distiller-design.md（§4.2/§4.3/§9.1-9.3/§10/§11/§12-M4/§13）

## Global Constraints

- `HostAdapter` 是**全系统唯一平台相关的地方**（spec §4.2）；宿主失败抛结构化错误（设备不可用/权限不足/注入被拒）+ 处置建议（§10）
- MockHost 保证全链路在 macOS 上可开发、可测试（§4.3）；**Windows 真实注入只能手工验证**（§11）——真机验证是用户侧动作，计划内一律用 MockHost 测试，不得假装真机已验
- **全局急停热键必须实现**（F12 立即停止并释放所有按住的键）——安全底线，非可选项（§9.3）
- 执行器**只执行，不判断成败**（§9.3）
- 执行日志回灌：按 Take 格式导入 Analysis 的 L0 泳道，`provenance` 标为 `execution_log`，**不参与多 Take 聚合的中位数计算**（§9.3）
- 低置信度元素绝不静默包含（§9.2-4）：plan/razer 压平时低置信块**跳过 + 警告**（JSON/XML 无"注释行"，跳过+警告是其对应物）；`repeat_note` 手动循环 → 展开一遍 + `manual_loops` 汇总（§9.2-3 的 plan 对应物）
- emit 后端签名 `IR → bytes/str`，一个文件一个后端，不碰其他代码（§4.2）
- Razer 宏格式设计阶段未验证（§13.4）：**documented deviation** —— 按 Synapse 3 宏 XML 公开样例产出，快照测试锁定结构；能否真实导入由用户在 Windows 上验证
- 测试全部 FakeLLM/Mock，无真实 API 调用、无真实进程注入；`cd backend && uv run pytest`（当前 124）与 `cd frontend && pnpm build && pnpm test`（当前 34）全程保持绿
- Conventional commits；每个提交尾注 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 前端 hooks 一律位于早返回之上（既定裁决）；错误一律走 client.ts `j()` → pushError → ErrorBar

---

## File Structure

- Create `backend/src/vd/host.py` — HostError、HostAdapter 协议、MockHost、MacHost、WindowsHost、get_host 工厂（VD_HOST 覆盖）
- Create `backend/src/vd/emit/plan.py` — `flatten_events`（共享压平器）+ `render_playbook_plan` / `render_rotation_plan`
- Create `backend/src/vd/emit/razer.py` — `render_playbook_razer` / `render_rotation_razer`（复用 flatten_events）
- Create `backend/src/vd/executor.py` — ExecutionSession 状态机 + 模块级当前会话
- Modify `backend/src/vd/store.py` — `insert_mark` 增加 `provenance` 参数
- Modify `backend/src/vd/api.py` — 导出 fmt 扩到 `md|ahk|plan|razer`；exec/capture/backfeed 路由；聚合排除 execution_log
- Create `frontend/src/pages/ExecPage.tsx` — 执行台
- Modify `frontend/src/api/{types,client}.ts`、`frontend/src/App.tsx`、`README.md`、`CONTEXT.md`

---

### 任务 1：host.py — 协议、MockHost 与工厂

**Files:**
- Create: `backend/src/vd/host.py`
- Test: `backend/tests/test_host.py`

**Interfaces:**
- Produces: `HostError(Exception)`，属性 `code: str`（`"device_unavailable" | "permission_denied" | "injection_rejected" | "not_supported"`）、`hint: str`；`HostAdapter` 协议：`inject_input(event: dict) -> None`、`release_all() -> None`、`start_capture(out_path: str) -> None`、`stop_capture() -> str`；`MockHost`：`injected: list[dict]`、`released: int`、`capture_fixture: str | None`；`get_host() -> HostAdapter`（环境变量 `VD_HOST` ∈ `mock|mac|windows` 覆盖，缺省按 `sys.platform`：`darwin→MacHost`、`win32→WindowsHost`、其余→MockHost）
- 事件 dict 形状（与任务 3 的 plan events 一致）：`{"action": "down"|"up"|"tap"|"wheel", "key": str}`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_host.py
import pytest

from vd import host


def test_mock_host_records_injections():
    h = host.MockHost()
    h.inject_input({"action": "tap", "key": "q"})
    h.inject_input({"action": "down", "key": "Shift"})
    assert h.injected == [
        {"action": "tap", "key": "q"},
        {"action": "down", "key": "Shift"},
    ]


def test_mock_host_release_all_counts():
    h = host.MockHost()
    h.release_all()
    assert h.released == 1


def test_mock_host_capture_roundtrip(tmp_path):
    fixture = tmp_path / "preset.mp4"
    fixture.write_bytes(b"fake-video")
    h = host.MockHost(capture_fixture=str(fixture))
    out = tmp_path / "out.mp4"
    h.start_capture(str(out))
    got = h.stop_capture()
    assert got == str(out)
    assert out.read_bytes() == b"fake-video"


def test_mock_host_capture_without_fixture_raises():
    h = host.MockHost()
    h.start_capture("/tmp/nope.mp4")
    h2 = host.MockHost()
    with pytest.raises(host.HostError) as ei:
        h2.stop_capture()
    assert ei.value.code == "device_unavailable"


def test_get_host_env_override(monkeypatch):
    monkeypatch.setenv("VD_HOST", "mock")
    assert isinstance(host.get_host(), host.MockHost)


def test_host_error_carries_code_and_hint():
    e = host.HostError("permission_denied", "以管理员运行或授予屏幕录制权限")
    assert e.code == "permission_denied"
    assert "权限" in e.hint
    assert "permission_denied" in str(e)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_host.py -v`
Expected: FAIL（`No module named 'vd.host'`）

- [ ] **Step 3: 最小实现**

```python
# backend/src/vd/host.py
"""HostAdapter：全系统唯一平台相关模块（spec §4.2/§4.3）。"""
import os
import shutil
import sys


class HostError(Exception):
    """结构化宿主错误：code + 处置建议（spec §10）。"""

    def __init__(self, code: str, hint: str):
        self.code = code
        self.hint = hint
        super().__init__(f"[{code}] {hint}")


class MockHost:
    """记录调用，不实际注入；采集返回预置文件（spec §4.3）。"""

    def __init__(self, capture_fixture: str | None = None):
        self.injected: list[dict] = []
        self.released = 0
        self.capture_fixture = capture_fixture
        self._capture_out: str | None = None

    def inject_input(self, event: dict) -> None:
        self.injected.append(dict(event))

    def release_all(self) -> None:
        self.released += 1

    def start_capture(self, out_path: str) -> None:
        self._capture_out = out_path

    def stop_capture(self) -> str:
        if self._capture_out is None or self.capture_fixture is None:
            raise HostError("device_unavailable",
                            "MockHost 未配置 capture_fixture 或未 start_capture")
        shutil.copyfile(self.capture_fixture, self._capture_out)
        out, self._capture_out = self._capture_out, None
        return out


def get_host():
    kind = os.environ.get("VD_HOST", "")
    if kind == "mock":
        return MockHost()
    if kind == "mac" or (not kind and sys.platform == "darwin"):
        from vd.host import MacHost  # 任务 2 定义；同文件内直接名字引用
        return MacHost()
    if kind == "windows" or (not kind and sys.platform == "win32"):
        return WindowsHost()
    return MockHost()
```

注意：任务 2 会在同一文件补上 `MacHost` 与 `WindowsHost`；本任务先放**占位最小类**让 `get_host` 可导入（macOS 开发机上 `get_host()` 缺省会走 `MacHost`）：

```python
class MacHost:
    """采集可用（avfoundation），注入不实现（spec §4.3）。任务 2 完整实现。"""

    def inject_input(self, event: dict) -> None:
        raise HostError("not_supported", "macOS 不支持注入；请在 Windows 上执行或用 VD_HOST=mock")

    def release_all(self) -> None:
        pass

    def start_capture(self, out_path: str) -> None:
        raise HostError("device_unavailable", "任务 2 实现 avfoundation 采集")

    def stop_capture(self) -> str:
        raise HostError("device_unavailable", "任务 2 实现 avfoundation 采集")


class WindowsHost:
    """任务 2 完整实现。"""

    def inject_input(self, event: dict) -> None:
        raise HostError("device_unavailable", "任务 2 实现 AHK worker 注入")

    def release_all(self) -> None:
        pass

    def start_capture(self, out_path: str) -> None:
        raise HostError("device_unavailable", "任务 2 实现 ddagrab 采集")

    def stop_capture(self) -> str:
        raise HostError("device_unavailable", "任务 2 实现 ddagrab 采集")
```

（`get_host` 中的 `from vd.host import MacHost` 改为直接使用同文件名字 `MacHost()`——删掉该 import 行。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_host.py -v`
Expected: 6 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 130 passed

```bash
git add backend/src/vd/host.py backend/tests/test_host.py
git commit -m "feat(backend): host adapter protocol with mock implementation"
```

---

### 任务 2：host.py — MacHost 与 WindowsHost

**Files:**
- Modify: `backend/src/vd/host.py`
- Test: `backend/tests/test_host.py`（追加）

**Interfaces:**
- Consumes: 任务 1 的 `HostError`
- Produces: `MacHost.start_capture/stop_capture`（ffmpeg avfoundation，子进程）；`WindowsHost`：`_worker_script() -> str`（AHK v2 worker 源码）、`_event_line(event: dict) -> str`（stdin 行协议编码）、`inject_input`（懒启动 worker 子进程并写行）、`release_all`（写 `releaseall` 行）、`start_capture/stop_capture`（ffmpeg ddagrab）
- 行协议：`down <key>` / `up <key>` / `tap <key>` / `wheel` / `releaseall`，每行 `\n` 结尾
- 测试只验证**命令构造与脚本文本**，不真实 spawn（spec §11：Windows 真实注入只能手工验证）

- [ ] **Step 1: 写失败测试（追加到 test_host.py）**

```python
def test_windows_worker_script_has_emergency_stop_and_release():
    src = host.WindowsHost._worker_script()
    assert "#Requires AutoHotkey v2.0" in src
    assert "F12::" in src            # 全局急停（spec §9.3 安全底线）
    assert "OnExit" in src           # 退出时释放所有按住的键
    assert "held" in src             # worker 维护按下集合


def test_windows_event_line_protocol():
    f = host.WindowsHost._event_line
    assert f({"action": "down", "key": "Shift"}) == "down Shift\n"
    assert f({"action": "up", "key": "Shift"}) == "up Shift\n"
    assert f({"action": "tap", "key": "q"}) == "tap q\n"
    assert f({"action": "wheel", "key": ""}) == "wheel\n"
    with pytest.raises(host.HostError) as ei:
        f({"action": "warp", "key": "x"})
    assert ei.value.code == "injection_rejected"


def test_capture_commands():
    mac = host.MacHost._capture_cmd("/tmp/o.mp4")
    assert mac[0] == "ffmpeg" and "avfoundation" in mac and "/tmp/o.mp4" == mac[-1]
    win = host.WindowsHost._capture_cmd("/tmp/o.mp4")
    assert win[0] == "ffmpeg" and "ddagrab" in " ".join(win) and "/tmp/o.mp4" == win[-1]


def test_stop_capture_without_start_raises():
    with pytest.raises(host.HostError) as ei:
        host.MacHost().stop_capture()
    assert ei.value.code == "device_unavailable"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_host.py -v`
Expected: 新增 4 个 FAIL

- [ ] **Step 3: 实现（整体替换任务 1 的两个占位类）**

```python
import subprocess

_CAPTURE_COMMON = ["-y", "-framerate", "60", "-pix_fmt", "yuv420p"]


class MacHost:
    """采集走 ffmpeg avfoundation；注入不实现（spec §4.3）。"""

    def __init__(self):
        self._proc: subprocess.Popen | None = None
        self._out: str | None = None

    @staticmethod
    def _capture_cmd(out_path: str) -> list[str]:
        return (["ffmpeg", "-f", "avfoundation", "-i", "1:none",
                 *_CAPTURE_COMMON, out_path])

    def inject_input(self, event: dict) -> None:
        raise HostError("not_supported",
                        "macOS 不支持注入；请在 Windows 上执行或用 VD_HOST=mock")

    def release_all(self) -> None:
        pass

    def start_capture(self, out_path: str) -> None:
        if self._proc is not None:
            raise HostError("device_unavailable", "已有采集在进行，先 stop")
        try:
            self._proc = subprocess.Popen(
                self._capture_cmd(out_path), stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            raise HostError("device_unavailable", "未找到 ffmpeg；brew install ffmpeg")
        self._out = out_path

    def stop_capture(self) -> str:
        if self._proc is None or self._out is None:
            raise HostError("device_unavailable", "没有进行中的采集")
        self._proc.stdin.write(b"q")     # ffmpeg 优雅收尾
        self._proc.stdin.flush()
        self._proc.wait(timeout=30)
        out, self._proc, self._out = self._out, None, None
        return out


_WORKER_AHK = '''#Requires AutoHotkey v2.0
; Video Distiller 注入 worker：从 stdin 读行协议，F12 急停并释放所有按住的键
held := Map()
ReleaseHeld() {
    global held
    for key, _ in held
        Send "{" key " up}"
    held := Map()
}
OnExit((*) => ReleaseHeld())
F12::ExitApp
stdin := FileOpen("*", "r")
Loop {
    line := stdin.ReadLine()
    if (line = "")
        break
    parts := StrSplit(line, " ")
    cmd := parts[1]
    key := parts.Length > 1 ? parts[2] : ""
    if (cmd = "down") {
        Send "{" key " down}"
        held[key] := true
    } else if (cmd = "up") {
        Send "{" key " up}"
        held.Delete(key)
    } else if (cmd = "tap") {
        Send "{" key "}"
    } else if (cmd = "wheel") {
        Send "{WheelDown}"
    } else if (cmd = "releaseall") {
        ReleaseHeld()
    }
}
ExitApp
'''


class WindowsHost:
    """注入走 AHK v2 worker 子进程（spec §9.3 起步路径）；采集走 ffmpeg ddagrab。"""

    def __init__(self):
        self._worker: subprocess.Popen | None = None
        self._proc: subprocess.Popen | None = None
        self._out: str | None = None

    @staticmethod
    def _worker_script() -> str:
        return _WORKER_AHK

    @staticmethod
    def _event_line(event: dict) -> str:
        action = event.get("action")
        if action in ("down", "up", "tap"):
            return f"{action} {event['key']}\n"
        if action == "wheel":
            return "wheel\n"
        raise HostError("injection_rejected", f"未知事件 action：{action!r}")

    @staticmethod
    def _capture_cmd(out_path: str) -> list[str]:
        return (["ffmpeg", "-f", "lavfi", "-i", "ddagrab=framerate=60",
                 *_CAPTURE_COMMON, out_path])

    def _ensure_worker(self):
        if self._worker is not None and self._worker.poll() is None:
            return
        import tempfile
        script = tempfile.NamedTemporaryFile(
            "w", suffix=".ahk", delete=False, encoding="utf-8")
        script.write(self._worker_script())
        script.close()
        try:
            self._worker = subprocess.Popen(
                ["AutoHotkey.exe", script.name], stdin=subprocess.PIPE)
        except FileNotFoundError:
            raise HostError("device_unavailable",
                            "未找到 AutoHotkey.exe；安装 AutoHotkey v2 并加入 PATH")

    def inject_input(self, event: dict) -> None:
        self._ensure_worker()
        try:
            self._worker.stdin.write(self._event_line(event).encode("utf-8"))
            self._worker.stdin.flush()
        except (BrokenPipeError, OSError):
            self._worker = None
            raise HostError("injection_rejected",
                            "worker 已退出（可能被 F12 急停）；重新开始执行")

    def release_all(self) -> None:
        if self._worker is not None and self._worker.poll() is None:
            try:
                self._worker.stdin.write(b"releaseall\n")
                self._worker.stdin.flush()
            except (BrokenPipeError, OSError):
                self._worker = None

    def start_capture(self, out_path: str) -> None:
        if self._proc is not None:
            raise HostError("device_unavailable", "已有采集在进行，先 stop")
        try:
            self._proc = subprocess.Popen(
                self._capture_cmd(out_path), stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            raise HostError("device_unavailable", "未找到 ffmpeg；安装并加入 PATH")
        self._out = out_path

    def stop_capture(self) -> str:
        if self._proc is None or self._out is None:
            raise HostError("device_unavailable", "没有进行中的采集")
        self._proc.stdin.write(b"q")
        self._proc.stdin.flush()
        self._proc.wait(timeout=30)
        out, self._proc, self._out = self._out, None, None
        return out
```

（`subprocess` import 放文件顶部；删除任务 1 占位类。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_host.py -v`
Expected: 10 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 134 passed

```bash
git add backend/src/vd/host.py backend/tests/test_host.py
git commit -m "feat(backend): mac and windows host implementations"
```

---

### 任务 3：emit/plan.py — 事件压平器与 plan JSON

**Files:**
- Create: `backend/src/vd/emit/plan.py`
- Test: `backend/tests/test_emit_plan.py`

**Interfaces:**
- Consumes: rotation/playbook/skills/binds 形状与 `emit/ahk.py` 完全一致（rotation body 项：`{"skill": id}` / `{"gap": ms}` / 原始 op `{"op":..., "key":...}`；playbook block：`rotation|skill|gap|note` 主键 + `iterations`/`repeat_note`/`confidence`；binds：`dict[skill_id, list[str]]`，取 `keys[0]`，chord 为 `"Shift+2"` 单字符串）
- Produces: `flatten_events(sections, rotations_by_id, skills_by_id, binds) -> tuple[list[dict], list[str], list[str]]`（events, manual_loops, warnings）；`render_playbook_plan(playbook, rotations_by_id, skills_by_id, binds) -> str`（JSON 文本）；`render_rotation_plan(rotation, skills_by_id, binds) -> str`
- 事件形状：`{"t_ms": int, "action": "down"|"up"|"tap"|"wheel", "key": str}`；`t_ms` 为相对起点的时钟：`tap`/`wheel`/chord 不推进时钟，`gap` 推进 `ms`，`hold` 在 `t` 发 down、`t+ms` 发 up 并推进 `ms`
- 压平规则（§9.2 的 plan 对应物）：`iterations: N` → 展开 N 遍；`repeat_note` → 展开 1 遍 + `manual_loops` 记录；低置信块（confidence < 0.7）→ **跳过 + warnings**；无 pattern 无绑定技能 → 跳过 + warnings；note 块 → 无事件
- plan JSON 顶层：`{"format": "vd-plan", "version": 1, "title": str, "stop_hotkey": "F12", "events": [...], "manual_loops": [...], "warnings": [...]}`，`json.dumps(..., ensure_ascii=False, indent=2)`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_emit_plan.py
import json

from vd.emit.plan import flatten_events, render_playbook_plan, render_rotation_plan

SKILLS = {
    "sk_a": {"id": "sk_a", "name": "平A", "pattern": [{"op": "tap", "key": "1"}]},
    "sk_h": {"id": "sk_h", "name": "蓄力", "pattern": [
        {"op": "hold", "key": "LMB", "ms": 300}]},
    "sk_b": {"id": "sk_b", "name": "闪现", "pattern": []},   # 仅绑定
    "sk_n": {"id": "sk_n", "name": "孤儿", "pattern": []},   # 无 pattern 无绑定
}
ROTS = {"rot_1": {"id": "rot_1", "name": "小循环", "body": [
    {"skill": "sk_a"}, {"gap": 150}, {"op": "tap", "key": "E"}]}}
BINDS = {"sk_b": ["Shift+2"]}


def test_flatten_rotation_body_with_gap_and_raw_op():
    events, loops, warns = flatten_events(
        [{"name": "s", "body": [{"rotation": "rot_1"}]}], ROTS, SKILLS, {})
    assert events == [
        {"t_ms": 0, "action": "tap", "key": "1"},
        {"t_ms": 150, "action": "tap", "key": "E"},
    ]
    assert loops == [] and warns == []


def test_hold_emits_down_up_and_advances_clock():
    events, _, _ = flatten_events(
        [{"name": "s", "body": [{"skill": "sk_h"}, {"gap": 100},
                                 {"skill": "sk_a"}]}], {}, SKILLS, {})
    assert events == [
        {"t_ms": 0, "action": "down", "key": "LMB"},
        {"t_ms": 300, "action": "up", "key": "LMB"},
        {"t_ms": 400, "action": "tap", "key": "1"},
    ]


def test_chord_bind_expands_first_key_wrapped():
    events, _, warns = flatten_events(
        [{"name": "s", "body": [{"skill": "sk_b"}]}], {}, SKILLS, BINDS)
    assert events == [
        {"t_ms": 0, "action": "down", "key": "Shift"},
        {"t_ms": 0, "action": "tap", "key": "2"},
        {"t_ms": 0, "action": "up", "key": "Shift"},
    ]
    assert warns == []


def test_unbindable_skill_skipped_with_warning():
    events, _, warns = flatten_events(
        [{"name": "s", "body": [{"skill": "sk_n"}]}], {}, SKILLS, {})
    assert events == []
    assert any("孤儿" in w for w in warns)


def test_iterations_unroll_and_manual_loop():
    sections = [{"name": "s", "body": [
        {"rotation": "rot_1", "iterations": 2},
        {"rotation": "rot_1", "repeat_note": "打到红血停"},
    ]}]
    events, loops, _ = flatten_events(sections, ROTS, SKILLS, {})
    assert len([e for e in events if e["key"] == "1"]) == 3   # 2 + 1
    assert loops == ["[s] 小循环：打到红血停"]


def test_low_confidence_block_skipped_with_warning():
    sections = [{"name": "s", "body": [
        {"skill": "sk_a", "confidence": 0.4}]}]
    events, _, warns = flatten_events(sections, {}, SKILLS, {})
    assert events == []
    assert any("低置信" in w for w in warns)


def test_render_playbook_plan_shape():
    pb = {"id": "pb_1", "name": "测试方案", "version": 2,
          "sections": [{"name": "s", "body": [{"rotation": "rot_1"}]}]}
    doc = json.loads(render_playbook_plan(pb, ROTS, SKILLS, {}))
    assert doc["format"] == "vd-plan" and doc["version"] == 1
    assert doc["stop_hotkey"] == "F12"
    assert doc["title"] == "方案：测试方案 v2"
    assert len(doc["events"]) == 2


def test_render_rotation_plan_shape():
    doc = json.loads(render_rotation_plan(ROTS["rot_1"], SKILLS, {}))
    assert doc["title"] == "循环：小循环"
    assert doc["events"][0] == {"t_ms": 0, "action": "tap", "key": "1"}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_emit_plan.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```python
# backend/src/vd/emit/plan.py
"""IR → 注入计划 JSON（spec §9.1 plan 后端、§9.3 执行器输入）。"""
import json


def _ev(t: int, action: str, key: str = "") -> dict:
    return {"t_ms": t, "action": action, "key": key}


def _op_events(item: dict, t: int, warnings: list[str]) -> tuple[list[dict], int]:
    """单个 op 项 → 事件列表 + 推进后的时钟。与 emit/ahk._op_lines 语义对齐。"""
    op = item.get("op")
    if op == "tap":
        return [_ev(t, "tap", item["key"])], t
    if op == "gap":
        return [], t + int(item["ms"])
    if op == "hold":
        key = item.get("key") or item.get("button")
        ms = int(item.get("ms", 100))
        return [_ev(t, "down", key), _ev(t + ms, "up", key)], t + ms
    if op == "chord":
        keys = item.get("keys")
        if keys is None:
            keys = (item.get("key") or "").split("+")
        evs = [_ev(t, "down", keys[0])]
        for k in keys[1:]:
            evs.append(_ev(t, "tap", k))
        evs.append(_ev(t, "up", keys[0]))
        return evs, t
    if op == "wheel":
        return [_ev(t, "wheel")], t
    warnings.append(f"未知操作已跳过：{item!r}")
    return [], t


def _chord_events(parts: list[str], t: int) -> list[dict]:
    evs = [_ev(t, "down", parts[0])]
    for k in parts[1:]:
        evs.append(_ev(t, "tap", k))
    evs.append(_ev(t, "up", parts[0]))
    return evs


def _skill_events(skill: dict, binds: dict, t: int,
                  warnings: list[str]) -> tuple[list[dict], int]:
    pattern = skill.get("pattern") or []
    if pattern:
        evs: list[dict] = []
        for item in pattern:
            got, t = _op_events(item, t, warnings)
            evs.extend(got)
        return evs, t
    keys = binds.get(skill["id"]) or []
    if keys:
        parts = keys[0].split("+")
        if len(parts) > 1:
            return _chord_events(parts, t), t
        return [_ev(t, "tap", parts[0])], t
    warnings.append(f"技能 {skill['name']} 无 pattern 也无键位绑定，已跳过")
    return [], t


def _rotation_events(rotation: dict, skills_by_id: dict, binds: dict, t: int,
                     warnings: list[str]) -> tuple[list[dict], int]:
    evs: list[dict] = []
    for item in rotation["body"]:
        if "skill" in item:
            sk = skills_by_id.get(item["skill"])
            if sk is None:
                warnings.append(f"未知技能 {item['skill']}，已跳过")
                continue
            got, t = _skill_events(sk, binds, t, warnings)
            evs.extend(got)
        elif "gap" in item:
            t += int(item["gap"])
        elif "op" in item:
            got, t = _op_events(item, t, warnings)
            evs.extend(got)
        else:
            warnings.append(f"循环体未知项已跳过：{item!r}")
    return evs, t


def flatten_events(sections: list, rotations_by_id: dict, skills_by_id: dict,
                   binds: dict) -> tuple[list[dict], list[str], list[str]]:
    events: list[dict] = []
    manual_loops: list[str] = []
    warnings: list[str] = []
    t = 0
    for sec in sections:
        for block in sec.get("body", []):
            if block.get("confidence", 1.0) < 0.7:
                warnings.append(f"[{sec.get('name', '')}] 低置信块已跳过：{block!r}")
                continue
            if "note" in block:
                continue
            if "skill" in block:
                sk = skills_by_id.get(block["skill"])
                if sk is None:
                    warnings.append(f"未知技能 {block['skill']}，已跳过")
                    continue
                got, t = _skill_events(sk, binds, t, warnings)
                events.extend(got)
            elif "gap" in block:
                t += int(block["gap"])
            elif "rotation" in block:
                rot = rotations_by_id.get(block["rotation"])
                if rot is None:
                    warnings.append(f"未知循环 {block['rotation']}，已跳过")
                    continue
                if block.get("repeat_note"):
                    manual_loops.append(
                        f"[{sec.get('name', '')}] {rot['name']}：{block['repeat_note']}")
                    reps = 1
                else:
                    reps = int(block.get("iterations") or 1)
                for _ in range(reps):
                    got, t = _rotation_events(rot, skills_by_id, binds, t, warnings)
                    events.extend(got)
    return events, manual_loops, warnings


def _render(title: str, events, manual_loops, warnings) -> str:
    return json.dumps({
        "format": "vd-plan", "version": 1, "title": title,
        "stop_hotkey": "F12", "events": events,
        "manual_loops": manual_loops, "warnings": warnings,
    }, ensure_ascii=False, indent=2)


def render_playbook_plan(playbook: dict, rotations_by_id: dict,
                         skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        playbook["sections"], rotations_by_id, skills_by_id, binds)
    title = f"方案：{playbook['name']} v{playbook['version']}"
    return _render(title, events, loops, warns)


def render_rotation_plan(rotation: dict, skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        [{"name": rotation["name"], "body": [{"rotation": rotation["id"]}]}],
        {rotation["id"]: rotation}, skills_by_id, binds)
    return _render(f"循环：{rotation['name']}", events, loops, warns)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_emit_plan.py -v`
Expected: 8 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 142 passed

```bash
git add backend/src/vd/emit/plan.py backend/tests/test_emit_plan.py
git commit -m "feat(backend): plan json emit backend with shared event flattener"
```

---

### 任务 4：emit/razer.py — Razer 宏 XML

**Files:**
- Create: `backend/src/vd/emit/razer.py`
- Test: `backend/tests/test_emit_razer.py`

**Interfaces:**
- Consumes: 任务 3 的 `flatten_events`
- Produces: `render_playbook_razer(playbook, rotations_by_id, skills_by_id, binds) -> str`、`render_rotation_razer(rotation, skills_by_id, binds) -> str`
- **Documented deviation（spec §13.4）**：Synapse 3 宏 XML 按公开样例结构产出（`<Macro><MacroEvents>` 下 `KeyDown/KeyUp/Delay` 元素）；能否真实导入由用户在 Windows Synapse 中验证。GUID 由标题的 `uuid5` 派生（确定性，快照可测）
- 事件转换：相邻事件的 `t_ms` 差 → `<Delay ms="..."/>`；`tap` → KeyDown+KeyUp 相邻；`down`/`up` → 对应元素；`wheel` → `<WheelDown/>`；warnings/manual_loops 以 XML 注释形式置于文件头

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_emit_razer.py
from vd.emit.razer import render_playbook_razer, render_rotation_razer

SKILLS = {
    "sk_a": {"id": "sk_a", "name": "平A", "pattern": [{"op": "tap", "key": "1"}]},
    "sk_h": {"id": "sk_h", "name": "蓄力", "pattern": [
        {"op": "hold", "key": "F", "ms": 300}]},
}
ROT = {"id": "rot_1", "name": "小循环",
       "body": [{"skill": "sk_a"}, {"gap": 150}, {"skill": "sk_h"}]}


def test_rotation_razer_structure():
    xml = render_rotation_razer(ROT, SKILLS, {})
    assert xml.startswith('<?xml version="1.0" encoding="utf-8"?>')
    assert '<Macro name="循环：小循环"' in xml
    assert 'guid="' in xml
    assert xml.index('<KeyDown key="1"/>') < xml.index('<KeyUp key="1"/>')
    assert '<Delay ms="150"/>' in xml
    assert xml.index('<KeyDown key="F"/>') < xml.index('<Delay ms="300"/>') \
        < xml.index('<KeyUp key="F"/>')


def test_razer_deterministic():
    a = render_rotation_razer(ROT, SKILLS, {})
    b = render_rotation_razer(ROT, SKILLS, {})
    assert a == b


def test_playbook_razer_warnings_as_comments():
    pb = {"id": "pb_1", "name": "测试", "version": 1, "sections": [
        {"name": "s", "body": [
            {"rotation": "rot_1", "repeat_note": "看血线"},
            {"skill": "sk_missing"}]}]}
    xml = render_playbook_razer(pb, {"rot_1": ROT}, SKILLS, {})
    assert "<!-- ⚠" in xml
    assert "看血线" in xml
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_emit_razer.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```python
# backend/src/vd/emit/razer.py
"""IR → Razer Synapse 宏 XML（spec §9.1；格式未经官方验证——§13.4 documented deviation：
按公开样例结构产出，真实导入由用户在 Windows Synapse 验证）。"""
import uuid
from xml.sax.saxutils import escape, quoteattr

from vd.emit.plan import flatten_events

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # uuid.NAMESPACE_DNS


def _one_line(x) -> str:
    return str(x).replace("\n", " ").replace("\r", " ")


def _events_xml(events: list[dict]) -> list[str]:
    lines: list[str] = []
    prev_t = 0
    for ev in events:
        delta = ev["t_ms"] - prev_t
        if delta > 0:
            lines.append(f'    <Delay ms="{delta}"/>')
        prev_t = ev["t_ms"]
        key = escape(ev.get("key", ""))
        if ev["action"] == "tap":
            lines.append(f'    <KeyDown key="{key}"/>')
            lines.append(f'    <KeyUp key="{key}"/>')
        elif ev["action"] == "down":
            lines.append(f'    <KeyDown key="{key}"/>')
        elif ev["action"] == "up":
            lines.append(f'    <KeyUp key="{key}"/>')
        elif ev["action"] == "wheel":
            lines.append('    <WheelDown/>')
    return lines


def _render(title: str, events, manual_loops, warnings) -> str:
    guid = str(uuid.uuid5(_NS, title))
    head = ['<?xml version="1.0" encoding="utf-8"?>']
    for w in warnings:
        head.append(f"<!-- ⚠ {escape(_one_line(w))} -->")
    for m in manual_loops:
        head.append(f"<!-- ⚠ 手动循环：{escape(_one_line(m))} -->")
    head.append(f'<Macro name={quoteattr(_one_line(title))} guid="{guid}">')
    head.append("  <MacroEvents>")
    body = _events_xml(events)
    tail = ["  </MacroEvents>", "</Macro>", ""]
    return "\n".join(head + body + tail)


def render_playbook_razer(playbook: dict, rotations_by_id: dict,
                          skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        playbook["sections"], rotations_by_id, skills_by_id, binds)
    title = f"方案：{playbook['name']} v{playbook['version']}"
    return _render(title, events, loops, warns)


def render_rotation_razer(rotation: dict, skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        [{"name": rotation["name"], "body": [{"rotation": rotation["id"]}]}],
        {rotation["id"]: rotation}, skills_by_id, binds)
    return _render(f"循环：{rotation['name']}", events, loops, warns)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_emit_razer.py -v`
Expected: 3 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 145 passed

```bash
git add backend/src/vd/emit/razer.py backend/tests/test_emit_razer.py
git commit -m "feat(backend): razer macro xml emit backend"
```

---

### 任务 5：导出路由扩展 plan/razer

**Files:**
- Modify: `backend/src/vd/api.py`（两个导出路由的 fmt 校验与分发）
- Test: `backend/tests/test_api.py`（追加）

**Interfaces:**
- Consumes: 任务 3/4 的 render 函数；既有 `_export_context`、`store.get_keymap`
- Produces: `GET /api/rotations/{id}/export.{fmt}` 与 `GET /api/playbooks/{id}/export.{fmt}` 接受 `md|ahk|plan|razer`；content-type：plan → `application/json; charset=utf-8`，razer → `application/xml; charset=utf-8`；binds 解析规则与 md/ahk 完全一致（playbook 用钉定 keymap，rotation 用空 binds）

- [ ] **Step 1: 写失败测试（追加到 test_api.py 导出测试附近）**

```python
def test_export_plan_and_razer_routes(client):
    pb_id, rot_id = _make_playbook(client)
    r = client.get(f"/api/playbooks/{pb_id}/export.plan")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/json; charset=utf-8"
    doc = r.json()
    assert doc["format"] == "vd-plan" and doc["stop_hotkey"] == "F12"
    r2 = client.get(f"/api/rotations/{rot_id}/export.razer")
    assert r2.status_code == 200
    assert r2.headers["content-type"] == "application/xml; charset=utf-8"
    assert "<Macro name=" in r2.text
    assert client.get(f"/api/playbooks/{pb_id}/export.exe").status_code == 400
```

（`_make_playbook` 为既有测试助手，返回值按其现有形状使用；若它只返回 pb_id，则 rot_id 用其内部创建的 rotation——阅读现有助手后适配，但断言内容不变。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_api.py -k "plan_and_razer" -v`
Expected: FAIL（400 fmt 校验拒绝 plan）

- [ ] **Step 3: 实现（api.py 导出路由改造）**

fmt 白名单改为 `("md", "ahk", "plan", "razer")`；媒体类型映射：

```python
_EXPORT_MEDIA = {
    "md": "text/markdown; charset=utf-8",
    "ahk": "text/plain; charset=utf-8",
    "plan": "application/json; charset=utf-8",
    "razer": "application/xml; charset=utf-8",
}
```

rotation 路由分发（playbook 路由同构，多传 rotations_by_id 与 binds）：

```python
from vd.emit import plan as emit_plan
from vd.emit import razer as emit_razer

    if fmt == "md":
        text = emit_md.render_rotation_md(rot, skills_by_id)
    elif fmt == "ahk":
        text = emit_ahk.render_rotation_ahk(rot, skills_by_id, {})
    elif fmt == "plan":
        text = emit_plan.render_rotation_plan(rot, skills_by_id, {})
    else:
        text = emit_razer.render_rotation_razer(rot, skills_by_id, {})
    return PlainTextResponse(text, media_type=_EXPORT_MEDIA[fmt])
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_api.py -v`
Expected: 全部 PASS（含新增）

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 146 passed

```bash
git add backend/src/vd/api.py backend/tests/test_api.py
git commit -m "feat(backend): plan and razer export routes"
```

---

### 任务 6：executor.py — 执行会话状态机

**Files:**
- Create: `backend/src/vd/executor.py`
- Test: `backend/tests/test_executor.py`

**Interfaces:**
- Consumes: 任务 1 的 `HostAdapter`（测试用 MockHost）、任务 3 的 plan dict（`json.loads` 后）
- Produces: `ExecutionSession(plan: dict, host, speed: float = 1.0)`：属性 `state`（`"idle"|"running"|"paused"|"stopped"|"done"`）、`cursor: int`（下一事件下标）、`log: list[dict]`（`{"t_ms": 实际相对毫秒, "action", "key"}`）；方法 `start()`（后台线程跑完剩余事件）、`pause()`、`resume()`、`step()`（仅在 idle/paused 下派发一个事件）、`stop()`（终态：释放按住的键——对每个未配对 down 注入 up 并 `host.release_all()`）、`status() -> dict`（state/cursor/total/log 尾 50 条）；线程安全（`threading.Lock` + `threading.Event`）
- 定时：事件间 sleep `(next.t_ms - prev.t_ms) / 1000 / speed`；测试用事件全部 `t_ms` 差 ≤ 20ms 保证套件速度
- **只执行不判断成败**（§9.3）：inject 抛 `HostError` → state=`stopped`，错误进 `status()["error"]`，已注入事件的 log 保留

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_executor.py
import time

from vd.executor import ExecutionSession
from vd.host import HostError, MockHost

PLAN = {"format": "vd-plan", "version": 1, "title": "t", "stop_hotkey": "F12",
        "events": [
            {"t_ms": 0, "action": "down", "key": "Shift"},
            {"t_ms": 10, "action": "tap", "key": "2"},
            {"t_ms": 20, "action": "up", "key": "Shift"},
        ], "manual_loops": [], "warnings": []}


def _wait(sess, state, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if sess.state == state:
            return True
        time.sleep(0.01)
    return False


def test_run_to_done_injects_all_and_logs():
    h = MockHost()
    s = ExecutionSession(PLAN, h)
    s.start()
    assert _wait(s, "done")
    assert [e["action"] for e in h.injected] == ["down", "tap", "up"]
    assert len(s.log) == 3
    assert s.status()["cursor"] == 3


def test_step_dispatches_one_event():
    h = MockHost()
    s = ExecutionSession(PLAN, h)
    s.step()
    assert s.state == "paused"
    assert len(h.injected) == 1
    s.step()
    assert len(h.injected) == 2


def test_stop_releases_held_keys():
    h = MockHost()
    s = ExecutionSession(PLAN, h)
    s.step()                      # down Shift 已注入，Shift 处于按住
    s.stop()
    assert s.state == "stopped"
    ups = [e for e in h.injected if e["action"] == "up" and e["key"] == "Shift"]
    assert ups, "stop 必须为未配对 down 注入 up"
    assert h.released == 1


def test_pause_resume():
    h = MockHost()
    slow = dict(PLAN)
    slow["events"] = [{"t_ms": i * 30, "action": "tap", "key": "q"}
                      for i in range(10)]
    s = ExecutionSession(slow, h)
    s.start()
    time.sleep(0.05)
    s.pause()
    assert _wait(s, "paused")
    n = len(h.injected)
    time.sleep(0.08)
    assert len(h.injected) == n   # 暂停期间不再注入
    s.resume()
    assert _wait(s, "done")
    assert len(h.injected) == 10


def test_host_error_stops_session():
    class Boom(MockHost):
        def inject_input(self, event):
            raise HostError("injection_rejected", "boom")
    s = ExecutionSession(PLAN, Boom())
    s.start()
    assert _wait(s, "stopped")
    assert "boom" in s.status()["error"]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_executor.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```python
# backend/src/vd/executor.py
"""注入执行器（spec §9.3）：只执行不判断成败；停止必须释放按住的键。"""
import threading
import time

from vd.host import HostError


class ExecutionSession:
    def __init__(self, plan: dict, host, speed: float = 1.0):
        self.plan = plan
        self.host = host
        self.speed = speed
        self.state = "idle"
        self.cursor = 0
        self.log: list[dict] = []
        self.error: str | None = None
        self._held: set[str] = set()
        self._lock = threading.Lock()
        self._resume = threading.Event()
        self._resume.set()
        self._thread: threading.Thread | None = None
        self._t0: float | None = None

    def _dispatch(self, ev: dict) -> None:
        self.host.inject_input(ev)
        if ev["action"] == "down":
            self._held.add(ev["key"])
        elif ev["action"] == "up":
            self._held.discard(ev["key"])
        now = time.monotonic()
        rel = 0 if self._t0 is None else round((now - self._t0) * 1000)
        self.log.append({"t_ms": rel, "action": ev["action"], "key": ev["key"]})

    def _run(self) -> None:
        events = self.plan["events"]
        prev_t = events[self.cursor - 1]["t_ms"] if self.cursor else 0
        try:
            while True:
                with self._lock:
                    if self.state != "running":
                        return
                    if self.cursor >= len(events):
                        self.state = "done"
                        return
                    ev = events[self.cursor]
                delay = (ev["t_ms"] - prev_t) / 1000.0 / self.speed
                if delay > 0:
                    time.sleep(delay)
                self._resume.wait()
                with self._lock:
                    if self.state != "running":
                        return
                    self._dispatch(ev)
                    self.cursor += 1
                prev_t = ev["t_ms"]
        except HostError as e:
            with self._lock:
                self.error = str(e)
                self.state = "stopped"

    def start(self) -> None:
        with self._lock:
            if self.state in ("running",):
                return
            if self.state in ("stopped", "done"):
                raise ValueError("会话已结束，请新建执行")
            if self._t0 is None:
                self._t0 = time.monotonic()
            self.state = "running"
            self._resume.set()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def pause(self) -> None:
        with self._lock:
            if self.state == "running":
                self.state = "paused"
        self._resume.set()

    def resume(self) -> None:
        with self._lock:
            if self.state != "paused":
                return
        self.start()

    def step(self) -> None:
        with self._lock:
            if self.state in ("stopped", "done"):
                raise ValueError("会话已结束")
            if self.state == "running":
                raise ValueError("运行中不能单步，先暂停")
            if self._t0 is None:
                self._t0 = time.monotonic()
            events = self.plan["events"]
            if self.cursor >= len(events):
                self.state = "done"
                return
            try:
                self._dispatch(events[self.cursor])
                self.cursor += 1
                self.state = "done" if self.cursor >= len(events) else "paused"
            except HostError as e:
                self.error = str(e)
                self.state = "stopped"

    def stop(self) -> None:
        with self._lock:
            self.state = "stopped"
            for key in sorted(self._held):
                try:
                    self.host.inject_input({"action": "up", "key": key})
                except HostError:
                    pass
            self._held.clear()
        try:
            self.host.release_all()
        except HostError:
            pass

    def status(self) -> dict:
        with self._lock:
            return {
                "state": self.state, "cursor": self.cursor,
                "total": len(self.plan["events"]),
                "title": self.plan.get("title", ""),
                "error": self.error, "log": self.log[-50:],
            }
```

实现提示：`pause()` 里 `self._resume.set()` 前应先 `clear()`——正确顺序是 `pause` 设 state=paused 后线程自然退出循环；`resume` 复用 `start()` 起新线程。测试 `test_pause_resume` 是行为契约：暂停后不再注入、恢复后跑完。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_executor.py -v`
Expected: 5 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 151 passed

```bash
git add backend/src/vd/executor.py backend/tests/test_executor.py
git commit -m "feat(backend): execution session state machine"
```

---

### 任务 7：exec / capture / 回灌路由与聚合排除

**Files:**
- Modify: `backend/src/vd/api.py`、`backend/src/vd/store.py`
- Test: `backend/tests/test_api.py`（追加）

**Interfaces:**
- Consumes: 任务 5 的 plan 渲染、任务 6 的 `ExecutionSession`、任务 1 的 `get_host`/`MockHost`、既有 `store.create_take`/`insert_mark`/`get_analysis_tree`、`ingest.process`
- Produces:
  - `store.insert_mark(..., provenance="human_manual")` 新增关键字参数（既有调用不变）
  - 模块级 `_exec_session: ExecutionSession | None` 与 `_exec_host`（进程内单会话；本地单用户）
  - `POST /api/exec/start` body `{"kind": "rotation"|"playbook", "id": str, "speed": float=1.0}` → 构建 plan、新建会话并 start；已有运行中会话 → 409
  - `POST /api/exec/pause|resume|stop|step`（无会话 → 404；HostError → 500 + hint）
  - `GET /api/exec/status`（无会话 → `{"state": "idle"}`）
  - `POST /api/exec/backfeed` body `{"analysis_id": str}` → 会话须 `stopped|done`，把 log 配对成 marks 写入该 Analysis 的 L0 泳道新 Take（`provenance='execution_log'`），返回 take；配对规则：`down X` 与其后最近的 `up X` → 一条 input mark（`t_ms=down.t, end_ms=up.t, label=X`）；`tap X` → input mark（无 end）；`wheel` → input mark label `Wheel`；孤立 `up X` → release mark
  - `POST /api/capture/start` → host.start_capture 到 `data_root/captures/<ts>.mp4`；`POST /api/capture/stop` → stop 后走 `ingest.process` 入库返回 video；HostError → 500 `{"detail": {"code", "hint"}}`
  - 聚合排除：`api.py` 两处聚合调用改走辅助函数 `_lane_takes_marks(conn, lane_id) -> list[list[dict]]`，**跳过非空且全部 marks `provenance=='execution_log'` 的 take**
  - 测试用 `monkeypatch` 把 api 模块的 `_exec_host` 换成 `MockHost`（capture 测试同理注入 fixture）

- [ ] **Step 1: 写失败测试（追加到 test_api.py）**

```python
def test_exec_lifecycle_and_backfeed(client, monkeypatch):
    from vd import api as api_module
    from vd.host import MockHost
    h = MockHost()
    monkeypatch.setattr(api_module, "_exec_host", h)

    pb_id, _ = _make_playbook(client)
    an_id = _make_analysis(client)          # 既有助手；若无则按现有测试建 video+analysis

    r = client.post("/api/exec/start", json={"kind": "playbook", "id": pb_id})
    assert r.status_code == 200
    for _ in range(100):
        st = client.get("/api/exec/status").json()
        if st["state"] == "done":
            break
        time.sleep(0.02)
    assert st["state"] == "done"
    assert len(h.injected) == st["total"] > 0

    r = client.post("/api/exec/backfeed", json={"analysis_id": an_id})
    assert r.status_code == 200
    take = r.json()
    assert take["marks"]
    assert all(m["provenance"] == "execution_log" for m in take["marks"])


def test_exec_start_conflict_and_stop(client, monkeypatch):
    from vd import api as api_module
    from vd.host import MockHost
    monkeypatch.setattr(api_module, "_exec_host", MockHost())
    pb_id, _ = _make_playbook(client)
    slow_events = [{"t_ms": i * 100, "action": "tap", "key": "q"} for i in range(50)]
    monkeypatch.setattr(
        api_module.emit_plan, "render_playbook_plan",
        lambda *a, **k: json.dumps({"format": "vd-plan", "version": 1,
                                    "title": "t", "stop_hotkey": "F12",
                                    "events": slow_events,
                                    "manual_loops": [], "warnings": []}))
    assert client.post("/api/exec/start",
                       json={"kind": "playbook", "id": pb_id}).status_code == 200
    assert client.post("/api/exec/start",
                       json={"kind": "playbook", "id": pb_id}).status_code == 409
    assert client.post("/api/exec/stop").status_code == 200
    assert client.get("/api/exec/status").json()["state"] == "stopped"


def test_execution_log_takes_excluded_from_aggregation(client):
    an_id = _make_analysis(client)
    lanes = client.get(f"/api/analyses/{an_id}").json()["lanes"]
    l0 = next(l for l in lanes if l["layer"] == 0)
    t1 = client.post(f"/api/lanes/{l0['id']}/takes").json()
    client.post(f"/api/takes/{t1['id']}/marks",
                json={"t_ms": 1000, "kind": "input", "label": "Q"})
    from vd import db, store
    conn = db.connect()
    t2 = store.create_take(conn, l0["id"])
    store.insert_mark(conn, t2["id"], t_ms=99000, kind="input", label="Q",
                      provenance="execution_log")
    agg = client.get(f"/api/lanes/{l0['id']}/aggregate").json()["aggregated"]
    assert [m["t_ms"] for m in agg] == [1000]   # 99000 不得影响中位数


def test_capture_roundtrip_with_mock(client, monkeypatch, tmp_path):
    from vd import api as api_module
    from vd.host import MockHost
    fixture = tmp_path / "cap.mp4"
    import shutil
    shutil.copyfile(SAMPLE_MP4, fixture)     # 既有测试样例视频常量；无则用 ingest 测试的样例生成方式
    monkeypatch.setattr(api_module, "_exec_host", MockHost(capture_fixture=str(fixture)))
    assert client.post("/api/capture/start").status_code == 200
    r = client.post("/api/capture/stop")
    assert r.status_code == 200
    assert r.json()["id"].startswith("vid_")
```

（`_make_analysis`/`SAMPLE_MP4` 若与现有测试助手命名不同，按 test_api.py 现状适配，断言不变。capture 测试若既有样例视频生成成本高，可用 `test_ingest.py` 已有的 fixture 方式。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && uv run pytest tests/test_api.py -k "exec or capture or excluded" -v`
Expected: FAIL（路由不存在）

- [ ] **Step 3: 实现**

store.py：

```python
def insert_mark(conn, take_id, *, t_ms, kind, label=None, end_ms=None,
                provenance="human_manual"):
    _validate_mark(t_ms, end_ms, kind, label)
    mid = _id("mk")
    conn.execute(
        "INSERT INTO marks(id,take_id,t_ms,end_ms,kind,label,provenance)"
        " VALUES(?,?,?,?,?,?,?)",
        (mid, take_id, t_ms, end_ms, kind, label, provenance))
    conn.commit()
    return dict(conn.execute("SELECT * FROM marks WHERE id=?", (mid,)).fetchone())
```

（以现有 insert_mark 实现为基底，仅增列与参数；列名核对现有 INSERT。）

api.py 新增（要点，完整照写）：

```python
from vd import executor as vd_executor
from vd import host as vd_host
from vd.emit import plan as emit_plan

_exec_host = vd_host.get_host()
_exec_session: vd_executor.ExecutionSession | None = None


class ExecStartReq(BaseModel):
    kind: str
    id: str
    speed: float = 1.0


def _lane_takes_marks(conn, lane_id: str) -> list[list[dict]]:
    takes = []
    for t in conn.execute(
            "SELECT id FROM takes WHERE lane_id=? ORDER BY idx", (lane_id,)):
        marks = [dict(r) for r in conn.execute(
            "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (t["id"],))]
        if marks and all(m["provenance"] == "execution_log" for m in marks):
            continue        # spec §9.3：执行日志不参与聚合
        takes.append(marks)
    return takes


@app.post("/api/exec/start")
def exec_start(req: ExecStartReq, conn=Depends(get_conn)):
    global _exec_session
    if req.kind not in ("rotation", "playbook"):
        raise HTTPException(status_code=400, detail="kind 须为 rotation|playbook")
    if _exec_session is not None and _exec_session.state in ("running", "paused"):
        raise HTTPException(status_code=409, detail="已有执行在进行")
    skills_by_id, rotations_by_id = _export_context(conn)
    if req.kind == "playbook":
        pb = store.get_playbook(conn, req.id)
        if pb is None:
            raise HTTPException(status_code=404, detail="playbook not found")
        binds = {}
        if pb.get("keymap_id"):
            km = store.get_keymap(conn, pb["keymap_id"], pb["keymap_version"])
            binds = km["binds"] if km else {}
        text = emit_plan.render_playbook_plan(pb, rotations_by_id, skills_by_id, binds)
    else:
        rot = store.get_rotation(conn, req.id)
        if rot is None:
            raise HTTPException(status_code=404, detail="rotation not found")
        text = emit_plan.render_rotation_plan(rot, skills_by_id, {})
    plan_doc = json.loads(text)
    _exec_session = vd_executor.ExecutionSession(plan_doc, _exec_host, speed=req.speed)
    try:
        _exec_session.start()
    except vd_host.HostError as e:
        raise HTTPException(status_code=500, detail={"code": e.code, "hint": e.hint})
    return _exec_session.status()


class BackfeedReq(BaseModel):
    analysis_id: str


@app.post("/api/exec/backfeed")
def exec_backfeed(req: BackfeedReq, conn=Depends(get_conn)):
    if _exec_session is None or _exec_session.state not in ("stopped", "done"):
        raise HTTPException(status_code=409, detail="执行未结束，不能回灌")
    tree = store.get_analysis_tree(conn, req.analysis_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="analysis not found")
    l0 = next((l for l in tree["lanes"] if l["layer"] == 0), None)
    if l0 is None:
        raise HTTPException(status_code=404, detail="L0 泳道不存在")
    take = store.create_take(conn, l0["id"])
    marks = []
    log = list(_exec_session.log)
    used: set[int] = set()
    for i, ev in enumerate(log):
        if i in used:
            continue
        if ev["action"] == "down":
            end = None
            for j in range(i + 1, len(log)):
                if j not in used and log[j]["action"] == "up" \
                        and log[j]["key"] == ev["key"]:
                    end = log[j]["t_ms"]
                    used.add(j)
                    break
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], end_ms=end, kind="input",
                label=ev["key"], provenance="execution_log"))
        elif ev["action"] == "tap":
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], kind="input",
                label=ev["key"], provenance="execution_log"))
        elif ev["action"] == "wheel":
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], kind="input",
                label="Wheel", provenance="execution_log"))
        elif ev["action"] == "up":
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], kind="release",
                label=ev["key"], provenance="execution_log"))
    take["marks"] = marks
    return take


# ⚠ 路由注册顺序约束：/api/exec/backfeed（上）与 /api/exec/start 必须先于
# /api/exec/{cmd} 注册，否则会被 {cmd} 通配捕获并 400。
@app.post("/api/exec/{cmd}")
def exec_cmd(cmd: str):
    if cmd not in ("pause", "resume", "stop", "step"):
        raise HTTPException(status_code=400, detail="未知命令")
    if _exec_session is None:
        raise HTTPException(status_code=404, detail="没有执行会话")
    try:
        getattr(_exec_session, cmd)()
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except vd_host.HostError as e:
        raise HTTPException(status_code=500, detail={"code": e.code, "hint": e.hint})
    return _exec_session.status()


@app.get("/api/exec/status")
def exec_status():
    if _exec_session is None:
        return {"state": "idle"}
    return _exec_session.status()


@app.post("/api/capture/start")
def capture_start():
    from vd.config import data_root
    cap_dir = data_root() / "captures"
    cap_dir.mkdir(parents=True, exist_ok=True)
    out = cap_dir / f"cap-{int(time.time())}.mp4"
    try:
        _exec_host.start_capture(str(out))
    except vd_host.HostError as e:
        raise HTTPException(status_code=500, detail={"code": e.code, "hint": e.hint})
    return {"path": str(out)}


@app.post("/api/capture/stop")
def capture_stop(conn=Depends(get_conn)):
    try:
        path = _exec_host.stop_capture()
    except vd_host.HostError as e:
        raise HTTPException(status_code=500, detail={"code": e.code, "hint": e.hint})
    return ingest.process(conn, path)
```

（`import json`/`import time`、`config.data_root`、`ingest.process` 的实际签名按现有代码核对适配——`ingest.process` 在 M1 的真实名字与参数以 ingest.py 为准，测试断言只看返回 video dict 有 `id`。两处聚合调用点改为 `takes = _lane_takes_marks(conn, lane_id)`。注意 FastAPI 路由顺序：`/api/exec/status` 的 GET 与 `/api/exec/{cmd}` 的 POST 方法不同，无遮蔽问题。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && uv run pytest tests/test_api.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd backend && uv run pytest`
Expected: 155 passed

```bash
git add backend/src/vd/api.py backend/src/vd/store.py backend/tests/test_api.py
git commit -m "feat(backend): execution console, capture and log backfeed routes"
```

---

### 任务 8：前端类型与 client 扩展

**Files:**
- Modify: `frontend/src/api/types.ts`、`frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`（追加）

**Interfaces:**
- Produces（types.ts）：

```ts
export type ExecState = 'idle' | 'running' | 'paused' | 'stopped' | 'done';

export interface ExecStatus {
  state: ExecState;
  cursor?: number;
  total?: number;
  title?: string;
  error?: string | null;
  log?: { t_ms: number; action: string; key: string }[];
}
```

- Produces（client.ts，沿用 `j`/`post` 助手）：

```ts
  startExec: (kind: 'rotation' | 'playbook', id: string, speed = 1.0) =>
    post<ExecStatus>('/api/exec/start', { kind, id, speed }),
  execCmd: (cmd: 'pause' | 'resume' | 'stop' | 'step') =>
    post<ExecStatus>(`/api/exec/${cmd}`, {}),
  execStatus: () => j<ExecStatus>('/api/exec/status'),
  backfeedExec: (analysisId: string) =>
    post<Take>('/api/exec/backfeed', { analysis_id: analysisId }),
  captureStart: () => post<{ path: string }>('/api/capture/start', {}),
  captureStop: () => post<Video>('/api/capture/stop', {}),
```

- 导出 URL 助手的 fmt 类型拓宽为 `'md' | 'ahk' | 'plan' | 'razer'`（rotation 与 playbook 两个助手一致）
- 测试：仿照既有 client.test.ts 的 `vi.stubGlobal('fetch', ...)` 风格，为 `startExec`、`execCmd('stop')`、`backfeedExec` 各写一条断言（URL、method、body）

- [ ] **Step 1: 追加测试 → 确认失败（tsc 或断言）**

Run: `cd frontend && pnpm test`
Expected: 新增测试 FAIL（方法不存在 → 编译失败即视为失败）

- [ ] **Step 2: 实现类型与方法**

按 Interfaces 块逐字加入；`Take`/`Video` 类型已有。

- [ ] **Step 3: 验证**

Run: `cd frontend && pnpm build && pnpm test`
Expected: build 干净；37 tests PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): exec and capture api client"
```

---

### 任务 9：ExecPage 执行台与导航

**Files:**
- Create: `frontend/src/pages/ExecPage.tsx`
- Modify: `frontend/src/App.tsx`、`frontend/src/pages/PlaybooksPage.tsx`（方案/循环表行加"执行"按钮可选——仅当 brief 内代码包含时）
- Test: 复用 `pnpm build` + 既有测试保持绿

**Interfaces:**
- Consumes: 任务 8 的 client 方法；`PlaybooksPage` 同款列表数据源（`listRotations`/`listPlaybooks`/`listVideos`）
- Produces: `ExecPage({ onBack }: { onBack: () => void })`；App.tsx 资料库页新增「执行台」按钮（`page` 枚举加 `'exec'`，模式与 playbooks 完全相同）

组件完整代码：

```tsx
// frontend/src/pages/ExecPage.tsx
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Analysis, ExecStatus, Playbook, Rotation, Video } from '../api/types';

export function ExecPage({ onBack }: { onBack: () => void }) {
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [kind, setKind] = useState<'rotation' | 'playbook'>('playbook');
  const [targetId, setTargetId] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [st, setSt] = useState<ExecStatus>({ state: 'idle' });

  useEffect(() => {
    void api.listRotations().then(setRotations);
    void api.listPlaybooks().then(setPlaybooks);
    void api.listVideos().then(setVideos);
  }, []);

  useEffect(() => {
    if (st.state !== 'running') return;
    const id = window.setInterval(() => {
      void api.execStatus().then(setSt);
    }, 500);
    return () => window.clearInterval(id);
  }, [st.state]);

  const options = kind === 'rotation' ? rotations : playbooks;
  const running = st.state === 'running' || st.state === 'paused';
  const finished = st.state === 'stopped' || st.state === 'done';

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>执行台</h1>
      <p style={{ color: '#888' }}>
        仅执行不判断成败；F12 全局急停（Windows）。macOS 上仅 Mock/演练。
      </p>
      <p>
        <select value={kind}
                onChange={e => { setKind(e.target.value as 'rotation' | 'playbook'); setTargetId(''); }}>
          <option value="playbook">方案</option>
          <option value="rotation">循环</option>
        </select>{' '}
        <select value={targetId} onChange={e => setTargetId(e.target.value)}>
          <option value="">选择目标…</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>{' '}
        <button disabled={!targetId || running}
                onClick={() => void api.startExec(kind, targetId).then(setSt)}>
          开始
        </button>{' '}
        <button disabled={st.state !== 'running'}
                onClick={() => void api.execCmd('pause').then(setSt)}>暂停</button>{' '}
        <button disabled={st.state !== 'paused'}
                onClick={() => void api.execCmd('resume').then(setSt)}>继续</button>{' '}
        <button disabled={!(st.state === 'idle' || st.state === 'paused') || !targetId}
                onClick={() => void (st.state === 'idle'
                  ? api.startExec(kind, targetId).then(() => api.execCmd('pause')).then(setSt)
                  : api.execCmd('step').then(setSt))}>单步</button>{' '}
        <button disabled={!running}
                onClick={() => void api.execCmd('stop').then(setSt)}>停止</button>
      </p>
      <p>
        状态：{st.state}
        {st.total != null && <> · {st.cursor}/{st.total}</>}
        {st.error && <span style={{ color: '#c33' }}> · {st.error}</span>}
      </p>
      {st.log && st.log.length > 0 && (
        <pre style={{ maxHeight: 200, overflow: 'auto' }}>
          {st.log.map(l => `${String(l.t_ms).padStart(6)}ms  ${l.action} ${l.key}`).join('\n')}
        </pre>
      )}
      {finished && (
        <p>
          回灌为 Take：{' '}
          <select value={analysisId} onChange={e => setAnalysisId(e.target.value)}>
            <option value="">选择视频的分析…</option>
            {videos.map(v => (
              <option key={v.id} value={v.analysis_id ?? ''}>{v.filename}</option>
            ))}
          </select>{' '}
          <button disabled={!analysisId}
                  onClick={() => void api.backfeedExec(analysisId).then(() => setSt({ state: 'idle' }))}>
            回灌
          </button>
        </p>
      )}
    </div>
  );
}
```

（适配条款：`api.listVideos`/`Video.analysis_id` 等名字以 client.ts / types.ts 现状为准——若列表方法或字段名不同，用现有等价物做最小适配（例如 analysis 需另取时经现有 video 详情接口），行为与断言不变，报告中说明适配点。）

App.tsx 接线（模式与 playbooks 相同）：`page` 联合类型加 `'exec'`；资料库按钮区加 `<button onClick={() => setPage('exec')}>执行台</button>`；渲染链加 `if (page === 'exec') return <ExecPage onBack={() => setPage('library')} />;`（置于 playbooks 分支旁，`editingPlaybook` 分支之后）。

- [ ] **Step 1: 实现组件与接线**
- [ ] **Step 2: 验证**

Run: `cd frontend && pnpm build && pnpm test`
Expected: build 干净；37 PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/ExecPage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): execution console page"
```

---

### 任务 10：README 与 CONTEXT.md 收尾

**Files:**
- Modify: `README.md`（追加 M4 段，不改 M1-M3）、`CONTEXT.md`（若"执行台/回灌/注入计划"词条缺失则补）

README 追加内容：

```markdown
## M4 · 执行与采集

- **执行台**：选循环/方案 → 开始/暂停/单步/停止；仅执行不判断成败；Windows 上 F12 全局急停并释放按键（AHK v2 worker）。macOS 无注入（Mock 供开发）。
- **执行日志回灌**：执行结束后可回灌为目标分析 L0 泳道的新 Take（`provenance=execution_log`，不参与聚合中位数），与人工标注并排对比。
- **新导出后端**：`plan`（注入计划 JSON）与 `razer`（Synapse 宏 XML；格式未经官方验证，导入由用户在 Windows 验证）。
- **屏幕采集**：`/api/capture/start|stop`，停止后自动 CFR 入库（Windows ddagrab / macOS avfoundation）。
- **Windows 真机注入未在本机验证**（macOS 开发环境）；MockHost 覆盖全链路测试。
```

CONTEXT.md 词条（按既有格式）：执行台（Execution Console）、回灌（Backfeed：执行日志按 Take 格式写回 L0，provenance=execution_log）、注入计划（Plan：`vd-plan` JSON，events 为定时 down/up/tap/wheel 序列）。

- [ ] **Step 1: 追加文档**
- [ ] **Step 2: 全量验证**

Run: `cd backend && uv run pytest && cd ../frontend && pnpm build && pnpm test`
Expected: 155 + 37 全绿

- [ ] **Step 3: 提交**

```bash
git add README.md CONTEXT.md
git commit -m "docs: m4 execution and capture section"
```

---

## 计划外（明确不做）

- Interception 驱动注入（spec：AHK 不足时才升级）
- OBS WebSocket 采集（ddagrab 起步）
- Segment 级导出（M3 未落，M4 不补）
- 坐标/走位类操作（§13.5）
- Windows 真机验证（用户侧动作；验收标准中"Windows 上注入跑通"由用户在 Windows 机器上确认，本计划交付到 MockHost 全链路 + 真机所需的全部代码与文档）
