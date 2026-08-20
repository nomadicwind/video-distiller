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
