# M2 对齐与推断 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从一份标注产出带覆盖率验证报告的 Rotation 提案——Skill Catalog / Keymap 实体与编辑界面、跨层对齐与三方冲突、Keymap 反推、点标记补区间、循环发现流水线（算法候选 → LLM 命名 → 匹配器验证）。

**Architecture:** 在 M1 的分层上扩展：`db` 增加 user_version 迁移；纯算法模块 `ops / matcher / align / discover`（全部纯函数、黄金样例 TDD）；`agent` 封装 Anthropic API（可注入 fake，失败无副作用）；`api` 增加目录/键位/推断/提案路由；前端增加目录页、键位页、推断面板与错误提示条。

**Tech Stack:** 在 M1 之上新增：anthropic Python SDK（`claude-opus-5` + `messages.parse` 结构化输出）。

**Spec:** `docs/superpowers/specs/2026-08-20-video-distiller-design.md`（§5.4-5.7、§7 全节、§12-M2）；术语基准 `CONTEXT.md`

## Global Constraints

- 沿用 M1 全部约束（backend/ 用 uv、frontend/ 用 pnpm、中文 UI、conventional commit + 结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`、测试经 `VD_DATA_DIR` 隔离）
- **层级判据（spec §3.3）**：pattern 全为原始输入 op = L1 技能；含 `skill(ref)` = L2 连招。匹配器多趟按内容排序（纯操作先，skill-ref 后，至不动点）
- **三方冲突集合语义（spec §5.6/§7.6）**：L1 技能 ∈ 该键绑定的技能集合即一致
- **Keymap 版本化（spec §5.6）**：修改 = 新版本行；Analysis 钉 (keymap_id, keymap_version)
- **Agent 边界（spec §7.1/§10）**：`agent` 纯函数、只消费 IR 文本与 Catalog、失败返回空提案+错误、绝不写库；LLM 模型 `claude-opus-5`；`stop_reason == "refusal"` 必须守卫。**说明**：未启用 server-side fallbacks——命名任务拒绝概率极低且失败已优雅降级为空提案（此为对 claude-api 默认建议的记录性偏离）
- **评测集（spec §11）**：CI 全程用注入的 FakeLLM（确定性）；真实 API 评测走 `uv run python -m vd.eval`（需 ANTHROPIC_API_KEY，人工触发）；任何 prompt 改动必须过 `test_eval_discovery.py`
- **匹配容差默认值**：gap 无 tol_ms 时 ±80ms；hold 时长无 tol_ms 时 ±100ms；对齐窗口 500ms
- **提案机制（spec §7.7）**：Agent 产出存 proposals 表（pending），人接受才写 rotations；拒绝保留记录
- 端口沿用 8000/5173

## 文件结构总览（新增/修改）

```
backend/src/vd/
├── db.py            # 修改：user_version 迁移 + v2 DDL（skills/keymaps/rotations/proposals + analyses 两列）
├── store.py         # 修改：catalog/keymap/rotation/proposal CRUD + analysis 绑定
├── ops.py           # 新增：标注 marks → 操作流（纯函数）
├── matcher.py       # 新增：pattern 匹配器（longest-first、递归、多趟不动点）
├── align.py         # 新增：跨层对齐、三方冲突、Keymap 反推、补区间
├── discover.py      # 新增：n-gram 循环候选 + 验证报告（匹配器回放）
├── agent.py         # 新增：LLM 命名（anthropic SDK，client 可注入）
├── eval.py          # 新增：真实 API 评测入口（python -m vd.eval）
├── media.py         # 修改：_run 失败附 stderr 尾部
├── ingest.py        # 修改：default_runner 同上
└── api.py           # 修改：新路由 + MarkReq.kind Literal + suffix Range

backend/tests/
├── test_migrate.py test_catalog_store.py test_ops.py test_matcher.py
├── test_align.py test_discover.py test_agent.py test_eval_discovery.py
└── test_api.py（追加）

frontend/src/
├── api/types.ts client.ts        # 修改：新类型与方法
├── state/errors.ts               # 新增：错误提示 store
├── ErrorBar.tsx                  # 新增：顶部错误条
├── pages/CatalogPage.tsx         # 新增：技能目录
├── pages/KeymapPage.tsx          # 新增：键位
├── panel/InferPanel.tsx          # 新增：推断面板（对齐冲突 + 提案裁决）
├── tally/TallyBar.tsx            # 修改：回填
└── App.tsx                       # 修改：导航 + 工作台集成
```

---

# 部分 0：技术债打包（任务 1）

### 任务 1：静默失败家族修复

**Files:**
- Modify: `backend/src/vd/media.py`（`_run` 失败附 stderr）
- Modify: `backend/src/vd/ingest.py`（`default_runner` 同）
- Modify: `backend/src/vd/api.py`（`MarkReq.kind` → Literal；suffix Range `bytes=-N`）
- Modify: `backend/tests/test_media.py`、`backend/tests/test_api.py`（追加测试）
- Create: `frontend/src/state/errors.ts` + `frontend/src/state/errors.test.ts`
- Create: `frontend/src/ErrorBar.tsx`
- Modify: `frontend/src/api/client.ts`（`j()` 失败上报 errors store）
- Modify: `frontend/src/App.tsx`（挂 ErrorBar；VideoLibrary 上传后 `e.target.value = ''`）
- Modify: `.gitignore`（追加 `frontend/.vite/`）

**Interfaces:**
- Produces: `pushError(msg)` / `useErrors`（后续任务的所有 API 失败都会流到 ErrorBar）；`_run` 抛出的 RuntimeError 带 stderr 尾部

- [ ] **Step 1: 后端失败测试**

`backend/tests/test_media.py` 追加：

```python
import pytest


def test_run_failure_includes_stderr(tmp_path):
    with pytest.raises(RuntimeError) as ei:
        media._run(["ffprobe", str(tmp_path / "nonexistent.mp4")])
    assert "nonexistent.mp4" in str(ei.value)
```

`backend/tests/test_api.py` 追加：

```python
def test_invalid_mark_kind_is_422(client, analysis):
    take = analysis["lanes"][0]["takes"][0]
    r = client.post(f"/api/takes/{take['id']}/marks",
                    json={"t_ms": 10, "kind": "boom", "label": "2"})
    assert r.status_code == 422


def test_suffix_range(client, sample_video):
    vid = _ready_video(client, sample_video)
    full = client.get(f"/api/videos/{vid}/file")
    size = int(full.headers["content-length"])
    r = client.get(f"/api/videos/{vid}/file", headers={"Range": "bytes=-100"})
    assert r.status_code == 206
    assert len(r.content) == 100
    assert r.headers["content-range"] == f"bytes {size - 100}-{size - 1}/{size}"
    assert r.content == full.content[-100:]
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_media.py tests/test_api.py -x
```

预期：FAIL（`_run` 抛 CalledProcessError 而非 RuntimeError；kind 无校验 500/400；suffix Range 被当 `start=0`）

- [ ] **Step 3: 后端实现**

`backend/src/vd/media.py` 的 `_run` 改为：

```python
def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or "")[-500:]
        raise RuntimeError(f"{cmd[0]} 失败（{' '.join(cmd[:6])}…）：{tail}") from e
```

`backend/src/vd/ingest.py` 的 `default_runner` 改为：

```python
def default_runner(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or "")[-500:]
        raise RuntimeError(f"yt-dlp 失败：{tail}") from e
```

`backend/src/vd/api.py`：`MarkReq` 与 `MarkPatch` 的 kind/label 保持，但 `MarkReq.kind` 类型改为 `Literal["input", "release"]`（顶部 `from typing import Iterator, Literal`）。Range 解析处，在 `start`/`end` 计算前处理 suffix 形式：

```python
    m = re.match(r"bytes=(\d*)-(\d*)", request.headers.get("range") or "")
    ...
    g1, g2 = m.group(1), m.group(2)
    if not g1 and g2:                      # 后缀形式 bytes=-N：最后 N 字节
        start = max(0, size - int(g2))
        end = size - 1
    else:
        start = int(g1 or 0)
        end = min(int(g2 or size - 1), size - 1)
```

- [ ] **Step 4: 前端失败测试**

`frontend/src/state/errors.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest'
import { useErrors } from './errors'

beforeEach(() => useErrors.getState().clear())

test('pushError accumulates and dismiss removes', () => {
  useErrors.getState().pushError('boom')
  useErrors.getState().pushError('bang')
  expect(useErrors.getState().errors.map(e => e.msg)).toEqual(['boom', 'bang'])
  const id = useErrors.getState().errors[0].id
  useErrors.getState().dismiss(id)
  expect(useErrors.getState().errors.map(e => e.msg)).toEqual(['bang'])
})
```

- [ ] **Step 5: 前端实现**

`frontend/src/state/errors.ts`:

```ts
import { create } from 'zustand'

export interface AppError { id: number; msg: string }

interface Errors {
  errors: AppError[]
  pushError: (msg: string) => void
  dismiss: (id: number) => void
  clear: () => void
}

let seq = 0

export const useErrors = create<Errors>(set => ({
  errors: [],
  pushError: msg => set(s => ({ errors: [...s.errors, { id: ++seq, msg }] })),
  dismiss: id => set(s => ({ errors: s.errors.filter(e => e.id !== id) })),
  clear: () => set({ errors: [] }),
}))
```

`frontend/src/ErrorBar.tsx`:

```tsx
import { useErrors } from './state/errors'

