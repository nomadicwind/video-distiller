# M1 标注可用（最小闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 跑通标注最小闭环——上传/拉取视频 → CFR 规范化 → 播放器逐帧标注 L0/L1（多 Take）→ 聚合查看 → 打表计时，关闭重开数据仍在。

**Architecture:** Python 3.11 + FastAPI 后端（sqlite3 + 文件系统，ffmpeg 子进程做转码/缩略图），React 19 + TypeScript + Vite 前端（`<video>` + requestVideoFrameCallback 帧级播放，Canvas 泳道时间轴，Zustand 会话状态）。前后端经 Vite 代理 `/api` 通信。

**Tech Stack:** uv · FastAPI · sqlite3（标准库） · ffmpeg/ffprobe（CLI） · yt-dlp · pnpm · Vite 6 · React 19 · Zustand 5 · Vitest 3

**Spec:** `docs/superpowers/specs/2026-08-20-video-distiller-design.md`（术语基准：`CONTEXT.md`）

## Global Constraints

- Python `>=3.11`，依赖由 uv 管理；后端代码在 `backend/`，`uv run` 一律带 `--project backend` 或在 `backend/` 目录执行
- 前端 `frontend/`，pnpm + TypeScript `strict: true`；UI 语言**中文**
- `ffmpeg` 与 `ffprobe` 必须在 PATH（macOS：`brew install ffmpeg`）
- 数据根目录：`~/VideoDistiller`，环境变量 `VD_DATA_DIR` 覆盖（**测试必须覆盖**，见 conftest）；子目录 `originals/`（原始文件）`work/`（CFR 工作副本）`thumbs/`（sprite）
- 入库素材统一转码 CFR：源 fps ≥ 45 → 60fps，否则 30fps（spec §4.4）
- URL 拉取仅 B 站（yt-dlp）；抖音等一律手动下载后上传（spec §4.4）
- M1 无 Skill Catalog/Keymap 实体：L1 标记的 `label` 是自由文本技能名；Analysis 的 keymap 固定占位 `km-default-v1`（M2 接入真实 Keymap）
- Mark 写入校验（spec §10 编辑期宽松的 M1 子集）：`t_ms >= 0`；`end_ms > t_ms`；`input` 必须有 label，`release`（空标记）必须无 label。其余一致性问题不阻塞写入
- 端口：后端 8000，前端 5173（Vite 代理 `/api` → `http://localhost:8000`）
- 提交信息用 conventional commits，并以 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 结尾

## 文件结构总览

```
backend/
├── pyproject.toml
├── src/vd/
│   ├── __init__.py
│   ├── config.py        # 数据根目录解析
│   ├── db.py            # sqlite 连接 + schema
│   ├── store.py         # 全部 CRUD（dict in/out）
│   ├── media.py         # ffprobe/ffmpeg 封装：探针、CFR 转码、sprite
│   ├── ingest.py        # 摄取管线后台任务 + B 站拉取
│   ├── aggregate.py     # 多 Take 聚合算法
│   └── api.py           # FastAPI 路由（唯一知道 HTTP 的地方）
└── tests/
    ├── conftest.py
    ├── test_config.py / test_db.py / test_store.py
    ├── test_media.py / test_ingest.py / test_aggregate.py
    └── test_api.py

frontend/
├── package.json · vite.config.ts · tsconfig.json · index.html
└── src/
    ├── main.tsx · App.tsx · styles.css
    ├── api/types.ts · api/client.ts
    ├── time/frames.ts               # 帧↔时间数学（纯函数，测试）
    ├── timeline/layout.ts           # 时间↔像素、区间、命中、缩放平移（纯函数，测试）
    ├── timeline/draw.ts             # Canvas 绘制（吃 layout 的结果）
    ├── timeline/Timeline.tsx        # 泳道时间轴组件（渲染 + 交互）
    ├── state/store.ts               # Zustand 会话状态（纯 reducer，测试）
    ├── actions.ts                   # API 调用 + store 更新的组合动作（测试）
    ├── hotkeys.ts                   # 全局快捷键
    ├── player/Player.tsx            # 播放器
    ├── strip/ThumbStrip.tsx         # 缩略图带
    ├── panel/EntryPanel.tsx         # 录入面板
    └── tally/TallyBar.tsx           # 打表计时条
```

---

# 部分 A：后端（任务 1–11，独立可交付）

### 任务 1：后端脚手架与配置

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/src/vd/__init__.py`（空文件）
- Create: `backend/src/vd/config.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_config.py`
- Create: `.gitignore`（仓库根）

**Interfaces:**
- Produces: `config.data_root() -> Path`（确保 originals/work/thumbs 子目录存在）、`config.db_path() -> Path`

- [ ] **Step 1: 写 pyproject 与空包**

`backend/pyproject.toml`:

```toml
[project]
name = "vd"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "python-multipart>=0.0.9",
    "yt-dlp>=2025.1.15",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/vd"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`.gitignore`（仓库根）:

```
__pycache__/
.venv/
node_modules/
dist/
*.sqlite3
```

- [ ] **Step 2: 写失败测试**

`backend/tests/conftest.py`:

```python
import pytest


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """所有测试隔离数据目录，绝不碰 ~/VideoDistiller。"""
    d = tmp_path / "data"
    monkeypatch.setenv("VD_DATA_DIR", str(d))
    return d
```

`backend/tests/test_config.py`:

```python
from vd.config import data_root, db_path


def test_data_root_respects_env_and_creates_subdirs(data_dir):
    root = data_root()
    assert root == data_dir
    for sub in ("originals", "work", "thumbs"):
        assert (root / sub).is_dir()


def test_db_path_inside_root(data_dir):
    assert db_path() == data_dir / "vd.sqlite3"
```

- [ ] **Step 3: 运行确认失败**

```bash
cd backend && uv sync && uv run pytest -x
```

预期：FAIL（`ModuleNotFoundError` 或 `ImportError: config`）

- [ ] **Step 4: 实现 config.py**

`backend/src/vd/config.py`:

```python
import os
from pathlib import Path


def data_root() -> Path:
    root = Path(os.environ.get("VD_DATA_DIR", str(Path.home() / "VideoDistiller")))
    for sub in ("originals", "work", "thumbs"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root


def db_path() -> Path:
    return data_root() / "vd.sqlite3"
```

- [ ] **Step 5: 运行确认通过**

```bash
cd backend && uv run pytest -x
```

预期：2 passed

- [ ] **Step 6: 提交**

```bash
git add backend .gitignore
git commit -m "feat(backend): scaffold uv project with config module"
```

---

### 任务 2：数据库 schema 与连接

**Files:**
- Create: `backend/src/vd/db.py`
- Create: `backend/tests/test_db.py`

**Interfaces:**
- Produces: `db.connect(path: Path | None = None) -> sqlite3.Connection`（row_factory=Row，外键开启，幂等建表）
- 表：`videos`（含 sprite 元数据列）、`analyses`、`lanes`、`takes`、`marks`、`tally_markers`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_db.py`:

```python
import sqlite3

import pytest

from vd import db


def test_schema_tables_exist():
    conn = db.connect()
    names = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"videos", "analyses", "lanes", "takes", "marks", "tally_markers"} <= names


def test_foreign_keys_enforced():
    conn = db.connect()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO lanes(id,analysis_id,layer) VALUES('x','nope','L0')")


def test_connect_is_idempotent():
    db.connect().close()
    db.connect().close()  # 第二次连接不因重复建表报错
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_db.py -x
```

预期：FAIL（no module `vd.db`）

- [ ] **Step 3: 实现 db.py**

`backend/src/vd/db.py`:

```python
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
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest tests/test_db.py -x
```

预期：3 passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/db.py backend/tests/test_db.py
git commit -m "feat(backend): sqlite schema for videos/analyses/lanes/takes/marks/tally"
```

---

### 任务 3：store CRUD 与 Analysis 树

**Files:**
- Create: `backend/src/vd/store.py`
- Create: `backend/tests/test_store.py`

**Interfaces:**
- Consumes: `db.connect()`
- Produces（全部以 `dict` 出入，第一个参数是 conn）：
  - `create_video(conn, *, name, source_kind, source_url=None, original_path="") -> dict`
  - `get_video(conn, video_id) -> dict | None` · `list_videos(conn) -> list[dict]`
  - `update_video(conn, video_id, **fields) -> dict`（通用字段更新，供 ingest 用）
  - `create_analysis(conn, video_id, keymap_label="km-default-v1") -> dict`（自动建 L0/L1/L2 三条 lane，各带 Take #1；命名 `video-{video.seq}_{keymap_label}_a{seq}`）
  - `get_analysis_tree(conn, analysis_id) -> dict | None`（嵌套 lanes→takes→marks + tally）
  - `create_take(conn, lane_id) -> dict`（idx 自增）
  - `insert_mark(conn, take_id, *, t_ms, kind, label=None, end_ms=None) -> dict`（校验失败抛 `ValueError`）
  - `update_mark(conn, mark_id, **fields) -> dict`（合并后重校验；provenance 置 `human_edited`）
  - `delete_mark(conn, mark_id)` · `add_tally(conn, analysis_id, t_ms) -> dict` · `clear_tally(conn, analysis_id)`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_store.py`:

```python
import pytest

from vd import db, store


@pytest.fixture
def conn():
    c = db.connect()
    yield c
    c.close()


@pytest.fixture
def video(conn):
    return store.create_video(conn, name="a.mp4", source_kind="upload")


def test_create_video_assigns_seq(conn):
    v1 = store.create_video(conn, name="a.mp4", source_kind="upload")
    v2 = store.create_video(conn, name="b.mp4", source_kind="upload")
    assert (v1["seq"], v2["seq"]) == (1, 2)


def test_create_analysis_builds_lanes_and_first_takes(conn, video):
    tree = store.create_analysis(conn, video["id"])
    assert tree["name"] == "video-1_km-default-v1_a1"
    assert [l["layer"] for l in tree["lanes"]] == ["L0", "L1", "L2"]
    assert all(len(l["takes"]) == 1 and l["takes"][0]["idx"] == 1 for l in tree["lanes"])
    tree2 = store.create_analysis(conn, video["id"])
    assert tree2["name"].endswith("_a2")


def test_mark_roundtrip_sorted_by_time(conn, video):
    tree = store.create_analysis(conn, video["id"])
    take = tree["lanes"][0]["takes"][0]
    store.insert_mark(conn, take["id"], t_ms=500, kind="input", label="2")
    store.insert_mark(conn, take["id"], t_ms=100, kind="input", label="Q")
    fresh = store.get_analysis_tree(conn, tree["id"])
    marks = fresh["lanes"][0]["takes"][0]["marks"]
    assert [m["t_ms"] for m in marks] == [100, 500]
    assert marks[0]["provenance"] == "human_manual"


def test_mark_validation(conn, video):
    tree = store.create_analysis(conn, video["id"])
    take = tree["lanes"][0]["takes"][0]
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=-1, kind="input", label="2")
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=10, end_ms=5, kind="input", label="2")
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=10, kind="input")           # input 缺 label
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=10, kind="release", label="F")  # 空标记带 label


def test_update_mark_sets_edited_provenance(conn, video):
    tree = store.create_analysis(conn, video["id"])
    take = tree["lanes"][0]["takes"][0]
    m = store.insert_mark(conn, take["id"], t_ms=100, kind="input", label="F")
    m2 = store.update_mark(conn, m["id"], end_ms=400)
    assert m2["end_ms"] == 400 and m2["provenance"] == "human_edited"


def test_new_take_increments_idx(conn, video):
    tree = store.create_analysis(conn, video["id"])
    lane = tree["lanes"][0]
    t2 = store.create_take(conn, lane["id"])
    assert t2["idx"] == 2


def test_tally_add_and_clear(conn, video):
    tree = store.create_analysis(conn, video["id"])
    store.add_tally(conn, tree["id"], 1000)
    store.add_tally(conn, tree["id"], 2000)
    assert len(store.get_analysis_tree(conn, tree["id"])["tally"]) == 2
    store.clear_tally(conn, tree["id"])
    assert store.get_analysis_tree(conn, tree["id"])["tally"] == []
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_store.py -x
```

预期：FAIL（no module `vd.store`）

- [ ] **Step 3: 实现 store.py**

`backend/src/vd/store.py`:

```python
import uuid
from datetime import datetime, timezone

KEYMAP_DEFAULT = "km-default-v1"
LAYERS = ("L0", "L1", "L2")


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(cur) -> dict | None:
    r = cur.fetchone()
    return dict(r) if r else None


# ---- videos ----

def create_video(conn, *, name, source_kind, source_url=None, original_path=""):
    vid = _id("vid")
    seq = conn.execute("SELECT COALESCE(MAX(seq),0)+1 AS s FROM videos").fetchone()["s"]
    conn.execute(
        "INSERT INTO videos(id,seq,name,source_kind,source_url,original_path,created_at)"
        " VALUES(?,?,?,?,?,?,?)",
        (vid, seq, name, source_kind, source_url, original_path, _now()),
    )
    conn.commit()
    return get_video(conn, vid)


def get_video(conn, video_id):
    return _row(conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)))


