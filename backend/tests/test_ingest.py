import shutil

import pytest

from vd import ingest


def test_pull_bilibili_invokes_ytdlp_and_returns_path(tmp_path, sample_video):
    seen: list[list[str]] = []

    def fake_runner(cmd):
        seen.append(cmd)
        shutil.copy(sample_video, tmp_path / "out.mp4")

    p = ingest.pull_bilibili("https://www.bilibili.com/video/BVxxxx",
                             tmp_path / "out.mp4", runner=fake_runner)
    assert p.exists()
    cmd = seen[0]
    assert "yt_dlp" in " ".join(cmd)
    assert cmd[-1] == "https://www.bilibili.com/video/BVxxxx"


def test_pull_bilibili_raises_when_no_output(tmp_path):
    with pytest.raises(RuntimeError):
        ingest.pull_bilibili("https://b23.tv/x", tmp_path / "out.mp4",
                             runner=lambda cmd: None)
