import shutil
import sys
import types

import pytest

from vd import ingest

ENV_BROWSER = "VD_YTDLP_COOKIES_BROWSER"
ENV_COOKIES = "VD_YTDLP_COOKIES"


def _clear_cookie_env(monkeypatch):
    monkeypatch.delenv(ENV_BROWSER, raising=False)
    monkeypatch.delenv(ENV_COOKIES, raising=False)


# ---- _ytdlp_quality_args()（子进程路径：argv 片段） ----

def test_quality_args_no_env_only_sort(monkeypatch):
    _clear_cookie_env(monkeypatch)
    assert ingest._ytdlp_quality_args() == ["-S", "res,fps,tbr"]


def test_quality_args_browser_set(monkeypatch):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_BROWSER, "chrome")
    assert ingest._ytdlp_quality_args() == [
        "-S", "res,fps,tbr", "--cookies-from-browser", "chrome",
    ]


def test_quality_args_cookies_file_set(monkeypatch):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    assert ingest._ytdlp_quality_args() == [
        "-S", "res,fps,tbr", "--cookies", "/tmp/c.txt",
    ]


def test_quality_args_browser_wins_over_file(monkeypatch):
    monkeypatch.setenv(ENV_BROWSER, "chrome")
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    args = ingest._ytdlp_quality_args()
    assert args == ["-S", "res,fps,tbr", "--cookies-from-browser", "chrome"]
    assert "--cookies" not in args
    assert "/tmp/c.txt" not in args


# ---- _ytdlp_quality_opts()（冻结路径：yt_dlp opts dict） ----

def test_quality_opts_no_env_only_sort(monkeypatch):
    _clear_cookie_env(monkeypatch)
    assert ingest._ytdlp_quality_opts() == {"format_sort": ["res", "fps", "tbr"]}


def test_quality_opts_browser_set(monkeypatch):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_BROWSER, "chrome")
    assert ingest._ytdlp_quality_opts() == {
        "format_sort": ["res", "fps", "tbr"],
        "cookiesfrombrowser": ("chrome",),
    }


def test_quality_opts_browser_with_profile(monkeypatch):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_BROWSER, "chrome:Default")
    opts = ingest._ytdlp_quality_opts()
    assert opts["cookiesfrombrowser"] == ("chrome", "Default")


def test_quality_opts_cookies_file_set(monkeypatch):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    assert ingest._ytdlp_quality_opts() == {
        "format_sort": ["res", "fps", "tbr"],
        "cookiefile": "/tmp/c.txt",
    }


def test_quality_opts_browser_wins_over_file(monkeypatch):
    monkeypatch.setenv(ENV_BROWSER, "chrome")
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    opts = ingest._ytdlp_quality_opts()
    assert "cookiefile" not in opts
    assert opts["cookiesfrombrowser"] == ("chrome",)
    assert "/tmp/c.txt" not in str(opts)


# ---- pull_bilibili：子进程路径（runner 注入，断言 argv） ----

def test_pull_bilibili_subprocess_argv_has_quality_args_no_env(
    monkeypatch, tmp_path, sample_video,
):
    _clear_cookie_env(monkeypatch)
    seen: list[list[str]] = []

    def fake_runner(cmd):
        seen.append(cmd)
        shutil.copy(sample_video, tmp_path / "out.mp4")

    ingest.pull_bilibili(
        "https://www.bilibili.com/video/BVxxxx", tmp_path / "out.mp4",
        runner=fake_runner,
    )
    cmd = seen[0]
    assert cmd[-1] == "https://www.bilibili.com/video/BVxxxx"
    assert "-f" in cmd and "bv*+ba/b" in cmd
    assert "--merge-output-format" in cmd and "mp4" in cmd
    assert "-S" in cmd and "res,fps,tbr" in cmd
    assert "--cookies-from-browser" not in cmd
    assert "--cookies" not in cmd


def test_pull_bilibili_subprocess_argv_has_browser_cookie_args(
    monkeypatch, tmp_path, sample_video,
):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_BROWSER, "edge")
    seen: list[list[str]] = []

    def fake_runner(cmd):
        seen.append(cmd)
        shutil.copy(sample_video, tmp_path / "out.mp4")

    ingest.pull_bilibili(
        "https://www.bilibili.com/video/BVxxxx", tmp_path / "out.mp4",
        runner=fake_runner,
    )
    cmd = seen[0]
    assert cmd[-1] == "https://www.bilibili.com/video/BVxxxx"
    i = cmd.index("--cookies-from-browser")
    assert cmd[i + 1] == "edge"