export function ErrorBar() {
  const { errors, dismiss } = useErrors()
  if (!errors.length) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99, background: '#7f1d1d', padding: '4px 8px' }}>
      {errors.map(e => (
        <div key={e.id}>
          ⚠ {e.msg} <button onClick={() => dismiss(e.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
```

`frontend/src/api/client.ts` 的 `j` 改为（顶部加 `import { useErrors } from '../state/errors'`）：

```ts
async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text()
    useErrors.getState().pushError(`API ${r.status}: ${text.slice(0, 200)}`)
    throw new Error(`API ${r.status}: ${text}`)
  }
  return r.json() as Promise<T>
}
```

`frontend/src/App.tsx`：`App` 根部渲染 `<><ErrorBar />…</>`（import ErrorBar）；VideoLibrary 上传 onChange 的 `await api.upload(f); refresh()` 后追加 `e.target.value = ''`。

`.gitignore` 追加一行 `frontend/.vite/`。

- [ ] **Step 6: 全部验证并提交**

```bash
cd backend && uv run pytest && cd ../frontend && pnpm test && pnpm build
```

```bash
git add -A
git commit -m "fix: surface silent failures (stderr tails, error bar, 422 kinds, suffix range)"
```

---

# 部分 A：数据层（任务 2–4）

### 任务 2：schema v2 迁移机制与新表

**Files:**
- Modify: `backend/src/vd/db.py`
- Create: `backend/tests/test_migrate.py`

**Interfaces:**
- Produces: `db.connect()` 返回的库 `PRAGMA user_version == 2`，含新表 `skills / keymaps / rotations / proposals`，`analyses` 增列 `keymap_id TEXT` / `keymap_version INTEGER`（可空）。对 M1 旧库（user_version 0）与全新库均幂等

- [ ] **Step 1: 写失败测试**

`backend/tests/test_migrate.py`:

```python
from vd import db


def _tables(conn):
    return {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}


def _cols(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_fresh_db_is_v2():
    conn = db.connect()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
    assert {"skills", "keymaps", "rotations", "proposals"} <= _tables(conn)
    assert {"keymap_id", "keymap_version"} <= _cols(conn, "analyses")


def test_migration_from_v1_is_idempotent(data_dir):
    # 模拟 M1 旧库：先建 v1 表（user_version 0），再连接触发迁移
    import sqlite3
    p = data_dir / "vd.sqlite3"
    data_dir.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(p)
    raw.executescript(db.SCHEMA)          # v1 部分（IF NOT EXISTS）
    raw.close()
    conn = db.connect()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
    conn.close()
    conn2 = db.connect()                  # 再连不报错（幂等）
    assert {"keymap_id", "keymap_version"} <= _cols(conn2, "analyses")
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_migrate.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/db.py`：`SCHEMA` 保持 v1 内容不动；文件末尾追加：

```python
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
```

`connect()` 在 `executescript(SCHEMA)` 之后调用 `_migrate(conn)`。

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/db.py backend/tests/test_migrate.py
git commit -m "feat(backend): schema v2 with user_version migration (catalog/keymap/rotation/proposal)"
```

---

### 任务 3：store — 目录/键位/循环/提案 CRUD

**Files:**
- Modify: `backend/src/vd/store.py`
- Create: `backend/tests/test_catalog_store.py`

**Interfaces:**
- Produces（全部 conn 首参、dict 出入，JSON 列自动编解码）：
  - `create_skill(conn, *, name, class_=None, cd_ms=None, cast_ms=None, anim_ms=None, cancelable=False, pattern=None) -> dict`（pattern 校验失败抛 ValueError）
  - `list_skills(conn)` · `get_skill(conn, skill_id)` · `update_skill(conn, skill_id, **fields)` · `delete_skill(conn, skill_id)`
  - `skill_layer(skill: dict) -> str`（'L1' 纯操作 / 'L2' 含 skill ref——spec §3.3 判据）
  - `save_keymap(conn, *, keymap_id, class_=None, binds) -> dict`（**总是新版本** = max(version)+1）
  - `list_keymaps(conn)`（每个 id 的全部版本）· `get_keymap(conn, keymap_id, version) -> dict | None`
  - `bind_analysis_keymap(conn, analysis_id, keymap_id, version) -> dict`
  - `create_proposal(conn, *, analysis_id, kind, payload, report) -> dict` · `list_proposals(conn, analysis_id)` · `set_proposal_status(conn, proposal_id, status) -> dict`
  - `create_rotation(conn, *, name, body, params=None, note=None, derived_from=None) -> dict` · `list_rotations(conn)`
  - `PATTERN_OPS = ("tap","hold","chord","wheel","gap","skill")`；`validate_pattern(pattern: list) -> None`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_catalog_store.py`:

```python
import pytest

from vd import db, store


@pytest.fixture
def conn():
    c = db.connect()
    yield c
    c.close()


def test_skill_crud_roundtrip(conn):
    s = store.create_skill(conn, name="火球术", class_="法师", cd_ms=6000,
                           cast_ms=400, anim_ms=720,
                           pattern=[{"op": "tap", "key": "2"}])
    assert s["pattern"] == [{"op": "tap", "key": "2"}]
    assert store.skill_layer(s) == "L1"
    s2 = store.update_skill(conn, s["id"], anim_ms=750)
    assert s2["anim_ms"] == 750
    assert len(store.list_skills(conn)) == 1
    store.delete_skill(conn, s["id"])
    assert store.list_skills(conn) == []


def test_skill_layer_by_content(conn):
    combo = store.create_skill(conn, name="冰火连携", pattern=[
        {"op": "skill", "ref": "sk_a"},
        {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "skill", "ref": "sk_b"}])
    assert store.skill_layer(combo) == "L2"
    multikey = store.create_skill(conn, name="旋风连", pattern=[
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300},
        {"op": "tap", "key": "Q"}])
    assert store.skill_layer(multikey) == "L1"     # 纯操作多步仍是 L1（spec §3.3）


def test_pattern_validation(conn):
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏", pattern=[{"op": "explode"}])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏2", pattern=[{"op": "tap"}])   # tap 缺 key
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏3", pattern=[{"op": "skill"}]) # skill 缺 ref


def test_keymap_always_new_version(conn):
    k1 = store.save_keymap(conn, keymap_id="km_mage", class_="法师",
                           binds={"sk_fireball": ["2"]})
    k2 = store.save_keymap(conn, keymap_id="km_mage",
                           binds={"sk_fireball": ["2"], "sk_blink": ["Shift+2"]})
    assert (k1["version"], k2["version"]) == (1, 2)
    old = store.get_keymap(conn, "km_mage", 1)
    assert old["binds"] == {"sk_fireball": ["2"]}      # 旧版本语义不漂移（spec §5.6）


def test_analysis_keymap_binding(conn):
    v = store.create_video(conn, name="a.mp4", source_kind="upload")
    tree = store.create_analysis(conn, v["id"])
    store.save_keymap(conn, keymap_id="km_mage", binds={})
    a = store.bind_analysis_keymap(conn, tree["id"], "km_mage", 1)
    assert (a["keymap_id"], a["keymap_version"]) == ("km_mage", 1)


def test_proposal_lifecycle(conn):
    v = store.create_video(conn, name="a.mp4", source_kind="upload")
    tree = store.create_analysis(conn, v["id"])
    p = store.create_proposal(conn, analysis_id=tree["id"], kind="rotation",
                              payload={"name": "x", "body": []},
                              report={"coverage": 0.9})
    assert p["status"] == "pending"
    assert p["payload"]["name"] == "x"
    p2 = store.set_proposal_status(conn, p["id"], "accepted")
    assert p2["status"] == "accepted"
    assert len(store.list_proposals(conn, tree["id"])) == 1


def test_rotation_create(conn):
    r = store.create_rotation(conn, name="单体稳定输出",
                              body=[{"skill": "sk_a"}, {"gap": 180}],
                              derived_from=["an_1"])
    assert store.list_rotations(conn)[0]["name"] == "单体稳定输出"
    assert r["derived_from"] == ["an_1"]
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_catalog_store.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/store.py` 顶部追加 `import json`，文件末尾追加：

```python
# ---- Skill Catalog（spec §5.4/§5.5）----

PATTERN_OPS = ("tap", "hold", "chord", "wheel", "gap", "skill")


def validate_pattern(pattern: list) -> None:
    if not isinstance(pattern, list):
        raise ValueError("pattern must be a list")
    for item in pattern:
        op = item.get("op")
        if op not in PATTERN_OPS:
            raise ValueError(f"unknown op: {op!r}")
        if op == "tap" and not item.get("key"):
            raise ValueError("tap requires key")
        if op == "hold" and not (item.get("key") or item.get("button")):
            raise ValueError("hold requires key/button")
        if op == "chord" and not item.get("keys"):
            raise ValueError("chord requires keys")
        if op == "gap" and "ms" not in item:
            raise ValueError("gap requires ms")
        if op == "skill" and not item.get("ref"):
            raise ValueError("skill requires ref")


def skill_layer(skill: dict) -> str:
    """层级判据（spec §3.3）：pattern 含 skill(ref) = L2，否则 L1。"""
    return "L2" if any(i.get("op") == "skill" for i in skill["pattern"]) else "L1"


def _skill_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["pattern"] = json.loads(d["pattern"])
    d["cancelable"] = bool(d["cancelable"])
    return d


def create_skill(conn, *, name, class_=None, cd_ms=None, cast_ms=None,
                 anim_ms=None, cancelable=False, pattern=None):
    pattern = pattern or []
    validate_pattern(pattern)
    sid = _id("sk")
    conn.execute(
        "INSERT INTO skills(id,name,class,cd_ms,cast_ms,anim_ms,cancelable,pattern,created_at)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (sid, name, class_, cd_ms, cast_ms, anim_ms, int(cancelable),
         json.dumps(pattern, ensure_ascii=False), _now()),
    )
    conn.commit()
    return get_skill(conn, sid)


def get_skill(conn, skill_id):
    return _skill_row(conn.execute("SELECT * FROM skills WHERE id=?", (skill_id,)).fetchone())


def list_skills(conn):
    return [_skill_row(r) for r in conn.execute("SELECT * FROM skills ORDER BY name")]


def update_skill(conn, skill_id, **fields):
    if "pattern" in fields:
        validate_pattern(fields["pattern"])
        fields["pattern"] = json.dumps(fields["pattern"], ensure_ascii=False)
    if "cancelable" in fields:
        fields["cancelable"] = int(fields["cancelable"])
    keys = ",".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE skills SET {keys} WHERE id=?", (*fields.values(), skill_id))
    conn.commit()
    return get_skill(conn, skill_id)


def delete_skill(conn, skill_id):
    conn.execute("DELETE FROM skills WHERE id=?", (skill_id,))
    conn.commit()


# ---- Keymap（spec §5.6：改动 = 新版本）----

def _keymap_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["binds"] = json.loads(d["binds"])
    return d


def save_keymap(conn, *, keymap_id, class_=None, binds):
    version = conn.execute(
        "SELECT COALESCE(MAX(version),0)+1 AS v FROM keymaps WHERE id=?", (keymap_id,)
    ).fetchone()["v"]
    conn.execute(
        "INSERT INTO keymaps(id,version,class,binds,created_at) VALUES(?,?,?,?,?)",
        (keymap_id, version, class_, json.dumps(binds, ensure_ascii=False), _now()),
    )
    conn.commit()
    return get_keymap(conn, keymap_id, version)


def get_keymap(conn, keymap_id, version):
    return _keymap_row(conn.execute(
        "SELECT * FROM keymaps WHERE id=? AND version=?", (keymap_id, version)).fetchone())


def list_keymaps(conn):
    return [_keymap_row(r) for r in conn.execute(
        "SELECT * FROM keymaps ORDER BY id, version")]


def bind_analysis_keymap(conn, analysis_id, keymap_id, version):
    conn.execute("UPDATE analyses SET keymap_id=?, keymap_version=? WHERE id=?",
                 (keymap_id, version, analysis_id))
    conn.commit()
    return _row(conn.execute("SELECT * FROM analyses WHERE id=?", (analysis_id,)))


# ---- Proposal / Rotation（spec §7.7）----

def _proposal_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"])
    d["report"] = json.loads(d["report"])
    return d


def create_proposal(conn, *, analysis_id, kind, payload, report):
    pid = _id("pp")
    conn.execute(
        "INSERT INTO proposals(id,analysis_id,kind,payload,report,created_at)"
        " VALUES(?,?,?,?,?,?)",
        (pid, analysis_id, kind, json.dumps(payload, ensure_ascii=False),
         json.dumps(report, ensure_ascii=False), _now()),
    )
    conn.commit()
    return _proposal_row(conn.execute("SELECT * FROM proposals WHERE id=?", (pid,)).fetchone())


def list_proposals(conn, analysis_id):
    return [_proposal_row(r) for r in conn.execute(
        "SELECT * FROM proposals WHERE analysis_id=? ORDER BY created_at", (analysis_id,))]


def set_proposal_status(conn, proposal_id, status):
    conn.execute("UPDATE proposals SET status=? WHERE id=?", (status, proposal_id))
    conn.commit()
    return _proposal_row(conn.execute(
        "SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone())


def _rotation_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["body"] = json.loads(d["body"])
    d["params"] = json.loads(d["params"])
    d["derived_from"] = json.loads(d["derived_from"])
    return d


def create_rotation(conn, *, name, body, params=None, note=None, derived_from=None):
    rid = _id("rot")
    conn.execute(
        "INSERT INTO rotations(id,name,body,params,note,derived_from,created_at)"
        " VALUES(?,?,?,?,?,?,?)",
        (rid, name, json.dumps(body, ensure_ascii=False),
         json.dumps(params or [], ensure_ascii=False), note,
         json.dumps(derived_from or [], ensure_ascii=False), _now()),
    )
    conn.commit()
    return _rotation_row(conn.execute("SELECT * FROM rotations WHERE id=?", (rid,)).fetchone())


def list_rotations(conn):
    return [_rotation_row(r) for r in conn.execute(
        "SELECT * FROM rotations ORDER BY created_at")]
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/store.py backend/tests/test_catalog_store.py
git commit -m "feat(backend): catalog/keymap/rotation/proposal store layer"
```

---

### 任务 4：目录/键位/提案 API 路由

**Files:**
- Modify: `backend/src/vd/api.py`
- Modify: `backend/tests/test_api.py`（追加）

**Interfaces:**
- Produces（前端 client 逐字消费）：
  - `GET/POST /api/skills`；`PATCH/DELETE /api/skills/{id}`（校验失败 400）
  - `GET /api/keymaps`；`POST /api/keymaps` body `{keymap_id, class?, binds}` → 新版本
  - `PATCH /api/analyses/{id}/keymap` body `{keymap_id, version}`
  - `GET /api/analyses/{id}/proposals`；`POST /api/proposals/{id}/accept`（rotation 提案：建 rotations 行 + 状态 accepted，返回 `{proposal, rotation}`）；`POST /api/proposals/{id}/reject`
  - `GET /api/rotations`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_api.py` 追加：

```python
def test_skill_routes(client):
    s = client.post("/api/skills", json={
        "name": "火球术", "class_": "法师", "cd_ms": 6000,
        "pattern": [{"op": "tap", "key": "2"}]}).json()
    assert s["name"] == "火球术"
    assert client.post("/api/skills", json={
        "name": "坏", "pattern": [{"op": "nope"}]}).status_code == 400
    s2 = client.patch(f"/api/skills/{s['id']}", json={"anim_ms": 720}).json()
    assert s2["anim_ms"] == 720
    assert len(client.get("/api/skills").json()) == 1
    client.delete(f"/api/skills/{s['id']}")
    assert client.get("/api/skills").json() == []


def test_keymap_routes_and_binding(client, analysis):
    k = client.post("/api/keymaps", json={
        "keymap_id": "km_mage", "class_": "法师",
        "binds": {"sk_x": ["2"]}}).json()
    assert k["version"] == 1
    a = client.patch(f"/api/analyses/{analysis['id']}/keymap",
                     json={"keymap_id": "km_mage", "version": 1}).json()
    assert a["keymap_version"] == 1


def test_proposal_accept_creates_rotation(client, analysis):
    from vd import db, store
    conn = db.connect()
    p = store.create_proposal(conn, analysis_id=analysis["id"], kind="rotation",
                              payload={"name": "单体循环", "note": "n",
                                       "body": [{"skill": "sk_a"}, {"gap": 180}]},
                              report={"coverage": 0.88})
    conn.close()
    r = client.post(f"/api/proposals/{p['id']}/accept").json()
    assert r["proposal"]["status"] == "accepted"
    assert r["rotation"]["name"] == "单体循环"
    assert client.get("/api/rotations").json()[0]["derived_from"] == [analysis["id"]]
    assert len(client.get(f"/api/analyses/{analysis['id']}/proposals").json()) == 1
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/api.py` 追加：

```python
class SkillReq(BaseModel):
    name: str
    class_: str | None = None
    cd_ms: int | None = None
    cast_ms: int | None = None
    anim_ms: int | None = None
    cancelable: bool = False
    pattern: list = []


@app.get("/api/skills")
def skills(conn=Depends(get_conn)):
    return store.list_skills(conn)


@app.post("/api/skills")
def create_skill(req: SkillReq, conn=Depends(get_conn)):
    try:
        return store.create_skill(conn, name=req.name, class_=req.class_,
                                  cd_ms=req.cd_ms, cast_ms=req.cast_ms,
                                  anim_ms=req.anim_ms, cancelable=req.cancelable,
                                  pattern=req.pattern)
    except ValueError as e:
        raise HTTPException(400, str(e))


class SkillPatch(BaseModel):
    name: str | None = None
    class_: str | None = None
    cd_ms: int | None = None
    cast_ms: int | None = None
    anim_ms: int | None = None
    cancelable: bool | None = None
    pattern: list | None = None


@app.patch("/api/skills/{skill_id}")
def patch_skill(skill_id: str, req: SkillPatch, conn=Depends(get_conn)):
    fields = {("class" if k == "class_" else k): v
              for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "empty patch")
    try:
        result = store.update_skill(conn, skill_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if result is None:
        raise HTTPException(404)
    return result


@app.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: str, conn=Depends(get_conn)):
    store.delete_skill(conn, skill_id)
    return {"ok": True}


class KeymapReq(BaseModel):
    keymap_id: str
    class_: str | None = None
    binds: dict


@app.get("/api/keymaps")
def keymaps(conn=Depends(get_conn)):
    return store.list_keymaps(conn)


@app.post("/api/keymaps")
def save_keymap(req: KeymapReq, conn=Depends(get_conn)):
    return store.save_keymap(conn, keymap_id=req.keymap_id, class_=req.class_,
                             binds=req.binds)


class KeymapBindReq(BaseModel):
    keymap_id: str
    version: int


@app.patch("/api/analyses/{analysis_id}/keymap")
def bind_keymap(analysis_id: str, req: KeymapBindReq, conn=Depends(get_conn)):
    a = store.bind_analysis_keymap(conn, analysis_id, req.keymap_id, req.version)
    if a is None:
        raise HTTPException(404)
    return a


@app.get("/api/analyses/{analysis_id}/proposals")
def proposals(analysis_id: str, conn=Depends(get_conn)):
    return store.list_proposals(conn, analysis_id)


@app.post("/api/proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, conn=Depends(get_conn)):
    p = store.set_proposal_status(conn, proposal_id, "accepted")
    if p is None:
        raise HTTPException(404)
    rotation = store.create_rotation(
        conn, name=p["payload"]["name"], body=p["payload"]["body"],
        params=p["payload"].get("params"), note=p["payload"].get("note"),
        derived_from=[p["analysis_id"]])
    return {"proposal": p, "rotation": rotation}


@app.post("/api/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: str, conn=Depends(get_conn)):
    p = store.set_proposal_status(conn, proposal_id, "rejected")
    if p is None:
        raise HTTPException(404)
    return p


@app.get("/api/rotations")
def rotations(conn=Depends(get_conn)):
    return store.list_rotations(conn)
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/api.py backend/tests/test_api.py
git commit -m "feat(backend): catalog/keymap/proposal/rotation routes"
```

---

# 部分 B：推断引擎（任务 5–13，纯算法 + LLM）

### 任务 5：ops — 标注到操作流

**Files:**
- Create: `backend/src/vd/ops.py`
- Create: `backend/tests/test_ops.py`

**Interfaces:**
- Produces: `ops.marks_to_ops(marks: list[dict]) -> list[dict]`。输入是 mark dict（人工 take 或聚合结果均可，字段 t_ms/end_ms/kind/label）；输出操作 token：`{"kind": "tap"|"hold"|"chord"|"wheel", "key": str, "t_ms": int, "end_ms": int|None, "keys"?: list[str], "source": list}`。规则：release 标记不产生操作；有 end_ms → hold；label=="Wheel" → wheel；label 含 "+" → chord（keys 排序）；其余 tap

- [ ] **Step 1: 写失败测试**

`backend/tests/test_ops.py`:

```python
from vd.ops import marks_to_ops


def mk(t, label="2", kind="input", end=None, mid="m"):
    return {"id": mid, "t_ms": t, "end_ms": end, "kind": kind, "label": label}


def test_tap_hold_chord_wheel():
    ops = marks_to_ops([
        mk(100, "2"),
        mk(400, "F", end=700),
        mk(1000, "Alt+3"),
        mk(1500, "Wheel"),
    ])
    assert [o["kind"] for o in ops] == ["tap", "hold", "chord", "wheel"]
    assert ops[1]["end_ms"] == 700
    assert ops[2]["keys"] == ["3", "Alt"]


def test_release_marks_skipped():
    ops = marks_to_ops([mk(100, "F", end=400), mk(400, None, kind="release")])
    assert len(ops) == 1


def test_aggregated_marks_without_id_work():
    ops = marks_to_ops([{"t_ms": 100, "end_ms": None, "kind": "input", "label": "Q"}])
    assert ops[0]["kind"] == "tap" and ops[0]["source"] == []
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_ops.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/ops.py`:

```python
"""标注 marks → 操作流（spec §3.2 操作流表示）。纯函数，不依赖 store/api。"""


def marks_to_ops(marks: list[dict]) -> list[dict]:
    ops = []
    for m in marks:
        if m["kind"] == "release":
            continue  # 空标记只充当 hold 终点，自身不产生操作（spec §6.3）
        label = m["label"] or ""
        if m.get("end_ms") is not None:
            kind = "hold"
        elif label == "Wheel":
            kind = "wheel"
        elif "+" in label:
            kind = "chord"
        else:
            kind = "tap"
        op = {"kind": kind, "key": label, "t_ms": m["t_ms"],
              "end_ms": m.get("end_ms"),
              "source": [m["id"]] if "id" in m else []}
        if kind == "chord":
            op["keys"] = sorted(label.split("+"))
        ops.append(op)
    return ops
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_ops.py -x
```

```bash
git add backend/src/vd/ops.py backend/tests/test_ops.py
git commit -m "feat(backend): marks-to-operations conversion"
```

---

### 任务 6：matcher — 单趟匹配（纯操作 pattern）

**Files:**
- Create: `backend/src/vd/matcher.py`
- Create: `backend/tests/test_matcher.py`

**Interfaces:**
- Produces:
  - 常量 `DEFAULT_GAP_TOL = 80`、`DEFAULT_HOLD_TOL = 100`
  - `match_at(tokens, start, pattern) -> int | None`（消费 token 数；gap 项不消费 token，校验相邻 token 时距）
  - `match_pass(tokens, skills) -> (new_tokens, matches, ambiguities)`——最长优先；等长多技能命中 = 歧义，不消费、记录 `{"t_ms", "skills": [ids]}`（spec §7.4 歧义不自动猜）；命中段替换为 skill token `{"kind":"skill","skill_id","name","t_ms","end_ms"}`
- token 时间口径：`end = end_ms or t_ms`；gap = 下一 token 的 t_ms − 上一 token 的 end

- [ ] **Step 1: 写失败测试**

`backend/tests/test_matcher.py`:

```python
from vd.matcher import match_at, match_pass


def tap(t, key):
    return {"kind": "tap", "key": key, "t_ms": t, "end_ms": None, "source": []}


def hold(t, key, end):
    return {"kind": "hold", "key": key, "t_ms": t, "end_ms": end, "source": []}


FIREBALL = {"id": "sk_fb", "name": "火球术", "pattern": [{"op": "tap", "key": "2"}]}
WHIRL = {"id": "sk_wh", "name": "旋风连", "pattern": [
    {"op": "tap", "key": "Q"},
    {"op": "gap", "ms": 300, "tol_ms": 80},
    {"op": "tap", "key": "Q"},
    {"op": "gap", "ms": 200, "tol_ms": 60},
    {"op": "hold", "button": "LMB", "ms": 300, "tol_ms": 100}]}
DOUBLE_FB = {"id": "sk_dfb", "name": "强化火球", "pattern": [
    {"op": "tap", "key": "2"},
    {"op": "gap", "ms": 200, "tol_ms": 80},
    {"op": "tap", "key": "2"}]}


def test_match_at_single_tap():
    assert match_at([tap(100, "2")], 0, FIREBALL["pattern"]) == 1
    assert match_at([tap(100, "3")], 0, FIREBALL["pattern"]) is None


def test_match_at_multikey_with_gaps():
    toks = [tap(0, "Q"), tap(310, "Q"), hold(500, "LMB", 810)]
    assert match_at(toks, 0, WHIRL["pattern"]) == 3


def test_gap_outside_tol_fails():
    toks = [tap(0, "Q"), tap(500, "Q"), hold(690, "LMB", 990)]   # 第一 gap 500 超 300±80
    assert match_at(toks, 0, WHIRL["pattern"]) is None


def test_hold_duration_tol():
    toks = [tap(0, "Q"), tap(300, "Q"), hold(500, "LMB", 1000)]  # 时长 500 超 300±100
    assert match_at(toks, 0, WHIRL["pattern"]) is None


def test_longest_first():
    toks = [tap(0, "2"), tap(200, "2")]
    out, matches, amb = match_pass(toks, [FIREBALL, DOUBLE_FB])
    assert [m["skill_id"] for m in matches] == ["sk_dfb"]        # 最长优先
    assert out[0]["kind"] == "skill" and len(out) == 1
    assert amb == []


def test_ambiguity_not_consumed():
    other = {"id": "sk_x", "name": "同型", "pattern": [{"op": "tap", "key": "2"}]}
    toks = [tap(0, "2")]
    out, matches, amb = match_pass(toks, [FIREBALL, other])
    assert matches == []
    assert out[0]["kind"] == "tap"                               # 保留原 token 交人裁决
    assert amb == [{"t_ms": 0, "skills": ["sk_fb", "sk_x"]}]


def test_unmatched_tokens_kept():
    toks = [tap(0, "9"), tap(300, "2")]
    out, matches, amb = match_pass(toks, [FIREBALL])
    assert out[0]["kind"] == "tap" and out[1]["kind"] == "skill"
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_matcher.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/matcher.py`:

```python
"""确定性 pattern 匹配器（spec §7.4）：最长优先、歧义不自动猜、失败保留。纯函数。"""

DEFAULT_GAP_TOL = 80
DEFAULT_HOLD_TOL = 100


def _token_end(tok: dict) -> int:
    return tok["end_ms"] if tok.get("end_ms") is not None else tok["t_ms"]


def _item_matches_token(item: dict, tok: dict) -> bool:
    op = item["op"]
    if op == "tap":
        return tok["kind"] == "tap" and tok["key"] == item["key"]
    if op == "wheel":
        return tok["kind"] == "wheel"
    if op == "chord":
        return tok["kind"] == "chord" and sorted(item["keys"]) == tok.get("keys")
    if op == "hold":
        if tok["kind"] != "hold":
            return False
        want = item.get("key") or item.get("button")
        if tok["key"] != want:
            return False
        if "ms" in item:
            tol = item.get("tol_ms", DEFAULT_HOLD_TOL)
            return abs((_token_end(tok) - tok["t_ms"]) - item["ms"]) <= tol
        return True
    if op == "skill":
        return tok["kind"] == "skill" and tok["skill_id"] == item["ref"]
    return False


def match_at(tokens: list[dict], start: int, pattern: list[dict]) -> int | None:
    j = start
    prev_tok = None
    pending_gap = None
    for item in pattern:
        if item["op"] == "gap":
            pending_gap = item
            continue
        if j >= len(tokens):
            return None
        tok = tokens[j]
        if pending_gap is not None and prev_tok is not None:
            gap = tok["t_ms"] - _token_end(prev_tok)
            tol = pending_gap.get("tol_ms", DEFAULT_GAP_TOL)
            if abs(gap - pending_gap["ms"]) > tol:
                return None
        pending_gap = None
        if not _item_matches_token(item, tok):
            return None
        prev_tok = tok
        j += 1
    return j - start if j > start else None


def match_pass(tokens: list[dict], skills: list[dict]):
    out: list[dict] = []
    matches: list[dict] = []
    ambiguities: list[dict] = []
    i = 0
    while i < len(tokens):
        best = 0
        winners: list[dict] = []
        for sk in skills:
            n = match_at(tokens, i, sk["pattern"])
            if n and n > best:
                best, winners = n, [sk]
            elif n and n == best:
                winners.append(sk)
        if best > 0 and len(winners) == 1:
            sk = winners[0]
            seg = tokens[i:i + best]
            rec = {"skill_id": sk["id"], "name": sk["name"],
                   "t_ms": seg[0]["t_ms"], "end_ms": _token_end(seg[-1]),
                   "token_count": best}
            matches.append(rec)
            out.append({"kind": "skill", "skill_id": sk["id"], "name": sk["name"],
                        "t_ms": rec["t_ms"], "end_ms": rec["end_ms"]})
            i += best
        else:
            if best > 0:
                ambiguities.append({"t_ms": tokens[i]["t_ms"],
                                    "skills": sorted(s["id"] for s in winners)})
            out.append(tokens[i])
            i += 1
    return out, matches, ambiguities
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_matcher.py -x
```

```bash
git add backend/src/vd/matcher.py backend/tests/test_matcher.py
git commit -m "feat(backend): deterministic pattern matcher single pass"
```

---

### 任务 7：matcher — 多趟不动点（递归 pattern）

**Files:**
- Modify: `backend/src/vd/matcher.py`（追加 `match_all`）
- Modify: `backend/tests/test_matcher.py`（追加）

**Interfaces:**
- Produces: `match_all(ops, skills) -> {"tokens", "matches", "ambiguities", "unmatched"}`——先纯操作 pattern 一趟，再含 `skill(ref)` 的 pattern 循环至不动点（spec §7.4 自底向上多趟）；`unmatched` = 最终仍非 skill 的 token

- [ ] **Step 1: 追加失败测试**

`backend/tests/test_matcher.py` 追加：

```python
from vd.matcher import match_all

FROSTBOLT = {"id": "sk_ice", "name": "冰锥", "pattern": [{"op": "tap", "key": "3"}]}
COMBO = {"id": "sk_combo", "name": "冰火连携", "pattern": [
    {"op": "skill", "ref": "sk_fb"},
    {"op": "gap", "ms": 300, "tol_ms": 80},
    {"op": "skill", "ref": "sk_ice"}]}


def test_match_all_recursive_to_fixpoint():
    toks = [tap(0, "2"), tap(310, "3"), tap(1000, "9")]
    r = match_all(toks, [FIREBALL, FROSTBOLT, COMBO])
    kinds = [(t["kind"], t.get("skill_id")) for t in r["tokens"]]
    assert kinds[0] == ("skill", "sk_combo")       # 第二趟把两个 L1 合成 L2
    assert kinds[1] == ("tap", None)
    assert len(r["unmatched"]) == 1
    ids = [m["skill_id"] for m in r["matches"]]
    assert ids.count("sk_fb") == 1 and ids.count("sk_ice") == 1 and ids.count("sk_combo") == 1


def test_match_all_pure_only():
    toks = [tap(0, "2")]
    r = match_all(toks, [FIREBALL])
    assert r["tokens"][0]["kind"] == "skill" and r["unmatched"] == []
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_matcher.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/matcher.py` 追加：

```python
def match_all(ops: list[dict], skills: list[dict]) -> dict:
    """自底向上多趟（spec §7.4）：纯操作 pattern 先，skill-ref pattern 循环至不动点。"""
    pure = [s for s in skills if all(i["op"] != "skill" for i in s["pattern"])]
    refs = [s for s in skills if any(i["op"] == "skill" for i in s["pattern"])]
    tokens, matches, ambiguities = match_pass(list(ops), pure)
    while refs:
        tokens, m2, a2 = match_pass(tokens, refs)
        matches += m2
        ambiguities += a2
        if not m2:
            break
    unmatched = [t for t in tokens if t["kind"] != "skill"]
    return {"tokens": tokens, "matches": matches,
            "ambiguities": ambiguities, "unmatched": unmatched}
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_matcher.py -x
```

```bash
git add backend/src/vd/matcher.py backend/tests/test_matcher.py
git commit -m "feat(backend): recursive multi-pass matching to fixpoint"
```

---

### 任务 8：align — 跨层对齐与补区间

**Files:**
- Create: `backend/src/vd/align.py`
- Create: `backend/tests/test_align.py`

**Interfaces:**
- Produces:
  - `ALIGN_WINDOW_MS = 500`
  - `align_l1(l0_ops, l1_marks, skills_by_name, binds) -> (links, conflicts)`——每个 L1 标记找窗口内最近 L0 op；冲突类型：`undefined_skill`（目录缺定义）、`no_l0`（窗口内无操作）、`three_way`（集合语义不一致，spec §7.6）
  - `complete_spans(l1_marks, skills_by_name) -> list`——无 end 的 L1 标记按 `t + cast_ms + anim_ms` 提议区间，confidence 0.6（spec §5.2/§7.2d）
- binds: `{skill_id: [keys]}`；集合语义 = 反查 key→skills 集合，L1 技能 ∈ 集合即一致

- [ ] **Step 1: 写失败测试**

`backend/tests/test_align.py`:

```python
from vd.align import align_l1, complete_spans


def op(t, key):
    return {"kind": "tap", "key": key, "t_ms": t, "end_ms": None, "source": []}


def l1(t, label, mid="m1", end=None):
    return {"id": mid, "t_ms": t, "end_ms": end, "kind": "input", "label": label}


SKILLS = {
    "火球术": {"id": "sk_fb", "name": "火球术", "cast_ms": 400, "anim_ms": 720, "pattern": []},
    "轻击一": {"id": "sk_a1", "name": "轻击一", "cast_ms": None, "anim_ms": None, "pattern": []},
    "轻击二": {"id": "sk_a2", "name": "轻击二", "cast_ms": None, "anim_ms": None, "pattern": []},
}


def test_link_and_three_way_conflict():
    binds = {"sk_fb": ["2"]}
    links, conflicts = align_l1([op(1000, "3")], [l1(1100, "火球术")], SKILLS, binds)
    assert links[0]["l0_key"] == "3" and links[0]["dt_ms"] == 100
    tw = [c for c in conflicts if c["type"] == "three_way"]
    assert tw[0]["l1_label"] == "火球术" and tw[0]["keymap_expected"] == ["2"]


def test_set_semantics_one_key_many_skills():
    binds = {"sk_a1": ["LMB"], "sk_a2": ["LMB"]}       # 一键多技能（spec §5.6）
    _, c1 = align_l1([op(1000, "LMB")], [l1(1050, "轻击一")], SKILLS, binds)
    _, c2 = align_l1([op(2000, "LMB")], [l1(2050, "轻击二")], SKILLS, binds)
    assert not [c for c in c1 + c2 if c["type"] == "three_way"]


def test_undefined_skill_and_no_l0():
    links, conflicts = align_l1([], [l1(100, "神秘技能")], SKILLS, {})
    types = sorted(c["type"] for c in conflicts)
    assert types == ["no_l0", "undefined_skill"]
    assert links == []


def test_window_limit():
    links, conflicts = align_l1([op(0, "2")], [l1(900, "火球术")], SKILLS, {})
    assert [c["type"] for c in conflicts] == ["no_l0"]   # 900ms 超 500ms 窗口


def test_complete_spans():
    out = complete_spans([l1(1000, "火球术"), l1(2000, "轻击一"),
                          l1(3000, "火球术", end=3500)], SKILLS)
    assert out == [{"mark_id": "m1", "t_ms": 1000,
                    "proposed_end_ms": 2120, "confidence": 0.6}]
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_align.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/align.py`:

```python
"""跨层对齐、三方冲突、补区间（spec §7.2b/d、§7.6）。纯函数。"""

ALIGN_WINDOW_MS = 500


def align_l1(l0_ops: list[dict], l1_marks: list[dict],
             skills_by_name: dict, binds: dict) -> tuple[list, list]:
    key_to_skills: dict[str, set] = {}
    for sid, keys in (binds or {}).items():
        for k in keys:
            key_to_skills.setdefault(k, set()).add(sid)
    links, conflicts = [], []
    for m in l1_marks:
        name = m["label"]
        sk = skills_by_name.get(name)
        if sk is None:
            conflicts.append({"type": "undefined_skill", "t_ms": m["t_ms"], "label": name})
        best, best_dt = None, ALIGN_WINDOW_MS + 1
        for o in l0_ops:
            dt = abs(o["t_ms"] - m["t_ms"])
            if dt < best_dt:
                best, best_dt = o, dt
        if best is None or best_dt > ALIGN_WINDOW_MS:
            conflicts.append({"type": "no_l0", "t_ms": m["t_ms"], "label": name})
            continue
        links.append({"l1_t_ms": m["t_ms"], "label": name,
                      "l0_key": best["key"], "l0_t_ms": best["t_ms"],
                      "dt_ms": best_dt})
        if sk is not None and binds:
            allowed = key_to_skills.get(best["key"], set())
            if sk["id"] not in allowed:
                conflicts.append({
                    "type": "three_way", "t_ms": m["t_ms"],
                    "l0_key": best["key"], "l1_label": name,
                    "keymap_expected": sorted(binds.get(sk["id"], []))})
    return links, conflicts


def complete_spans(l1_marks: list[dict], skills_by_name: dict) -> list[dict]:
    out = []
    for m in l1_marks:
        if m.get("end_ms") is not None:
            continue
        sk = skills_by_name.get(m["label"])
        if sk and sk.get("cast_ms") is not None and sk.get("anim_ms") is not None:
            out.append({"mark_id": m.get("id"), "t_ms": m["t_ms"],
                        "proposed_end_ms": m["t_ms"] + sk["cast_ms"] + sk["anim_ms"],
                        "confidence": 0.6})
    return out
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_align.py -x
```

```bash
git add backend/src/vd/align.py backend/tests/test_align.py
git commit -m "feat(backend): cross-layer alignment with set-semantics conflicts"
```

---

### 任务 9：align — Keymap 反推

**Files:**
- Modify: `backend/src/vd/align.py`（追加 `infer_keymap`）
- Modify: `backend/tests/test_align.py`（追加）

**Interfaces:**
- Produces: `infer_keymap(links, skills_by_name) -> list[{"skill_id","key","support","total"}]`——共现计数，某键出现 ≥2 次且占该技能全部对齐 > 0.6 才提议（spec §7.2c）

- [ ] **Step 1: 追加失败测试**

```python
from vd.align import infer_keymap


def link(label, key):
    return {"l1_t_ms": 0, "label": label, "l0_key": key, "l0_t_ms": 0, "dt_ms": 0}


def test_infer_dominant_key():
    links = [link("火球术", "2"), link("火球术", "2"), link("火球术", "3")]
    out = infer_keymap(links, SKILLS)
    assert out == [{"skill_id": "sk_fb", "key": "2", "support": 2, "total": 3}]


def test_no_suggestion_below_threshold():
    assert infer_keymap([link("火球术", "2")], SKILLS) == []          # 仅 1 次
    links = [link("火球术", "2"), link("火球术", "3"),
             link("火球术", "2"), link("火球术", "3")]
    assert infer_keymap(links, SKILLS) == []                          # 0.5 不过 0.6


def test_unknown_label_ignored():
    assert infer_keymap([link("未知", "2"), link("未知", "2")], SKILLS) == []
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_align.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/align.py` 追加：

```python
def infer_keymap(links: list[dict], skills_by_name: dict) -> list[dict]:
    """共现统计反推键位（spec §7.2c）。"""
    counts: dict[str, dict[str, int]] = {}
    for ln in links:
        sk = skills_by_name.get(ln["label"])
        if sk is None:
            continue
        by_key = counts.setdefault(sk["id"], {})
        by_key[ln["l0_key"]] = by_key.get(ln["l0_key"], 0) + 1
    suggestions = []
    for sid in sorted(counts):
        by_key = counts[sid]
        total = sum(by_key.values())
        key, n = max(by_key.items(), key=lambda kv: kv[1])
        if n >= 2 and n / total > 0.6:
            suggestions.append({"skill_id": sid, "key": key,
                                "support": n, "total": total})
    return suggestions
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_align.py -x
```

```bash
git add backend/src/vd/align.py backend/tests/test_align.py
git commit -m "feat(backend): keymap inference from co-occurrence"
```

---

### 任务 10：discover — 循环候选与验证报告

**Files:**
- Create: `backend/src/vd/discover.py`
- Create: `backend/tests/test_discover.py`

**Interfaces:**
- Produces:
  - `find_candidates(tokens, min_len=2, max_len=8, min_repeats=2) -> list[(unit, offsets)]`——n-gram 连续重复（贪心非重叠），被更高分候选包含的剔除；得分 = len×count
  - `build_candidate(tokens, unit_len, offsets) -> dict`——body（skill/op 项 + gap 项：跨次中位数与容差 `max(40, spread/2+20)`，spec §5.5 容差从方差反推）、occurrences（时间 span）、iterations、token_offsets
  - `verify(tokens, candidate) -> dict`——匹配器口径回放：complete/iterations、warnings（gap 超容差逐条中文说明）、coverage（覆盖 token 占比）、uncovered_before/after（spec §7.5 可证伪报告）
  - `discover_rotations(tokens, top_n=3) -> list[(candidate, report)]`
- token 序列 = `matcher.match_all(...)["tokens"]`（skill token + 残留原始 op）

- [ ] **Step 1: 写失败测试**

`backend/tests/test_discover.py`:

```python
from vd.discover import build_candidate, discover_rotations, find_candidates, verify


def sk(t, sid, end=None):
    return {"kind": "skill", "skill_id": sid, "name": sid,
            "t_ms": t, "end_ms": end if end is not None else t + 500}


def tap(t, key):
    return {"kind": "tap", "key": key, "t_ms": t, "end_ms": None, "source": []}


def cycle(base):
    """一次循环：旋风连 → 200ms → 火球，总长 1500ms。"""
    return [sk(base, "sk_wh", base + 800), sk(base + 1000, "sk_fb", base + 1300)]


TOKENS = cycle(0) + cycle(1500) + cycle(3000)


def test_find_candidates_repeating_pair():
    cands = find_candidates(TOKENS)
    units = [u for u, _ in cands]
    assert ("sk:sk_wh", "sk:sk_fb") in units
    unit, offsets = next((u, o) for u, o in cands if u == ("sk:sk_wh", "sk:sk_fb"))
    assert offsets == [0, 2, 4]


def test_build_candidate_gap_stats():
    c = build_candidate(TOKENS, 2, [0, 2, 4])
    assert c["body"][0] == {"skill": "sk_wh"}
    assert c["body"][1]["gap"] == 200                # 1000-800，三次一致
    assert c["body"][2] == {"skill": "sk_fb"}
    assert c["iterations"] == 3
    assert c["occurrences"][0] == [0, 1300]


def test_verify_full_coverage():
    c = build_candidate(TOKENS, 2, [0, 2, 4])
    r = verify(TOKENS, c)
    assert r["iterations"] == 3 and r["complete"] == 3
    assert r["coverage"] == 1.0
    assert r["warnings"] == [] and r["uncovered_before"] == 0


def test_verify_flags_deviant_gap():
    toks = cycle(0) + cycle(1500) + [sk(3000, "sk_wh", 3800), sk(4400, "sk_fb", 4700)]
    # 第三次 gap = 600，远离中位数 200
    cands = find_candidates(toks)
    unit, offsets = next((u, o) for u, o in cands if u == ("sk:sk_wh", "sk:sk_fb"))
    c = build_candidate(toks, 2, offsets)
    r = verify(toks, c)
    assert r["complete"] < r["iterations"]
    assert any("超出" in w for w in r["warnings"])


def test_uncovered_counted():
    toks = [tap(0, "9")] + cycle(1000) + cycle(2500)
    cands = find_candidates(toks)
    unit, offsets = next((u, o) for u, o in cands if u == ("sk:sk_wh", "sk:sk_fb"))
    c = build_candidate(toks, 2, offsets)
    r = verify(toks, c)
    assert r["uncovered_before"] == 1


def test_discover_rotations_top():
    out = discover_rotations(TOKENS)
    assert out and out[0][1]["coverage"] == 1.0
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_discover.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/discover.py`:

```python
"""循环发现（spec §7.3 候选发现 + §7.5 验证报告）。确定性，纯函数。"""
from statistics import median


def _symbol(tok: dict) -> str:
    if tok["kind"] == "skill":
        return f"sk:{tok['skill_id']}"
    return f"{tok['kind']}:{tok.get('key', '')}"


def _token_end(tok: dict) -> int:
    return tok["end_ms"] if tok.get("end_ms") is not None else tok["t_ms"]


def _is_contig_sub(small: tuple, big: tuple) -> bool:
    if len(small) >= len(big):
        return False
    return any(big[i:i + len(small)] == small
               for i in range(len(big) - len(small) + 1))


def find_candidates(tokens: list[dict], min_len: int = 2, max_len: int = 8,
                    min_repeats: int = 2) -> list[tuple[tuple, list[int]]]:
    syms = [_symbol(t) for t in tokens]
    found: dict[tuple, list[int]] = {}
    upper = min(max_len, len(syms) // min_repeats)
    for n in range(min_len, upper + 1):
        for start in range(0, len(syms) - n + 1):
            unit = tuple(syms[start:start + n])
            if unit in found:
                continue
            occs, j = [], start
            while j + n <= len(syms):
                if tuple(syms[j:j + n]) == unit:
                    occs.append(j)
                    j += n
                else:
                    j += 1
            if len(occs) >= min_repeats:
                found[unit] = occs
    ranked = sorted(found.items(),
                    key=lambda kv: len(kv[0]) * len(kv[1]), reverse=True)
    kept: list[tuple[tuple, list[int]]] = []
    for unit, occs in ranked:
        if any(_is_contig_sub(unit, k_unit) for k_unit, _ in kept):
            continue
        kept.append((unit, occs))
    return kept


def build_candidate(tokens: list[dict], unit_len: int, offsets: list[int]) -> dict:
    body: list[dict] = []
    first = offsets[0]
    for k in range(unit_len):
        tok = tokens[first + k]
        if tok["kind"] == "skill":
            body.append({"skill": tok["skill_id"]})
        else:
            body.append({"op": tok["kind"], "key": tok.get("key", "")})
        if k + 1 < unit_len:
            gaps = sorted(
                tokens[o + k + 1]["t_ms"] - _token_end(tokens[o + k])
                for o in offsets)
            spread = gaps[-1] - gaps[0]
            body.append({"gap": round(median(gaps)),
                         "tol": max(40, round(spread / 2) + 20)})
    spans = [[tokens[o]["t_ms"], _token_end(tokens[o + unit_len - 1])]
             for o in offsets]
    return {"body": body, "occurrences": spans, "iterations": len(offsets),
            "unit_len": unit_len, "token_offsets": offsets}


def verify(tokens: list[dict], candidate: dict) -> dict:
    """确定性回放验证（spec §7.5）：提案是假设，报告是证据。"""
    n = candidate["unit_len"]
    offsets = candidate["token_offsets"]
    gap_items = [b for b in candidate["body"] if "gap" in b]
    warnings: list[str] = []
    complete = 0
    for idx, o in enumerate(offsets):
        ok = True
        for k in range(n - 1):
            a, b = tokens[o + k], tokens[o + k + 1]
            gap = b["t_ms"] - _token_end(a)
            spec = gap_items[k]
            if abs(gap - spec["gap"]) > spec["tol"]:
                warnings.append(
                    f"第 {idx + 1} 次迭代 gap 实测 {gap}ms，超出 {spec['gap']}±{spec['tol']}")
                ok = False
        if ok:
            complete += 1
    covered = n * len(offsets)
    coverage = round(covered / len(tokens), 3) if tokens else 0.0
    return {"iterations": len(offsets), "complete": complete,
            "coverage": coverage, "warnings": warnings,
            "uncovered_before": offsets[0],
            "uncovered_after": len(tokens) - (offsets[-1] + n)}


def discover_rotations(tokens: list[dict], top_n: int = 3):
    out = []
    for unit, offsets in find_candidates(tokens)[:top_n]:
        cand = build_candidate(tokens, len(unit), offsets)
        out.append((cand, verify(tokens, cand)))
    return out
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_discover.py -x
```

```bash
git add backend/src/vd/discover.py backend/tests/test_discover.py
git commit -m "feat(backend): rotation candidate discovery with falsifiable verification"
```

---

### 任务 11：agent — LLM 命名（Anthropic SDK）

**Files:**
- Modify: `backend/pyproject.toml`（dependencies 追加 `"anthropic>=0.40"`，然后 `uv sync`）
- Create: `backend/src/vd/agent.py`
- Create: `backend/tests/test_agent.py`

**Interfaces:**
- Produces:
  - `agent.MODEL = "claude-opus-5"`
  - `agent.RotationNaming`（pydantic：name/note/param_positions）
  - `agent.describe_candidate(candidate, skill_names) -> str`（IR 文本化——只发文本与目录，绝不发画面，spec §7.1）
  - `agent.name_candidate(candidate, skill_names, client=None) -> dict`——成功 `{"ok": True, "name", "note", "param_positions"}`；`stop_reason=="refusal"` 或任何异常 → `{"ok": False, "error"}`（spec §10 失败无副作用）。client 形参可注入 fake（测试/评测集用）
- 记录性偏离：未启用 server-side fallbacks——失败已优雅降级为空提案，命名任务拒绝概率极低（见 Global Constraints）

- [ ] **Step 1: 加依赖**

`backend/pyproject.toml` 的 `dependencies` 追加 `"anthropic>=0.40",`，然后：

```bash
cd backend && uv sync
```

- [ ] **Step 2: 写失败测试**

`backend/tests/test_agent.py`:

```python
from vd import agent
from vd.agent import RotationNaming

CAND = {"body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
        "occurrences": [[0, 1300]], "iterations": 3, "unit_len": 2,
        "token_offsets": [0]}
NAMES = {"sk_wh": "旋风连", "sk_fb": "火球术"}


class FakeResponse:
    stop_reason = "end_turn"
    parsed_output = RotationNaming(name="单体稳定输出", note="旋风接火球的填充循环",
                                   param_positions=[1])


class FakeMessages:
    def __init__(self, response=None, exc=None):
        self.response, self.exc, self.calls = response, exc, []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return self.response


class FakeClient:
    def __init__(self, response=None, exc=None):
        self.messages = FakeMessages(response, exc)


def test_describe_candidate_uses_names():
    text = agent.describe_candidate(CAND, NAMES)
    assert "旋风连" in text and "等待200ms" in text and "重复 3 次" in text


def test_name_candidate_success():
    fake = FakeClient(response=FakeResponse())
    r = agent.name_candidate(CAND, NAMES, client=fake)
    assert r == {"ok": True, "name": "单体稳定输出",
                 "note": "旋风接火球的填充循环", "param_positions": [1]}
    assert fake.messages.calls[0]["model"] == "claude-opus-5"
    assert fake.messages.calls[0]["output_format"] is RotationNaming


def test_name_candidate_refusal():
    resp = FakeResponse()
    resp.stop_reason = "refusal"
    r = agent.name_candidate(CAND, NAMES, client=FakeClient(response=resp))
    assert r["ok"] is False and "拒绝" in r["error"]


def test_name_candidate_exception_is_contained():
    r = agent.name_candidate(CAND, NAMES, client=FakeClient(exc=RuntimeError("网络炸了")))
    assert r["ok"] is False and "网络炸了" in r["error"]
```

- [ ] **Step 3: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_agent.py -x
```

- [ ] **Step 4: 实现**

`backend/src/vd/agent.py`:

```python
"""LLM 命名与解释（spec §7.3 解释与命名步）。纯函数：失败返回错误、无副作用（spec §10）。
只发送 IR 文本与 Catalog 名称，绝不发送画面（spec §7.1）。"""
import anthropic
from pydantic import BaseModel

MODEL = "claude-opus-5"

SYSTEM = (
    "你是动作游戏攻略专家。给你一个从操作录像里发现的重复循环"
    "（技能/按键序列与节奏统计），请给它起一个简短贴切的中文名字（不超过 8 个字），"
    "写一句玩家能读懂的说明，并给出 body 中适合作为可替换参数的位置下标"
    "（0 起，按含 gap 在内的 body 数组下标）。没有合适的参数位就给空列表。"
)


class RotationNaming(BaseModel):
    name: str
    note: str
    param_positions: list[int]


def describe_candidate(candidate: dict, skill_names: dict[str, str]) -> str:
    parts = []
    for item in candidate["body"]:
        if "skill" in item:
            parts.append(skill_names.get(item["skill"], item["skill"]))
        elif "gap" in item:
            parts.append(f"等待{item['gap']}ms±{item['tol']}")
        else:
            parts.append(f"{item['op']} {item.get('key', '')}".strip())
    return (f"循环体：[{' → '.join(parts)}]，"
            f"在录像中连续重复 {candidate['iterations']} 次。")


def name_candidate(candidate: dict, skill_names: dict[str, str],
                   client=None) -> dict:
    client = client or anthropic.Anthropic()
    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM,
            messages=[{"role": "user",
                       "content": describe_candidate(candidate, skill_names)}],
            output_format=RotationNaming,
        )
        if response.stop_reason == "refusal":
            return {"ok": False, "error": "LLM 拒绝了该请求"}
        p = response.parsed_output
        return {"ok": True, "name": p.name, "note": p.note,
                "param_positions": p.param_positions}
    except Exception as e:  # noqa: BLE001 —— agent 失败必须被包住（spec §10）
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 5: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/pyproject.toml backend/uv.lock backend/src/vd/agent.py backend/tests/test_agent.py
git commit -m "feat(backend): LLM naming via anthropic sdk with injectable client"
```

---

### 任务 12：infer / discover API 编排

**Files:**
- Modify: `backend/src/vd/api.py`
- Modify: `backend/tests/test_api.py`（追加）

**Interfaces:**
- Produces:
  - `POST /api/analyses/{id}/infer` → `{"links", "conflicts", "keymap_suggestions", "span_proposals"}`——聚合 L0 → ops，聚合 L1 直接用；纯计算不写库；无 keymap 绑定时 binds 为空（不产 three_way）
  - `POST /api/analyses/{id}/discover` → `{"proposals", "unmatched", "ambiguities"}`——ops → match_all → discover_rotations → LLM 命名（`api._agent_client()` 可 monkeypatch 注入 fake；命名失败用 "未命名循环" + error 作 note）→ 每个候选存 proposal
  - `api._agent_client() -> anthropic 客户端 | None`（None = agent 内部自建真实客户端）
- 404：analysis 不存在

- [ ] **Step 1: 写失败测试**

`backend/tests/test_api.py` 追加：

```python
def _seed_rotation_annotation(client, analysis):
    """L0 打三轮 [tap Q, tap Q, hold LMB, tap 2]，L1 标三次火球，注册目录与键位。"""
    sk_wh = client.post("/api/skills", json={"name": "旋风连", "pattern": [
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 200, "tol_ms": 60},
        {"op": "hold", "button": "LMB", "ms": 300, "tol_ms": 100}]}).json()
    sk_fb = client.post("/api/skills", json={
        "name": "火球术", "cast_ms": 400, "anim_ms": 720,
        "pattern": [{"op": "tap", "key": "2"}]}).json()
    client.post("/api/keymaps", json={"keymap_id": "km_t", "binds": {
        sk_fb["id"]: ["2"]}})
    client.patch(f"/api/analyses/{analysis['id']}/keymap",
                 json={"keymap_id": "km_t", "version": 1})
    l0 = analysis["lanes"][0]["takes"][0]
    l1 = analysis["lanes"][1]["takes"][0]
    t = 0
    for _ in range(3):
        for key, dur in (("Q", None), ("Q", None)):
            client.post(f"/api/takes/{l0['id']}/marks",
                        json={"t_ms": t, "kind": "input", "label": key})
            t += 300
        client.post(f"/api/takes/{l0['id']}/marks",
                    json={"t_ms": t - 100, "kind": "input", "label": "LMB",
                          "end_ms": t + 200})
        t += 400
        client.post(f"/api/takes/{l0['id']}/marks",
                    json={"t_ms": t, "kind": "input", "label": "2"})
        client.post(f"/api/takes/{l1['id']}/marks",
                    json={"t_ms": t + 60, "kind": "input", "label": "火球术"})
        t += 800
    return sk_wh, sk_fb


def test_infer_endpoint(client, analysis):
    _seed_rotation_annotation(client, analysis)
    r = client.post(f"/api/analyses/{analysis['id']}/infer")
    assert r.status_code == 200
    body = r.json()
    assert len(body["links"]) == 3                      # 三次火球都对齐
    assert not [c for c in body["conflicts"] if c["type"] == "three_way"]
    assert len(body["span_proposals"]) == 3             # 火球有 cast/anim → 补区间
    assert body["keymap_suggestions"] == []             # 已绑定一致的键不再提议（API 层过滤）


def test_discover_endpoint_persists_proposals(client, analysis, monkeypatch):
    _seed_rotation_annotation(client, analysis)

    from test_agent import FakeClient, FakeResponse   # 同目录测试模块（pytest rootdir 顶层导入）
    from vd import api as api_module
    monkeypatch.setattr(api_module, "_agent_client", lambda: FakeClient(FakeResponse()))

    r = client.post(f"/api/analyses/{analysis['id']}/discover")
    assert r.status_code == 200
    body = r.json()
    assert body["proposals"], "应至少产出一个提案"
    p = body["proposals"][0]
    assert p["payload"]["name"] == "单体稳定输出"
    assert p["report"]["coverage"] > 0
    stored = client.get(f"/api/analyses/{analysis['id']}/proposals").json()
    assert len(stored) == len(body["proposals"])


def test_infer_404(client):
    assert client.post("/api/analyses/nope/infer").status_code == 404
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/api.py`（import 追加 `from vd import agent, align, discover, matcher, ops as ops_module`）：

```python
def _agent_client():
    """真实运行返回 None（agent 自建客户端）；测试 monkeypatch 注入 fake。"""
    return None


def _aggregated_lane_marks(conn, lane_id: str) -> list[dict]:
    takes = []
    for t in conn.execute(
            "SELECT id FROM takes WHERE lane_id=? ORDER BY idx", (lane_id,)):
        takes.append([dict(r) for r in conn.execute(
            "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (t["id"],))])
    return agg.aggregate_lane(takes)["aggregated"]


def _analysis_inputs(conn, analysis_id: str):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    lanes = {l["layer"]: l for l in tree["lanes"]}
    l0_ops = ops_module.marks_to_ops(_aggregated_lane_marks(conn, lanes["L0"]["id"]))
    l1_marks = _aggregated_lane_marks(conn, lanes["L1"]["id"])
    skills = store.list_skills(conn)
    binds = {}
    if tree.get("keymap_id"):
        km = store.get_keymap(conn, tree["keymap_id"], tree["keymap_version"])
        binds = km["binds"] if km else {}
    return tree, l0_ops, l1_marks, skills, binds


@app.post("/api/analyses/{analysis_id}/infer")
def run_infer(analysis_id: str, conn=Depends(get_conn)):
    _, l0_ops, l1_marks, skills, binds = _analysis_inputs(conn, analysis_id)
    by_name = {s["name"]: s for s in skills}
    links, conflicts = align.align_l1(l0_ops, l1_marks, by_name, binds)
    suggestions = [s for s in align.infer_keymap(links, by_name)
                   if s["key"] not in (binds.get(s["skill_id"]) or [])]  # 已绑定一致的不再提议
    return {"links": links, "conflicts": conflicts,
            "keymap_suggestions": suggestions,
            "span_proposals": align.complete_spans(l1_marks, by_name)}


@app.post("/api/analyses/{analysis_id}/discover")
def run_discover(analysis_id: str, conn=Depends(get_conn)):
    _, l0_ops, _, skills, _ = _analysis_inputs(conn, analysis_id)
    matched = matcher.match_all(l0_ops, skills)
    skill_names = {s["id"]: s["name"] for s in skills}
    results = []
    for cand, report in discover.discover_rotations(matched["tokens"]):
        naming = agent.name_candidate(cand, skill_names, client=_agent_client())
        payload = {
            "name": naming.get("name") or "未命名循环",
            "note": naming.get("note") or naming.get("error", ""),
            "body": cand["body"],
            "occurrences": cand["occurrences"],
            "param_positions": naming.get("param_positions", []),
        }
        results.append(store.create_proposal(
            conn, analysis_id=analysis_id, kind="rotation",
            payload=payload, report=report))
    return {"proposals": results,
            "unmatched": len(matched["unmatched"]),
            "ambiguities": matched["ambiguities"]}
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/api.py backend/tests/test_api.py
git commit -m "feat(backend): infer and discover orchestration endpoints"
```

---

### 任务 13：评测集与真实 API 评测入口

**Files:**
- Create: `backend/tests/test_eval_discovery.py`
- Create: `backend/src/vd/eval.py`

**Interfaces:**
- Produces:
  - `test_eval_discovery.py`——黄金样例端到端评测（FakeLLM）：完整标注（含抖动）→ discover → **断言覆盖率 ≥ 0.6、提案含期望 skill 序、接受后 rotations 落库**。spec §11：任何 prompt/算法改动必须过此集
  - `uv run python -m vd.eval`——真实 API 评测（需 ANTHROPIC_API_KEY）：对黄金候选跑真实命名，打印结果；任一 `ok=False` 退出码 1

- [ ] **Step 1: 写评测（即失败测试）**

`backend/tests/test_eval_discovery.py`:

```python
"""黄金样例评测集（spec §11）。改 prompt、改匹配器、改发现算法都必须先过这里。"""


def test_golden_rotation_discovery_end_to_end(client, analysis, monkeypatch):
    from test_agent import FakeClient, FakeResponse
    from test_api import _seed_rotation_annotation
    from vd import api as api_module
    monkeypatch.setattr(api_module, "_agent_client", lambda: FakeClient(FakeResponse()))

    sk_wh, sk_fb = _seed_rotation_annotation(client, analysis)
    body = client.post(f"/api/analyses/{analysis['id']}/discover").json()

    assert body["proposals"], "黄金样例必须发现至少一个循环"
    best = max(body["proposals"], key=lambda p: p["report"]["coverage"])
    assert best["report"]["coverage"] >= 0.6, f"覆盖率退化：{best['report']}"
    skill_refs = [i["skill"] for i in best["payload"]["body"] if "skill" in i]
    assert sk_wh["id"] in skill_refs and sk_fb["id"] in skill_refs, \
        f"循环体应含旋风连与火球术：{best['payload']['body']}"
    assert best["report"]["iterations"] >= 2

    accepted = client.post(f"/api/proposals/{best['id']}/accept").json()
    assert accepted["rotation"]["derived_from"] == [analysis["id"]]
    assert client.get("/api/rotations").json()
```

- [ ] **Step 2: 运行（应直接通过——它复用任务 12 已验证的链路；若失败即为回归，修复后再继续）**

```bash
cd backend && uv run pytest tests/test_eval_discovery.py -x
```

- [ ] **Step 3: 真实评测入口**

`backend/src/vd/eval.py`:

```python
"""真实 LLM 评测：uv run python -m vd.eval（需 ANTHROPIC_API_KEY 或 ant 登录态）。
CI 不跑这里；这是人工触发的 prompt 质量抽查（spec §11）。"""
import sys

from vd import agent

GOLDEN = [
    ({"body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
      "occurrences": [[0, 1300]], "iterations": 6, "unit_len": 2,
      "token_offsets": [0]},
     {"sk_wh": "旋风连", "sk_fb": "火球术"}),
    ({"body": [{"skill": "sk_fb"}, {"gap": 1100, "tol": 60}],
      "occurrences": [[0, 1300]], "iterations": 12, "unit_len": 1,
      "token_offsets": [0]},
     {"sk_fb": "火球术"}),
]


def main() -> int:
    failures = 0
    for cand, names in GOLDEN:
        r = agent.name_candidate(cand, names)
        if r["ok"]:
            print(f"✓ {r['name']} — {r['note']}（参数位 {r['param_positions']}）")
        else:
            failures += 1
            print(f"✗ 失败：{r['error']}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 全量验证并提交**

```bash
cd backend && uv run pytest
```

```bash
git add backend/tests/test_eval_discovery.py backend/src/vd/eval.py
git commit -m "test(backend): golden discovery evalset and real-API eval entry"
```

---

# 部分 C：前端（任务 14–19）

### 任务 14：类型与 client 扩展

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`（追加）

**Interfaces:**
- Produces（后续任务逐字消费）：类型 `Skill / PatternItem / Keymap / Proposal / Rotation / InferResult / Conflict / DiscoverResult`；`AnalysisTree` 增 `keymap_id: string | null; keymap_version: number | null`；client 方法 `listSkills / createSkill / patchSkill / deleteSkill / listKeymaps / saveKeymap / bindKeymap / runInfer / runDiscover / listProposals / acceptProposal / rejectProposal / listRotations`

- [ ] **Step 1: 追加失败测试**

`frontend/src/api/client.test.ts` 追加：

```ts
test('createSkill posts to /api/skills', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'sk_1', name: '火球术' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const s = await api.createSkill({ name: '火球术', pattern: [{ op: 'tap', key: '2' }] })
  expect(s.id).toBe('sk_1')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/skills')
  expect(JSON.parse(init.body).pattern[0].op).toBe('tap')
})

test('runDiscover posts to discover endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ proposals: [], unmatched: 0, ambiguities: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const r = await api.runDiscover('an_1')
  expect(r.proposals).toEqual([])
  expect(fetchMock.mock.calls[0][0]).toBe('/api/analyses/an_1/discover')
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

- [ ] **Step 3: 实现**

`frontend/src/api/types.ts` 追加（并把 `AnalysisTree` 补上 `keymap_id: string | null; keymap_version: number | null`）：

```ts
export interface PatternItem {
  op: 'tap' | 'hold' | 'chord' | 'wheel' | 'gap' | 'skill'
  key?: string
  button?: string
  keys?: string[]
  ms?: number
  tol_ms?: number
  ref?: string
}

export interface Skill {
  id: string; name: string; class: string | null
  cd_ms: number | null; cast_ms: number | null; anim_ms: number | null
  cancelable: boolean; pattern: PatternItem[]
}

export interface Keymap {
  id: string; version: number; class: string | null
  binds: Record<string, string[]>
}

export interface Conflict {
  type: 'undefined_skill' | 'no_l0' | 'three_way'
  t_ms: number
  label?: string
  l0_key?: string
  l1_label?: string
  keymap_expected?: string[]
}

export interface InferResult {
  links: { l1_t_ms: number; label: string; l0_key: string; l0_t_ms: number; dt_ms: number }[]
  conflicts: Conflict[]
  keymap_suggestions: { skill_id: string; key: string; support: number; total: number }[]
  span_proposals: { mark_id: string | null; t_ms: number; proposed_end_ms: number; confidence: number }[]
}

export interface Proposal {
  id: string; analysis_id: string; kind: 'rotation'
  payload: {
    name: string; note: string
    body: Record<string, unknown>[]
    occurrences: [number, number][]
    param_positions: number[]
  }
  report: {
    iterations: number; complete: number; coverage: number
    warnings: string[]; uncovered_before: number; uncovered_after: number
  }
  status: 'pending' | 'accepted' | 'rejected'
}

export interface Rotation {
  id: string; name: string; note: string | null
  body: Record<string, unknown>[]; params: unknown[]
  derived_from: string[]
}

export interface DiscoverResult {
  proposals: Proposal[]
  unmatched: number
  ambiguities: { t_ms: number; skills: string[] }[]
}
```

`frontend/src/api/client.ts` 的 `api` 对象追加（import 类型同步补）：

```ts
  listSkills: () => fetch('/api/skills').then(r => j<Skill[]>(r)),
  createSkill: (s: { name: string; class_?: string; cd_ms?: number; cast_ms?: number; anim_ms?: number; cancelable?: boolean; pattern: PatternItem[] }) =>
    post('/api/skills', s).then(r => j<Skill>(r)),
  patchSkill: (id: string, patch: Partial<{ name: string; class_: string; cd_ms: number; cast_ms: number; anim_ms: number; cancelable: boolean; pattern: PatternItem[] }>) =>
    fetch(`/api/skills/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(r => j<Skill>(r)),
  deleteSkill: (id: string) => fetch(`/api/skills/${id}`, { method: 'DELETE' }).then(r => j<{ ok: boolean }>(r)),

  listKeymaps: () => fetch('/api/keymaps').then(r => j<Keymap[]>(r)),
  saveKeymap: (k: { keymap_id: string; class_?: string; binds: Record<string, string[]> }) =>
    post('/api/keymaps', k).then(r => j<Keymap>(r)),
  bindKeymap: (analysisId: string, keymapId: string, version: number) =>
    fetch(`/api/analyses/${analysisId}/keymap`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keymap_id: keymapId, version }) }).then(r => j<AnalysisTree>(r)),

  runInfer: (analysisId: string) =>
    post(`/api/analyses/${analysisId}/infer`).then(r => j<InferResult>(r)),
  runDiscover: (analysisId: string) =>
    post(`/api/analyses/${analysisId}/discover`).then(r => j<DiscoverResult>(r)),
  listProposals: (analysisId: string) =>
    fetch(`/api/analyses/${analysisId}/proposals`).then(r => j<Proposal[]>(r)),
  acceptProposal: (id: string) =>
    post(`/api/proposals/${id}/accept`).then(r => j<{ proposal: Proposal; rotation: Rotation }>(r)),
  rejectProposal: (id: string) =>
    post(`/api/proposals/${id}/reject`).then(r => j<Proposal>(r)),
  listRotations: () => fetch('/api/rotations').then(r => j<Rotation[]>(r)),
```

（`bindKeymap` 的返回是 analyses 行而非完整树——类型用 `AnalysisTree` 的部分字段即可，简单起见按 `AnalysisTree` 声明，运行时多余字段无害。）

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd frontend && pnpm test && pnpm build
```

```bash
git add frontend/src/api
git commit -m "feat(frontend): catalog/keymap/inference api client"
```

---

### 任务 15：技能目录页

**Files:**
- Create: `frontend/src/pages/CatalogPage.tsx`

**Interfaces:**
- Consumes: `api.listSkills/createSkill/patchSkill/deleteSkill`、`skill 层级判据`（pattern 含 skill ref → L2 徽标）
- Produces: `CatalogPage({ onBack })`——技能表格（名称/职业/cd/cast/anim/层级/删除）、点行编辑、表单（数值可留空）、pattern JSON 文本域 + 解析校验（非法 JSON 禁止提交并提示）

- [ ] **Step 1: 实现**

`frontend/src/pages/CatalogPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PatternItem, Skill } from '../api/types'
import { useErrors } from '../state/errors'

const EMPTY = { name: '', class_: '', cd_ms: '', cast_ms: '', anim_ms: '', pattern: '[]' }

const layerOf = (pattern: PatternItem[]) =>
  pattern.some(i => i.op === 'skill') ? 'L2' : 'L1'

export function CatalogPage({ onBack }: { onBack: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [form, setForm] = useState({ ...EMPTY })
  const [editing, setEditing] = useState<string | null>(null)

  const refresh = () => { void api.listSkills().then(setSkills) }
  useEffect(refresh, [])

  const parsePattern = (): PatternItem[] | null => {
    try {
      const p = JSON.parse(form.pattern)
      return Array.isArray(p) ? p : null
    } catch { return null }
  }

  const submit = async () => {
    const pattern = parsePattern()
    if (!form.name || pattern === null) {
      useErrors.getState().pushError('技能名必填，pattern 必须是合法 JSON 数组')
      return
    }
    const num = (v: string) => (v === '' ? undefined : Number(v))
    const payload = { name: form.name, class_: form.class_ || undefined,
      cd_ms: num(form.cd_ms), cast_ms: num(form.cast_ms), anim_ms: num(form.anim_ms), pattern }
    if (editing) await api.patchSkill(editing, payload)
    else await api.createSkill(payload)
    setForm({ ...EMPTY }); setEditing(null); refresh()
  }

  const edit = (s: Skill) => {
    setEditing(s.id)
    setForm({ name: s.name, class_: s.class ?? '',
      cd_ms: s.cd_ms?.toString() ?? '', cast_ms: s.cast_ms?.toString() ?? '',
      anim_ms: s.anim_ms?.toString() ?? '',
      pattern: JSON.stringify(s.pattern, null, 1) })
  }

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>技能目录</h1>
      <table>
        <tbody>
          {skills.map(s => (
            <tr key={s.id} onClick={() => edit(s)} style={{ cursor: 'pointer' }}>
              <td>{s.name}</td><td>{s.class ?? '—'}</td>
              <td>cd {s.cd_ms ?? '—'}</td><td>前摇 {s.cast_ms ?? '—'}</td>
              <td>动作锁 {s.anim_ms ?? '—'}</td><td>{layerOf(s.pattern)}</td>
              <td><button onClick={async e => {
                e.stopPropagation(); await api.deleteSkill(s.id); refresh()
              }}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{editing ? '编辑技能' : '新建技能'}</h2>
      <p>
        <input placeholder="技能名" value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="职业" value={form.class_}
          onChange={e => setForm({ ...form, class_: e.target.value })} />
      </p>
      <p>
        <input placeholder="cd_ms" value={form.cd_ms}
          onChange={e => setForm({ ...form, cd_ms: e.target.value })} />
        <input placeholder="cast_ms（前摇）" value={form.cast_ms}
          onChange={e => setForm({ ...form, cast_ms: e.target.value })} />
        <input placeholder="anim_ms（动作锁）" value={form.anim_ms}
          onChange={e => setForm({ ...form, anim_ms: e.target.value })} />
      </p>
      <p>
        <textarea rows={5} style={{ width: '100%' }} value={form.pattern}
          onChange={e => setForm({ ...form, pattern: e.target.value })} />
      </p>
      <p>
        <button onClick={() => void submit()}>{editing ? '保存' : '创建'}</button>
        {editing && <button onClick={() => { setEditing(null); setForm({ ...EMPTY }) }}>取消编辑</button>}
      </p>
      <p style={{ color: '#888' }}>
        pattern 示例：[{'{'}"op":"tap","key":"2"{'}'}] · gap 项 {'{'}"op":"gap","ms":300,"tol_ms":80{'}'} ·
        连招引用 {'{'}"op":"skill","ref":"sk_xxx"{'}'}（含 skill 引用即 L2）
      </p>
    </div>
  )
}
```

- [ ] **Step 2: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src/pages/CatalogPage.tsx
git commit -m "feat(frontend): skill catalog page"
```

---

### 任务 16：键位页与工作台绑定

**Files:**
- Create: `frontend/src/pages/KeymapPage.tsx`
- Modify: `frontend/src/App.tsx`（Workbench 头部 keymap 下拉）

**Interfaces:**
- Consumes: `api.listKeymaps/saveKeymap/listSkills/bindKeymap`、`useSession`
- Produces: `KeymapPage({ onBack })`——keymap id 输入（默认 `km-default`）、绑定行（技能下拉 + 逗号分隔键串）、加行/删行、保存即新版本并显示版本号；Workbench 头部 `<select>` 列出各 keymap 的**最新版本**，选择后 PATCH 绑定并刷新树

- [ ] **Step 1: 实现 KeymapPage**

`frontend/src/pages/KeymapPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Keymap, Skill } from '../api/types'

export function KeymapPage({ onBack }: { onBack: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
  const [kmId, setKmId] = useState('km-default')
  const [rows, setRows] = useState<{ skill_id: string; keys: string }[]>([])

  const refresh = () => { void api.listKeymaps().then(setKeymaps) }
  useEffect(() => { void api.listSkills().then(setSkills); refresh() }, [])

  const latest = keymaps.filter(k => k.id === kmId).sort((a, b) => b.version - a.version)[0]

  const load = () => {
    if (!latest) { setRows([]); return }
    setRows(Object.entries(latest.binds).map(([skill_id, keys]) =>
      ({ skill_id, keys: keys.join(',') })))
  }

  const save = async () => {
    const binds: Record<string, string[]> = {}
    for (const r of rows) {
      if (r.skill_id && r.keys.trim()) binds[r.skill_id] = r.keys.split(',').map(s => s.trim())
    }
    await api.saveKeymap({ keymap_id: kmId, binds })
    refresh()
  }

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>键位（Keymap）</h1>
      <p>
        <input value={kmId} onChange={e => setKmId(e.target.value)} placeholder="keymap id" />
        <button onClick={load}>载入最新版{latest ? `（v${latest.version}）` : '（暂无）'}</button>
      </p>
      {rows.map((r, i) => (
        <p key={i}>
          <select value={r.skill_id}
            onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, skill_id: e.target.value } : x))}>
            <option value="">选择技能</option>
            {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="键，逗号分隔（如 2 或 Shift+2）" value={r.keys}
            onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, keys: e.target.value } : x))} />
          <button onClick={() => setRows(rows.filter((_, j) => j !== i))}>删行</button>
        </p>
      ))}
      <p>
        <button onClick={() => setRows([...rows, { skill_id: '', keys: '' }])}>+ 加绑定</button>
        <button onClick={() => void save()}>保存（生成新版本）</button>
      </p>
      <p style={{ color: '#888' }}>保存永远生成新版本——旧 Analysis 钉住旧版本，语义不漂移（spec §5.6）。一键可绑多个技能：给多行不同技能填同一个键即可。</p>
    </div>
  )
}
```

- [ ] **Step 2: Workbench 头部绑定下拉**

`frontend/src/App.tsx` 的 Workbench：`{analysis.name}` 后追加（import 追加 `type { Keymap }`；组件内加状态与效果）：

```tsx
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
  useEffect(() => { void api.listKeymaps().then(setKeymaps) }, [])
  const latestByIdEntries = [...new Map(
    keymaps.sort((a, b) => a.version - b.version).map(k => [k.id, k])).entries()]
