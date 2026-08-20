"""HostAdapter：全系统唯一平台相关模块（spec §4.2/§4.3）。"""
import os
import shutil
import subprocess
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


_CAPTURE_COMMON = ["-y", "-pix_fmt", "yuv420p"]


class MacHost:
    """采集走 ffmpeg avfoundation；注入不实现（spec §4.3）。"""

    def __init__(self):
        self._proc: subprocess.Popen | None = None
        self._out: str | None = None

    @staticmethod
    def _capture_cmd(out_path: str) -> list[str]:
        return (["ffmpeg", "-f", "avfoundation", "-framerate", "60", "-i", "1:none",
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


def get_host():
    kind = os.environ.get("VD_HOST", "")
    if kind == "mock":
        return MockHost()
    if kind == "mac" or (not kind and sys.platform == "darwin"):
        return MacHost()
    if kind == "windows" or (not kind and sys.platform == "win32"):
        return WindowsHost()
    return MockHost()