def list_videos(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM videos ORDER BY seq")]


def update_video(conn, video_id, **fields):
    keys = ",".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE videos SET {keys} WHERE id=?", (*fields.values(), video_id))
    conn.commit()
    return get_video(conn, video_id)


# ---- analyses ----

def create_analysis(conn, video_id, keymap_label=KEYMAP_DEFAULT):
    video = get_video(conn, video_id)
    if video is None:
        raise ValueError("video not found")
    seq = conn.execute(
        "SELECT COALESCE(MAX(seq),0)+1 AS s FROM analyses WHERE video_id=?", (video_id,)
    ).fetchone()["s"]
    aid = _id("an")
    name = f"video-{video['seq']}_{keymap_label}_a{seq}"
    conn.execute(
        "INSERT INTO analyses(id,video_id,keymap_label,seq,name,created_at) VALUES(?,?,?,?,?,?)",
        (aid, video_id, keymap_label, seq, name, _now()),
    )
    for layer in LAYERS:
        lane_id = _id("ln")
        conn.execute("INSERT INTO lanes(id,analysis_id,layer) VALUES(?,?,?)", (lane_id, aid, layer))
        conn.execute(
            "INSERT INTO takes(id,lane_id,idx,created_at) VALUES(?,?,1,?)",
            (_id("tk"), lane_id, _now()),
        )
    conn.commit()
    return get_analysis_tree(conn, aid)


def get_analysis_tree(conn, analysis_id):
    a = _row(conn.execute("SELECT * FROM analyses WHERE id=?", (analysis_id,)))
    if a is None:
        return None
    lanes = [dict(r) for r in conn.execute(
        "SELECT * FROM lanes WHERE analysis_id=? ORDER BY layer", (analysis_id,))]
    for lane in lanes:
        takes = [dict(r) for r in conn.execute(
            "SELECT * FROM takes WHERE lane_id=? ORDER BY idx", (lane["id"],))]
        for take in takes:
            take["marks"] = [dict(r) for r in conn.execute(
                "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (take["id"],))]
        lane["takes"] = takes
    a["lanes"] = lanes
    a["tally"] = [dict(r) for r in conn.execute(
        "SELECT * FROM tally_markers WHERE analysis_id=? ORDER BY t_ms", (analysis_id,))]
    return a


# ---- takes / marks ----

def create_take(conn, lane_id):
    idx = conn.execute(
        "SELECT COALESCE(MAX(idx),0)+1 AS s FROM takes WHERE lane_id=?", (lane_id,)
    ).fetchone()["s"]
    tid = _id("tk")
    conn.execute(
        "INSERT INTO takes(id,lane_id,idx,created_at) VALUES(?,?,?,?)",
        (tid, lane_id, idx, _now()),
    )
    conn.commit()
    return {"id": tid, "lane_id": lane_id, "idx": idx, "marks": []}


def _validate_mark(t_ms, end_ms, kind, label):
    if t_ms < 0:
        raise ValueError("t_ms must be >= 0")
    if end_ms is not None and end_ms <= t_ms:
        raise ValueError("end_ms must be > t_ms")
    if kind == "input" and not label:
        raise ValueError("input mark requires label")
    if kind == "release" and label:
        raise ValueError("release mark must not carry label")


def insert_mark(conn, take_id, *, t_ms, kind, label=None, end_ms=None):
    _validate_mark(t_ms, end_ms, kind, label)
    mid = _id("mk")
    conn.execute(
        "INSERT INTO marks(id,take_id,t_ms,end_ms,kind,label) VALUES(?,?,?,?,?,?)",
        (mid, take_id, t_ms, end_ms, kind, label),
    )
    conn.commit()
    return _row(conn.execute("SELECT * FROM marks WHERE id=?", (mid,)))


def update_mark(conn, mark_id, **fields):
    cur = _row(conn.execute("SELECT * FROM marks WHERE id=?", (mark_id,)))
    if cur is None:
        raise ValueError("mark not found")
    merged = {**cur, **fields}
    _validate_mark(merged["t_ms"], merged["end_ms"], merged["kind"], merged["label"])
    keys = ",".join(f"{k}=?" for k in fields)
    conn.execute(
        f"UPDATE marks SET {keys}, provenance='human_edited' WHERE id=?",
        (*fields.values(), mark_id),
    )
    conn.commit()
    return _row(conn.execute("SELECT * FROM marks WHERE id=?", (mark_id,)))


def delete_mark(conn, mark_id):
    conn.execute("DELETE FROM marks WHERE id=?", (mark_id,))
    conn.commit()


# ---- tally ----

def add_tally(conn, analysis_id, t_ms):
    tid = _id("tm")
    conn.execute(
        "INSERT INTO tally_markers(id,analysis_id,t_ms) VALUES(?,?,?)",
        (tid, analysis_id, t_ms),
    )
    conn.commit()
    return {"id": tid, "analysis_id": analysis_id, "t_ms": t_ms}


def clear_tally(conn, analysis_id):
    conn.execute("DELETE FROM tally_markers WHERE analysis_id=?", (analysis_id,))
    conn.commit()
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest tests/test_store.py -x
```

预期：7 passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/store.py backend/tests/test_store.py
git commit -m "feat(backend): store CRUD with analysis tree and mark validation"
```

---

### 任务 4：media 探针与常量规则

**Files:**
- Create: `backend/src/vd/media.py`
- Create: `backend/tests/test_media.py`
- Modify: `backend/tests/conftest.py`（追加 sample_video fixture）

**Interfaces:**
- Produces: `media.probe(path) -> dict`（键：fps, width, height, duration_ms）、`media.target_fps(src_fps: float) -> int`、`media.thumb_interval_s(duration_ms: int) -> int`、`media._run(cmd) -> CompletedProcess`（内部）

- [ ] **Step 1: conftest 追加 fixture**

在 `backend/tests/conftest.py` 追加：

```python
import subprocess


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
```

- [ ] **Step 2: 写失败测试**

`backend/tests/test_media.py`:

```python
from vd import media


def test_target_fps_rule():
    assert media.target_fps(59.94) == 60
    assert media.target_fps(45.0) == 60
    assert media.target_fps(44.9) == 30
    assert media.target_fps(30.0) == 30
    assert media.target_fps(15.0) == 30


def test_thumb_interval_rule():
    assert media.thumb_interval_s(30_000) == 1        # 30s → 每秒 1 张
    assert media.thumb_interval_s(600_000) == 1       # 600s 恰好上限
    assert media.thumb_interval_s(601_000) == 2       # 超上限 → 拉大间隔
    assert media.thumb_interval_s(3_600_000) == 6     # 1h → 6s 一张（600 张封顶）


def test_probe_sample(sample_video):
    info = media.probe(sample_video)
    assert abs(info["fps"] - 15.0) < 0.1
    assert (info["width"], info["height"]) == (320, 240)
    assert abs(info["duration_ms"] - 2000) < 200
```

- [ ] **Step 3: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_media.py -x
```

预期：FAIL（no module `vd.media`）

- [ ] **Step 4: 实现 media.py（探针部分）**

`backend/src/vd/media.py`:

```python
import json
import math
import subprocess
from pathlib import Path


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe(path: Path) -> dict:
    out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_streams", "-show_format", "-of", "json", str(path),
    ]).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    num, _, den = stream["avg_frame_rate"].partition("/")
    fps = float(num) / float(den or 1)
    duration_s = float(data["format"]["duration"])
    return {
        "fps": fps,
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "duration_ms": round(duration_s * 1000),
    }


def target_fps(src_fps: float) -> int:
    return 60 if src_fps >= 45 else 30


def thumb_interval_s(duration_ms: int) -> int:
    return max(1, math.ceil(duration_ms / 1000 / 600))
```

- [ ] **Step 5: 运行确认通过**

```bash
cd backend && uv run pytest tests/test_media.py -x
```

预期：3 passed

- [ ] **Step 6: 提交**

```bash
git add backend/src/vd/media.py backend/tests/test_media.py backend/tests/conftest.py
git commit -m "feat(backend): ffprobe wrapper with fps/thumbnail constants"
```

---

### 任务 5：CFR 转码

**Files:**
- Modify: `backend/src/vd/media.py`（追加 `transcode_cfr`）
- Modify: `backend/tests/test_media.py`（追加测试）

**Interfaces:**
- Produces: `media.transcode_cfr(src: Path, dst: Path, fps: int) -> None`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_media.py` 追加：

```python
def test_transcode_cfr_produces_target_fps(sample_video, tmp_path):
    out = tmp_path / "work.mp4"
    media.transcode_cfr(sample_video, out, 30)
    info = media.probe(out)
    assert abs(info["fps"] - 30.0) < 0.1
    assert abs(info["duration_ms"] - 2000) < 300
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_media.py -x
```

预期：FAIL（`AttributeError: transcode_cfr`）

- [ ] **Step 3: 实现**

在 `backend/src/vd/media.py` 追加：

```python
def transcode_cfr(src: Path, dst: Path, fps: int) -> None:
    """统一转码为恒定帧率工作副本（spec §4.4）。原始文件不动。"""
    _run([
        "ffmpeg", "-y", "-i", str(src),
        "-vf", f"fps={fps}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart", str(dst),
    ])
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest tests/test_media.py -x
```

预期：4 passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/media.py backend/tests/test_media.py
git commit -m "feat(backend): CFR transcode to work copy"
```

---

### 任务 6：缩略图 sprite

**Files:**
- Modify: `backend/src/vd/media.py`（追加 `make_sprite`、`probe_image`）
- Modify: `backend/tests/test_media.py`（追加测试）

**Interfaces:**
- Produces: `media.make_sprite(work: Path, out_jpg: Path, duration_ms: int) -> dict`，返回键 `sprite_interval_s / sprite_count / thumb_w / thumb_h`（与 videos 表列名一致）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_media.py` 追加：

```python
def test_make_sprite(sample_video, tmp_path):
    out = tmp_path / "sprite.jpg"
    meta = media.make_sprite(sample_video, out, 2000)
    assert out.exists()
    assert meta["sprite_interval_s"] == 1
    assert meta["sprite_count"] == 2
    assert meta["thumb_w"] == 96
    img = media.probe_image(out)
    assert img["width"] == 96 * 2
    assert img["height"] == meta["thumb_h"]
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_media.py -x
```

预期：FAIL（`AttributeError: make_sprite`）

- [ ] **Step 3: 实现**

在 `backend/src/vd/media.py` 追加：

```python
def probe_image(path: Path) -> dict:
    out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", str(path),
    ]).stdout
    s = json.loads(out)["streams"][0]
    return {"width": int(s["width"]), "height": int(s["height"])}


def make_sprite(work: Path, out_jpg: Path, duration_ms: int) -> dict:
    """横向单行 sprite：每 interval 秒一张 96px 宽缩略图，tile 成一张 JPEG。
    interval 规则保证总张数 ≤600（JPEG 宽度上限约 65500px）。"""
    interval = thumb_interval_s(duration_ms)
    count = max(1, math.ceil(duration_ms / 1000 / interval))
    _run([
        "ffmpeg", "-y", "-i", str(work),
        "-vf", f"fps=1/{interval},scale=96:-2,tile={count}x1",
        "-frames:v", "1", str(out_jpg),
    ])
    meta = probe_image(out_jpg)
    return {
        "sprite_interval_s": interval,
        "sprite_count": count,
        "thumb_w": 96,
        "thumb_h": meta["height"],
    }
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest tests/test_media.py -x
```

预期：5 passed

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/media.py backend/tests/test_media.py
git commit -m "feat(backend): thumbnail sprite generation"
```

---

### 任务 7：上传摄取管线（FastAPI app 起点）

**Files:**
- Create: `backend/src/vd/ingest.py`（`process` 部分）
- Create: `backend/src/vd/api.py`（app + 视频列表/详情/上传）
- Create: `backend/tests/test_api.py`
- Modify: `backend/tests/conftest.py`（追加 client fixture）

**Interfaces:**
- Consumes: `store.*`、`media.*`、`config.data_root()`
- Produces:
  - `ingest.process(video_id: str) -> None`（后台任务：探针 → CFR 转码 → sprite → status=ready；任何异常置 failed + error，不抛出）
  - HTTP：`GET /api/videos`、`GET /api/videos/{id}`、`POST /api/videos/upload`（multipart 字段名 `file`，返回 video dict，转码在 BackgroundTasks 中执行）
  - `api.get_conn` FastAPI 依赖（yield 连接，用后关闭）

- [ ] **Step 1: conftest 追加 client fixture**

在 `backend/tests/conftest.py` 追加：

```python
@pytest.fixture
def client(data_dir):
    from fastapi.testclient import TestClient

    from vd.api import app

    with TestClient(app) as c:
        yield c
```

- [ ] **Step 2: 写失败测试**

`backend/tests/test_api.py`:

```python
def test_upload_runs_full_ingest_pipeline(client, sample_video):
    with sample_video.open("rb") as f:
        r = client.post("/api/videos/upload",
                        files={"file": ("sample.mp4", f, "video/mp4")})
    assert r.status_code == 200
    vid = r.json()["id"]
    # TestClient 同步执行 BackgroundTasks：请求返回后管线已完成
    v = client.get(f"/api/videos/{vid}").json()
    assert v["status"] == "ready", v.get("error")
    assert v["fps"] == 30            # 15fps 源 → 目标 30
    assert v["work_path"] and v["sprite_count"] == 2
    assert v["seq"] == 1


def test_get_missing_video_404(client):
    assert client.get("/api/videos/nope").status_code == 404
```

- [ ] **Step 3: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

预期：FAIL（no module `vd.api`）

- [ ] **Step 4: 实现 ingest.process 与 api 上传**

`backend/src/vd/ingest.py`:

```python
from pathlib import Path

from vd import db, media, store
from vd.config import data_root


def process(video_id: str) -> None:
    """摄取管线后台任务。失败落库为 failed，绝不抛出（spec §10）。"""
    conn = db.connect()
    try:
        video = store.get_video(conn, video_id)
        store.update_video(conn, video_id, status="transcoding")
        src = Path(video["original_path"])
        info = media.probe(src)
        fps = media.target_fps(info["fps"])
        work = data_root() / "work" / f"{video_id}.mp4"
        media.transcode_cfr(src, work, fps)
        winfo = media.probe(work)
        sprite = data_root() / "thumbs" / f"{video_id}.jpg"
        smeta = media.make_sprite(work, sprite, winfo["duration_ms"])
        store.update_video(
            conn, video_id,
            work_path=str(work), fps=winfo["fps"], width=winfo["width"],
            height=winfo["height"], duration_ms=winfo["duration_ms"],
            status="ready", **smeta,
        )
    except Exception as e:  # noqa: BLE001 —— 管线失败必须落库而非崩掉进程
        store.update_video(conn, video_id, status="failed", error=str(e))
    finally:
        conn.close()
```

`backend/src/vd/api.py`:

```python
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, UploadFile

from vd import db, ingest, store
from vd.config import data_root

app = FastAPI(title="Video Distiller")


def get_conn():
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


@app.get("/api/videos")
def videos(conn=Depends(get_conn)):
    return store.list_videos(conn)


@app.get("/api/videos/{video_id}")
def video(video_id: str, conn=Depends(get_conn)):
    v = store.get_video(conn, video_id)
    if v is None:
        raise HTTPException(404)
    return v


@app.post("/api/videos/upload")
def upload(file: UploadFile, background_tasks: BackgroundTasks, conn=Depends(get_conn)):
    v = store.create_video(conn, name=file.filename or "未命名", source_kind="upload")
    suffix = Path(file.filename or "v.mp4").suffix or ".mp4"
    dest = data_root() / "originals" / f"{v['id']}{suffix}"
    with dest.open("wb") as f:
        while chunk := file.file.read(1 << 20):
            f.write(chunk)
    v = store.update_video(conn, v["id"], original_path=str(dest))
    background_tasks.add_task(ingest.process, v["id"])
    return v
```

- [ ] **Step 5: 运行确认通过**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

预期：2 passed

- [ ] **Step 6: 提交**

```bash
git add backend/src/vd/ingest.py backend/src/vd/api.py backend/tests
git commit -m "feat(backend): upload endpoint with full ingest pipeline"
```

---

### 任务 8：B 站 URL 拉取

**Files:**
- Modify: `backend/src/vd/ingest.py`（追加 `pull_bilibili`、`default_runner`）
- Modify: `backend/src/vd/api.py`（追加 `POST /api/videos/pull` 与 `_pull_then_process`）
- Create: `backend/tests/test_ingest.py`
- Modify: `backend/tests/test_api.py`（追加 pull 流程测试）

**Interfaces:**
- Produces:
  - `ingest.pull_bilibili(url: str, dest: Path, runner=default_runner) -> Path`（runner 可注入以便测试；产物不存在则抛 RuntimeError）
  - HTTP：`POST /api/videos/pull`，body `{"url": "..."}`，返回 video dict（status=ingesting，下载与转码在后台）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_ingest.py`:

```python
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
```

在 `backend/tests/test_api.py` 追加：

```python
def test_pull_endpoint_full_flow(client, sample_video, monkeypatch):
    import shutil

    from vd import ingest

    def fake_pull(url, dest, runner=None):
        shutil.copy(sample_video, dest)
        return dest

    monkeypatch.setattr(ingest, "pull_bilibili", fake_pull)
    r = client.post("/api/videos/pull",
                    json={"url": "https://www.bilibili.com/video/BVxxxx"})
    assert r.status_code == 200
    v = client.get(f"/api/videos/{r.json()['id']}").json()
    assert v["status"] == "ready"
    assert v["source_kind"] == "bilibili"
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_ingest.py tests/test_api.py -x
```

预期：FAIL（`AttributeError: pull_bilibili`）

- [ ] **Step 3: 实现**

在 `backend/src/vd/ingest.py` 顶部追加 import 并在文件末尾追加：

```python
import subprocess
import sys


def default_runner(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def pull_bilibili(url: str, dest: Path, runner=default_runner) -> Path:
    """B 站拉取（spec §4.4：仅 B 站；抖音走手动上传）。"""
    runner([
        sys.executable, "-m", "yt_dlp",
        "-f", "bv*+ba/b", "--merge-output-format", "mp4",
        "-o", str(dest), url,
    ])
    if not dest.exists():
        raise RuntimeError("yt-dlp 未产出文件，请手动下载后上传")
    return dest
```

在 `backend/src/vd/api.py` 追加：

```python
from pydantic import BaseModel


class PullReq(BaseModel):
    url: str


@app.post("/api/videos/pull")
def pull(req: PullReq, background_tasks: BackgroundTasks, conn=Depends(get_conn)):
    v = store.create_video(conn, name=req.url, source_kind="bilibili", source_url=req.url)
    background_tasks.add_task(_pull_then_process, v["id"], req.url)
    return v


def _pull_then_process(video_id: str, url: str) -> None:
    conn = db.connect()
    try:
        dest = data_root() / "originals" / f"{video_id}.mp4"
        ingest.pull_bilibili(url, dest)
        store.update_video(conn, video_id, original_path=str(dest))
    except Exception as e:  # noqa: BLE001
        store.update_video(conn, video_id, status="failed", error=str(e))
        return
    finally:
        conn.close()
    ingest.process(video_id)
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest -x
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd backend/tests
git commit -m "feat(backend): bilibili URL pull via yt-dlp"
```

---

### 任务 9：标注 CRUD API

**Files:**
- Modify: `backend/src/vd/api.py`（追加 analyses/takes/marks/tally 路由）
- Modify: `backend/tests/test_api.py`（追加测试）

**Interfaces:**
- Produces（前端 client 依赖这些精确路径与形状）：
  - `POST /api/analyses` body `{"video_id"}` → Analysis 树
  - `GET /api/analyses?video_id=` → `[{id, name, seq, ...}]`；`GET /api/analyses/{id}` → 树
  - `POST /api/lanes/{lane_id}/takes` → take dict
  - `POST /api/takes/{take_id}/marks` body `{t_ms, kind, label?, end_ms?}` → mark dict；校验失败 400
  - `PATCH /api/marks/{id}` body `{t_ms?, end_ms?, label?, clear_end?}`（`clear_end: true` 表示清除 end_ms，即取消 holding）→ mark dict
  - `DELETE /api/marks/{id}` → `{"ok": true}`
  - `POST /api/analyses/{id}/tally` body `{t_ms}` → tally dict；`DELETE /api/analyses/{id}/tally` 清空

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_api.py` 追加：

```python
import pytest


@pytest.fixture
def analysis(client, sample_video):
    with sample_video.open("rb") as f:
        vid = client.post("/api/videos/upload",
                          files={"file": ("s.mp4", f, "video/mp4")}).json()["id"]
    return client.post("/api/analyses", json={"video_id": vid}).json()


def test_analysis_create_and_fetch(client, analysis):
    assert analysis["name"].endswith("_a1")
    tree = client.get(f"/api/analyses/{analysis['id']}").json()
    assert [l["layer"] for l in tree["lanes"]] == ["L0", "L1", "L2"]


def test_mark_crud_over_http(client, analysis):
    take = analysis["lanes"][0]["takes"][0]
    m = client.post(f"/api/takes/{take['id']}/marks",
                    json={"t_ms": 1200, "kind": "input", "label": "2"}).json()
    # holding：设置 end_ms
    m2 = client.patch(f"/api/marks/{m['id']}", json={"end_ms": 1500}).json()
    assert m2["end_ms"] == 1500
    # 取消 holding：clear_end
    m3 = client.patch(f"/api/marks/{m['id']}", json={"clear_end": True}).json()
    assert m3["end_ms"] is None
    assert client.delete(f"/api/marks/{m['id']}").json() == {"ok": True}


def test_mark_validation_maps_to_400(client, analysis):
    take = analysis["lanes"][0]["takes"][0]
    r = client.post(f"/api/takes/{take['id']}/marks",
                    json={"t_ms": 10, "kind": "input"})     # input 缺 label
    assert r.status_code == 400


def test_take_and_tally_endpoints(client, analysis):
    lane = analysis["lanes"][0]
    t2 = client.post(f"/api/lanes/{lane['id']}/takes").json()
    assert t2["idx"] == 2
    client.post(f"/api/analyses/{analysis['id']}/tally", json={"t_ms": 500})
    tree = client.get(f"/api/analyses/{analysis['id']}").json()
    assert len(tree["tally"]) == 1
    client.delete(f"/api/analyses/{analysis['id']}/tally")
    tree = client.get(f"/api/analyses/{analysis['id']}").json()
    assert tree["tally"] == []
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

预期：FAIL（404，路由不存在）

- [ ] **Step 3: 实现路由**

在 `backend/src/vd/api.py` 追加：

```python
class AnalysisReq(BaseModel):
    video_id: str


@app.post("/api/analyses")
def create_analysis(req: AnalysisReq, conn=Depends(get_conn)):
    try:
        return store.create_analysis(conn, req.video_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/analyses")
def list_analyses(video_id: str, conn=Depends(get_conn)):
    rows = conn.execute(
        "SELECT * FROM analyses WHERE video_id=? ORDER BY seq", (video_id,))
    return [dict(r) for r in rows]


@app.get("/api/analyses/{analysis_id}")
def analysis(analysis_id: str, conn=Depends(get_conn)):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    return tree


@app.post("/api/lanes/{lane_id}/takes")
def new_take(lane_id: str, conn=Depends(get_conn)):
    return store.create_take(conn, lane_id)


class MarkReq(BaseModel):
    t_ms: int
    kind: str
    label: str | None = None
    end_ms: int | None = None


@app.post("/api/takes/{take_id}/marks")
def new_mark(take_id: str, req: MarkReq, conn=Depends(get_conn)):
    try:
        return store.insert_mark(conn, take_id, t_ms=req.t_ms, kind=req.kind,
                                 label=req.label, end_ms=req.end_ms)
    except ValueError as e:
        raise HTTPException(400, str(e))


class MarkPatch(BaseModel):
    t_ms: int | None = None
    end_ms: int | None = None
    label: str | None = None
    clear_end: bool = False


@app.patch("/api/marks/{mark_id}")
def patch_mark(mark_id: str, req: MarkPatch, conn=Depends(get_conn)):
    fields = {k: v for k, v in req.model_dump().items()
              if k != "clear_end" and v is not None}
    if req.clear_end:
        fields["end_ms"] = None
    if not fields:
        raise HTTPException(400, "empty patch")
    try:
        return store.update_mark(conn, mark_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/marks/{mark_id}")
def del_mark(mark_id: str, conn=Depends(get_conn)):
    store.delete_mark(conn, mark_id)
    return {"ok": True}


class TallyReq(BaseModel):
    t_ms: int


@app.post("/api/analyses/{analysis_id}/tally")
def add_tally(analysis_id: str, req: TallyReq, conn=Depends(get_conn)):
    return store.add_tally(conn, analysis_id, req.t_ms)


@app.delete("/api/analyses/{analysis_id}/tally")
def clear_tally(analysis_id: str, conn=Depends(get_conn)):
    store.clear_tally(conn, analysis_id)
    return {"ok": True}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest -x
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/api.py backend/tests/test_api.py
git commit -m "feat(backend): annotation CRUD endpoints"
```

---

### 任务 10：多 Take 聚合

**Files:**
- Create: `backend/src/vd/aggregate.py`
- Create: `backend/tests/test_aggregate.py`
- Modify: `backend/src/vd/api.py`（追加 `GET /api/lanes/{id}/aggregate`）
- Modify: `backend/tests/test_api.py`（追加端点测试）

**Interfaces:**
- Produces:
  - `aggregate.aggregate_lane(takes: list[list[dict]], window_ms: int = 300) -> dict`，返回 `{"n_takes", "aggregated": [...], "minority": [...]}`，每项含 `kind/label/t_ms/end_ms/iqr_ms/support/take_idxs`
  - HTTP：`GET /api/lanes/{lane_id}/aggregate?window_ms=300`
- 算法（spec §7.2a + Q13 决议）：同 `(kind,label)` 的标记按时间贪心聚簇（同簇内相邻间隔 ≤ window 且每 Take 至多一条）；簇大小 ×2 > n_takes → 多数派进 `aggregated`（t 取中位数，IQR 为不确定度，confidence=support）；否则进 `minority`。**永不静默丢弃。** span：簇内过半成员有 end_ms 才聚合出 end_ms（取中位数）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_aggregate.py`:

```python
from vd.aggregate import aggregate_lane


def mk(t, label="2", kind="input", end=None):
    return {"t_ms": t, "end_ms": end, "kind": kind, "label": label}


def test_three_takes_full_agreement():
    takes = [[mk(100), mk(1000)], [mk(120), mk(980)], [mk(90), mk(1010)]]
    r = aggregate_lane(takes)
    assert r["n_takes"] == 3
    assert [a["t_ms"] for a in r["aggregated"]] == [100, 1000]
    assert all(a["support"] == 1.0 for a in r["aggregated"])
    assert r["minority"] == []


def test_majority_included_with_reduced_support():
    takes = [[mk(100)], [mk(110)], []]           # 第 3 遍漏标
    r = aggregate_lane(takes)
    assert len(r["aggregated"]) == 1
    assert abs(r["aggregated"][0]["support"] - 2 / 3) < 1e-9
    assert r["aggregated"][0]["take_idxs"] == [0, 1]


def test_minority_never_dropped():
    takes = [[mk(100)], [], []]                  # 只有 1/3 出现
    r = aggregate_lane(takes)
    assert r["aggregated"] == []
    assert len(r["minority"]) == 1
    assert r["minority"][0]["t_ms"] == 100


def test_same_take_marks_split_into_clusters():
    # 同一 Take 的两次按键相距 200ms（< window），不得并簇
    takes = [[mk(100), mk(300)], [mk(110), mk(310)]]
    r = aggregate_lane(takes)
    assert [a["t_ms"] for a in r["aggregated"]] == [105, 305]


def test_different_labels_never_merge():
    takes = [[mk(100, label="2"), mk(105, label="3")]]
    r = aggregate_lane(takes)
    assert len(r["aggregated"]) == 2


def test_span_aggregated_when_majority_has_end():
    takes = [[mk(100, end=400)], [mk(110, end=420)], [mk(90)]]
    r = aggregate_lane(takes)
    assert r["aggregated"][0]["end_ms"] == 410


def test_iqr_reflects_spread():
    takes = [[mk(100)], [mk(140)], [mk(180)]]
    r = aggregate_lane(takes)
    assert r["aggregated"][0]["t_ms"] == 140
    assert r["aggregated"][0]["iqr_ms"] > 0
```

在 `backend/tests/test_api.py` 追加：

```python
def test_lane_aggregate_endpoint(client, analysis):
    lane = analysis["lanes"][0]
    take1 = lane["takes"][0]
    take2 = client.post(f"/api/lanes/{lane['id']}/takes").json()
    for tid, t in ((take1["id"], 100), (take2["id"], 120)):
        client.post(f"/api/takes/{tid}/marks",
                    json={"t_ms": t, "kind": "input", "label": "Q"})
    r = client.get(f"/api/lanes/{lane['id']}/aggregate").json()
    assert r["n_takes"] == 2
    assert r["aggregated"][0]["t_ms"] == 110
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_aggregate.py -x
```

预期：FAIL（no module `vd.aggregate`）

- [ ] **Step 3: 实现**

`backend/src/vd/aggregate.py`:

```python
from statistics import median, quantiles


def _iqr(values: list[int]) -> int:
    if len(values) < 2:
        return 0
    q = quantiles(values, n=4, method="inclusive")
    return round(q[2] - q[0])


def aggregate_lane(takes: list[list[dict]], window_ms: int = 300) -> dict:
    """多 Take 聚合（spec §7.2a）：多数派产出稳健时序，少数派永不静默丢弃。"""
    n = len(takes)
    groups: dict[tuple, list[tuple[int, dict]]] = {}
    for idx, marks in enumerate(takes):
        for m in marks:
            groups.setdefault((m["kind"], m["label"]), []).append((idx, m))

    aggregated: list[dict] = []
    minority: list[dict] = []
    for (kind, label), members in groups.items():
        members.sort(key=lambda x: x[1]["t_ms"])
        clusters: list[list[tuple[int, dict]]] = []
        for idx, m in members:
            cur = clusters[-1] if clusters else None
            if (cur is None
                    or m["t_ms"] - cur[-1][1]["t_ms"] > window_ms
                    or any(i == idx for i, _ in cur)):
                clusters.append([(idx, m)])
            else:
                cur.append((idx, m))
        for cluster in clusters:
            ts = [m["t_ms"] for _, m in cluster]
            ends = [m["end_ms"] for _, m in cluster if m["end_ms"] is not None]
            item = {
                "kind": kind,
                "label": label,
                "t_ms": round(median(ts)),
                "end_ms": round(median(ends)) if len(ends) * 2 > len(cluster) else None,
                "iqr_ms": _iqr(ts),
                "support": len(cluster) / n,
                "take_idxs": sorted(i for i, _ in cluster),
            }
            (aggregated if len(cluster) * 2 > n else minority).append(item)

    aggregated.sort(key=lambda x: x["t_ms"])
    minority.sort(key=lambda x: x["t_ms"])
    return {"n_takes": n, "aggregated": aggregated, "minority": minority}
```

在 `backend/src/vd/api.py` 追加（import 处加 `from vd import aggregate as agg`）：

```python
@app.get("/api/lanes/{lane_id}/aggregate")
def lane_aggregate(lane_id: str, window_ms: int = 300, conn=Depends(get_conn)):
    takes = []
    for t in conn.execute(
            "SELECT id FROM takes WHERE lane_id=? ORDER BY idx", (lane_id,)):
        marks = [dict(r) for r in conn.execute(
            "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (t["id"],))]
        takes.append(marks)
    return agg.aggregate_lane(takes, window_ms=window_ms)
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest -x
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/aggregate.py backend/src/vd/api.py backend/tests
git commit -m "feat(backend): multi-take aggregation with minority flagging"
```

---

### 任务 11：视频与 sprite 文件服务（HTTP Range）

**Files:**
- Modify: `backend/src/vd/api.py`（追加文件路由）
- Modify: `backend/tests/test_api.py`（追加测试）

**Interfaces:**
- Produces:
  - `GET /api/videos/{id}/file`：工作副本（无则原件）。无 Range → 200 + `Accept-Ranges: bytes`；带 `Range: bytes=a-b` → 206 + `Content-Range`（`<video>` seek 依赖此语义，手工实现不依赖 Starlette 版本行为）
  - `GET /api/videos/{id}/sprite`：sprite JPEG

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_api.py` 追加：

```python
def _ready_video(client, sample_video):
    with sample_video.open("rb") as f:
        return client.post("/api/videos/upload",
                           files={"file": ("s.mp4", f, "video/mp4")}).json()["id"]


def test_video_file_supports_range(client, sample_video):
    vid = _ready_video(client, sample_video)
    r = client.get(f"/api/videos/{vid}/file")
    assert r.status_code == 200
    assert r.headers["accept-ranges"] == "bytes"
    r206 = client.get(f"/api/videos/{vid}/file", headers={"Range": "bytes=0-99"})
    assert r206.status_code == 206
    assert len(r206.content) == 100
    assert r206.headers["content-range"].startswith("bytes 0-99/")


def test_sprite_served_as_jpeg(client, sample_video):
    vid = _ready_video(client, sample_video)
    r = client.get(f"/api/videos/{vid}/sprite")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

预期：FAIL（404）

- [ ] **Step 3: 实现**

在 `backend/src/vd/api.py` 追加（顶部 import 加 `import re`、`from typing import Iterator`、`from fastapi import Request`、`from fastapi.responses import FileResponse, StreamingResponse`）：

```python
CHUNK = 1 << 20


def _read_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    with path.open("rb") as f:
        f.seek(start)
        left = end - start + 1
        while left > 0:
            data = f.read(min(CHUNK, left))
            if not data:
                break
            left -= len(data)
            yield data


@app.get("/api/videos/{video_id}/file")
def video_file(video_id: str, request: Request, conn=Depends(get_conn)):
    v = store.get_video(conn, video_id)
    if v is None:
        raise HTTPException(404)
    path = Path(v["work_path"] or v["original_path"])
    if not path.exists():
        raise HTTPException(404)
    size = path.stat().st_size
    m = re.match(r"bytes=(\d*)-(\d*)", request.headers.get("range") or "")
    if not m:
        return StreamingResponse(
            _read_range(path, 0, size - 1), media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(size)},
        )
    start = int(m.group(1) or 0)
    end = min(int(m.group(2) or size - 1), size - 1)
    return StreamingResponse(
        _read_range(path, start, end), status_code=206, media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(end - start + 1),
        },
    )


@app.get("/api/videos/{video_id}/sprite")
def sprite(video_id: str, conn=Depends(get_conn)):
    p = data_root() / "thumbs" / f"{video_id}.jpg"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend && uv run pytest -x
```

预期：全部通过（后端合计约 25 个）

- [ ] **Step 5: 提交**

```bash
git add backend/src/vd/api.py backend/tests/test_api.py
git commit -m "feat(backend): range-capable video file and sprite serving"
```

---

# 部分 B：前端（任务 12–23）

### 任务 12：前端脚手架

**Files:**
- Create: `frontend/package.json` · `frontend/vite.config.ts` · `frontend/tsconfig.json` · `frontend/index.html`
- Create: `frontend/src/main.tsx` · `frontend/src/App.tsx` · `frontend/src/styles.css` · `frontend/src/vite-env.d.ts`
- Create: `frontend/src/smoke.test.ts`

**Interfaces:**
- Produces: `pnpm dev`（5173，`/api` 代理到 8000）、`pnpm test`（vitest run）、`pnpm build`（tsc + vite build）

- [ ] **Step 1: 写脚手架文件**

`frontend/package.json`:

```json
{
  "name": "vd-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "~5.7.2",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`frontend/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
  test: { environment: 'node' },
})
```

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Video Distiller</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
```