```

头部 JSX（返回按钮行内）：

```tsx
        <select
          value={analysis.keymap_id ? `${analysis.keymap_id}@${analysis.keymap_version}` : ''}
          onChange={async e => {
            const [kid, ver] = e.target.value.split('@')
            if (!kid) return
            await api.bindKeymap(analysis.id, kid, Number(ver))
            void api.getAnalysis(analysis.id).then(setAnalysis)
          }}>
          <option value="">未绑定键位</option>
          {latestByIdEntries.map(([id, k]) => (
            <option key={id} value={`${id}@${k.version}`}>{id} v{k.version}</option>
          ))}
          {analysis.keymap_id && !latestByIdEntries.some(([id, k]) =>
            id === analysis.keymap_id && k.version === analysis.keymap_version) && (
            <option value={`${analysis.keymap_id}@${analysis.keymap_version}`}>
              {analysis.keymap_id} v{analysis.keymap_version}（钉住的旧版）
            </option>
          )}
        </select>
```

- [ ] **Step 3: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src
git commit -m "feat(frontend): keymap page and analysis binding"
```

---

### 任务 17：打表回填 Skill Catalog

**Files:**
- Modify: `frontend/src/tally/TallyBar.tsx`

**Interfaces:**
- Consumes: `api.listSkills/patchSkill`
- Produces（spec §6.5 回填）：当打表 marker ≥2 时，显示「回填 [最近间隔] → 技能下拉 + 字段下拉(anim_ms/cast_ms/cd_ms) + 回填按钮」，写入后提示已写值

