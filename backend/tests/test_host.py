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