`frontend/src/App.tsx`（占位，任务 16 扩展）:

```tsx
export default function App() {
  return <h1>Video Distiller</h1>
}
```

`frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`frontend/src/styles.css`:

```css
:root { color-scheme: dark; }
body { margin: 0; font: 13px/1.5 system-ui, sans-serif; background: #16181d; color: #ddd; }
button { margin: 2px; }
button.active { outline: 2px solid #5af; }
video { width: 100%; max-height: 45vh; background: #000; }
canvas { display: block; }
.workbench { display: grid; grid-template-columns: 1fr 300px; gap: 8px; padding: 8px; }
.workbench .main { min-width: 0; }
.entry-panel { border-left: 1px solid #333; padding: 8px; }
.entry-panel .keys button { min-width: 40px; }
.tally-bar { display: flex; gap: 16px; align-items: center; padding: 4px 8px; background: #1e2128; }
.strip { user-select: none; }
.library { max-width: 720px; margin: 40px auto; }
.library table { width: 100%; border-collapse: collapse; }
.library td { padding: 4px 8px; border-bottom: 1px solid #333; }
```

`frontend/src/smoke.test.ts`:

```ts
import { expect, test } from 'vitest'

test('smoke', () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 2: 安装并验证**

```bash
cd frontend && pnpm install && pnpm test && pnpm build
```

预期：test 1 passed；build 成功

- [ ] **Step 3: 提交**

```bash
git add frontend
git commit -m "feat(frontend): vite react-ts scaffold with vitest"
```

---

### 任务 13：API 类型与 client

**Files:**
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: 任务 7–11 的 HTTP 路由（路径与 JSON 形状**必须逐字一致**）
- Produces: `api` 对象（下列方法签名被后续所有任务使用）与全部类型

- [ ] **Step 1: 写失败测试**

`frontend/src/api/client.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { api } from './client'

afterEach(() => vi.unstubAllGlobals())

test('newMark posts json and parses response', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'mk_1', t_ms: 100 }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const m = await api.newMark('tk_1', { t_ms: 100, kind: 'input', label: '2' })
  expect(m.id).toBe('mk_1')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/takes/tk_1/marks')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body).label).toBe('2')
})

test('non-ok response throws', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 400 })))
  await expect(api.listVideos()).rejects.toThrow('400')
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

预期：FAIL（cannot find `./client`）

- [ ] **Step 3: 实现**

`frontend/src/api/types.ts`:

```ts
export interface Video {
  id: string; seq: number; name: string
  status: 'ingesting' | 'transcoding' | 'ready' | 'failed'
  source_kind: 'upload' | 'bilibili'
  fps: number | null; width: number | null; height: number | null
  duration_ms: number | null
  sprite_interval_s: number | null; sprite_count: number | null
  thumb_w: number | null; thumb_h: number | null
  error: string | null
}

export interface Mark {
  id: string; take_id: string; t_ms: number; end_ms: number | null
  kind: 'input' | 'release'; label: string | null
  provenance: string; confidence: number
}

export interface Take { id: string; idx: number; marks: Mark[] }
export interface Lane { id: string; layer: 'L0' | 'L1' | 'L2'; takes: Take[] }
export interface Tally { id: string; t_ms: number }

export interface AnalysisTree {
  id: string; video_id: string; name: string
  lanes: Lane[]; tally: Tally[]
}

export interface AggMark {
  kind: string; label: string | null; t_ms: number; end_ms: number | null
  iqr_ms: number; support: number; take_idxs: number[]
}
export interface Aggregate { n_takes: number; aggregated: AggMark[]; minority: AggMark[] }
```

`frontend/src/api/client.ts`:

```ts
import type { Aggregate, AnalysisTree, Mark, Take, Tally, Video } from './types'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const api = {
  listVideos: () => fetch('/api/videos').then(r => j<Video[]>(r)),
  getVideo: (id: string) => fetch(`/api/videos/${id}`).then(r => j<Video>(r)),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch('/api/videos/upload', { method: 'POST', body: fd }).then(r => j<Video>(r))
  },
  pull: (url: string) => post('/api/videos/pull', { url }).then(r => j<Video>(r)),

  listAnalyses: (videoId: string) =>
    fetch(`/api/analyses?video_id=${videoId}`).then(r => j<{ id: string }[]>(r)),
  createAnalysis: (videoId: string) =>
    post('/api/analyses', { video_id: videoId }).then(r => j<AnalysisTree>(r)),
  getAnalysis: (id: string) => fetch(`/api/analyses/${id}`).then(r => j<AnalysisTree>(r)),

  newTake: (laneId: string) => post(`/api/lanes/${laneId}/takes`).then(r => j<Take>(r)),
  newMark: (takeId: string, m: { t_ms: number; kind: 'input' | 'release'; label?: string | null; end_ms?: number | null }) =>
    post(`/api/takes/${takeId}/marks`, m).then(r => j<Mark>(r)),
  patchMark: (id: string, patch: { t_ms?: number; end_ms?: number; label?: string; clear_end?: boolean }) =>
    fetch(`/api/marks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => j<Mark>(r)),
  deleteMark: (id: string) =>
    fetch(`/api/marks/${id}`, { method: 'DELETE' }).then(r => j<{ ok: boolean }>(r)),

  addTally: (analysisId: string, t_ms: number) =>
    post(`/api/analyses/${analysisId}/tally`, { t_ms }).then(r => j<Tally>(r)),
  clearTally: (analysisId: string) =>
    fetch(`/api/analyses/${analysisId}/tally`, { method: 'DELETE' }).then(r => j<{ ok: boolean }>(r)),

  laneAggregate: (laneId: string, windowMs = 300) =>
    fetch(`/api/lanes/${laneId}/aggregate?window_ms=${windowMs}`).then(r => j<Aggregate>(r)),

  videoFileUrl: (id: string) => `/api/videos/${id}/file`,
  spriteUrl: (id: string) => `/api/videos/${id}/sprite`,
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd frontend && pnpm test
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add frontend/src/api
git commit -m "feat(frontend): typed api client"
```

---

### 任务 14：帧数学与时间轴布局（纯函数）

**Files:**
- Create: `frontend/src/time/frames.ts` · `frontend/src/time/frames.test.ts`
- Create: `frontend/src/timeline/layout.ts` · `frontend/src/timeline/layout.test.ts`

**Interfaces:**
- Produces（后续组件全部依赖）：
  - frames: `frameOf(tMs, fps)`、`frameToSeekTime(frame, fps)`（帧中点秒）、`stepFrame(currentS, fps, dir, durationS)`、`fmtTc(tMs)`（`mm:ss.mmm`）
  - layout: `Viewport {startMs, endMs, widthPx}`、`MarkLite`、`msToPx`、`pxToMs`、`Interval {fromId,toId,startMs,endMs,deltaMs,holding,midMs}`、`intervals(marks)`、`hitTestMark(marks, v, x, tolPx=6)`、`zoomed(v, factor, focusMs, durationMs)`、`panned(v, deltaMs, durationMs)`、`holdingPatch(iv, checked)`、常量 `LANE_H=64`、`TOP_H=16`、`checkboxRect(midMs, v, laneY)`、`inRect(r, px, py)`

- [ ] **Step 1: 写失败测试**

`frontend/src/time/frames.test.ts`:

```ts
import { expect, test } from 'vitest'
import { fmtTc, frameOf, frameToSeekTime, stepFrame } from './frames'

test('frameOf rounds to nearest frame', () => {
  expect(frameOf(1000, 30)).toBe(30)
  expect(frameOf(16, 60)).toBe(1)
})

test('frameToSeekTime targets frame midpoint', () => {
  expect(frameToSeekTime(0, 30)).toBeCloseTo(0.5 / 30)
  expect(frameToSeekTime(29, 30)).toBeCloseTo(29.5 / 30)
})

test('stepFrame moves exactly one frame and clamps', () => {
  const t0 = frameToSeekTime(10, 30)
  expect(stepFrame(t0, 30, 1, 60)).toBeCloseTo(frameToSeekTime(11, 30))
  expect(stepFrame(t0, 30, -1, 60)).toBeCloseTo(frameToSeekTime(9, 30))
  expect(stepFrame(0, 30, -1, 60)).toBeCloseTo(frameToSeekTime(0, 30))
})

test('fmtTc formats ms precision', () => {
  expect(fmtTc(0)).toBe('00:00.000')
  expect(fmtTc(21437)).toBe('00:21.437')
  expect(fmtTc(61001)).toBe('01:01.001')
})
```

`frontend/src/timeline/layout.test.ts`:

```ts
import { expect, test } from 'vitest'
import {
  checkboxRect, hitTestMark, holdingPatch, inRect, intervals,
  msToPx, panned, pxToMs, zoomed, type MarkLite, type Viewport,
} from './layout'

const v: Viewport = { startMs: 0, endMs: 10_000, widthPx: 1000 }
const mk = (id: string, t: number, end: number | null = null): MarkLite =>
  ({ id, t_ms: t, end_ms: end, kind: 'input', label: '2' })

test('ms↔px roundtrip', () => {
  expect(msToPx(v, 5000)).toBe(500)
  expect(pxToMs(v, 500)).toBe(5000)
  expect(pxToMs(v, msToPx(v, 1234))).toBe(1234)
})

test('intervals compute delta and holding', () => {
  const [iv] = intervals([mk('a', 100, 400), mk('b', 400)])
  expect(iv).toMatchObject({ fromId: 'a', toId: 'b', deltaMs: 300, holding: true, midMs: 250 })
  const [iv2] = intervals([mk('a', 100), mk('b', 400)])
  expect(iv2.holding).toBe(false)
})

test('hitTestMark picks nearest within tolerance', () => {
  const marks = [mk('a', 1000), mk('b', 2000)]
  expect(hitTestMark(marks, v, msToPx(v, 1010))).toBe('a')
  expect(hitTestMark(marks, v, msToPx(v, 1500))).toBeNull()
})

test('zoom keeps focus and clamps to duration', () => {
  const z = zoomed(v, 0.5, 5000, 10_000)
  expect(z.endMs - z.startMs).toBe(5000)
  expect(z.startMs).toBeGreaterThanOrEqual(0)
  const zoomOut = zoomed(v, 4, 5000, 10_000)
  expect(zoomOut.endMs - zoomOut.startMs).toBe(10_000)
})

test('pan clamps to bounds', () => {
  expect(panned(v, -500, 10_000).startMs).toBe(0)
  const right = panned({ ...v, startMs: 5000, endMs: 10_000 }, 9999, 10_000)
  expect(right.endMs).toBe(10_000)
})

test('holdingPatch emits set or clear', () => {
  const [iv] = intervals([mk('a', 100), mk('b', 400)])
  expect(holdingPatch(iv, true)).toEqual({ markId: 'a', patch: { end_ms: 400 } })
  expect(holdingPatch(iv, false)).toEqual({ markId: 'a', patch: { clear_end: true } })
})

test('checkboxRect hit', () => {
  const r = checkboxRect(250, v, 16)
  expect(inRect(r, msToPx(v, 250), 16 + 64 / 2 + 15)).toBe(true)
  expect(inRect(r, msToPx(v, 250) + 50, r.y + 5)).toBe(false)
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现**

`frontend/src/time/frames.ts`:

```ts
export const frameOf = (tMs: number, fps: number): number =>
  Math.round((tMs / 1000) * fps)

/** 目标为帧中点，避免落在帧边界上取到相邻帧 */
export const frameToSeekTime = (frame: number, fps: number): number =>
  (frame + 0.5) / fps

export const stepFrame = (currentS: number, fps: number, dir: 1 | -1, durationS: number): number => {
  const cur = Math.round(currentS * fps - 0.5)
  const next = Math.max(0, cur + dir)
  return Math.min(frameToSeekTime(next, fps), Math.max(0, durationS - 0.5 / fps))
}

export const fmtTc = (tMs: number): string => {
  const total = Math.round(tMs)
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}
```

`frontend/src/timeline/layout.ts`:

```ts
export const LANE_H = 64
export const TOP_H = 16

export interface Viewport { startMs: number; endMs: number; widthPx: number }

export interface MarkLite {
  id: string; t_ms: number; end_ms: number | null
  kind: 'input' | 'release'; label: string | null
}

export const msToPx = (v: Viewport, tMs: number): number =>
  ((tMs - v.startMs) / (v.endMs - v.startMs)) * v.widthPx

export const pxToMs = (v: Viewport, x: number): number =>
  Math.round(v.startMs + (x / v.widthPx) * (v.endMs - v.startMs))

export interface Interval {
  fromId: string; toId: string
  startMs: number; endMs: number; deltaMs: number
  holding: boolean; midMs: number
}

export const intervals = (marks: MarkLite[]): Interval[] => {
  const out: Interval[] = []
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1]
    out.push({
      fromId: a.id, toId: b.id, startMs: a.t_ms, endMs: b.t_ms,
      deltaMs: b.t_ms - a.t_ms, holding: a.end_ms === b.t_ms,
      midMs: Math.round((a.t_ms + b.t_ms) / 2),
    })
  }
  return out
}

export const hitTestMark = (marks: MarkLite[], v: Viewport, x: number, tolPx = 6): string | null => {
  let best: string | null = null
  let bestD = tolPx + 1
  for (const m of marks) {
    const d = Math.abs(msToPx(v, m.t_ms) - x)
    if (d < bestD) { bestD = d; best = m.id }
  }
  return bestD <= tolPx ? best : null
}

export const zoomed = (v: Viewport, factor: number, focusMs: number, durationMs: number): Viewport => {
  const span = (v.endMs - v.startMs) * factor
  const clamped = Math.min(Math.max(span, 500), durationMs)
  let start = focusMs - (focusMs - v.startMs) * (clamped / (v.endMs - v.startMs))
  start = Math.max(0, Math.min(start, durationMs - clamped))
  return { ...v, startMs: Math.round(start), endMs: Math.round(start + clamped) }
}

export const panned = (v: Viewport, deltaMs: number, durationMs: number): Viewport => {
  const span = v.endMs - v.startMs
  const start = Math.max(0, Math.min(v.startMs + deltaMs, durationMs - span))
  return { ...v, startMs: Math.round(start), endMs: Math.round(start + span) }
}

/** holding 勾选切换 → 应发给后端的 patch（勾选 = from 的键按住到 to 时刻） */
export const holdingPatch = (
  iv: Interval, checked: boolean,
): { markId: string; patch: { end_ms?: number; clear_end?: boolean } } =>
  checked
    ? { markId: iv.fromId, patch: { end_ms: iv.endMs } }
    : { markId: iv.fromId, patch: { clear_end: true } }

export interface Rect { x: number; y: number; w: number; h: number }

export const checkboxRect = (midMs: number, v: Viewport, laneY: number): Rect =>
  ({ x: msToPx(v, midMs) - 5, y: laneY + LANE_H / 2 + 10, w: 10, h: 10 })

export const inRect = (r: Rect, px: number, py: number): boolean =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
```

- [ ] **Step 4: 运行确认通过**

```bash
cd frontend && pnpm test
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add frontend/src/time frontend/src/timeline
git commit -m "feat(frontend): frame math and timeline layout pure functions"
```

---

### 任务 15：会话 store（Zustand）

**Files:**
- Create: `frontend/src/state/store.ts`
- Create: `frontend/src/state/store.test.ts`

**Interfaces:**
- Consumes: `api/types.ts`
- Produces: `useSession`（状态：`analysis / laneId / takeId / selectedMarkId / playheadMs / entryMode / showAggregate`；动作：`setAnalysis / selectLane / selectTake / addTakeLocal / setPlayhead / selectMark / insertMarkLocal / updateMarkLocal / removeMarkLocal / addTallyLocal / clearTallyLocal / toggleEntryMode / toggleAggregate`）、选择器 `currentTake(s)`

- [ ] **Step 1: 写失败测试**

`frontend/src/state/store.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest'
import type { AnalysisTree, Mark } from '../api/types'
import { currentTake, useSession } from './store'

const tree: AnalysisTree = {
  id: 'an_1', video_id: 'vid_1', name: 'video-1_km-default-v1_a1',
  lanes: [
    { id: 'ln_0', layer: 'L0', takes: [{ id: 'tk_a', idx: 1, marks: [] }, { id: 'tk_b', idx: 2, marks: [] }] },
    { id: 'ln_1', layer: 'L1', takes: [{ id: 'tk_c', idx: 1, marks: [] }] },
  ],
  tally: [],
}
const mark = (id: string, t: number): Mark =>
  ({ id, take_id: 'tk_a', t_ms: t, end_ms: null, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 })

beforeEach(() => useSession.getState().setAnalysis(structuredClone(tree)))

test('setAnalysis selects first lane and its latest take', () => {
  const s = useSession.getState()
  expect(s.laneId).toBe('ln_0')
  expect(s.takeId).toBe('tk_b')
})

test('selectLane switches to its latest take', () => {
  useSession.getState().selectLane('ln_1')
  expect(useSession.getState().takeId).toBe('tk_c')
})

test('insertMarkLocal keeps marks sorted and selects it', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m2', 500))
  s.insertMarkLocal(mark('m1', 100))
  const take = currentTake(useSession.getState())!
  expect(take.marks.map(m => m.id)).toEqual(['m1', 'm2'])
  expect(useSession.getState().selectedMarkId).toBe('m1')
})

test('updateMarkLocal re-sorts after time change', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m1', 100))
  s.insertMarkLocal(mark('m2', 500))
  s.updateMarkLocal({ ...mark('m1', 900) })
  expect(currentTake(useSession.getState())!.marks.map(m => m.id)).toEqual(['m2', 'm1'])
})

test('removeMarkLocal clears selection if selected', () => {
  const s = useSession.getState()
  s.selectTake('tk_a')
  s.insertMarkLocal(mark('m1', 100))
  s.removeMarkLocal('m1')
  expect(currentTake(useSession.getState())!.marks).toEqual([])
  expect(useSession.getState().selectedMarkId).toBeNull()
})

test('tally local ops keep sorted', () => {
  const s = useSession.getState()
  s.addTallyLocal({ id: 't2', t_ms: 500 })
  s.addTallyLocal({ id: 't1', t_ms: 100 })
  expect(useSession.getState().analysis!.tally.map(t => t.id)).toEqual(['t1', 't2'])
  s.clearTallyLocal()
  expect(useSession.getState().analysis!.tally).toEqual([])
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现**

`frontend/src/state/store.ts`:

```ts
import { create } from 'zustand'
import type { AnalysisTree, Mark, Take, Tally } from '../api/types'

export interface Session {
  analysis: AnalysisTree | null
  laneId: string | null
  takeId: string | null
  selectedMarkId: string | null
  playheadMs: number
  entryMode: boolean
  showAggregate: boolean

  setAnalysis: (a: AnalysisTree) => void
  selectLane: (laneId: string) => void
  selectTake: (takeId: string) => void
  addTakeLocal: (laneId: string, take: Take) => void
  setPlayhead: (ms: number) => void
  selectMark: (id: string | null) => void
  insertMarkLocal: (m: Mark) => void
  updateMarkLocal: (m: Mark) => void
  removeMarkLocal: (id: string) => void
  addTallyLocal: (t: Tally) => void
  clearTallyLocal: () => void
  toggleEntryMode: () => void
  toggleAggregate: () => void
}

const mapMarks = (a: AnalysisTree, takeId: string, f: (marks: Mark[]) => Mark[]): AnalysisTree => ({
  ...a,
  lanes: a.lanes.map(l => ({
    ...l,
    takes: l.takes.map(t => (t.id === takeId ? { ...t, marks: f(t.marks) } : t)),
  })),
})

const byT = <T extends { t_ms: number }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.t_ms - b.t_ms)

export const useSession = create<Session>((set, get) => ({
  analysis: null, laneId: null, takeId: null, selectedMarkId: null,
  playheadMs: 0, entryMode: false, showAggregate: false,

  setAnalysis: a => {
    const lane = a.lanes[0] ?? null
    const take = lane ? lane.takes[lane.takes.length - 1] : null
    set({ analysis: a, laneId: lane?.id ?? null, takeId: take?.id ?? null, selectedMarkId: null })
  },
  selectLane: laneId => {
    const lane = get().analysis?.lanes.find(l => l.id === laneId)
    const take = lane?.takes[lane.takes.length - 1]
    set({ laneId, takeId: take?.id ?? null, selectedMarkId: null })
  },
  selectTake: takeId => set({ takeId, selectedMarkId: null }),
  addTakeLocal: (laneId, take) =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l =>
          l.id === laneId ? { ...l, takes: [...l.takes, take] } : l),
      },
      laneId, takeId: take.id, selectedMarkId: null,
    })),
  setPlayhead: ms => set({ playheadMs: ms }),
  selectMark: id => set({ selectedMarkId: id }),
  insertMarkLocal: m =>
    set(s => ({
      analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks => byT([...marks, m])),
      selectedMarkId: m.id,
    })),
  updateMarkLocal: m =>
    set(s => ({
      analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks =>
        byT(marks.map(x => (x.id === m.id ? m : x)))),
    })),
  removeMarkLocal: id =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l => ({
          ...l,
          takes: l.takes.map(t => ({ ...t, marks: t.marks.filter(m => m.id !== id) })),
        })),
      },
      selectedMarkId: s.selectedMarkId === id ? null : s.selectedMarkId,
    })),
  addTallyLocal: t =>
    set(s => ({
      analysis: s.analysis && { ...s.analysis, tally: byT([...s.analysis.tally, t]) },
    })),
  clearTallyLocal: () =>
    set(s => ({ analysis: s.analysis && { ...s.analysis, tally: [] } })),
  toggleEntryMode: () => set(s => ({ entryMode: !s.entryMode })),
  toggleAggregate: () => set(s => ({ showAggregate: !s.showAggregate })),
}))

export const currentTake = (s: Session): Take | null => {
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  return lane?.takes.find(t => t.id === s.takeId) ?? null
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd frontend && pnpm test
```

预期：全部通过

- [ ] **Step 5: 提交**

```bash
git add frontend/src/state
git commit -m "feat(frontend): zustand session store"
```

---

### 任务 16：播放器与工作台骨架

**Files:**
- Create: `frontend/src/player/Player.tsx`
- Create: `frontend/src/hotkeys.ts`
- Modify: `frontend/src/App.tsx`（全量替换为下述内容）

**Interfaces:**
- Consumes: `api`、`useSession`、`frames.stepFrame`
- Produces:
  - `Player({ videoId, fps, durationMs })` 组件；`videoEl(): HTMLVideoElement | null`；`frameStep(dir, fps, durationMs)`；`seekMs(tMs)`（后续任务用来点击跳转）
  - `useHotkeys(video)`：空格播放/暂停、`[` `]` 逐帧（后续任务在此追加分支）
  - `App` 含 `Workbench({ video, onBack })`（组件挂载点注释指明后续任务插入位置）

- [ ] **Step 1: 实现 Player**

`frontend/src/player/Player.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { useSession } from '../state/store'
import { stepFrame } from '../time/frames'

const RATES = [0.25, 0.5, 1, 2]

export function videoEl(): HTMLVideoElement | null {
  return document.getElementById('vd-video') as HTMLVideoElement | null
}

export function frameStep(dir: 1 | -1, fps: number, durationMs: number): void {
  const v = videoEl()
  if (!v) return
  v.pause()
  v.currentTime = stepFrame(v.currentTime, fps, dir, durationMs / 1000)
}

export function seekMs(tMs: number): void {
  const v = videoEl()
  if (v) v.currentTime = tMs / 1000
}

export function Player({ videoId, fps, durationMs }: { videoId: string; fps: number; durationMs: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  const setPlayhead = useSession(s => s.setPlayhead)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    let handle = 0
    const loop = (_now: number, meta: VideoFrameCallbackMetadata) => {
      setPlayhead(meta.mediaTime * 1000)
      handle = v.requestVideoFrameCallback(loop)
    }
    handle = v.requestVideoFrameCallback(loop)
    return () => v.cancelVideoFrameCallback(handle)
  }, [setPlayhead, videoId])

  return (
    <div className="player">
      <video ref={ref} id="vd-video" src={api.videoFileUrl(videoId)} />
      <div className="player-controls">
        {RATES.map(r => (
          <button key={r} onClick={() => { const v = videoEl(); if (v) v.playbackRate = r }}>
            {r}×
          </button>
        ))}
        <button onClick={() => frameStep(-1, fps, durationMs)}>◀ 上一帧 [</button>
        <button onClick={() => frameStep(1, fps, durationMs)}>] 下一帧 ▶</button>
      </div>
    </div>
  )
}
```

`frontend/src/hotkeys.ts`:

```ts
import { useEffect } from 'react'
import type { Video } from './api/types'
import { frameStep, videoEl } from './player/Player'

export function useHotkeys(video: Video): void {
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === ' ') {
        e.preventDefault()
        const v = videoEl()
        if (v) v.paused ? void v.play() : v.pause()
      } else if (e.key === '[') {
        frameStep(-1, fps, durationMs)
      } else if (e.key === ']') {
        frameStep(1, fps, durationMs)
      }
      // 后续任务在此追加：, . Delete（任务 19）；录入模式与 E（任务 20）；T（任务 21）；A（任务 22）
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fps, durationMs])
}
```

`frontend/src/App.tsx`（全量替换）:

```tsx
import { useEffect, useState } from 'react'
import { api } from './api/client'
import type { Video } from './api/types'
import { useHotkeys } from './hotkeys'
import { Player } from './player/Player'
import { useSession } from './state/store'

function Workbench({ video, onBack }: { video: Video; onBack: () => void }) {
  const analysis = useSession(s => s.analysis)
  const setAnalysis = useSession(s => s.setAnalysis)
  useHotkeys(video)

  useEffect(() => {
    api.listAnalyses(video.id)
      .then(list => (list.length ? api.getAnalysis(list[0].id) : api.createAnalysis(video.id)))
      .then(setAnalysis)
  }, [video.id, setAnalysis])

  if (!analysis) return <p>加载中…</p>
  return (
    <div className="workbench">
      <div className="main">
        <p><button onClick={onBack}>← 返回</button> {analysis.name}</p>
        <Player videoId={video.id} fps={video.fps ?? 30} durationMs={video.duration_ms ?? 0} />
        {/* 后续任务在此依次挂载：TallyBar（21）、ThumbStrip（17）、Timeline（18）*/}
      </div>
      {/* EntryPanel（任务 20）挂载于此 */}
    </div>
  )
}

export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  useEffect(() => { api.listVideos().then(setVideos) }, [])

  if (video) return <Workbench video={video} onBack={() => setVideo(null)} />
  return (
    <div className="library">
      <h1>Video Distiller</h1>
      <ul>
        {videos.map(v => (
          <li key={v.id}>
            video-{v.seq} {v.name}（{v.status}）
            <button disabled={v.status !== 'ready'} onClick={() => setVideo(v)}>打开</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查与测试**

```bash
cd frontend && pnpm build && pnpm test
```

预期：均通过

- [ ] **Step 3: 手动验证**

后端起 `uv run --project backend uvicorn vd.api:app --port 8000`，前端起 `pnpm --dir frontend dev`；用 curl 上传测试视频：

```bash
ffmpeg -y -f lavfi -i "testsrc=duration=10:size=640x360:rate=30" -pix_fmt yuv420p /tmp/t.mp4 && curl -F "file=@/tmp/t.mp4" http://localhost:8000/api/videos/upload
```

浏览器打开 `http://localhost:5173`：视频出现在列表且 status=ready → 打开 → 视频可播放；四个速率按钮生效；`[` `]` 逐帧步进画面确实逐帧变化；空格播放/暂停。

- [ ] **Step 4: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): player with frame stepping and workbench shell"
```

---

### 任务 17：缩略图带

**Files:**
- Create: `frontend/src/strip/ThumbStrip.tsx`
- Modify: `frontend/src/App.tsx`（Workbench 挂载 ThumbStrip）

**Interfaces:**
- Consumes: `api.spriteUrl`、`seekMs`、`useSession(playheadMs)`
- Produces: `ThumbStrip({ video })`——sprite 横向滚动条 + 播放头红线，点击跳转

- [ ] **Step 1: 实现**

`frontend/src/strip/ThumbStrip.tsx`:

```tsx
import { api } from '../api/client'
import type { Video } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'

export function ThumbStrip({ video }: { video: Video }) {
  const playheadMs = useSession(s => s.playheadMs)
  const count = video.sprite_count ?? 1
  const thumbW = video.thumb_w ?? 96
  const thumbH = video.thumb_h ?? 54
  const w = thumbW * count
  const durationMs = video.duration_ms ?? 1
  const x = (playheadMs / durationMs) * w

  return (
    <div
      className="strip"
      style={{ overflowX: 'auto', position: 'relative', height: thumbH }}
      onClick={e => {
        const el = e.currentTarget
        const px = e.clientX - el.getBoundingClientRect().left + el.scrollLeft
        seekMs((px / w) * durationMs)
      }}
    >
      <img src={api.spriteUrl(video.id)} width={w} height={thumbH} draggable={false} alt="缩略图带" />
      <div style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 2, background: 'red' }} />
    </div>
  )
}
```

在 `frontend/src/App.tsx` 的 Workbench 中，`<Player …/>` 之后挂载（并加 import `{ ThumbStrip } from './strip/ThumbStrip'`）：

```tsx
        <ThumbStrip video={video} />
```

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm build
```

- [ ] **Step 3: 手动验证**

工作台中缩略图带显示；播放时红线随进度移动；点击某处播放器跳到对应时刻。

- [ ] **Step 4: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): thumbnail strip with click-to-seek"
```

---

### 任务 18：泳道时间轴渲染

**Files:**
- Create: `frontend/src/timeline/draw.ts`
- Create: `frontend/src/timeline/Timeline.tsx`（本任务只渲染；交互在任务 19）
- Modify: `frontend/src/App.tsx`（Workbench 挂载 Timeline）

**Interfaces:**
- Consumes: `layout.*`（全部几何计算）、`useSession`、`fmtTc`
- Produces:
  - `draw(ctx, data: TimelineData)`：`TimelineData = { lanes, currentLaneId, currentTakeId, selectedMarkId, playheadMs, tally, aggregate, viewport }`
  - `timelineHeight(laneCount)`
  - `Timeline({ video, aggregate })` 组件（viewport 状态内置：初始 0–10s，播放头出视口自动跟随平移）

- [ ] **Step 1: 实现 draw.ts**

`frontend/src/timeline/draw.ts`:

```ts
import type { Aggregate, Lane, Tally } from '../api/types'
import { fmtTc } from '../time/frames'
import {
  checkboxRect, intervals, LANE_H, msToPx, TOP_H, type Viewport,
} from './layout'

export interface TimelineData {
  lanes: Lane[]
  currentLaneId: string | null
  currentTakeId: string | null
  selectedMarkId: string | null
  playheadMs: number
  tally: Tally[]
  aggregate: Aggregate | null
  viewport: Viewport
}

export function timelineHeight(laneCount: number): number {
  return TOP_H + laneCount * LANE_H
}

export function draw(ctx: CanvasRenderingContext2D, d: TimelineData): void {
  const v = d.viewport
  ctx.clearRect(0, 0, v.widthPx, timelineHeight(d.lanes.length))
  ctx.font = '11px system-ui'

  // 打表 marker：顶部黄色小三角
  ctx.fillStyle = '#e6b800'
  for (const t of d.tally) {
    const x = msToPx(v, t.t_ms)
    ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 8); ctx.fill()
  }

  d.lanes.forEach((lane, i) => {
    const laneY = TOP_H + i * LANE_H
    const midY = laneY + LANE_H / 2
    ctx.strokeStyle = '#333'
    ctx.strokeRect(0, laneY, v.widthPx, LANE_H)
    ctx.fillStyle = lane.id === d.currentLaneId ? '#9cf' : '#777'
    ctx.fillText(lane.layer, 4, laneY + 12)

    const current = lane.takes.find(t => t.id === d.currentTakeId)

    // 其余 Take：幽灵刻度（泳道底部灰色细线）
    ctx.fillStyle = 'rgba(150,150,150,0.35)'
    for (const take of lane.takes) {
      if (take.id === d.currentTakeId) continue
      for (const m of take.marks) ctx.fillRect(msToPx(v, m.t_ms) - 1, laneY + LANE_H - 10, 2, 8)
    }

    if (current) {
      // 区间：Δms 常驻显示 + holding 勾选框（spec §6.3/§6.5）
      for (const iv of intervals(current.marks)) {
        const x1 = msToPx(v, iv.startMs)
        const x2 = msToPx(v, iv.endMs)
        const mx = msToPx(v, iv.midMs)
        if (iv.holding) {
          ctx.fillStyle = 'rgba(80,160,255,0.35)'
          ctx.fillRect(x1, midY - 8, x2 - x1, 16)
        }
        ctx.fillStyle = '#aaa'
        ctx.fillText(`${iv.deltaMs}ms`, mx - 14, midY - 14)
        const r = checkboxRect(iv.midMs, v, laneY)
        ctx.strokeStyle = iv.holding ? '#5af' : '#666'
        ctx.strokeRect(r.x, r.y, r.w, r.h)
        if (iv.holding) { ctx.fillStyle = '#5af'; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4) }
      }
      // 标记：input 圆点+标签；release（空标记）灰点
      for (const m of current.marks) {
        const x = msToPx(v, m.t_ms)
        const sel = m.id === d.selectedMarkId
        ctx.fillStyle = m.kind === 'release' ? '#888' : sel ? '#ffd54a' : '#6cf'
        ctx.beginPath(); ctx.arc(x, midY, sel ? 6 : 4, 0, Math.PI * 2); ctx.fill()
        if (m.label) { ctx.fillStyle = '#ddd'; ctx.fillText(m.label, x + 6, midY + 4) }
      }
    }

    // 聚合叠加（任务 22 传入 aggregate 后生效）：IQR 带 + 少数派橙标
    if (d.aggregate && lane.id === d.currentLaneId) {
      for (const am of d.aggregate.aggregated) {
        const x1 = msToPx(v, am.t_ms - am.iqr_ms)
        const x2 = msToPx(v, am.t_ms + am.iqr_ms)
        ctx.fillStyle = 'rgba(120,220,120,0.5)'
        ctx.fillRect(x1, laneY + LANE_H - 6, Math.max(2, x2 - x1), 4)
      }
      for (const am of d.aggregate.minority) {
        ctx.fillStyle = 'rgba(255,140,0,0.9)'
        ctx.fillRect(msToPx(v, am.t_ms) - 2, laneY + LANE_H - 8, 4, 8)
      }
    }
  })

  // 播放头
  ctx.strokeStyle = 'red'
  const px = msToPx(v, d.playheadMs)
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, timelineHeight(d.lanes.length)); ctx.stroke()

  // 视口起止时码
  ctx.fillStyle = '#888'
  ctx.fillText(fmtTc(v.startMs), 2, TOP_H - 4)
  ctx.fillText(fmtTc(v.endMs), v.widthPx - 70, TOP_H - 4)
}
```

- [ ] **Step 2: 实现 Timeline 组件（仅渲染）**

`frontend/src/timeline/Timeline.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Aggregate, Video } from '../api/types'
import { useSession } from '../state/store'
import { draw, timelineHeight } from './draw'
import type { Viewport } from './layout'

