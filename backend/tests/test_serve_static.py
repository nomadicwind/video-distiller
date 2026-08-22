"""M13 任务 1：静态前端托管 + 冻结态 yt-dlp 路径 + serve 入口。

api.py 的 FastAPI app 在模块导入时构建，_web_dist() 的解析结果也在导入时
就决定了是否挂载静态目录 —— 要在同一个进程里覆盖 VD_WEB_DIST 后验证不同
结果，必须用 importlib.reload 重建 vd.api 模块，而不是只 monkeypatch 环境
变量（环境变量本身不会让已经 import 过的模块重新跑一遍顶层代码）。

每个改写了 vd.api 全局状态的测试都在结束时把模块重建回“纯 API 模式”
（VD_WEB_DIST 指向一个必定不存在 index.html 的临时目录），避免残留的静态
挂载影响同一进程里其后运行、经由 conftest.client 拿到 `from vd.api import
app` 的其它测试——尤其是本地开发机上 frontend/dist 可能确实存在的情况，
不能让那份本地状态泄漏进测试结果。
"""
import importlib
import subprocess
import sys
import types

import pytest
from fastapi.testclient import TestClient

from vd import ingest, serve


def _rebuild_api(monkeypatch, web_dist):
    if web_dist is None:
        monkeypatch.delenv("VD_WEB_DIST", raising=False)
    else:
        monkeypatch.setenv("VD_WEB_DIST", str(web_dist))
    from vd import api

    importlib.reload(api)
    return api


@pytest.fixture
def rebuild_api(monkeypatch, tmp_path):
    built: list = []

    def _build(web_dist):
        api = _rebuild_api(monkeypatch, web_dist)
        built.append(api)
        return api

    yield _build
    # 无论测试是否手动恢复过，兜底把模块状态重建回纯 API 模式，指向一个
    # 保证不存在的目录 —— 显式 env 优先级最高，不会被本机 frontend/dist
    # 是否存在影响。
    _rebuild_api(monkeypatch, tmp_path / "___no_such_dist___")


def test_static_dist_served_when_present(data_dir, rebuild_api, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>vd-web-index</html>", encoding="utf-8")

    api = rebuild_api(dist)
    with TestClient(api.app) as c:
        r = c.get("/")
        assert r.status_code == 200
        assert "vd-web-index" in r.text

        assert c.get("/api/videos").status_code == 200


def test_no_dist_is_pure_api_mode(data_dir, rebuild_api, tmp_path):
    api = rebuild_api(tmp_path / "___missing_dist___")
    with TestClient(api.app) as c:
        assert c.get("/").status_code == 404
        assert c.get("/api/videos").status_code == 200


def test_serve_main_defaults_port_and_schedules_browser(monkeypatch):
    calls = {}

    def fake_run(app_obj, host, port):
        calls["app"] = app_obj
        calls["host"] = host
        calls["port"] = port

    monkeypatch.setattr(serve.uvicorn, "run", fake_run)

    timers = []

    class FakeTimer:
        def __init__(self, interval, fn, args=()):
            timers.append((interval, fn, args))

        def start(self):
            pass

    monkeypatch.setattr(serve.threading, "Timer", FakeTimer)

    serve.main([])

    assert calls == {"app": serve.app, "host": "127.0.0.1", "port": 8000}
    assert len(timers) == 1
    interval, fn, args = timers[0]
    assert interval == 1.5
    assert fn is serve.webbrowser.open
    assert args == ("http://127.0.0.1:8000",)


def test_serve_main_custom_port_and_no_browser_skips_timer(monkeypatch):
    calls = {}

    def fake_run(app_obj, host, port):
        calls["port"] = port

    monkeypatch.setattr(serve.uvicorn, "run", fake_run)

    timer_calls = []

    class FakeTimer:
        def __init__(self, *a, **k):
            timer_calls.append((a, k))

        def start(self):
            pass

    monkeypatch.setattr(serve.threading, "Timer", FakeTimer)

    serve.main(["--port", "9100", "--no-browser"])

    assert calls == {"port": 9100}
    assert timer_calls == []


def test_run_ytdlp_frozen_uses_python_api(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    captured = {}

    class FakeYoutubeDL:
        def __init__(self, opts):
            captured["opts"] = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def download(self, urls):
            captured["urls"] = urls

    fake_yt_dlp = types.SimpleNamespace(YoutubeDL=FakeYoutubeDL)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_yt_dlp)

    dest = tmp_path / "out.mp4"
    argv = [
        sys.executable, "-m", "yt_dlp",
        "-f", "bv*+ba/b", "--merge-output-format", "mp4",
        "-o", str(dest), "https://www.bilibili.com/video/BVxxxx",
    ]
    ingest._run_ytdlp(argv)

    assert captured["opts"] == {
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(dest),
    }
    assert captured["urls"] == ["https://www.bilibili.com/video/BVxxxx"]


def test_run_ytdlp_frozen_wraps_errors(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    class BoomYoutubeDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def download(self, urls):
            raise RuntimeError("network unreachable")

    fake_yt_dlp = types.SimpleNamespace(YoutubeDL=BoomYoutubeDL)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_yt_dlp)

    with pytest.raises(RuntimeError, match="yt-dlp 失败"):
        ingest._run_ytdlp([sys.executable, "-m", "yt_dlp", "-o", str(tmp_path / "o.mp4"), "https://x"])


def test_run_ytdlp_non_frozen_uses_subprocess_runner(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)

    seen = {}

    def fake_run(cmd, check, capture_output, text):
        seen["cmd"] = cmd

    monkeypatch.setattr(subprocess, "run", fake_run)

    argv = [sys.executable, "-m", "yt_dlp", "-f", "bv*+ba/b", "https://x"]
    ingest._run_ytdlp(argv)

    assert seen["cmd"] == argv
