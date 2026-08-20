"""注入执行器（spec §9.3）：只执行不判断成败；停止必须释放按住的键。

状态机：idle -> running -> {paused, stopped, done}；paused -> running（resume）
或 -> stopped。running/paused 之间的转换靠单一 state 字段 + 锁实现：pause()
只做状态翻转，后台线程在下一次派发前必然会检查到并自行退出；resume() 复用
start() 起一条新线程，从当前 cursor 继续，事件间隔按“相邻两事件的 t_ms 差”
重新计算，因此暂停时长不影响恢复后的节奏。
"""
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
        self._thread: threading.Thread | None = None
        self._t0: float | None = None

    def _rel_ms(self) -> int:
        if self._t0 is None:
            return 0
        return round((time.monotonic() - self._t0) * 1000)

    def _dispatch(self, ev: dict) -> None:
        """派发单个事件；调用方必须持有 self._lock。成败不判断，仅转发。"""
        self.host.inject_input(ev)
        if ev["action"] == "down":
            self._held.add(ev["key"])
        elif ev["action"] == "up":
            self._held.discard(ev["key"])
        self.log.append({"t_ms": self._rel_ms(), "action": ev["action"], "key": ev["key"]})

    def _run(self) -> None:
        events = self.plan["events"]
        prev_t = events[self.cursor - 1]["t_ms"] if self.cursor else 0
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
            with self._lock:
                if self.state != "running":
                    return
                try:
                    self._dispatch(ev)
                except HostError as e:
                    self.error = str(e)
                    self.state = "stopped"
                    return
                self.cursor += 1
            prev_t = ev["t_ms"]

    def start(self) -> None:
        with self._lock:
            if self.state == "running":
                return
            if self.state in ("stopped", "done"):
                raise ValueError("会话已结束，请新建执行")
            if self._t0 is None:
                self._t0 = time.monotonic()
            self.state = "running"
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def pause(self) -> None:
        with self._lock:
            if self.state == "running":
                self.state = "paused"

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
            except HostError as e:
                self.error = str(e)
                self.state = "stopped"
                return
            self.cursor += 1
            self.state = "done" if self.cursor >= len(events) else "paused"

    def stop(self) -> None:
        with self._lock:
            self.state = "stopped"
            for key in sorted(self._held):
                try:
                    self.host.inject_input({"action": "up", "key": key})
                except HostError:
                    continue
                self.log.append({"t_ms": self._rel_ms(), "action": "up", "key": key})
            self._held.clear()
        try:
            self.host.release_all()
        except HostError:
            pass

    def status(self) -> dict:
        with self._lock:
            return {
                "state": self.state,
                "cursor": self.cursor,
                "total": len(self.plan["events"]),
                "title": self.plan.get("title", ""),
                "error": self.error,
                "log": list(self.log[-50:]),
            }