- [ ] **Step 1: 实现**

`frontend/src/tally/TallyBar.tsx`：组件内追加状态与逻辑（import 追加 `useEffect, useState` 与 `type { Skill }`）：

```tsx
  const [skills, setSkills] = useState<Skill[]>([])
  const [backfillSkill, setBackfillSkill] = useState('')
  const [backfillField, setBackfillField] = useState<'anim_ms' | 'cast_ms' | 'cd_ms'>('anim_ms')
  const [backfilled, setBackfilled] = useState('')
  useEffect(() => { void api.listSkills().then(setSkills) }, [])

  const backfill = async () => {
    if (!backfillSkill || lastGap === null) return
    await api.patchSkill(backfillSkill, { [backfillField]: lastGap })
    const name = skills.find(s => s.id === backfillSkill)?.name ?? backfillSkill
    setBackfilled(`已把 ${lastGap}ms 写入 ${name}.${backfillField}`)
  }
```

JSX 在「清空打表」按钮后追加：

```tsx
      {lastGap !== null && (
        <span>
          回填 {lastGap}ms →
          <select value={backfillSkill} onChange={e => setBackfillSkill(e.target.value)}>
            <option value="">选技能</option>
            {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={backfillField}
            onChange={e => setBackfillField(e.target.value as 'anim_ms' | 'cast_ms' | 'cd_ms')}>
            <option value="anim_ms">anim_ms</option>
            <option value="cast_ms">cast_ms</option>
            <option value="cd_ms">cd_ms</option>
          </select>
          <button onClick={() => void backfill()}>回填</button>
          {backfilled && <em style={{ color: '#8c8' }}> {backfilled}</em>}
        </span>
      )}
```