def test_pull_bilibili_subprocess_argv_has_file_cookie_args(
    monkeypatch, tmp_path, sample_video,
):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    seen: list[list[str]] = []

    def fake_runner(cmd):
        seen.append(cmd)
        shutil.copy(sample_video, tmp_path / "out.mp4")

    ingest.pull_bilibili(
        "https://www.bilibili.com/video/BVxxxx", tmp_path / "out.mp4",
        runner=fake_runner,
    )
    cmd = seen[0]
    i = cmd.index("--cookies")
    assert cmd[i + 1] == "/tmp/c.txt"


# ---- pull_bilibili：冻结路径（假 YoutubeDL，断言 opts） ----

def _install_fake_yt_dlp(monkeypatch, captured):
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


def test_pull_bilibili_frozen_opts_no_env_only_sort(monkeypatch, tmp_path):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    captured: dict = {}
    _install_fake_yt_dlp(monkeypatch, captured)

    dest = tmp_path / "out.mp4"
    dest.touch()
    ingest.pull_bilibili("https://www.bilibili.com/video/BVxxxx", dest)

    assert captured["opts"]["format_sort"] == ["res", "fps", "tbr"]
    assert "cookiesfrombrowser" not in captured["opts"]
    assert "cookiefile" not in captured["opts"]


def test_pull_bilibili_frozen_opts_browser_cookie(monkeypatch, tmp_path):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_BROWSER, "chrome")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    captured: dict = {}
    _install_fake_yt_dlp(monkeypatch, captured)

    dest = tmp_path / "out.mp4"
    dest.touch()
    ingest.pull_bilibili("https://www.bilibili.com/video/BVxxxx", dest)

    assert captured["opts"]["cookiesfrombrowser"] == ("chrome",)
    assert "cookiefile" not in captured["opts"]


def test_pull_bilibili_frozen_opts_file_cookie(monkeypatch, tmp_path):
    _clear_cookie_env(monkeypatch)
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    captured: dict = {}
    _install_fake_yt_dlp(monkeypatch, captured)

    dest = tmp_path / "out.mp4"
    dest.touch()
    ingest.pull_bilibili("https://www.bilibili.com/video/BVxxxx", dest)

    assert captured["opts"]["cookiefile"] == "/tmp/c.txt"
    assert "cookiesfrombrowser" not in captured["opts"]


def test_pull_bilibili_frozen_opts_browser_wins_over_file(monkeypatch, tmp_path):
    monkeypatch.setenv(ENV_BROWSER, "chrome")
    monkeypatch.setenv(ENV_COOKIES, "/tmp/c.txt")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    captured: dict = {}
    _install_fake_yt_dlp(monkeypatch, captured)

    dest = tmp_path / "out.mp4"
    dest.touch()
    ingest.pull_bilibili("https://www.bilibili.com/video/BVxxxx", dest)

    assert captured["opts"]["cookiesfrombrowser"] == ("chrome",)
    assert "cookiefile" not in captured["opts"]


# ---- cookie 红线：argv/opts 中不含 cookie 值本体，只含路径/浏览器名 ----

def test_no_cookie_value_content_leaks_anywhere(monkeypatch, tmp_path, sample_video):
    """env 只能是路径或浏览器名；代码从不读取 cookie 文件内容，argv/opts 里
    除了这个路径/名字字符串本身，不应出现任何别的 cookie 相关数据。"""
    fake_cookie_file = tmp_path / "cookies.txt"
    fake_cookie_file.write_text("# Netscape HTTP Cookie File\nSESSDATA\tSECRETVALUE123\n")
    monkeypatch.setenv(ENV_COOKIES, str(fake_cookie_file))
    monkeypatch.delenv(ENV_BROWSER, raising=False)

    seen: list[list[str]] = []

    def fake_runner(cmd):
        seen.append(cmd)
        shutil.copy(sample_video, tmp_path / "out.mp4")

    ingest.pull_bilibili(
        "https://www.bilibili.com/video/BVxxxx", tmp_path / "out.mp4",
        runner=fake_runner,
    )
    cmd_str = " ".join(seen[0])
    assert "SECRETVALUE123" not in cmd_str
    assert "SESSDATA" not in cmd_str
    assert str(fake_cookie_file) in cmd_str
