from vd.config import data_root, db_path


def test_data_root_respects_env_and_creates_subdirs(data_dir):
    root = data_root()
    assert root == data_dir
    for sub in ("originals", "work", "thumbs"):
        assert (root / sub).is_dir()


def test_db_path_inside_root(data_dir):
    assert db_path() == data_dir / "vd.sqlite3"