- [ ] **Step 2: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src/tally/TallyBar.tsx
git commit -m "feat(frontend): tally interval backfill into skill catalog"
```

---

### 任务 18：推断面板

**Files:**
- Create: `frontend/src/panel/InferPanel.tsx`
- Modify: `frontend/src/App.tsx`（右栏 EntryPanel 之后挂载）

**Interfaces:**
- Consumes: `api.runInfer/runDiscover/listProposals/acceptProposal/rejectProposal/listSkills`、`useSession`、`seekMs`
- Produces: `InferPanel()`——「运行对齐」→ 冲突清单（类型化中文文案，点击 seek 到 t_ms）+ 键位反推建议 + 补区间数；「发现循环」→ 提案卡（名称、说明、覆盖率、complete/iterations、warnings、body 预览用技能名、接受/拒绝按钮，状态徽标）；未匹配/歧义计数提示

- [ ] **Step 1: 实现**

`frontend/src/panel/InferPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Conflict, DiscoverResult, InferResult, Proposal, Skill } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { fmtTc } from '../time/frames'

const conflictText = (c: Conflict): string => {
  if (c.type === 'undefined_skill') return `目录缺定义：「${c.label}」`
  if (c.type === 'no_l0') return `「${c.label}」附近 500ms 内没有 L0 操作`
  return `三方冲突：L0 按键「${c.l0_key}」· L1「${c.l1_label}」· 键位期望 ${c.keymap_expected?.join('/')}`
}

