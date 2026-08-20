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
