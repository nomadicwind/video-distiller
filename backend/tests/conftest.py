import os
import subprocess

import pytest

# M13：vd.api 在 import 时依据 VD_WEB_DIST 决定是否挂载静态前端
# （见 vd.api._web_dist 的三态文档）。测试套件不该依赖“本机是否已经
# pnpm build 过前端”这种环境差异——这里在 conftest 模块加载时就强制
# 禁用一次，保证它先于本目录任何 test_*.py 模块被 collect/import（进
# 而可能间接 import vd.api，例如 test_serve_static.py 顶部
# `from vd import serve` 会连带 import vd.api）：只在 autouse fixture
# 里设置是不够的，fixture 要到测试运行阶段才生效，晚于 collect 阶段的
# 模块级 import。
os.environ["VD_WEB_DIST"] = ""


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """所有测试隔离数据目录，绝不碰 ~/VideoDistiller。"""
    d = tmp_path / "data"
    monkeypatch.setenv("VD_DATA_DIR", str(d))
    return d


@pytest.fixture(autouse=True)
def _pure_api_by_default(monkeypatch):
    """默认纯 API 模式（不挂载静态前端）。需要挂载的测试自行
    monkeypatch.setenv("VD_WEB_DIST", ...) 后 reload vd.api 模块选择性
    开启（见 test_serve_static.py 的 rebuild_api fixture）。"""
    monkeypatch.setenv("VD_WEB_DIST", "")


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