export function Timeline({ video, aggregate }: { video: Video; aggregate: Aggregate | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const s = useSession()
  const durationMs = video.duration_ms ?? 10_000
  const [viewport, setViewport] = useState<Viewport>({
    startMs: 0, endMs: Math.min(10_000, durationMs), widthPx: 800,
  })

  // 播放头出视口 → 自动跟随
  useEffect(() => {
    if (s.playheadMs < viewport.startMs || s.playheadMs > viewport.endMs) {
      const span = viewport.endMs - viewport.startMs
      const start = Math.max(0, Math.min(s.playheadMs - span / 4, durationMs - span))
      setViewport(v => ({ ...v, startMs: Math.round(start), endMs: Math.round(start + span) }))
    }
  }, [s.playheadMs])  // eslint-disable-line react-hooks/exhaustive-deps

  // 每次渲染重绘（store 订阅驱动）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !s.analysis) return
    const width = canvas.parentElement?.clientWidth ?? 800
    const v = { ...viewport, widthPx: width }
    const h = timelineHeight(s.analysis.lanes.length)
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = h * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    draw(ctx, {
      lanes: s.analysis.lanes,
      currentLaneId: s.laneId,
      currentTakeId: s.takeId,
      selectedMarkId: s.selectedMarkId,
      playheadMs: s.playheadMs,
      tally: s.analysis.tally,
      aggregate,
      viewport: v,
    })
  })

  if (!s.analysis) return null
  return <canvas ref={canvasRef} />
}
```

在 `frontend/src/App.tsx` 的 Workbench 中，ThumbStrip 之后挂载（import `{ Timeline } from './timeline/Timeline'`）：

```tsx
        <Timeline video={video} aggregate={null} />
