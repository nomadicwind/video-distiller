import threading
import time

from vd import executor as executor_mod
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


def test_pause_then_rapid_resume_no_double_dispatch(monkeypatch):
    """回归测试（确定性复现，不依赖真实调度时序的运气）。

    pause() 后紧接 resume() 时，旧的执行线程可能仍卡在 time.sleep 里等待派发
    下一个事件；resume() 会把 state 重新置回 "running"。若判断逻辑只看
    state，旧线程醒来后会误以为自己仍是合法执行者，从而与 resume() 起的新线
    程一起竞争同一个 self.cursor，导致同一事件被重复注入。

    这里给 vd.executor.time.sleep 打桩：第一次调用（必然来自旧线程为了派发
    events[1] 而进入的 sleep）被挂起，直到测试主线程明确放行；之后的调用都
    转发给真实的 time.sleep。这样就能确定性地把"旧线程卡在 sleep 里、随后
    state 被 resume 拨回 running"这个窗口摆在我们想要的位置，而不用赌真实
    定时器的先后顺序。
    """
    real_sleep = time.sleep
    first_sleep_seen = threading.Event()
    release_old_thread = threading.Event()
    first_call_lock = threading.Lock()
    first_call_done = {"v": False}

    def fake_sleep(seconds):
        with first_call_lock:
            is_first = not first_call_done["v"]
            first_call_done["v"] = True
        if is_first:
            first_sleep_seen.set()
            release_old_thread.wait(timeout=5.0)
            return
        real_sleep(seconds)

    monkeypatch.setattr(executor_mod.time, "sleep", fake_sleep)

    h = MockHost()
    plan = dict(PLAN)
    plan["events"] = [{"t_ms": i * 10, "action": "tap", "key": "q"} for i in range(5)]
    s = ExecutionSession(plan, h)

    s.start()
    assert first_sleep_seen.wait(timeout=5.0), "旧线程应已捕获 events[1] 并阻塞在 sleep 中"
    assert len(h.injected) == 1        # events[0] 的 t_ms=0，delay=0，无需 sleep，已派发

    s.pause()
    assert _wait(s, "paused")
    s.resume()                         # state 被重新置回 running，起一条新线程
    release_old_thread.set()           # 立刻放开旧线程：state 仍是 running，修复前它会误判自己合法

    assert _wait(s, "done", timeout=5.0)
    real_sleep(0.1)                    # debounce：给任何迟到的（错误）派发留出落地时间

    # 注意：只检查 len(h.injected) 或 cursor 不足以暴露这个 bug——旧线程的越权
    # 派发会把 cursor 多推进一次，导致新线程提前把最后一个事件判定为"超出范围"
    # 而跳过；总条数和最终 cursor 都可能"凑巧"仍然是 5，但实际序列是"某个
    # 事件被重复注入 + 另一个事件被漏派发"。必须按内容逐一比对实际派发序列。
    expected_t_ms = [ev["t_ms"] for ev in plan["events"]]
    actual_t_ms = [e["t_ms"] for e in h.injected]
    assert actual_t_ms == expected_t_ms, (
        f"每个事件应恰好按顺序派发一次，期望 t_ms 序列 {expected_t_ms}，"
        f"实际注入 {actual_t_ms}"
    )
    assert s.cursor == 5
