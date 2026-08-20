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


def get_host():
    kind = os.environ.get("VD_HOST", "")
    if kind == "mock":
        return MockHost()
    if kind == "mac" or (not kind and sys.platform == "darwin"):
        return MacHost()
    if kind == "windows" or (not kind and sys.platform == "win32"):
        return WindowsHost()
    return MockHost()
