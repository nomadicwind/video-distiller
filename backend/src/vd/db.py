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


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn
