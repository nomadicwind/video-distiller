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


@pytest.fixture
def client(data_dir):
    from fastapi.testclient import TestClient

    from vd.api import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def analysis(client, sample_video):
    with sample_video.open("rb") as f:
        vid = client.post("/api/videos/upload",
                          files={"file": ("s.mp4", f, "video/mp4")}).json()["id"]
    return client.post("/api/analyses", json={"video_id": vid}).json()