```

- [ ] **Step 3: 类型检查与手动验证**

```bash
cd frontend && pnpm build
```

浏览器中：时间轴出现三条泳道（L0 高亮为当前）；播放头红线随播放移动，出视口后视口跟随；顶部显示视口起止时码。（此时还没有标记——正确，录入在任务 20。）

- [ ] **Step 4: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): lane timeline canvas rendering"
```

---

### 任务 19：时间轴交互

**Files:**
- Create: `frontend/src/actions.ts`
- Create: `frontend/src/actions.test.ts`
- Modify: `frontend/src/timeline/Timeline.tsx`（追加 onClick / onWheel）
- Modify: `frontend/src/hotkeys.ts`（追加 `,` `.` `Delete` 分支）

**Interfaces:**
- Consumes: `api`、`useSession`、`layout.*`
- Produces: `actions.nudgeSelected(deltaMs)`、`actions.deleteSelected()`、`actions.toggleHolding(markId, patch)`（后续任务追加更多动作到同一文件）
- 交互契约：点击别的泳道 = 切换当前泳道；点击勾选框 = holding 切换；点击标记 = 选中并跳转到其时刻；滚轮 = 平移，Ctrl/⌘+滚轮 = 缩放；`,` `.` = 选中标记 ±10ms；`Delete`/`Backspace` = 删除选中

