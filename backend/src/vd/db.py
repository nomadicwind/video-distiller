import sqlite3
from pathlib import Path

from vd.config import db_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('upload','bilibili')),
  source_url TEXT,
  original_path TEXT NOT NULL DEFAULT '',
  work_path TEXT,
  fps REAL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  sprite_interval_s INTEGER,
  sprite_count INTEGER,
  thumb_w INTEGER,
  thumb_h INTEGER,
  status TEXT NOT NULL DEFAULT 'ingesting'
    CHECK(status IN ('ingesting','transcoding','ready','failed')),
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses(
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  keymap_label TEXT NOT NULL,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(video_id, seq)
);
CREATE TABLE IF NOT EXISTS lanes(
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  layer TEXT NOT NULL CHECK(layer IN ('L0','L1','L2')),
  UNIQUE(analysis_id, layer)
);
CREATE TABLE IF NOT EXISTS takes(
  id TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL REFERENCES lanes(id),
  idx INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(lane_id, idx)
);
CREATE TABLE IF NOT EXISTS marks(
  id TEXT PRIMARY KEY,
  take_id TEXT NOT NULL REFERENCES takes(id),
  t_ms INTEGER NOT NULL,
  end_ms INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('input','release')),
  label TEXT,
  provenance TEXT NOT NULL DEFAULT 'human_manual',
  confidence REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_marks_take_t ON marks(take_id, t_ms);
CREATE TABLE IF NOT EXISTS tally_markers(
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  t_ms INTEGER NOT NULL
);
"""

SCHEMA_V2 = """
CREATE TABLE IF NOT EXISTS skills(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  class TEXT,
  cd_ms INTEGER,
  cast_ms INTEGER,
  anim_ms INTEGER,
  cancelable INTEGER NOT NULL DEFAULT 0,
  pattern TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS keymaps(
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  class TEXT,
  binds TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, version)
);
CREATE TABLE IF NOT EXISTS rotations(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  derived_from TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals(
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  kind TEXT NOT NULL CHECK(kind IN ('rotation')),
  payload TEXT NOT NULL,
  report TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL
);
"""


def _column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    return any(r["name"] == col for r in conn.execute(f"PRAGMA table_info({table})"))


def _migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version < 2:
        conn.executescript(SCHEMA_V2)
        if not _column_exists(conn, "analyses", "keymap_id"):
            conn.execute("ALTER TABLE analyses ADD COLUMN keymap_id TEXT")
        if not _column_exists(conn, "analyses", "keymap_version"):
            conn.execute("ALTER TABLE analyses ADD COLUMN keymap_version INTEGER")
        conn.execute("PRAGMA user_version = 2")
        conn.commit()


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn
