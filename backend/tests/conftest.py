import subprocess

import pytest


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """所有测试隔离数据目录，绝不碰 ~/VideoDistiller。"""
    d = tmp_path / "data"
    monkeypatch.setenv("VD_DATA_DIR", str(d))
    return d


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory):
    """15fps、2 秒的合成测试视频（转码目标应为 30fps）。"""
    p = tmp_path_factory.mktemp("vid") / "sample.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         "testsrc=duration=2:size=320x240:rate=15",
         "-pix_fmt", "yuv420p", str(p)],
        check=True, capture_output=True,
    )
    return p