- [ ] **Step 1: 写失败测试**

`frontend/src/actions.test.ts`:

```ts
import { beforeEach, expect, test, vi } from 'vitest'
import type { AnalysisTree, Mark } from './api/types'
import { useSession } from './state/store'

vi.mock('./api/client', () => ({
  api: {
    patchMark: vi.fn((id: string, patch: Record<string, unknown>) =>
      Promise.resolve({
        id, take_id: 'tk_a', t_ms: (patch.t_ms as number) ?? 100,
        end_ms: patch.clear_end ? null : (patch.end_ms as number) ?? null,
        kind: 'input', label: '2', provenance: 'human_edited', confidence: 1,
      } satisfies Mark)),
    deleteMark: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

import { deleteSelected, nudgeSelected, toggleHolding } from './actions'
import { api } from './api/client'

const tree: AnalysisTree = {
  id: 'an_1', video_id: 'v', name: 'n', tally: [],
  lanes: [{
    id: 'ln_0', layer: 'L0',
    takes: [{
      id: 'tk_a', idx: 1,
      marks: [{ id: 'm1', take_id: 'tk_a', t_ms: 100, end_ms: null, kind: 'input', label: '2', provenance: 'human_manual', confidence: 1 }],
    }],
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  useSession.getState().setAnalysis(structuredClone(tree))
  useSession.getState().selectMark('m1')
})

test('nudgeSelected patches t_ms and updates store', async () => {
  await nudgeSelected(10)
  expect(api.patchMark).toHaveBeenCalledWith('m1', { t_ms: 110 })
  const take = useSession.getState().analysis!.lanes[0].takes[0]
  expect(take.marks[0].t_ms).toBe(110)
})

test('deleteSelected removes mark', async () => {
  await deleteSelected()
  expect(api.deleteMark).toHaveBeenCalledWith('m1')
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks).toEqual([])
})

test('toggleHolding applies patch result', async () => {
  await toggleHolding('m1', { end_ms: 400 })
  expect(useSession.getState().analysis!.lanes[0].takes[0].marks[0].end_ms).toBe(400)
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

预期：FAIL（`./actions` 不存在）

- [ ] **Step 3: 实现 actions.ts**

`frontend/src/actions.ts`:

```ts
import { api } from './api/client'
import { currentTake, useSession } from './state/store'

