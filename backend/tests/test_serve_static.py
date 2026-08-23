"""M13 任务 1：静态前端托管 + 冻结态 yt-dlp 路径 + serve 入口。

api.py 的 FastAPI app 在模块导入时构建，_web_dist() 的解析结果也在导入时
就决定了是否挂载静态目录 —— 要在同一个进程里覆盖 VD_WEB_DIST 后验证不同
结果，必须用 importlib.reload 重建 vd.api 模块，而不是只 monkeypatch 环境
变量（环境变量本身不会让已经 import 过的模块重新跑一遍顶层代码）。

conftest.py 的 autouse fixture 已经把整套测试默认状态钉死在
VD_WEB_DIST=""（纯 API，三态里的“显式禁用”），所以本文件里每个改写了这个
环境变量去验证挂载行为的测试，都要在结束时把模块重建回同一个纯 API 状态
——不能依赖 monkeypatch 在测试结束时自动 unset 环境变量：那只会让 os.environ
恢复，vd.api 模块里已经 mount 好的 app 对象并不会跟着自动重建，会残留给同
一进程里后面才跑的测试（尤其是经由 conftest.client 拿到 `from vd.api import
app` 的那些）。
"""
import importlib
import subprocess
import sys
import types

import pytest
from fastapi.testclient import TestClient

from vd import ingest, serve


def _rebuild_api(monkeypatch, web_dist):
    """web_dist 三态：None=删除环境变量（走“未设置”分支的自动解析）；""
    （空字符串）=显式禁用，不做任何回退；其余按字符串路径设为 VD_WEB_DIST。"""
    if web_dist is None:
        monkeypatch.delenv("VD_WEB_DIST", raising=False)
    else:
        monkeypatch.setenv("VD_WEB_DIST", str(web_dist))
    from vd import api

    importlib.reload(api)
    return api


@pytest.fixture
def rebuild_api(monkeypatch):
    built: list = []

    def _build(web_dist):
        api = _rebuild_api(monkeypatch, web_dist)
        built.append(api)
        return api

    yield _build
    # 无论测试是否手动恢复过，兜底把模块状态重建回纯 API 模式 —— 用官方的
    # “空字符串禁用”三态分支，不依赖本机 frontend/dist 是否存在。
    _rebuild_api(monkeypatch, "")


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


def test_empty_web_dist_disables_static_serving_without_fallback(data_dir, rebuild_api):
    """VD_WEB_DIST="" 是显式禁用：即便冻结态/开发路径回退本来能找到一份
    index.html，也必须直接返回 None，不做任何回退尝试。"""
    api = rebuild_api("")
    assert api._web_dist() is None
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

    created = []

    class FakeTimer:
        def __init__(self, interval, fn, args=()):
            self.interval = interval
            self.fn = fn
            self.args = args
            self.daemon = False
            self.started = False
            created.append(self)

        def start(self):
            self.started = True

    monkeypatch.setattr(serve.threading, "Timer", FakeTimer)

    serve.main([])

    assert calls == {"app": serve.app, "host": "127.0.0.1", "port": 8000}
    assert len(created) == 1
    timer = created[0]
    assert timer.interval == 1.5
    assert timer.fn is serve.webbrowser.open
    assert timer.args == ("http://127.0.0.1:8000",)
    # daemon=True 是本轮修复的要点：非 daemon 线程会让进程退出多等最多 1.5s。
    assert timer.daemon is True
    assert timer.started is True


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
