import os
from pathlib import Path


def data_root() -> Path:
    root = Path(os.environ.get("VD_DATA_DIR", str(Path.home() / "VideoDistiller")))
    for sub in ("originals", "work", "thumbs"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def db_path() -> Path:
    return data_root() / "vd.sqlite3"