export async function nudgeSelected(deltaMs: number): Promise<void> {
  const s = useSession.getState()
  const mark = currentTake(s)?.marks.find(m => m.id === s.selectedMarkId)
  if (!mark) return
  const updated = await api.patchMark(mark.id, { t_ms: mark.t_ms + deltaMs })
  useSession.getState().updateMarkLocal(updated)
}

export async function deleteSelected(): Promise<void> {
  const s = useSession.getState()
  if (!s.selectedMarkId) return
  await api.deleteMark(s.selectedMarkId)
  useSession.getState().removeMarkLocal(s.selectedMarkId)
}

export async function toggleHolding(
  markId: string, patch: { end_ms?: number; clear_end?: boolean },
): Promise<void> {
  const updated = await api.patchMark(markId, patch)
  useSession.getState().updateMarkLocal(updated)
}
```

- [ ] **Step 4: Timeline 追加交互**

在 `frontend/src/timeline/Timeline.tsx` 中：import 追加 `{ toggleHolding } from '../actions'`、`{ seekMs } from '../player/Player'`、以及从 `./layout` 追加 `{ checkboxRect, hitTestMark, holdingPatch, inRect, intervals, LANE_H, panned, pxToMs, TOP_H, zoomed }`。组件内追加两个处理器并绑到 canvas：

```tsx
  const vp = (): Viewport =>
    ({ ...viewport, widthPx: canvasRef.current?.parentElement?.clientWidth ?? 800 })

  const onClick = (e: React.MouseEvent) => {
    const a = s.analysis
    const canvas = canvasRef.current
    if (!a || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const yPos = e.clientY - rect.top
    const laneIdx = Math.floor((yPos - TOP_H) / LANE_H)
    const lane = a.lanes[laneIdx]
    if (!lane) return
    if (lane.id !== s.laneId) { s.selectLane(lane.id); return }
    const take = lane.takes.find(t => t.id === s.takeId)
    if (!take) return
    const v = vp()
    for (const iv of intervals(take.marks)) {
      if (inRect(checkboxRect(iv.midMs, v, TOP_H + laneIdx * LANE_H), x, yPos)) {
        const { markId, patch } = holdingPatch(iv, !iv.holding)
        void toggleHolding(markId, patch)
        return
      }
    }
    const hit = hitTestMark(take.marks, v, x)
    s.selectMark(hit)
    if (hit) {
      const m = take.marks.find(mm => mm.id === hit)!
      seekMs(m.t_ms)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const v = vp()
    const rect = canvasRef.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      setViewport(zoomed(v, e.deltaY > 0 ? 1.25 : 0.8, pxToMs(v, e.clientX - rect.left), durationMs))
    } else {
      setViewport(panned(v, Math.round((e.deltaY + e.deltaX) * (v.endMs - v.startMs) / 1000), durationMs))
    }
  }
```

canvas 标签改为：

```tsx
  return <canvas ref={canvasRef} onClick={onClick} onWheel={onWheel} />
```

- [ ] **Step 5: hotkeys 追加分支**

在 `frontend/src/hotkeys.ts` 的 `]` 分支后追加（import 追加 `{ deleteSelected, nudgeSelected } from './actions'`）：

```ts
      } else if (e.key === ',') {
        void nudgeSelected(-10)
      } else if (e.key === '.') {
        void nudgeSelected(10)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        void deleteSelected()
```

- [ ] **Step 6: 测试与类型检查**

```bash
cd frontend && pnpm test && pnpm build
```

预期：均通过

- [ ] **Step 7: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): timeline interactions with holding toggle and nudge"
```

---

### 任务 20：录入面板与录入模式

**Files:**
- Create: `frontend/src/panel/EntryPanel.tsx`
- Modify: `frontend/src/actions.ts`（追加 `insertAtPlayhead`）
- Modify: `frontend/src/actions.test.ts`（追加测试）
- Modify: `frontend/src/hotkeys.ts`（追加录入模式与 `E` 分支）
- Modify: `frontend/src/App.tsx`（Workbench 挂载 EntryPanel）

**Interfaces:**
- Consumes: `api.newMark`、`api.newTake`、`useSession`
- Produces: `actions.insertAtPlayhead(kind, label)`、`EntryPanel()` 组件
- 交互契约（spec §6.3，Q7/Q11 决议）：L0 = 键按钮网格 + 空标记按钮 + 「录入模式」勾选（勾选后直接敲字母/数字键即插入打点；`E` 只能**开启**——录入模式中字母键全部是打点，退出用面板勾选框）；L1/L2 = 技能名输入框（datalist 提示既有名字）+ Enter/按钮插入；泳道 radio 切换；Take 按钮切换 + 新建

- [ ] **Step 1: 追加失败测试**

在 `frontend/src/actions.test.ts` 的 `vi.mock` 工厂中追加 `newMark`：

```ts
    newMark: vi.fn((takeId: string, m: Record<string, unknown>) =>
      Promise.resolve({
        id: 'mk_new', take_id: takeId, t_ms: m.t_ms as number, end_ms: null,
        kind: m.kind as 'input' | 'release', label: (m.label as string) ?? null,
        provenance: 'human_manual', confidence: 1,
      } satisfies Mark)),
```

测试文件追加：

```ts
test('insertAtPlayhead posts mark at current playhead into current take', async () => {
  useSession.getState().setPlayhead(1234.6)
  const { insertAtPlayhead } = await import('./actions')
  await insertAtPlayhead('input', 'Q')
  expect(api.newMark).toHaveBeenCalledWith('tk_a', { t_ms: 1235, kind: 'input', label: 'Q' })
  const marks = useSession.getState().analysis!.lanes[0].takes[0].marks
  expect(marks.some(m => m.id === 'mk_new')).toBe(true)
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

预期：FAIL（`insertAtPlayhead` 不存在）

- [ ] **Step 3: 实现**

在 `frontend/src/actions.ts` 追加：

```ts
export async function insertAtPlayhead(
  kind: 'input' | 'release', label: string | null,
): Promise<void> {
  const s = useSession.getState()
  if (!s.takeId) return
  const mark = await api.newMark(s.takeId, {
    t_ms: Math.round(s.playheadMs), kind, label,
  })
  useSession.getState().insertMarkLocal(mark)
}
```

`frontend/src/panel/EntryPanel.tsx`:

```tsx
import { useState } from 'react'
import { insertAtPlayhead } from '../actions'
import { api } from '../api/client'
import { useSession } from '../state/store'

const L0_KEYS = ['1', '2', '3', '4', '5', 'Q', 'W', 'E', 'R', 'F', 'G', 'Tab', 'LMB', 'RMB', 'Wheel']

export function EntryPanel() {
  const s = useSession()
  const [skillName, setSkillName] = useState('')
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  if (!s.analysis || !lane) return null

  const usedLabels = [...new Set(
    lane.takes.flatMap(t => t.marks.map(m => m.label)).filter((x): x is string => !!x))]

  return (
    <div className="entry-panel">
      <div>
        {s.analysis.lanes.map(l => (
          <label key={l.id} style={{ marginRight: 8 }}>
            <input type="radio" checked={l.id === s.laneId} onChange={() => s.selectLane(l.id)} />
            {l.layer}
          </label>
        ))}
      </div>
      <div>
        Take：
        {lane.takes.map(t => (
          <button key={t.id} className={t.id === s.takeId ? 'active' : ''}
            onClick={() => s.selectTake(t.id)}>#{t.idx}</button>
        ))}
        <button onClick={async () => {
          const take = await api.newTake(lane.id)
          s.addTakeLocal(lane.id, take)
        }}>+ 新 Take</button>
      </div>
      {lane.layer === 'L0' ? (
        <div className="keys">
          {L0_KEYS.map(k => (
            <button key={k} onClick={() => void insertAtPlayhead('input', k)}>{k}</button>
          ))}
          <button onClick={() => void insertAtPlayhead('release', null)}>空标记</button>
          <p>
            <label>
              <input type="checkbox" checked={s.entryMode} onChange={s.toggleEntryMode} />
              录入模式（直接敲键盘打点；退出请取消本勾选）
            </label>
          </p>
        </div>
      ) : (
        <div>
          <input list="used-labels" placeholder="技能名" value={skillName}
            onChange={e => setSkillName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && skillName) void insertAtPlayhead('input', skillName)
            }} />
          <datalist id="used-labels">
            {usedLabels.map(l => <option key={l} value={l} />)}
          </datalist>
          <button disabled={!skillName}
            onClick={() => void insertAtPlayhead('input', skillName)}>插入</button>
        </div>
      )}
    </div>
  )
}
```

在 `frontend/src/hotkeys.ts` 中：import 追加 `{ insertAtPlayhead } from './actions'` 与 `{ useSession } from './state/store'`。在 `onKey` 函数体**最前面**（空格分支之前）插入录入模式拦截，并在 `Delete` 分支后追加 `E`：

```ts
      const st = useSession.getState()
      if (st.entryMode && /^[a-z0-9]$/i.test(e.key)) {
        // 录入模式下字母/数字优先作为 L0 打点，不再触发其他单键快捷键
        e.preventDefault()
        void insertAtPlayhead('input', e.key.toUpperCase())
        return
      }
