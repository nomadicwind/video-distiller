import pytest


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """所有测试隔离数据目录，绝不碰 ~/VideoDistiller。"""
    d = tmp_path / "data"
    monkeypatch.setenv("VD_DATA_DIR", str(d))
    return d
