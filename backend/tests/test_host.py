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


def test_get_host_unknown_value_raises(monkeypatch):
    monkeypatch.setenv("VD_HOST", "bogus")
    with pytest.raises(host.HostError) as ei:
        host.get_host()
    assert ei.value.code == "device_unavailable"
    assert "bogus" in ei.value.hint
    assert "mock|mac|windows" in ei.value.hint


def test_host_error_carries_code_and_hint():
    e = host.HostError("permission_denied", "以管理员运行或授予屏幕录制权限")
    assert e.code == "permission_denied"
    assert "权限" in e.hint
    assert "permission_denied" in str(e)


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


def test_windows_event_line_translates_ir_key_names():
    """plan events 携带 IR 键名（LMB/RMB/Wheel）；worker 协议须收到 AHK 键名，
    否则 `Send "{LMB down}"` 会被 AHK 拒绝，杀死 worker（M4 review Fix 1）。
    翻译语义须与 emit/ahk.py 的 _ahk_key 完全一致：映射表命中优先；单字母
    字母键小写；其余原样透传。"""
    f = host.WindowsHost._event_line
    assert f({"action": "down", "key": "LMB"}) == "down LButton\n"
    assert f({"action": "up", "key": "RMB"}) == "up RButton\n"
    assert f({"action": "tap", "key": "Q"}) == "tap q\n"
    assert f({"action": "down", "key": "Shift"}) == "down Shift\n"
    # wheel action 本就忽略 key 字段（协议行固定为 "wheel\n"），仅确认不翻译报错
    assert f({"action": "wheel", "key": "Wheel"}) == "wheel\n"


def test_capture_commands():
    mac = host.MacHost._capture_cmd("/tmp/o.mp4")
    assert mac[0] == "ffmpeg" and "avfoundation" in mac and "/tmp/o.mp4" == mac[-1]
    # -framerate must come BEFORE -i for avfoundation demuxer (60fps requirement)
    assert mac.index("-framerate") < mac.index("-i"), "framerate must precede -i"

    win = host.WindowsHost._capture_cmd("/tmp/o.mp4")
    assert win[0] == "ffmpeg" and "ddagrab" in " ".join(win) and "/tmp/o.mp4" == win[-1]
    # Windows framerate is in the filter, not as a flag
    assert "-framerate" not in win, "Windows should not have -framerate flag"
    assert "ddagrab=framerate=60" in " ".join(win), "Windows must use ddagrab filter with framerate"


def test_stop_capture_without_start_raises():
    with pytest.raises(host.HostError) as ei:
        host.MacHost().stop_capture()
    assert ei.value.code == "device_unavailable"


class _FakePopenBrokenPipe:
    """假 Popen：stdin.write 抛 BrokenPipeError（ffmpeg 无权限时秒退的典型
    症状，M4 review Fix 2）。"""

    def __init__(self):
        self.stdin = self
        self.killed = False

    def write(self, _data):
        raise BrokenPipeError("stdin broken")

    def flush(self):
        pass

    def wait(self, timeout=None):
        pass


def test_mac_stop_capture_broken_pipe_raises_permission_denied_and_resets():
    h = host.MacHost()
    h._proc = _FakePopenBrokenPipe()
    h._out = "/tmp/o.mp4"
    with pytest.raises(host.HostError) as ei:
        h.stop_capture()
    assert ei.value.code == "permission_denied"
    assert "屏幕录制权限" in ei.value.hint
    assert h._proc is None
    assert h._out is None


def test_windows_stop_capture_broken_pipe_raises_device_unavailable_and_resets():
    h = host.WindowsHost()
    h._proc = _FakePopenBrokenPipe()
    h._out = "/tmp/o.mp4"
    with pytest.raises(host.HostError) as ei:
        h.stop_capture()
    assert ei.value.code == "device_unavailable"
    assert "ddagrab" in ei.value.hint
    assert h._proc is None
    assert h._out is None


def test_mac_stop_capture_retry_after_error():
    """出错重置后应能重新 start_capture（可重试，M4 review Fix 2）。不依赖
    机器上是否真的装了 ffmpeg：只要不是"已有采集在进行"这个因状态未重置而
    产生的拒绝，就说明 self._proc/self._out 已被正确清空。"""
    h = host.MacHost()
    h._proc = _FakePopenBrokenPipe()
    h._out = "/tmp/o.mp4"
    with pytest.raises(host.HostError):
        h.stop_capture()
    assert h._proc is None and h._out is None
    try:
        h.start_capture("/tmp/o2.mp4")
    except host.HostError as e:
        assert "已有采集" not in e.hint
    finally:
        if h._proc is not None:
            h._proc.kill()
            h._proc.wait()