```

```ts
      } else if (e.key === 'e' || e.key === 'E') {
        st.toggleEntryMode()
```

在 `frontend/src/App.tsx` 的 Workbench 中，`</div>`（main 列结束）之后挂载（import `{ EntryPanel } from './panel/EntryPanel'`）：

```tsx
      <EntryPanel />
```

- [ ] **Step 4: 测试与类型检查**

```bash
cd frontend && pnpm test && pnpm build
```

预期：均通过

- [ ] **Step 5: 手动验证**

播放 → 空格暂停 → 点 L0 键按钮 → 时间轴当前帧出现圆点与键名；两个点之间显示 Δms；点勾选框 → 蓝色 hold 带出现；勾选录入模式后直接敲 `2` 键立即打点；切 L1 泳道输入技能名回车插入；+ 新 Take 后泳道显示新 Take（旧 Take 变幽灵刻度）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): entry panel with point-mark annotation and entry mode"
```

---

### 任务 21：打表计时条

**Files:**
- Create: `frontend/src/tally/TallyBar.tsx`
- Modify: `frontend/src/actions.ts`（追加 `tallyAtPlayhead`）
- Modify: `frontend/src/actions.test.ts`（追加测试）
- Modify: `frontend/src/hotkeys.ts`（追加 `T` 分支）
- Modify: `frontend/src/App.tsx`（Player 之后挂载 TallyBar）

**Interfaces:**
- Consumes: `api.addTally / clearTally`、`useSession`、`fmtTc`
- Produces: `actions.tallyAtPlayhead()`、`TallyBar()`（常驻显示：当前时码 ms 精度、Δ 上一标记、最近两个打表 marker 的间隔、清空按钮；spec §6.5——marker 随 Analysis 持久化，时间轴顶部黄三角由任务 18 的 draw 渲染）

- [ ] **Step 1: 追加失败测试**

在 `frontend/src/actions.test.ts` 的 `vi.mock` 工厂追加：

```ts
    addTally: vi.fn((analysisId: string, t_ms: number) =>
      Promise.resolve({ id: 'tm_new', analysis_id: analysisId, t_ms })),
```

测试追加：

```ts
test('tallyAtPlayhead posts marker and stores locally', async () => {
  useSession.getState().setPlayhead(2500.2)
  const { tallyAtPlayhead } = await import('./actions')
  await tallyAtPlayhead()
  expect(api.addTally).toHaveBeenCalledWith('an_1', 2500)
  expect(useSession.getState().analysis!.tally.map(t => t.t_ms)).toEqual([2500])
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

预期：FAIL

- [ ] **Step 3: 实现**

在 `frontend/src/actions.ts` 追加：

```ts
export async function tallyAtPlayhead(): Promise<void> {
  const s = useSession.getState()
  if (!s.analysis) return
  const t = await api.addTally(s.analysis.id, Math.round(s.playheadMs))
  useSession.getState().addTallyLocal(t)
}
```

`frontend/src/tally/TallyBar.tsx`:

```tsx
import { tallyAtPlayhead } from '../actions'
import { api } from '../api/client'
import { currentTake, useSession } from '../state/store'
import { fmtTc } from '../time/frames'

export function TallyBar() {
  const s = useSession()
  const take = currentTake(s)
  const prev = take ? [...take.marks].reverse().find(m => m.t_ms <= s.playheadMs) : undefined
  const tally = s.analysis?.tally ?? []
  const lastGap = tally.length >= 2
    ? tally[tally.length - 1].t_ms - tally[tally.length - 2].t_ms
    : null

  return (
    <div className="tally-bar">
      <span>当前 {fmtTc(s.playheadMs)}</span>
      <span>Δ 上一标记 {prev ? `${Math.round(s.playheadMs - prev.t_ms)}ms` : '—'}</span>
      <span>打表 {tally.length} 个{lastGap !== null ? `（最近间隔 ${lastGap}ms）` : ''}</span>
      <button onClick={() => void tallyAtPlayhead()}>T 打点</button>
      <button onClick={async () => {
        if (!s.analysis) return
        await api.clearTally(s.analysis.id)
        s.clearTallyLocal()
      }}>清空打表</button>
    </div>
  )
}
```

在 `frontend/src/hotkeys.ts` 的 `E` 分支后追加（import 追加 `tallyAtPlayhead`）：

```ts
      } else if (e.key === 't' || e.key === 'T') {
        void tallyAtPlayhead()
```

在 `frontend/src/App.tsx` 的 Workbench 中，`<Player …/>` 之后、ThumbStrip 之前挂载（import `{ TallyBar } from './tally/TallyBar'`）：

```tsx
        <TallyBar />
```

- [ ] **Step 4: 测试与类型检查**

```bash
cd frontend && pnpm test && pnpm build
```

- [ ] **Step 5: 手动验证**

播放中按 `T` 两次 → 计时条显示最近间隔；时间轴顶部出现两个黄三角；刷新页面后黄三角仍在（持久化）；清空按钮生效。

- [ ] **Step 6: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): tally timing bar with persistent markers"
```

---

### 任务 22：聚合叠加视图

**Files:**
- Modify: `frontend/src/App.tsx`（Workbench 内获取聚合数据并传给 Timeline）
- Modify: `frontend/src/hotkeys.ts`（追加 `A` 分支）

**Interfaces:**
- Consumes: `api.laneAggregate`、`useSession.showAggregate / toggleAggregate`、Timeline 的 `aggregate` prop（任务 18 已实现渲染）
- 契约：`A` 切换聚合叠加；开启时拉取当前泳道聚合结果，绿色 IQR 带 = 多 Take 方差（越宽越该复核，spec §6.4），橙色 = 少数派标记（待复核差异点）；切换泳道自动重取

- [ ] **Step 1: 实现**

在 `frontend/src/App.tsx` 的 Workbench 组件内追加（import 追加 `useState`、`type Aggregate`、`api` 已有）：

```tsx
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  const showAggregate = useSession(st => st.showAggregate)
  const laneId = useSession(st => st.laneId)

  useEffect(() => {
    if (!showAggregate || !laneId) { setAggregate(null); return }
    api.laneAggregate(laneId).then(setAggregate)
  }, [showAggregate, laneId])
```

Timeline 挂载处改为：

```tsx
        <Timeline video={video} aggregate={aggregate} />
```

在 `frontend/src/hotkeys.ts` 的 `T` 分支后追加：

```ts
      } else if (e.key === 'a' || e.key === 'A') {
        st.toggleAggregate()
```

- [ ] **Step 2: 类型检查**

```bash
cd frontend && pnpm build
```

- [ ] **Step 3: 手动验证**

同一 L0 泳道打两个 Take（各标 3 个相近的点，故意有几十 ms 偏差，其中一个点只在 Take#1 标）→ 按 `A` → 泳道底部出现绿色 IQR 带；只标了一遍的位置出现橙色少数派标记；再按 `A` 关闭。

- [ ] **Step 4: 提交**

```bash
git add frontend/src
git commit -m "feat(frontend): aggregate overlay with uncertainty band and minority flags"
```

---

### 任务 23：视频库首页、启动配置与验收走查

**Files:**
- Modify: `frontend/src/App.tsx`（完整视频库：上传、B 站拉取、状态轮询）
- Create: `.claude/launch.json`
- Create: `README.md`

**Interfaces:**
- Consumes: `api.upload / pull / listVideos`
- Produces: 可交付的 M1 全流程入口

- [ ] **Step 1: 替换 App 的库页面**

将 `frontend/src/App.tsx` 中 `export default function App()` 整体替换为：

```tsx
function VideoLibrary({ onOpen }: { onOpen: (v: Video) => void }) {
  const [videos, setVideos] = useState<Video[]>([])
  const [url, setUrl] = useState('')
  const refresh = () => { void api.listVideos().then(setVideos) }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)   // 轮询转码状态
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="library">
      <h1>Video Distiller</h1>
      <p>
        上传视频：
        <input type="file" accept="video/*" onChange={async e => {
          const f = e.target.files?.[0]
          if (f) { await api.upload(f); refresh() }
        }} />
      </p>
      <p>
        <input style={{ width: 320 }} placeholder="B 站视频 URL（抖音请手动下载后上传）"
          value={url} onChange={e => setUrl(e.target.value)} />
        <button disabled={!url} onClick={async () => {
          await api.pull(url); setUrl(''); refresh()
        }}>拉取</button>
      </p>
      <table>
        <tbody>
          {videos.map(v => (
            <tr key={v.id}>
              <td>video-{v.seq}</td>
              <td>{v.name}</td>
              <td>{v.status}{v.error ? `：${v.error}` : ''}</td>
              <td>{v.fps ?? '—'} fps</td>
              <td>
                <button disabled={v.status !== 'ready'} onClick={() => onOpen(v)}>打开</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  return video
    ? <Workbench video={video} onBack={() => setVideo(null)} />
    : <VideoLibrary onOpen={setVideo} />
}
```

- [ ] **Step 2: launch.json 与 README**

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "backend",
      "runtimeExecutable": "uv",
      "runtimeArgs": ["run", "--project", "backend", "uvicorn", "vd.api:app", "--port", "8000"],
      "port": 8000
    },
    {
      "name": "frontend",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--dir", "frontend", "dev"],
      "port": 5173
    }
  ]
}
```

`README.md`:

```markdown
# Video Distiller

游戏操作录像蒸馏工作台。设计文档见 `docs/superpowers/specs/`，术语表见 `CONTEXT.md`。

## 运行（M1）

前置：`brew install ffmpeg uv pnpm`

    uv run --project backend uvicorn vd.api:app --port 8000   # 后端
    pnpm --dir frontend dev                                   # 前端 → http://localhost:5173

数据目录：`~/VideoDistiller`（环境变量 `VD_DATA_DIR` 覆盖；备份 = 拷贝该目录）。

## 测试

    cd backend && uv run pytest
    cd frontend && pnpm test
```

- [ ] **Step 3: 全量测试与构建**

```bash
cd backend && uv run pytest && cd ../frontend && pnpm test && pnpm build
```

预期：全部通过

- [ ] **Step 4: M1 验收走查（对照 spec §12-M1：完整标完一个视频，关闭重开数据仍在）**

启动双服务后逐项确认：

1. 上传一个真实录像（或 B 站 URL 拉取）→ 列表 status 走到 ready，fps 为 30 或 60
2. 打开 → 自动创建 `video-1_km-default-v1_a1`
3. 0.5× 播放 + 空格暂停 + `[` `]` 逐帧，在 L0 打点标键；间隔勾 holding；打一个空标记结束长按
4. `+ 新 Take` 再标一遍；切 L1 泳道标技能名（可多 Take）
5. `T` 打表两下读出间隔；`A` 查看聚合带与少数派橙标
6. **关闭浏览器与两个服务进程，全部重启** → 重新打开该视频 → 所有标记、Take、打表 marker 原样存在
7. 检查 `~/VideoDistiller`（或 `VD_DATA_DIR`）下 originals/work/thumbs/vd.sqlite3 齐备

- [ ] **Step 5: 提交**

```bash
git add frontend/src .claude/launch.json README.md
git commit -m "feat: video library page with launch config, completing M1 loop"
```

---

## 计划外（M1 明确不做，防止执行时膨胀）

- Segment 圈选（schema 未建表，M2 随 Agent 作用域一起做）
- 区间平移（±N ms 批量）、笔记锚定、置信度虚线渲染 → M2
- Skill Catalog / Keymap 实体与编辑界面 → M2（M1 的 L1 label 是自由文本）
- 撤销/重做（M1 用删除 + 重标注顶替）
- WebCodecs 解码管线（`<video>` + rVFC 在 CFR 工作副本上已达 ±1 帧精度；若执行中发现某些素材 seek 不准，先确认转码是否成功，再考虑 WebCodecs）