export function InferPanel() {
  const analysis = useSession(s => s.analysis)
  const [infer, setInfer] = useState<InferResult | null>(null)
  const [discover, setDiscover] = useState<DiscoverResult | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  useEffect(() => { void api.listSkills().then(setSkills) }, [])

  if (!analysis) return null
  const names = new Map(skills.map(s => [s.id, s.name]))

  const bodyText = (p: Proposal) =>
    p.payload.body.map(item =>
      'skill' in item ? (names.get(item.skill as string) ?? item.skill)
        : 'gap' in item ? `等待${item.gap}ms`
          : `${item.op} ${item.key ?? ''}`).join(' → ')

  const refreshProposals = () => { void api.listProposals(analysis.id).then(setProposals) }

  return (
    <div className="entry-panel">
      <h3>推断</h3>
      <p>
        <button onClick={() => void api.runInfer(analysis.id).then(setInfer)}>运行对齐</button>
        <button onClick={async () => {
          const d = await api.runDiscover(analysis.id)
          setDiscover(d); refreshProposals()
        }}>发现循环</button>
      </p>
      {infer && (
        <div>
          <p>对齐 {infer.links.length} 条 · 补区间提议 {infer.span_proposals.length} 个</p>
          {infer.conflicts.map((c, i) => (
            <p key={i} style={{ color: '#f80', cursor: 'pointer' }}
              onClick={() => seekMs(c.t_ms)}>
              ⚠ [{fmtTc(c.t_ms)}] {conflictText(c)}
            </p>
          ))}
          {infer.keymap_suggestions.map((s, i) => (
            <p key={i} style={{ color: '#8cf' }}>
              💡 反推：{names.get(s.skill_id) ?? s.skill_id} → 键「{s.key}」（{s.support}/{s.total} 次共现）
            </p>
          ))}
        </div>
      )}
      {discover && (
        <p style={{ color: '#888' }}>
          未匹配操作 {discover.unmatched} 个
          {discover.ambiguities.length > 0 && ` · 歧义 ${discover.ambiguities.length} 处（需人工裁决）`}
        </p>
      )}
      {proposals.map(p => (
        <div key={p.id} style={{ border: '1px solid #345', margin: '6px 0', padding: 6 }}>
          <strong>{p.payload.name}</strong>
          <span style={{ float: 'right' }}>
            {p.status === 'pending' ? '待裁决' : p.status === 'accepted' ? '✅ 已接受' : '❌ 已拒绝'}
          </span>
          <p>{p.payload.note}</p>
          <p style={{ color: '#9c9' }}>
            覆盖率 {(p.report.coverage * 100).toFixed(0)}% ·
            完整 {p.report.complete}/{p.report.iterations} 次迭代
          </p>
          <p style={{ color: '#aaa' }}>{bodyText(p)}</p>
          {p.report.warnings.map((w, i) => <p key={i} style={{ color: '#f80' }}>⚠ {w}</p>)}
          {p.status === 'pending' && (
            <p>
              <button onClick={async () => { await api.acceptProposal(p.id); refreshProposals() }}>接受</button>
              <button onClick={async () => { await api.rejectProposal(p.id); refreshProposals() }}>拒绝</button>
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 挂载**

`frontend/src/App.tsx` 的 Workbench：`<EntryPanel />` 改为右栏容器并排两块：

```tsx
      <div>
        <EntryPanel />
        <InferPanel />
      </div>
```

（import `{ InferPanel } from './panel/InferPanel'`。）

- [ ] **Step 3: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src
git commit -m "feat(frontend): inference panel with conflicts and proposal adjudication"
```

---

### 任务 19：导航集成与 M2 验收走查

**Files:**
- Modify: `frontend/src/App.tsx`（顶层视图切换）
- Modify: `README.md`（M2 一段）

**Interfaces:**
- Produces: `App` 顶层视图 `'library' | 'catalog' | 'keymap'` + 打开的视频；VideoLibrary 头部加「技能目录」「键位设置」按钮

- [ ] **Step 1: 实现导航**

`frontend/src/App.tsx` 的 `export default function App()` 改为：

```tsx
export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  const [page, setPage] = useState<'library' | 'catalog' | 'keymap'>('library')
  if (video) return <><ErrorBar /><Workbench video={video} onBack={() => setVideo(null)} /></>
  if (page === 'catalog') return <><ErrorBar /><CatalogPage onBack={() => setPage('library')} /></>
  if (page === 'keymap') return <><ErrorBar /><KeymapPage onBack={() => setPage('library')} /></>
  return <><ErrorBar /><VideoLibrary onOpen={setVideo}
    onCatalog={() => setPage('catalog')} onKeymap={() => setPage('keymap')} /></>
}
```

`VideoLibrary` 增加 props `onCatalog: () => void; onKeymap: () => void`，`<h1>` 行后加：

```tsx
      <p>
        <button onClick={onCatalog}>技能目录</button>
        <button onClick={onKeymap}>键位设置</button>
      </p>
```

（CatalogPage/KeymapPage import 补上。）

`README.md` 的「运行（M1）」标题改为「运行」，末尾追加：

```markdown
## M2 功能

- 技能目录 / 键位（版本化）：首页入口
- 工作台右栏「推断」：运行对齐（三方冲突、键位反推、补区间）与发现循环（LLM 命名 + 覆盖率验证报告，接受后入 Rotation 库）
- LLM 命名需 `ANTHROPIC_API_KEY`（或 `ant auth login`）；未配置时提案仍产出，名称为「未命名循环」
- Prompt 质量评测：`cd backend && uv run python -m vd.eval`
```

- [ ] **Step 2: 全量验证并提交**

```bash
cd backend && uv run pytest && cd ../frontend && pnpm test && pnpm build
```

```bash
git add frontend/src README.md
git commit -m "feat: catalog/keymap navigation, completing M2 loop"
```

- [ ] **Step 3: M2 验收走查（对照 spec §12-M2：从一份标注产出带覆盖率验证报告的 Rotation 提案）**

启动双服务后逐项确认（控制器在浏览器执行）：

1. 首页 → 技能目录：建「旋风连」（Q gap300 Q gap200 hold LMB 300）与「火球术」（tap 2，cast 400 / anim 720）
2. 键位设置：km-default 绑火球术→2，保存出 v1
3. 打开视频 → 头部绑定 km-default v1
4. L0 打三轮 [Q,Q,LMB长按,2]（节奏按 pattern 容差内），L1 标三次「火球术」
5. 「运行对齐」→ 对齐 3 条、无三方冲突、补区间 3 个；故意把一次 L1 改标成不存在的技能名 → 出现「目录缺定义」，点击跳转
6. 「发现循环」→ 提案卡出现：有名字（配 API key 时为 LLM 起名）、覆盖率 %、complete/iterations、body 预览
7. 「接受」→ 状态变已接受；`curl localhost:8000/api/rotations` 可见 derived_from 指回该 analysis
8. 重启前后端 → 提案与 rotation 仍在；打表两下 → 回填控件把间隔写入火球术 anim_ms（目录页可见新值）

---

## 计划外（M2 明确不做，防止执行时膨胀）

- L2 泳道进入对齐引擎（M2 对齐只吃 L0+L1；L2 直接观察通道 M3 随块编辑器一起接）
- 提案的块级 diff 与 pinned 编辑保护（spec §7.7 完整机制属 M3 块编辑器）
- 补区间提议「固化为显式区间」的一键写回（M2 只展示提议）
- 歧义裁决 UI（M2 只计数提示；裁决交互 M3）
- 导出（md/ahk）、Playbook——M3
- 真实 LLM 调用进 CI（评测集全部 FakeLLM；真实评测手动 `python -m vd.eval`）
- Segment 圈选、撤销/重做（维持 M1 立场）
