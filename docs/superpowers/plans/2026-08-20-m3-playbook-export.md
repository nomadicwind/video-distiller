# M3 方案与导出 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从一个视频走到一份可读文档 + 一个能运行的 AHK 脚本——Playbook（L4）实体与块编辑器、LLM 方案编排提案与逐块裁决、`md` + `ahk` 导出后端与并排预览。

**Architecture:** 在 M2 之上：schema v3（playbooks + 版本快照链 + proposals kind 扩展）；`emit/` 纯函数导出后端（IR → 文本，快照测试）；`agent.compose_playbook`（LLM 编排 + 确定性兜底与越界修正）；前端方案页 + 块编辑器 + 导出并排预览 + 提案逐块裁决。

**Tech Stack:** 沿用 M1/M2 全栈；导出目标 AutoHotkey v2 语法与 Markdown。

**Spec:** `docs/superpowers/specs/2026-08-20-video-distiller-design.md`（§7.2f、§7.7、§8、§9.1-9.2、§12-M3）；术语基准 `CONTEXT.md`

## Global Constraints

- 沿用 M1/M2 全部约束（uv/pnpm、中文 UI、conventional commit + 结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`、VD_DATA_DIR 测试隔离、FakeLLM 进 CI）
- **编辑器块类型 = IR 节点类型；脚本是只读派生物，系统永远不反向解析脚本**（spec §8.1）
- **块 JSON 形状**（playbook sections 内）：`{"rotation": id, "iterations"?: int, "repeat_note"?: str, "pinned"?: bool}` | `{"skill": id, "pinned"?}` | `{"gap": ms, "tol"?: ms, "pinned"?}` | `{"note": str, "pinned"?}`
- **编译规则（spec §9.2）**：时间用实测中位数（rotation body 的 gap 即中位数）；Rotation → AHK function；固定次数 → `Loop N`；`repeat_note`（不可执行条件）→ `Loop { }` + 显式注释 + **文件头汇总**；无键位绑定的技能 → 注释行 + 警告，绝不静默包含
- **AHK v2**：`#Requires AutoHotkey v2.0` 头；`F12::ExitApp` 急停行；`Send "{key}"` / `Sleep ms`；chord `"Shift+2"` → `Send "{Shift down}{2}{Shift up}"`；LMB→LButton、RMB→RButton、Wheel→WheelDown
- **AHK 验收口径**：macOS 上以快照测试锁定产物 + 语法结构校验；真机运行验收留 M4 / 用户 Windows（计划内明示，不算缺口）
- **LLM 编排（spec §7.2f）**：`claude-opus-5` 同 M2 约定；LLM 只做"把 rotation id 编排进命名段落"，**块的组装是确定性代码**；LLM 失败 → 确定性兜底（单段「主循环」含全部 rotation）；LLM 返回的越界/遗漏 id 由代码强制修正（丢弃未知、末段补漏）
- **Playbook 版本链（spec §7.7）**：每次保存 version+1 并写 playbook_versions 快照；回滚 = 以旧快照存为新版本
- **提案裁决**：playbook 提案在 UI 逐块勾选（默认全选，取消 = 拒绝该块），accept 时把裁决后的 sections 传给后端；rotation 提案行为不变
- 端口沿用 8000/5173

## 文件结构总览（新增/修改）

```
backend/src/vd/
├── db.py            # 修改：v3 迁移（playbooks/playbook_versions + proposals CHECK 重建）
├── store.py         # 修改：playbook CRUD/版本/回滚、supersede、get_rotation；validate_pattern 整数校验；create_skill 重名 ValueError
├── emit/__init__.py # 新增（空）
├── emit/md.py       # 新增：Markdown 导出（纯函数）
├── emit/ahk.py      # 新增：AHK v2 导出（纯函数）
├── agent.py         # 修改：compose_playbook + client 进 try
└── api.py           # 修改：accept 顺序、supersede、compose、playbook 路由、导出路由

backend/tests/
├── test_migrate.py test_catalog_store.py test_api.py（追加）
├── test_emit_md.py test_emit_ahk.py test_compose.py（新增）

frontend/src/
├── api/types.ts client.ts        # 修改：Playbook/Block 等
├── panel/InferPanel.tsx          # 修改：挂载加载、编排按钮、playbook 提案卡逐块裁决
├── pages/PlaybooksPage.tsx       # 新增：循环/方案列表 + 导出
├── pages/PlaybookEditor.tsx      # 新增：块编辑器 + 版本回滚 + 导出并排预览
└── App.tsx                       # 修改：导航
```

---

# 部分 0：M2 尾款打包（任务 1）

### 任务 1：终审建议与校验加固

**Files:**
- Modify: `backend/src/vd/api.py`（accept 先建 rotation 再改状态；discover 前 supersede 待裁决提案）
- Modify: `backend/src/vd/store.py`（`delete_pending_proposals`；`validate_pattern` 的 gap.ms/hold.ms/tol 必须为 int；`create_skill` 重名 IntegrityError → ValueError）
- Modify: `backend/src/vd/agent.py`（`anthropic.Anthropic()` 移入 try）
- Modify: `frontend/src/panel/InferPanel.tsx`（挂载时加载提案）
- Modify: `CONTEXT.md`（Keymap 词条追加 chord 绑定约定一句）
- Modify: `backend/tests/test_api.py`、`backend/tests/test_catalog_store.py`（追加测试）

**Interfaces:**
- Produces: `store.delete_pending_proposals(conn, analysis_id, kind) -> int`（删除数；按 kind 过滤，rotation/playbook 互不误伤）；discover 端点行为变化：先清本 analysis 的 pending **rotation** 提案再插新批（已裁决的保留）

- [ ] **Step 1: 后端失败测试**

`backend/tests/test_catalog_store.py` 追加：

```python
def test_pattern_ms_must_be_int(conn):
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏4", pattern=[{"op": "gap", "ms": None}])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏5", pattern=[{"op": "gap", "ms": "300"}])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏6", pattern=[{"op": "hold", "key": "F", "ms": None}])


def test_duplicate_skill_name_raises_value_error(conn):
    store.create_skill(conn, name="重复", pattern=[])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="重复", pattern=[])


def test_delete_pending_proposals_keeps_adjudicated(conn):
    v = store.create_video(conn, name="a.mp4", source_kind="upload")
    tree = store.create_analysis(conn, v["id"])
    p1 = store.create_proposal(conn, analysis_id=tree["id"], kind="rotation",
                               payload={"name": "a", "body": []}, report={})
    p2 = store.create_proposal(conn, analysis_id=tree["id"], kind="rotation",
                               payload={"name": "b", "body": []}, report={})
    store.set_proposal_status(conn, p1["id"], "accepted")
    assert store.delete_pending_proposals(conn, tree["id"], kind="rotation") == 1
    remaining = store.list_proposals(conn, tree["id"])
    assert [p["status"] for p in remaining] == ["accepted"]
```

`backend/tests/test_api.py` 追加：

```python
def test_duplicate_skill_name_is_400(client):
    client.post("/api/skills", json={"name": "唯一技", "pattern": []})
    r = client.post("/api/skills", json={"name": "唯一技", "pattern": []})
    assert r.status_code == 400


def test_discover_supersedes_pending(client, analysis, monkeypatch):
    from test_agent import FakeClient, FakeResponse
    from vd import api as api_module
    monkeypatch.setattr(api_module, "_agent_client", lambda: FakeClient(FakeResponse()))
    from test_api import _seed_rotation_annotation
    _seed_rotation_annotation(client, analysis)
    n1 = len(client.post(f"/api/analyses/{analysis['id']}/discover").json()["proposals"])
    client.post(f"/api/analyses/{analysis['id']}/discover")
    stored = client.get(f"/api/analyses/{analysis['id']}/proposals").json()
    assert len([p for p in stored if p["status"] == "pending"]) == n1   # 不累积


def test_accept_creates_rotation_before_status(client, analysis):
    from vd import db, store
    conn = db.connect()
    p = store.create_proposal(conn, analysis_id=analysis["id"], kind="rotation",
                              payload={"note": "缺 name 和 body"}, report={})
    conn.close()
    r = client.post(f"/api/proposals/{p['id']}/accept")
    assert r.status_code == 500                       # 畸形 payload 仍失败……
    conn = db.connect()
    fresh = store.list_proposals(conn, analysis["id"])
    conn.close()
    bad = [x for x in fresh if x["id"] == p["id"]][0]
    assert bad["status"] == "pending"                 # ……但状态未被卡死，可重试/拒绝
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_catalog_store.py tests/test_api.py -x
```

- [ ] **Step 3: 后端实现**

`backend/src/vd/store.py`：
- `validate_pattern` 中 gap 分支改为：

```python
        if op == "gap" and not isinstance(item.get("ms"), int):
            raise ValueError("gap requires integer ms")
```

并在 hold 分支的 key/button 检查后追加：

```python
        if op == "hold" and "ms" in item and not isinstance(item["ms"], int):
            raise ValueError("hold ms must be integer")
```

（`tol_ms` 同理：任一分支中出现 `tol_ms` 且非 int → ValueError。实现为循环末尾统一检查：`if "tol_ms" in item and not isinstance(item["tol_ms"], int): raise ValueError("tol_ms must be integer")`。）
- `create_skill` 的 INSERT 包 try：

```python
    try:
        conn.execute(...)
    except sqlite3.IntegrityError as e:
        raise ValueError(f"技能名重复：{name}") from e
```

（文件顶部补 `import sqlite3`。）
- 追加：

```python
def delete_pending_proposals(conn, analysis_id, kind) -> int:
    cur = conn.execute(
        "DELETE FROM proposals WHERE analysis_id=? AND status='pending' AND kind=?",
        (analysis_id, kind))
    conn.commit()
    return cur.rowcount
```

`backend/src/vd/api.py`：
- `run_discover` 在循环插入提案前加一行 `store.delete_pending_proposals(conn, analysis_id, kind="rotation")`
- `accept_proposal` 重排：先 `create_rotation`（从 SELECT 到的行解 payload），成功后再 `set_proposal_status`：

```python
@app.post("/api/proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, conn=Depends(get_conn)):
    row = conn.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    if row["status"] != "pending":
        raise HTTPException(409, "proposal 已裁决")
    payload = json.loads(row["payload"])
    rotation = store.create_rotation(
        conn, name=payload["name"], body=payload["body"],
        params=payload.get("params"), note=payload.get("note"),
        derived_from=[row["analysis_id"]])
    p = store.set_proposal_status(conn, proposal_id, "accepted")
    return {"proposal": p, "rotation": rotation}
```

（api.py 顶部补 `import json`。）

`backend/src/vd/agent.py` 的 `name_candidate`：把 `client = client or anthropic.Anthropic()` 移到 `try:` 内第一行。

- [ ] **Step 4: 前端与文档**

`frontend/src/panel/InferPanel.tsx`：组件内追加（import `useEffect` 已有）：

```tsx
  useEffect(() => { if (analysis) refreshProposals() }, [analysis?.id])  // eslint-disable-line react-hooks/exhaustive-deps
```

（放在 `if (!analysis) return null` 之前，用可选链守卫。）

`CONTEXT.md` 的 **Keymap** 词条正文末追加一句：`组合键绑定写成单字符串（如 "Shift+2"），列表元素是可替代的多个键。`

- [ ] **Step 5: 全量验证并提交**

```bash
cd backend && uv run pytest && cd ../frontend && pnpm test && pnpm build
```

```bash
git add -A
git commit -m "fix: M2 final-review follow-ups (proposal lifecycle, validation hardening)"
```

---

# 部分 A：数据层（任务 2–3）

### 任务 2：schema v3 —— playbooks 与 proposals kind 扩展

**Files:**
- Modify: `backend/src/vd/db.py`
- Modify: `backend/tests/test_migrate.py`（追加）

**Interfaces:**
- Produces: `PRAGMA user_version == 3`；新表 `playbooks`（sections/derived_from JSON、version、keymap 钉定列）、`playbook_versions`（快照链）；`proposals.kind` CHECK 扩展为 `('rotation','playbook')`（SQLite 无法改 CHECK → 表重建迁移，数据保留）

- [ ] **Step 1: 追加失败测试**

`backend/tests/test_migrate.py` 追加：

```python
def test_v3_adds_playbooks_and_extends_proposal_kind():
    conn = db.connect()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
    assert {"playbooks", "playbook_versions"} <= _tables(conn)
    # kind 'playbook' 可插入（CHECK 已扩展）
    conn.execute("INSERT INTO videos(id,seq,name,source_kind,created_at)"
                 " VALUES('v1',1,'n','upload','t')")
    conn.execute("INSERT INTO analyses(id,video_id,keymap_label,seq,name,created_at)"
                 " VALUES('a1','v1','km',1,'n','t')")
    conn.execute("INSERT INTO proposals(id,analysis_id,kind,payload,report,created_at)"
                 " VALUES('p1','a1','playbook','{}','{}','t')")
    conn.commit()


def test_v3_migration_preserves_existing_proposals(data_dir):
    import sqlite3 as sq
    data_dir.mkdir(parents=True, exist_ok=True)
    raw = sq.connect(data_dir / "vd.sqlite3")
    raw.executescript(db.SCHEMA)
    raw.executescript(db.SCHEMA_V2)
    raw.execute("PRAGMA user_version = 2")
    raw.execute("INSERT INTO videos(id,seq,name,source_kind,created_at)"
                " VALUES('v1',1,'n','upload','t')")
    raw.execute("INSERT INTO analyses(id,video_id,keymap_label,seq,name,created_at)"
                " VALUES('a1','v1','km',1,'n','t')")
    raw.execute("INSERT INTO proposals(id,analysis_id,kind,payload,report,status,created_at)"
                " VALUES('p0','a1','rotation','{\"x\":1}','{}','accepted','t')")
    raw.commit()
    raw.close()
    conn = db.connect()
    row = conn.execute("SELECT * FROM proposals WHERE id='p0'").fetchone()
    assert row["status"] == "accepted" and row["kind"] == "rotation"
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_migrate.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/db.py` 追加：

```python
SCHEMA_V3 = """
CREATE TABLE IF NOT EXISTS playbooks(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class TEXT,
  keymap_id TEXT,
  keymap_version INTEGER,
  sections TEXT NOT NULL DEFAULT '[]',
  derived_from TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS playbook_versions(
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(playbook_id, version)
);
"""

PROPOSALS_V3 = """
ALTER TABLE proposals RENAME TO proposals_old;
CREATE TABLE proposals(
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id),
  kind TEXT NOT NULL CHECK(kind IN ('rotation','playbook')),
  payload TEXT NOT NULL,
  report TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL
);
INSERT INTO proposals SELECT * FROM proposals_old;
DROP TABLE proposals_old;
"""
```

`_migrate` 末尾（v2 块之后）追加：

```python
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version < 3:
        conn.executescript(SCHEMA_V3)
        conn.executescript(PROPOSALS_V3)
        conn.execute("PRAGMA user_version = 3")
        conn.commit()
```

（重读 version 而不是复用局部变量——v2 块可能刚把它改成 2。）

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/db.py backend/tests/test_migrate.py
git commit -m "feat(backend): schema v3 playbooks with version chain and proposal kind rebuild"
```

---

### 任务 3：store —— Playbook CRUD、版本链与回滚

**Files:**
- Modify: `backend/src/vd/store.py`
- Modify: `backend/tests/test_catalog_store.py`（追加）

**Interfaces:**
- Produces（conn 首参、dict 出入、JSON 自动编解码）：
  - `VALID_BLOCK_KEYS = ("rotation", "skill", "gap", "note")`；`validate_sections(sections) -> None`（每段 {name, body[]}；每块恰含一个主键 ∈ VALID_BLOCK_KEYS；rotation 块的 iterations 若有必须 int ≥1；gap 块 ms int；违规 ValueError）
  - `create_playbook(conn, *, name, class_=None, keymap_id=None, keymap_version=None, sections=None, derived_from=None) -> dict`（version 1 + 写快照）
  - `get_playbook(conn, playbook_id)` · `list_playbooks(conn)`
  - `save_playbook(conn, playbook_id, *, sections, name=None) -> dict`（校验 → version+1 → 更新行 → 写快照）
  - `list_playbook_versions(conn, playbook_id) -> [{version, created_at}]`
  - `rollback_playbook(conn, playbook_id, version) -> dict`（取快照 → 以 save_playbook 存为新版本）
  - `get_rotation(conn, rotation_id) -> dict | None`

- [ ] **Step 1: 追加失败测试**

```python
def test_playbook_lifecycle_with_versions(conn):
    pb = store.create_playbook(conn, name="法师单体", sections=[
        {"name": "开场", "body": [{"skill": "sk_a"}, {"gap": 400}]}])
    assert pb["version"] == 1
    pb2 = store.save_playbook(conn, pb["id"], sections=[
        {"name": "开场", "body": [{"skill": "sk_a"}]},
        {"name": "稳定输出", "body": [{"rotation": "rot_1", "iterations": 2, "pinned": True}]}])
    assert pb2["version"] == 2
    versions = store.list_playbook_versions(conn, pb["id"])
    assert [v["version"] for v in versions] == [1, 2]
    pb3 = store.rollback_playbook(conn, pb["id"], 1)
    assert pb3["version"] == 3                          # 回滚 = 旧快照存为新版本
    assert pb3["sections"][0]["body"] == [{"skill": "sk_a"}, {"gap": 400}]


def test_validate_sections_rejects_bad_blocks(conn):
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏", sections=[{"name": "s", "body": [{"boom": 1}]}])
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏2", sections=[{"name": "s", "body": [
            {"rotation": "r", "iterations": 0}]}])
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏3", sections=[{"name": "s", "body": [{"gap": "x"}]}])
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏4", sections=[{"body": []}])       # 段落缺 name


def test_get_rotation(conn):
    r = store.create_rotation(conn, name="r", body=[])
    assert store.get_rotation(conn, r["id"])["name"] == "r"
    assert store.get_rotation(conn, "nope") is None
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_catalog_store.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/store.py` 末尾追加：

```python
# ---- Playbook（spec §5.8/§7.7 版本链）----

VALID_BLOCK_KEYS = ("rotation", "skill", "gap", "note")


def validate_sections(sections: list) -> None:
    if not isinstance(sections, list):
        raise ValueError("sections must be a list")
    for sec in sections:
        if not isinstance(sec, dict) or not sec.get("name"):
            raise ValueError("每个段落必须有 name")
        for block in sec.get("body", []):
            keys = [k for k in VALID_BLOCK_KEYS if k in block]
            if len(keys) != 1:
                raise ValueError(f"块必须恰含一个主键 {VALID_BLOCK_KEYS}: {block!r}")
            kind = keys[0]
            if kind == "rotation" and "iterations" in block:
                if not isinstance(block["iterations"], int) or block["iterations"] < 1:
                    raise ValueError("iterations 必须是 ≥1 的整数")
            if kind == "gap" and not isinstance(block["gap"], int):
                raise ValueError("gap 块 ms 必须是整数")


def _playbook_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["sections"] = json.loads(d["sections"])
    d["derived_from"] = json.loads(d["derived_from"])
    return d


def _snapshot_playbook(conn, playbook: dict) -> None:
    conn.execute(
        "INSERT INTO playbook_versions(id,playbook_id,version,snapshot,created_at)"
        " VALUES(?,?,?,?,?)",
        (_id("pv"), playbook["id"], playbook["version"],
         json.dumps(playbook, ensure_ascii=False), _now()),
    )


def create_playbook(conn, *, name, class_=None, keymap_id=None, keymap_version=None,
                    sections=None, derived_from=None):
    sections = sections or []
    validate_sections(sections)
    pid = _id("pb")
    conn.execute(
        "INSERT INTO playbooks(id,name,class,keymap_id,keymap_version,sections,"
        "derived_from,version,created_at) VALUES(?,?,?,?,?,?,?,1,?)",
        (pid, name, class_, keymap_id, keymap_version,
         json.dumps(sections, ensure_ascii=False),
         json.dumps(derived_from or [], ensure_ascii=False), _now()),
    )
    pb = get_playbook(conn, pid)
    _snapshot_playbook(conn, pb)
    conn.commit()
    return pb


def get_playbook(conn, playbook_id):
    return _playbook_row(conn.execute(
        "SELECT * FROM playbooks WHERE id=?", (playbook_id,)).fetchone())


def list_playbooks(conn):
    return [_playbook_row(r) for r in conn.execute(
        "SELECT * FROM playbooks ORDER BY created_at")]


def save_playbook(conn, playbook_id, *, sections, name=None):
    validate_sections(sections)
    pb = get_playbook(conn, playbook_id)
    if pb is None:
        raise ValueError("playbook not found")
    new_version = pb["version"] + 1
    conn.execute(
        "UPDATE playbooks SET sections=?, version=?, name=? WHERE id=?",
        (json.dumps(sections, ensure_ascii=False), new_version,
         name or pb["name"], playbook_id),
    )
    pb = get_playbook(conn, playbook_id)
    _snapshot_playbook(conn, pb)
    conn.commit()
    return pb


def list_playbook_versions(conn, playbook_id):
    return [{"version": r["version"], "created_at": r["created_at"]}
            for r in conn.execute(
                "SELECT version, created_at FROM playbook_versions"
                " WHERE playbook_id=? ORDER BY version", (playbook_id,))]


def rollback_playbook(conn, playbook_id, version):
    row = conn.execute(
        "SELECT snapshot FROM playbook_versions WHERE playbook_id=? AND version=?",
        (playbook_id, version)).fetchone()
    if row is None:
        raise ValueError("version not found")
    old = json.loads(row["snapshot"])
    return save_playbook(conn, playbook_id, sections=old["sections"], name=old["name"])


def get_rotation(conn, rotation_id):
    return _rotation_row(conn.execute(
        "SELECT * FROM rotations WHERE id=?", (rotation_id,)).fetchone())
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/store.py backend/tests/test_catalog_store.py
git commit -m "feat(backend): playbook store with version chain and rollback"
```

---

# 部分 B：导出引擎与 LLM 编排（任务 4–7）

### 任务 4：emit/md —— Markdown 导出

**Files:**
- Create: `backend/src/vd/emit/__init__.py`（空）
- Create: `backend/src/vd/emit/md.py`
- Create: `backend/tests/test_emit_md.py`

**Interfaces:**
- Produces（纯函数，输入均为 store 层 dict）：
  - `render_rotation_md(rotation, skills_by_id) -> str`
  - `render_playbook_md(playbook, rotations_by_id, skills_by_id) -> str`
  - 内部 `_body_line(body, skills_by_id) -> str`（`旋风连 → 等待 200ms（±40）→ 火球术`；未知 skill id 显示原 id）
- 块渲染：技能块 `【技能】名`；gap 块 `等待 Nms`；rotation 块 `【循环】名 ×N` 或 `【循环】名 —— 循环条件（人工判断）：note`（spec §5.7 executable:false 必须显式注明）；note 块 `> 备注：…`；低置信块（`confidence < 0.7`）行首加 `⚠️[低置信] `

- [ ] **Step 1: 写失败测试**

`backend/tests/test_emit_md.py`:

```python
from vd.emit.md import render_playbook_md, render_rotation_md

SKILLS = {
    "sk_wh": {"id": "sk_wh", "name": "旋风连", "pattern": [
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "tap", "key": "Q"}]},
    "sk_fb": {"id": "sk_fb", "name": "火球术", "pattern": [{"op": "tap", "key": "2"}]},
}
ROT = {"id": "rot_1", "name": "单体稳定输出",
       "body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
       "note": "旋风接火球", "derived_from": ["an_1"], "params": []}
PB = {"id": "pb_1", "name": "法师单体", "version": 2,
      "keymap_id": "km-default", "keymap_version": 1, "derived_from": ["an_1"],
      "sections": [
          {"name": "开场爆发", "body": [
              {"skill": "sk_fb"}, {"gap": 400},
              {"rotation": "rot_1", "iterations": 2}]},
          {"name": "稳定输出", "body": [
              {"rotation": "rot_1", "repeat_note": "直到目标死亡"},
              {"note": "留意走位"},
              {"skill": "sk_fb", "confidence": 0.5}]},
      ]}


def test_rotation_md():
    out = render_rotation_md(ROT, SKILLS)
    assert "# 循环：单体稳定输出" in out
    assert "旋风连 → 等待 200ms（±40）→ 火球术" in out
    assert "旋风接火球" in out
    assert "an_1" in out


def test_playbook_md_structure():
    out = render_playbook_md(PB, {"rot_1": ROT}, SKILLS)
    assert out.startswith("# 方案：法师单体 v2")
    assert "> 键位：km-default v1" in out
    assert "## 开场爆发" in out and "## 稳定输出" in out
    assert "【技能】火球术" in out
    assert "等待 400ms" in out
    assert "【循环】单体稳定输出 ×2" in out
    assert "循环条件（人工判断）：直到目标死亡" in out
    assert "> 备注：留意走位" in out
    assert "⚠️[低置信] 【技能】火球术" in out
    assert "旋风连 → 等待 200ms（±40）→ 火球术" in out   # 循环块附 body 展开


def test_unknown_skill_id_falls_back():
    out = render_rotation_md({**ROT, "body": [{"skill": "sk_ghost"}]}, SKILLS)
    assert "sk_ghost" in out
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_emit_md.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/emit/md.py`:

```python
"""Markdown 导出（spec §9.1 md 后端）。纯函数：IR dict → 文本。"""


def _skill_name(sid: str, skills_by_id: dict) -> str:
    sk = skills_by_id.get(sid)
    return sk["name"] if sk else sid


def _body_line(body: list, skills_by_id: dict) -> str:
    parts = []
    for item in body:
        if "skill" in item:
            parts.append(_skill_name(item["skill"], skills_by_id))
        elif "gap" in item:
            tol = f"（±{item['tol']}）" if item.get("tol") is not None else ""
            parts.append(f"等待 {item['gap']}ms{tol}")
        else:
            parts.append(f"{item.get('op', '?')} {item.get('key', '')}".strip())
    return " → ".join(parts)


def _block_lines(block: dict, rotations_by_id: dict, skills_by_id: dict) -> list[str]:
    prefix = "⚠️[低置信] " if block.get("confidence", 1.0) < 0.7 else ""
    if "skill" in block:
        return [f"{prefix}【技能】{_skill_name(block['skill'], skills_by_id)}"]
    if "gap" in block:
        return [f"{prefix}等待 {block['gap']}ms"]
    if "note" in block:
        return [f"> 备注：{block['note']}"]
    rot = rotations_by_id.get(block["rotation"])
    name = rot["name"] if rot else block["rotation"]
    if block.get("repeat_note"):
        head = f"{prefix}【循环】{name} —— 循环条件（人工判断）：{block['repeat_note']}"
    elif block.get("iterations"):
        head = f"{prefix}【循环】{name} ×{block['iterations']}"
    else:
        head = f"{prefix}【循环】{name}"
    lines = [head]
    if rot:
        lines.append(f"   - {_body_line(rot['body'], skills_by_id)}")
    return lines


def render_rotation_md(rotation: dict, skills_by_id: dict) -> str:
    lines = [f"# 循环：{rotation['name']}", ""]
    if rotation.get("note"):
        lines += [f"> {rotation['note']}", ""]
    lines += [_body_line(rotation["body"], skills_by_id), ""]
    if rotation.get("derived_from"):
        lines.append(f"来源：{'、'.join(rotation['derived_from'])}")
    return "\n".join(lines) + "\n"


def render_playbook_md(playbook: dict, rotations_by_id: dict, skills_by_id: dict) -> str:
    lines = [f"# 方案：{playbook['name']} v{playbook['version']}", ""]
    meta = []
    if playbook.get("keymap_id"):
        meta.append(f"键位：{playbook['keymap_id']} v{playbook['keymap_version']}")
    if playbook.get("derived_from"):
        meta.append(f"来源：{'、'.join(playbook['derived_from'])}")
    if meta:
        lines += [f"> {' · '.join(meta)}", ""]
    for sec in playbook["sections"]:
        lines += [f"## {sec['name']}", ""]
        n = 0
        for block in sec.get("body", []):
            rendered = _block_lines(block, rotations_by_id, skills_by_id)
            if rendered[0].startswith(">"):
                lines += rendered
            else:
                n += 1
                lines.append(f"{n}. {rendered[0]}")
                lines += rendered[1:]
        lines.append("")
    return "\n".join(lines)
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_emit_md.py -x
```

```bash
git add backend/src/vd/emit backend/tests/test_emit_md.py
git commit -m "feat(backend): markdown export backend"
```

---

### 任务 5：emit/ahk —— AutoHotkey v2 导出

**Files:**
- Create: `backend/src/vd/emit/ahk.py`
- Create: `backend/tests/test_emit_ahk.py`

**Interfaces:**
- Produces（纯函数）：
  - `render_playbook_ahk(playbook, rotations_by_id, skills_by_id, binds) -> str`
  - `render_rotation_ahk(rotation, skills_by_id, binds) -> str`（单循环脚本：头 + F12 + F9 调该循环）
  - 内部：`_ahk_key(k)`（LMB→LButton、RMB→RButton、Wheel→WheelDown、单字母→小写）、`_skill_fn(skill_id)`/`_rotation_fn(rid)`（ASCII 安全函数名 `Skill_<id>` / `Rotation_<id>`，中文名进尾注释）、`skill_lines(skill, binds, skills_by_id) -> (lines, warnings)`
- 编译规则（spec §9.2，全部必须实现）：
  1. pattern 有内容 → 逐 op 编译：tap→`Send "{k}"`；gap→`Sleep ms`（中位数）；hold→down/Sleep/up；chord→`Send "{A down}{B}{A up}"`（首键 down/up 包裹其余）；wheel→`Send "{WheelDown}"`；`skill` ref → 调 `Skill_<ref>()`（递归收集被引函数）
  2. pattern 为空但 keymap binds 有键 → 用首键 tap；**两者皆无 → 该行输出为注释 `; ⚠ 技能 <名> 无 pattern 也无键位绑定` 并计入 warnings，绝不静默包含**
  3. `repeat_note` 循环 → `Loop { ... }` + 行内注释 + **文件头「人工判断的循环条件」汇总**
  4. `confidence < 0.7` 的块 → 整块行注释化（`; [低置信] ` 前缀）+ warnings
  5. 头部：`#Requires AutoHotkey v2.0`、来源注释、`F12::ExitApp`（急停）、`F9::` 主入口

- [ ] **Step 1: 写失败测试**

`backend/tests/test_emit_ahk.py`:

```python
from vd.emit.ahk import render_playbook_ahk, render_rotation_ahk

SKILLS = {
    "sk_wh": {"id": "sk_wh", "name": "旋风连", "pattern": [
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 200, "tol_ms": 60},
        {"op": "hold", "button": "LMB", "ms": 300, "tol_ms": 100}]},
    "sk_fb": {"id": "sk_fb", "name": "火球术", "pattern": [{"op": "tap", "key": "2"}]},
    "sk_blink": {"id": "sk_blink", "name": "闪现", "pattern": [
        {"op": "chord", "keys": ["Shift", "2"]}]},
    "sk_bound": {"id": "sk_bound", "name": "只有键位", "pattern": []},
    "sk_naked": {"id": "sk_naked", "name": "裸技能", "pattern": []},
    "sk_combo": {"id": "sk_combo", "name": "冰火连携", "pattern": [
        {"op": "skill", "ref": "sk_fb"}, {"op": "gap", "ms": 300},
        {"op": "skill", "ref": "sk_fb"}]},
}
BINDS = {"sk_bound": ["3"]}
ROT = {"id": "rot_1", "name": "单体稳定输出",
       "body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
       "note": None, "derived_from": [], "params": []}
PB = {"id": "pb_1", "name": "法师单体", "version": 2,
      "keymap_id": "km-default", "keymap_version": 1, "derived_from": ["an_1"],
      "sections": [
          {"name": "开场", "body": [
              {"skill": "sk_blink"}, {"gap": 400},
              {"rotation": "rot_1", "iterations": 2}]},
          {"name": "稳定输出", "body": [
              {"rotation": "rot_1", "repeat_note": "直到目标死亡"},
              {"skill": "sk_bound"}, {"skill": "sk_naked"},
              {"skill": "sk_combo"},
              {"gap": 100, "confidence": 0.5}]},
      ]}


def test_playbook_ahk_structure():
    out = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    assert out.startswith("#Requires AutoHotkey v2.0")
    assert "F12::ExitApp" in out
    assert "F9::" in out
    assert "直到目标死亡" in out.split("F12::ExitApp")[0]      # 头部汇总
    assert 'Send "{q}"' in out                                  # 字母小写
    assert 'Send "{Shift down}{2}{Shift up}"' in out            # chord
    assert 'Send "{LButton down}"' in out and "Sleep 300" in out
    assert "Loop 2 {" in out                                    # 固定次数
    assert "Loop {" in out                                      # 条件循环
    assert "循环条件（人工判断）：直到目标死亡" in out
    assert 'Send "{3}"' in out                                  # 空 pattern 用键位首键
    assert "; ⚠ 技能 裸技能 无 pattern 也无键位绑定" in out     # 绝不静默包含
    assert "Skill_sk_combo" in out and out.count("Skill_sk_fb()") >= 3  # 递归引用被展开为函数调用
    assert "; [低置信] Sleep 100" in out                         # 低置信注释化


def test_rotation_ahk_single():
    out = render_rotation_ahk(ROT, SKILLS, {})
    assert "#Requires AutoHotkey v2.0" in out
    assert "Rotation_rot_1()" in out
    assert "Sleep 200" in out
    assert "F9::" in out and "F12::ExitApp" in out


def test_deterministic_output():
    a = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    b = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    assert a == b
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_emit_ahk.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/emit/ahk.py`:

```python
"""AutoHotkey v2 导出（spec §9.1 ahk 后端、§9.2 编译规则）。纯函数、确定性。"""

_KEY_MAP = {"LMB": "LButton", "RMB": "RButton", "Wheel": "WheelDown"}


def _ahk_key(k: str) -> str:
    if k in _KEY_MAP:
        return _KEY_MAP[k]
    if len(k) == 1 and k.isalpha():
        return k.lower()
    return k


def _skill_fn(skill_id: str) -> str:
    return f"Skill_{skill_id}"


def _rotation_fn(rotation_id: str) -> str:
    return f"Rotation_{rotation_id}"


def skill_lines(skill: dict, binds: dict, skills_by_id: dict) -> tuple[list[str], list[str]]:
    """单技能 → AHK 行（不含函数壳）。返回 (lines, warnings)。"""
    pattern = skill.get("pattern") or []
    lines: list[str] = []
    warnings: list[str] = []
    if pattern:
        for item in pattern:
            op = item["op"]
            if op == "tap":
                lines.append(f'Send "{{{_ahk_key(item["key"])}}}"')
            elif op == "gap":
                lines.append(f'Sleep {item["ms"]}')
            elif op == "hold":
                key = _ahk_key(item.get("key") or item.get("button"))
                lines.append(f'Send "{{{key} down}}"')
                lines.append(f'Sleep {item.get("ms", 100)}')
                lines.append(f'Send "{{{key} up}}"')
            elif op == "chord":
                keys = [_ahk_key(k) for k in item["keys"]]
                inner = "".join(f"{{{k}}}" for k in keys[1:])
                lines.append(f'Send "{{{keys[0]} down}}{inner}{{{keys[0]} up}}"')
            elif op == "wheel":
                lines.append('Send "{WheelDown}"')
            elif op == "skill":
                lines.append(f"{_skill_fn(item['ref'])}()")
        return lines, warnings
    keys = binds.get(skill["id"]) or []
    if keys:
        lines.append(f'Send "{{{_ahk_key(keys[0])}}}"')
        return lines, warnings
    warnings.append(f"技能 {skill['name']} 无 pattern 也无键位绑定")
    lines.append(f"; ⚠ 技能 {skill['name']} 无 pattern 也无键位绑定")
    return lines, warnings


def _collect_skill_ids(body: list, skills_by_id: dict, acc: list[str]) -> None:
    """按出现顺序收集 body 引用的 skill id（含 pattern 里的递归引用），去重保序。"""
    for item in body:
        sid = item.get("skill")
        if sid is None:
            continue
        if sid not in acc:
            acc.append(sid)
            sk = skills_by_id.get(sid)
            if sk:
                _collect_skill_ids(
                    [{"skill": i["ref"]} for i in sk.get("pattern", []) if i.get("op") == "skill"],
                    skills_by_id, acc)


def _block_ahk(block: dict, rotations_by_id: dict, skills_by_id: dict,
               manual_loops: list[str], section_name: str) -> list[str]:
    lines: list[str] = []
    if "skill" in block:
        sk = skills_by_id.get(block["skill"])
        name = sk["name"] if sk else block["skill"]
        lines.append(f"{_skill_fn(block['skill'])}() ; {name}")
    elif "gap" in block:
        lines.append(f"Sleep {block['gap']}")
    elif "note" in block:
        lines.append(f"; {block['note']}")
    else:
        rid = block["rotation"]
        rot = rotations_by_id.get(rid)
        name = rot["name"] if rot else rid
        if block.get("repeat_note"):
            manual_loops.append(f"[{section_name}] {name}：{block['repeat_note']}")
            lines.append(f"Loop {{ ; 循环条件（人工判断）：{block['repeat_note']}")
            lines.append(f"    {_rotation_fn(rid)}()")
            lines.append("}")
        elif block.get("iterations"):
            lines.append(f"Loop {block['iterations']} {{")
            lines.append(f"    {_rotation_fn(rid)}()")
            lines.append("}")
        else:
            lines.append(f"{_rotation_fn(rid)}() ; {name}")
    if block.get("confidence", 1.0) < 0.7:
        lines = [f"; [低置信] {ln}" for ln in lines]
    return lines


def _fn(name: str, body_lines: list[str], comment: str = "") -> list[str]:
    head = f"{name}() {{" + (f" ; {comment}" if comment else "")
    return [head] + [f"    {ln}" for ln in body_lines] + ["}", ""]


def _skill_functions(skill_ids: list[str], skills_by_id: dict, binds: dict,
                     warnings: list[str]) -> list[str]:
    out: list[str] = []
    for sid in skill_ids:
        sk = skills_by_id.get(sid)
        if sk is None:
            warnings.append(f"未知技能 id {sid}")
            out += _fn(_skill_fn(sid), [f"; ⚠ 未知技能 id {sid}"])
            continue
        lines, warns = skill_lines(sk, binds, skills_by_id)
        warnings.extend(warns)
        out += _fn(_skill_fn(sid), lines, sk["name"])
    return out


def _header(title: str, manual_loops: list[str], warnings: list[str]) -> list[str]:
    lines = ["#Requires AutoHotkey v2.0", f"; Video Distiller 导出 · {title}"]
    if manual_loops:
        lines.append("; ⚠ 人工判断的循环条件（不可执行，运行中按 F12 急停）：")
        lines += [f";   - {m}" for m in manual_loops]
    if warnings:
        lines.append("; ⚠ 警告：")
        lines += [f";   - {w}" for w in warnings]
    lines += ["", "F12::ExitApp", ""]
    return lines


def render_playbook_ahk(playbook: dict, rotations_by_id: dict,
                        skills_by_id: dict, binds: dict) -> str:
    manual_loops: list[str] = []
    warnings: list[str] = []
    section_fns: list[str] = []
    section_bodies: list[list[str]] = []
    all_skill_ids: list[str] = []
    rotation_ids: list[str] = []

    for i, sec in enumerate(playbook["sections"], 1):
        body_lines: list[str] = []
        for block in sec.get("body", []):
            body_lines += _block_ahk(block, rotations_by_id, skills_by_id,
                                     manual_loops, sec["name"])
            if "rotation" in block and block["rotation"] not in rotation_ids:
                rotation_ids.append(block["rotation"])
        _collect_skill_ids(sec.get("body", []), skills_by_id, all_skill_ids)
        section_fns.append(f"Section_{i}")
        section_bodies.append(body_lines)

    for rid in rotation_ids:
        rot = rotations_by_id.get(rid)
        if rot:
            _collect_skill_ids(rot["body"], skills_by_id, all_skill_ids)

    parts: list[str] = []
    parts += ["F9:: {"] + [f"    {fn}()" for fn in section_fns] + ["}", ""]
    for fn, body, sec in zip(section_fns, section_bodies,
                             playbook["sections"]):
        parts += _fn(fn, body, sec["name"])
    for rid in rotation_ids:
        rot = rotations_by_id.get(rid)
        if rot is None:
            warnings.append(f"未知循环 id {rid}")
            parts += _fn(_rotation_fn(rid), [f"; ⚠ 未知循环 id {rid}"])
            continue
        body_lines: list[str] = []
        for item in rot["body"]:
            if "skill" in item:
                body_lines.append(f"{_skill_fn(item['skill'])}()")
            elif "gap" in item:
                body_lines.append(f"Sleep {item['gap']}")
        parts += _fn(_rotation_fn(rid), body_lines, rot["name"])
    parts += _skill_functions(all_skill_ids, skills_by_id, binds, warnings)

    title = f"方案：{playbook['name']} v{playbook['version']}"
    return "\n".join(_header(title, manual_loops, warnings) + parts)


def render_rotation_ahk(rotation: dict, skills_by_id: dict, binds: dict) -> str:
    warnings: list[str] = []
    all_skill_ids: list[str] = []
    _collect_skill_ids(rotation["body"], skills_by_id, all_skill_ids)
    body_lines: list[str] = []
    for item in rotation["body"]:
        if "skill" in item:
            body_lines.append(f"{_skill_fn(item['skill'])}()")
        elif "gap" in item:
            body_lines.append(f"Sleep {item['gap']}")
    parts = ["F9:: {", f"    {_rotation_fn(rotation['id'])}()", "}", ""]
    parts += _fn(_rotation_fn(rotation["id"]), body_lines, rotation["name"])
    parts += _skill_functions(all_skill_ids, skills_by_id, binds, warnings)
    return "\n".join(_header(f"循环：{rotation['name']}", [], warnings) + parts)
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest tests/test_emit_ahk.py -x
```

```bash
git add backend/src/vd/emit/ahk.py backend/tests/test_emit_ahk.py
git commit -m "feat(backend): autohotkey v2 export backend"
```

---

### 任务 6：导出 API 路由

**Files:**
- Modify: `backend/src/vd/api.py`
- Modify: `backend/tests/test_api.py`（追加）

**Interfaces:**
- Produces:
  - `GET /api/rotations/{id}/export.{fmt}`、`GET /api/playbooks/{id}/export.{fmt}`（fmt ∈ md|ahk，非法 → 400；对象缺失 → 404）
  - md → `text/markdown; charset=utf-8`；ahk → `text/plain; charset=utf-8`（PlainTextResponse）
  - binds 取 playbook 钉住的 keymap 版本（无绑定则空 dict）；rotation 导出用空 binds（技能自身 pattern 已足够，无 pattern 者出注释警告）

- [ ] **Step 1: 追加失败测试**

`backend/tests/test_api.py` 追加：

```python
def _make_playbook(client, analysis):
    sk = client.post("/api/skills", json={"name": "平A", "pattern": [
        {"op": "tap", "key": "1"}]}).json()
    from vd import db, store
    conn = db.connect()
    rot = store.create_rotation(conn, name="小循环",
                                body=[{"skill": sk["id"]}, {"gap": 150}],
                                derived_from=[analysis["id"]])
    pb = store.create_playbook(conn, name="测试方案", sections=[
        {"name": "唯一段", "body": [{"rotation": rot["id"], "iterations": 2}]}],
        derived_from=[analysis["id"]])
    conn.close()
    return rot, pb


def test_export_routes(client, analysis):
    rot, pb = _make_playbook(client, analysis)
    md = client.get(f"/api/playbooks/{pb['id']}/export.md")
    assert md.status_code == 200
    assert md.headers["content-type"].startswith("text/markdown")
    assert "# 方案：测试方案" in md.text
    ahk = client.get(f"/api/playbooks/{pb['id']}/export.ahk")
    assert ahk.status_code == 200
    assert "#Requires AutoHotkey v2.0" in ahk.text
    assert "Loop 2 {" in ahk.text
    rmd = client.get(f"/api/rotations/{rot['id']}/export.md")
    assert "# 循环：小循环" in rmd.text
    rahk = client.get(f"/api/rotations/{rot['id']}/export.ahk")
    assert 'Send "{1}"' in rahk.text
    assert client.get(f"/api/playbooks/{pb['id']}/export.pdf").status_code == 400
    assert client.get("/api/playbooks/nope/export.md").status_code == 404
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_api.py -x
```

- [ ] **Step 3: 实现**

`backend/src/vd/api.py`（import 追加 `from fastapi.responses import PlainTextResponse` 合并进现有行、`from vd.emit import ahk as emit_ahk, md as emit_md`）：

```python
def _export_context(conn):
    skills_by_id = {s["id"]: s for s in store.list_skills(conn)}
    rotations_by_id = {r["id"]: r for r in store.list_rotations(conn)}
    return skills_by_id, rotations_by_id


def _text_response(text: str, fmt: str):
    media = "text/markdown; charset=utf-8" if fmt == "md" else "text/plain; charset=utf-8"
    return PlainTextResponse(text, media_type=media)


@app.get("/api/rotations/{rotation_id}/export.{fmt}")
def export_rotation(rotation_id: str, fmt: str, conn=Depends(get_conn)):
    if fmt not in ("md", "ahk"):
        raise HTTPException(400, "fmt 仅支持 md/ahk")
    rot = store.get_rotation(conn, rotation_id)
    if rot is None:
        raise HTTPException(404)
    skills_by_id, _ = _export_context(conn)
    if fmt == "md":
        return _text_response(emit_md.render_rotation_md(rot, skills_by_id), fmt)
    return _text_response(emit_ahk.render_rotation_ahk(rot, skills_by_id, {}), fmt)


@app.get("/api/playbooks/{playbook_id}/export.{fmt}")
def export_playbook(playbook_id: str, fmt: str, conn=Depends(get_conn)):
    if fmt not in ("md", "ahk"):
        raise HTTPException(400, "fmt 仅支持 md/ahk")
    pb = store.get_playbook(conn, playbook_id)
    if pb is None:
        raise HTTPException(404)
    skills_by_id, rotations_by_id = _export_context(conn)
    binds = {}
    if pb.get("keymap_id"):
        km = store.get_keymap(conn, pb["keymap_id"], pb["keymap_version"])
        binds = km["binds"] if km else {}
    if fmt == "md":
        return _text_response(
            emit_md.render_playbook_md(pb, rotations_by_id, skills_by_id), fmt)
    return _text_response(
        emit_ahk.render_playbook_ahk(pb, rotations_by_id, skills_by_id, binds), fmt)
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd backend && uv run pytest -x
```

```bash
git add backend/src/vd/api.py backend/tests/test_api.py
git commit -m "feat(backend): rotation and playbook export routes"
```

---

### 任务 7：LLM 方案编排与 Playbook 提案

**Files:**
- Modify: `backend/src/vd/agent.py`（追加 compose）
- Modify: `backend/src/vd/api.py`（compose 端点 + playbook 路由 + accept 分支）
- Create: `backend/tests/test_compose.py`
- Modify: `backend/tests/test_api.py`（追加 playbook 路由测试）

**Interfaces:**
- Produces:
  - `agent.SectionPlan`（name + rotation_ids）、`agent.PlaybookPlan`（name + sections）、`agent.compose_playbook(rotations: list[dict], client=None) -> dict`——成功 `{"ok": True, "name", "sections": [{"name", "rotation_ids"}]}`；失败 `{"ok": False, "error"}`（模型 `claude-opus-5`，client 进 try）
  - `POST /api/analyses/{id}/compose`：全库无 accepted rotation → 400；supersede 本 analysis 的 pending **playbook** 提案（`delete_pending_proposals(conn, id, kind="playbook")`）；LLM 结果做**确定性修正**：未知 rotation_id 丢弃并记 report、遗漏的 id 追加到末段（或 LLM 失败时兜底单段「主循环」）；提案 payload `{"name","sections":[{"name","body":[{"rotation": id}...]}],"note"}`，report `{"rotations_used", "unknown_dropped", "missing_appended", "fallback"}`
  - accept：kind=='playbook' 时走 `create_playbook`（keymap 取该 analysis 绑定），请求体可带 `{"sections"}` 覆盖（逐块裁决结果，validate_sections 校验，非法 400）→ 返回 `{"proposal","playbook"}`
  - `GET /api/playbooks`、`GET /api/playbooks/{id}`、`PUT /api/playbooks/{id}` body `{name?, sections}` → 新版本、`GET /api/playbooks/{id}/versions`、`POST /api/playbooks/{id}/rollback` body `{version}`
- **注意**：任务 1 的 `delete_pending_proposals` 需要加 kind 形参（见其 Interfaces 修订）——discover 传 `kind="rotation"`、compose 传 `kind="playbook"`，互不误伤

- [ ] **Step 1: 写失败测试**

`backend/tests/test_compose.py`:

```python
from vd import agent
from vd.agent import PlaybookPlan, SectionPlan

ROTS = [{"id": "rot_1", "name": "单体稳定输出", "note": "主循环"},
        {"id": "rot_2", "name": "爆发循环", "note": ""}]


class FakeComposeResponse:
    stop_reason = "end_turn"
    parsed_output = PlaybookPlan(name="法师单体方案", sections=[
        SectionPlan(name="开场爆发", rotation_ids=["rot_2", "rot_ghost"]),
        SectionPlan(name="稳定输出", rotation_ids=[])])


class FakeMessages:
    def __init__(self, response=None, exc=None):
        self.response, self.exc = response, exc

    def parse(self, **kwargs):
        if self.exc:
            raise self.exc
        return self.response


class FakeComposeClient:
    def __init__(self, response=None, exc=None):
        self.messages = FakeMessages(response, exc)


def test_compose_success():
    r = agent.compose_playbook(ROTS, client=FakeComposeClient(FakeComposeResponse()))
    assert r["ok"] and r["name"] == "法师单体方案"
    assert r["sections"][0]["rotation_ids"] == ["rot_2", "rot_ghost"]


def test_compose_failure_contained():
    r = agent.compose_playbook(ROTS, client=FakeComposeClient(exc=RuntimeError("炸")))
    assert r["ok"] is False and "炸" in r["error"]
```

`backend/tests/test_api.py` 追加：

```python
def test_compose_endpoint_corrects_and_persists(client, analysis, monkeypatch):
    from test_compose import FakeComposeClient
    from vd.agent import PlaybookPlan, SectionPlan
    from vd import api as api_module, db, store
    conn = db.connect()
    rot = store.create_rotation(conn, name="单体稳定输出", body=[],
                                derived_from=[analysis["id"]])
    conn.close()

    class Resp:  # 用真实 rotation id 构造 LLM 假返回，附一个未知 id 与一个空段
        stop_reason = "end_turn"
        parsed_output = PlaybookPlan(name="法师方案", sections=[
            SectionPlan(name="开场", rotation_ids=[rot["id"], "rot_ghost"]),
            SectionPlan(name="空段", rotation_ids=[])])

    monkeypatch.setattr(api_module, "_agent_client", lambda: FakeComposeClient(Resp()))
    r = client.post(f"/api/analyses/{analysis['id']}/compose")
    assert r.status_code == 200
    p = r.json()["proposal"]
    assert p["kind"] == "playbook"
    assert p["payload"]["name"] == "法师方案"
    body_ids = [b["rotation"] for s in p["payload"]["sections"] for b in s["body"]]
    assert body_ids == [rot["id"]]                     # 未知 id 被丢弃、真实 id 保留
    assert p["report"]["unknown_dropped"] == ["rot_ghost"]
    assert all(s["body"] for s in p["payload"]["sections"])   # 空段被丢弃
    assert p["report"]["fallback"] is False


def test_compose_no_rotations_400(client, analysis):
    r = client.post(f"/api/analyses/{analysis['id']}/compose")
    assert r.status_code == 400


def test_accept_playbook_with_adjudicated_sections(client, analysis):
    from vd import db, store
    conn = db.connect()
    rot = store.create_rotation(conn, name="r", body=[])
    p = store.create_proposal(conn, analysis_id=analysis["id"], kind="playbook",
                              payload={"name": "方案A", "note": "",
                                       "sections": [{"name": "s", "body": [
                                           {"rotation": rot["id"]},
                                           {"rotation": rot["id"]}]}]},
                              report={})
    conn.close()
    adjudicated = {"sections": [{"name": "s", "body": [{"rotation": rot["id"]}]}]}
    r = client.post(f"/api/proposals/{p['id']}/accept", json=adjudicated)
    assert r.status_code == 200
    pb = r.json()["playbook"]
    assert len(pb["sections"][0]["body"]) == 1         # 裁决后的子集生效
    assert client.get("/api/playbooks").json()[0]["id"] == pb["id"]


def test_playbook_routes_roundtrip(client, analysis):
    _, pb = _make_playbook(client, analysis)
    got = client.get(f"/api/playbooks/{pb['id']}").json()
    assert got["version"] == 1
    upd = client.put(f"/api/playbooks/{pb['id']}",
                     json={"sections": [{"name": "改", "body": []}]}).json()
    assert upd["version"] == 2
    vs = client.get(f"/api/playbooks/{pb['id']}/versions").json()
    assert [v["version"] for v in vs] == [1, 2]
    back = client.post(f"/api/playbooks/{pb['id']}/rollback", json={"version": 1}).json()
    assert back["version"] == 3
    assert back["sections"][0]["name"] == "唯一段"
    assert client.put("/api/playbooks/nope",
                      json={"sections": []}).status_code == 400
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && uv run pytest tests/test_compose.py tests/test_api.py -x
```

- [ ] **Step 3: 实现 agent.compose_playbook**

`backend/src/vd/agent.py` 追加：

```python
COMPOSE_SYSTEM = (
    "你是动作游戏攻略专家。给你一组已确认的循环（rotation），"
    "请把它们编排成一个完整打法方案：给方案起名（≤10字），"
    "分成若干命名段落（如 开场爆发/稳定输出/收尾），"
    "每段列出该段使用的 rotation id（按执行顺序）。"
    "只能使用给定的 id，不要发明新的。"
)


class SectionPlan(BaseModel):
    name: str
    rotation_ids: list[str]


class PlaybookPlan(BaseModel):
    name: str
    sections: list[SectionPlan]


def compose_playbook(rotations: list[dict], client=None) -> dict:
    """LLM 方案编排（spec §7.2f）。只发文本；失败无副作用（spec §10）。"""
    desc = "\n".join(f"- {r['id']}：{r['name']}" + (f"（{r['note']}）" if r.get("note") else "")
                     for r in rotations)
    try:
        client = client or anthropic.Anthropic()
        response = client.messages.parse(
            model=MODEL,
            max_tokens=2048,
            system=COMPOSE_SYSTEM,
            messages=[{"role": "user", "content": f"可用循环：\n{desc}"}],
            output_format=PlaybookPlan,
        )
        if response.stop_reason == "refusal":
            return {"ok": False, "error": "LLM 拒绝了该请求"}
        plan = response.parsed_output
        return {"ok": True, "name": plan.name,
                "sections": [{"name": s.name, "rotation_ids": s.rotation_ids}
                             for s in plan.sections]}
    except Exception as e:  # noqa: BLE001 —— agent 失败必须被包住（spec §10）
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 4: 实现 compose / accept / playbook 路由**

`backend/src/vd/api.py` 追加：

```python
@app.post("/api/analyses/{analysis_id}/compose")
def run_compose(analysis_id: str, conn=Depends(get_conn)):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    rotations = store.list_rotations(conn)
    if not rotations:
        raise HTTPException(400, "还没有已接受的循环，先在推断面板接受一个 Rotation")
    store.delete_pending_proposals(conn, analysis_id, kind="playbook")
    known = {r["id"] for r in rotations}
    result = agent.compose_playbook(
        [{"id": r["id"], "name": r["name"], "note": r.get("note") or ""}
         for r in rotations],
        client=_agent_client())
    unknown_dropped: list[str] = []
    fallback = not result["ok"]
    if result["ok"]:
        name = result["name"]
        note = ""
        sections = []
        used: set[str] = set()
        for s in result["sections"]:
            ids = []
            for rid in s["rotation_ids"]:
                if rid in known and rid not in used:
                    ids.append(rid)
                    used.add(rid)
                elif rid not in known:
                    unknown_dropped.append(rid)
            sections.append({"name": s["name"],
                             "body": [{"rotation": rid} for rid in ids]})
        missing = [r["id"] for r in rotations if r["id"] not in used]
        if missing:
            target = sections[-1] if sections else None
            if target is None:
                sections.append({"name": "主循环", "body": []})
                target = sections[-1]
            target["body"] += [{"rotation": rid} for rid in missing]
        sections = [s for s in sections if s["body"]] or [
            {"name": "主循环", "body": [{"rotation": r["id"]} for r in rotations]}]
        missing_appended = len(missing)
    else:
        name = "未命名方案"
        note = result["error"]
        sections = [{"name": "主循环",
                     "body": [{"rotation": r["id"]} for r in rotations]}]
        missing_appended = 0
    payload = {"name": name, "note": note, "sections": sections}
    report = {"rotations_used": len(rotations), "unknown_dropped": unknown_dropped,
              "missing_appended": missing_appended, "fallback": fallback}
    proposal = store.create_proposal(conn, analysis_id=analysis_id, kind="playbook",
                                     payload=payload, report=report)
    return {"proposal": proposal}
```

`accept_proposal` 改为按 kind 分支（保留任务 1 的先建后改状态顺序；新增可选请求体）：

```python
class AcceptReq(BaseModel):
    sections: list | None = None


@app.post("/api/proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, req: AcceptReq | None = None,
                    conn=Depends(get_conn)):
    row = conn.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    if row["status"] != "pending":
        raise HTTPException(409, "proposal 已裁决")
    payload = json.loads(row["payload"])
    if row["kind"] == "playbook":
        sections = req.sections if (req and req.sections is not None) else payload["sections"]
        try:
            store.validate_sections(sections)
        except ValueError as e:
            raise HTTPException(400, str(e))
        tree = store.get_analysis_tree(conn, row["analysis_id"])
        playbook = store.create_playbook(
            conn, name=payload["name"], sections=sections,
            keymap_id=tree.get("keymap_id") if tree else None,
            keymap_version=tree.get("keymap_version") if tree else None,
            derived_from=[row["analysis_id"]])
        p = store.set_proposal_status(conn, proposal_id, "accepted")
        return {"proposal": p, "playbook": playbook}
    rotation = store.create_rotation(
        conn, name=payload["name"], body=payload["body"],
        params=payload.get("params"), note=payload.get("note"),
        derived_from=[row["analysis_id"]])
    p = store.set_proposal_status(conn, proposal_id, "accepted")
    return {"proposal": p, "rotation": rotation}
```

playbook 路由：

```python
@app.get("/api/playbooks")
def playbooks(conn=Depends(get_conn)):
    return store.list_playbooks(conn)


@app.get("/api/playbooks/{playbook_id}")
def playbook(playbook_id: str, conn=Depends(get_conn)):
    pb = store.get_playbook(conn, playbook_id)
    if pb is None:
        raise HTTPException(404)
    return pb


class PlaybookPut(BaseModel):
    name: str | None = None
    sections: list


@app.put("/api/playbooks/{playbook_id}")
def put_playbook(playbook_id: str, req: PlaybookPut, conn=Depends(get_conn)):
    try:
        return store.save_playbook(conn, playbook_id, sections=req.sections,
                                   name=req.name)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/playbooks/{playbook_id}/versions")
def playbook_versions(playbook_id: str, conn=Depends(get_conn)):
    return store.list_playbook_versions(conn, playbook_id)


class RollbackReq(BaseModel):
    version: int


@app.post("/api/playbooks/{playbook_id}/rollback")
def rollback(playbook_id: str, req: RollbackReq, conn=Depends(get_conn)):
    try:
        return store.rollback_playbook(conn, playbook_id, req.version)
    except ValueError as e:
        raise HTTPException(400, str(e))
```

（`delete_pending_proposals` 已在任务 1 就带 kind 形参——compose 传 `kind="playbook"`，与 discover 的 `kind="rotation"` 互不误伤，无需改造。）

- [ ] **Step 5: 运行确认通过并提交**

```bash
cd backend && uv run pytest
```

```bash
git add backend/src/vd backend/tests
git commit -m "feat(backend): LLM playbook composition with deterministic correction"
```

---

# 部分 C：前端（任务 8–12）

### 任务 8：类型与 client 扩展

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`（追加）

**Interfaces:**
- Produces：
  - 类型 `Block { rotation?; skill?; gap?; tol?; note?; iterations?; repeat_note?; pinned?; confidence? }`、`Section { name; body: Block[] }`、`Playbook { id; name; class; keymap_id; keymap_version; sections: Section[]; derived_from; version }`、`PlaybookVersion { version; created_at }`
  - `Proposal.payload` 放宽为同时容纳两种 kind：`{ name: string; note: string; body?: Record<string, unknown>[]; occurrences?: [number, number][]; param_positions?: number[]; sections?: Section[] }`
  - client 方法：`listPlaybooks / getPlaybook / putPlaybook(id, {name?, sections}) / playbookVersions(id) / rollbackPlaybook(id, version) / runCompose(analysisId)`；`acceptProposal(id, sections?)`（有 sections 时作为 JSON body）；URL 助手 `rotationExportUrl(id, fmt)` / `playbookExportUrl(id, fmt)`

- [ ] **Step 1: 追加失败测试**

`frontend/src/api/client.test.ts` 追加：

```ts
test('runCompose posts to compose endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ proposal: { id: 'pp_1' } }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.runCompose('an_1')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/analyses/an_1/compose')
})

test('acceptProposal sends adjudicated sections when provided', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ proposal: {}, playbook: {} }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.acceptProposal('pp_1', [{ name: 's', body: [] }])
  const [, init] = fetchMock.mock.calls[0]
  expect(JSON.parse(init.body).sections[0].name).toBe('s')
})

test('putPlaybook and export urls', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'pb_1', version: 2 }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.putPlaybook('pb_1', { sections: [] })
  expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
  expect(api.playbookExportUrl('pb_1', 'ahk')).toBe('/api/playbooks/pb_1/export.ahk')
  expect(api.rotationExportUrl('rot_1', 'md')).toBe('/api/rotations/rot_1/export.md')
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend && pnpm test
```

- [ ] **Step 3: 实现**

`frontend/src/api/types.ts` 追加（并把 `Proposal.payload` 换成上述放宽版）：

```ts
export interface Block {
  rotation?: string
  skill?: string
  gap?: number
  tol?: number
  note?: string
  iterations?: number
  repeat_note?: string
  pinned?: boolean
  confidence?: number
}

export interface Section { name: string; body: Block[] }

export interface Playbook {
  id: string; name: string; class: string | null
  keymap_id: string | null; keymap_version: number | null
  sections: Section[]; derived_from: string[]; version: number
}

export interface PlaybookVersion { version: number; created_at: string }
```

`frontend/src/api/client.ts` 的 `api` 追加（import 补 `Playbook, PlaybookVersion, Section`）：

```ts
  listPlaybooks: () => fetch('/api/playbooks').then(r => j<Playbook[]>(r)),
  getPlaybook: (id: string) => fetch(`/api/playbooks/${id}`).then(r => j<Playbook>(r)),
  putPlaybook: (id: string, body: { name?: string; sections: Section[] }) =>
    fetch(`/api/playbooks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => j<Playbook>(r)),
  playbookVersions: (id: string) =>
    fetch(`/api/playbooks/${id}/versions`).then(r => j<PlaybookVersion[]>(r)),
  rollbackPlaybook: (id: string, version: number) =>
    post(`/api/playbooks/${id}/rollback`, { version }).then(r => j<Playbook>(r)),
  runCompose: (analysisId: string) =>
    post(`/api/analyses/${analysisId}/compose`).then(r => j<{ proposal: Proposal }>(r)),
  rotationExportUrl: (id: string, fmt: 'md' | 'ahk') => `/api/rotations/${id}/export.${fmt}`,
  playbookExportUrl: (id: string, fmt: 'md' | 'ahk') => `/api/playbooks/${id}/export.${fmt}`,
```

并把 `acceptProposal` 改为：

```ts
  acceptProposal: (id: string, sections?: Section[]) =>
    post(`/api/proposals/${id}/accept`, sections ? { sections } : undefined)
      .then(r => j<{ proposal: Proposal; rotation?: Rotation; playbook?: Playbook }>(r)),
```

- [ ] **Step 4: 运行确认通过并提交**

```bash
cd frontend && pnpm test && pnpm build
```

```bash
git add frontend/src/api
git commit -m "feat(frontend): playbook api client"
```

---

### 任务 9：InferPanel —— 编排按钮与 Playbook 提案逐块裁决

**Files:**
- Modify: `frontend/src/panel/InferPanel.tsx`

**Interfaces:**
- Consumes: `api.runCompose/listRotations/acceptProposal(sections?)`
- Produces：「编排方案」按钮（在「发现循环」右侧）→ runCompose → refreshProposals；提案卡按 kind 分流——rotation 卡沿用；**playbook 卡**：段落标题 + 每个块一行复选框（默认勾选，显示循环名），accept 时把勾选块组装为 sections（空段丢弃；全空则禁用接受按钮）；拒绝按钮不变

- [ ] **Step 1: 实现**

`frontend/src/panel/InferPanel.tsx`：
- import 追加 `type { Rotation, Section }`；状态追加：

```tsx
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [blockChecks, setBlockChecks] = useState<Record<string, boolean>>({})
  useEffect(() => { void api.listRotations().then(setRotations) }, [proposals.length])
```

- 按钮行追加：

```tsx
        <button onClick={async () => { await api.runCompose(analysis.id); refreshProposals() }}>编排方案</button>
```

- 卡片渲染改为按 kind 分流。rotation 卡保持原样；playbook 卡（`p.kind === 'playbook'`）：

```tsx
  const rotName = (id: string) => rotations.find(r => r.id === id)?.name ?? id
  const blockKey = (pid: string, si: number, bi: number) => `${pid}:${si}:${bi}`
  const isChecked = (k: string) => blockChecks[k] !== false     // 默认勾选

  const adjudicated = (p: Proposal): Section[] =>
    (p.payload.sections ?? [])
      .map((s, si) => ({
        name: s.name,
        body: s.body.filter((_, bi) => isChecked(blockKey(p.id, si, bi))),
      }))
      .filter(s => s.body.length > 0)
```

playbook 卡 JSX（在 map 内替换原 body 预览部分）：

```tsx
          {(p.payload.sections ?? []).map((s, si) => (
            <div key={si}>
              <strong>§ {s.name}</strong>
              {s.body.map((b, bi) => (
                <p key={bi}>
                  <label>
                    <input type="checkbox"
                      checked={isChecked(blockKey(p.id, si, bi))}
                      disabled={p.status !== 'pending'}
                      onChange={e => setBlockChecks({
                        ...blockChecks, [blockKey(p.id, si, bi)]: e.target.checked })} />
                    {b.rotation ? `【循环】${rotName(b.rotation)}` : JSON.stringify(b)}
                  </label>
                </p>
              ))}
            </div>
          ))}
```

接受按钮对 playbook 卡改为：

```tsx
              <button
                disabled={adjudicated(p).length === 0}
                onClick={async () => { await api.acceptProposal(p.id, adjudicated(p)); refreshProposals() }}>
                接受勾选块
              </button>
```

- [ ] **Step 2: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src/panel/InferPanel.tsx
git commit -m "feat(frontend): playbook composition with per-block adjudication"
```

---

### 任务 10：方案页（列表与导出）

**Files:**
- Create: `frontend/src/pages/PlaybooksPage.tsx`

**Interfaces:**
- Consumes: `api.listRotations/listPlaybooks/rotationExportUrl/playbookExportUrl`
- Produces: `PlaybooksPage({ onBack, onEdit })`——循环表（名称 / body 预览 / 导出 md·ahk 链接）+ 方案表（名称 vN / 编辑按钮 / 导出 md·ahk 链接）；导出链接 `<a href target="_blank">`

- [ ] **Step 1: 实现**

`frontend/src/pages/PlaybooksPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Playbook, Rotation } from '../api/types'

export function PlaybooksPage({ onBack, onEdit }: {
  onBack: () => void; onEdit: (id: string) => void
}) {
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  useEffect(() => {
    void api.listRotations().then(setRotations)
    void api.listPlaybooks().then(setPlaybooks)
  }, [])

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>循环与方案</h1>
      <h2>循环（L3）</h2>
      <table><tbody>
        {rotations.map(r => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td style={{ color: '#888' }}>{r.note ?? ''}</td>
            <td>
              <a href={api.rotationExportUrl(r.id, 'md')} target="_blank" rel="noreferrer">md</a>{' · '}
              <a href={api.rotationExportUrl(r.id, 'ahk')} target="_blank" rel="noreferrer">ahk</a>
            </td>
          </tr>
        ))}
      </tbody></table>
      {rotations.length === 0 && <p style={{ color: '#888' }}>还没有循环——去工作台「发现循环」并接受一个。</p>}
      <h2>方案（L4）</h2>
      <table><tbody>
        {playbooks.map(pb => (
          <tr key={pb.id}>
            <td>{pb.name} v{pb.version}</td>
            <td><button onClick={() => onEdit(pb.id)}>编辑</button></td>
            <td>
              <a href={api.playbookExportUrl(pb.id, 'md')} target="_blank" rel="noreferrer">md</a>{' · '}
              <a href={api.playbookExportUrl(pb.id, 'ahk')} target="_blank" rel="noreferrer">ahk</a>
            </td>
          </tr>
        ))}
      </tbody></table>
      {playbooks.length === 0 && <p style={{ color: '#888' }}>还没有方案——工作台「编排方案」或接受一个 playbook 提案。</p>}
    </div>
  )
}
```

- [ ] **Step 2: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src/pages/PlaybooksPage.tsx
git commit -m "feat(frontend): rotations and playbooks listing page"
```

---

### 任务 11：块编辑器与导出并排预览

**Files:**
- Create: `frontend/src/pages/PlaybookEditor.tsx`

**Interfaces:**
- Consumes: `api.getPlaybook/putPlaybook/playbookVersions/rollbackPlaybook/listSkills/listRotations/playbookExportUrl`
- Produces: `PlaybookEditor({ playbookId, onBack })`（spec §8.4 的 M3 子集）：
  - 段落：重命名（行内 input）、加段落、删段落
  - 块：按 kind 行内编辑（rotation→循环下拉+iterations 数字+repeat_note 文本；skill→技能下拉；gap→数字；note→文本）；pinned 勾选；上移/下移/删除；每段尾部「+ 块」（kind 下拉 + 添加）
  - 保存 → PUT（version+1）并刷新；版本下拉 + 「回滚到此版本」
  - 右侧并排预览：md / ahk 两个 tab，加载与每次保存后重新 fetch 导出文本进 `<pre>`（spec §8.4-5 导出预览并排）

- [ ] **Step 1: 实现**

`frontend/src/pages/PlaybookEditor.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Block, Playbook, PlaybookVersion, Rotation, Section, Skill } from '../api/types'

const swap = <T,>(arr: T[], i: number, j: number): T[] => {
  const out = [...arr]; [out[i], out[j]] = [out[j], out[i]]; return out
}

export function PlaybookEditor({ playbookId, onBack }: {
  playbookId: string; onBack: () => void
}) {
  const [pb, setPb] = useState<Playbook | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [versions, setVersions] = useState<PlaybookVersion[]>([])
  const [rollbackTo, setRollbackTo] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [tab, setTab] = useState<'md' | 'ahk'>('md')
  const [preview, setPreview] = useState('')
  const [newKind, setNewKind] = useState<Record<number, string>>({})

  const load = (p: Playbook) => {
    setPb(p)
    setSections(structuredClone(p.sections))
    void api.playbookVersions(p.id).then(setVersions)
  }
  useEffect(() => {
    void api.getPlaybook(playbookId).then(load)
    void api.listSkills().then(setSkills)
    void api.listRotations().then(setRotations)
  }, [playbookId])
  useEffect(() => {
    if (!pb) return
    void fetch(api.playbookExportUrl(pb.id, tab)).then(r => r.text()).then(setPreview)
  }, [pb?.version, tab])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!pb) return <p>加载中…</p>

  const setBlock = (si: number, bi: number, patch: Partial<Block>) =>
    setSections(sections.map((s, i) => i !== si ? s : {
      ...s, body: s.body.map((b, j) => j !== bi ? b : { ...b, ...patch }) }))
  const removeBlock = (si: number, bi: number) =>
    setSections(sections.map((s, i) => i !== si ? s : {
      ...s, body: s.body.filter((_, j) => j !== bi) }))
  const moveBlock = (si: number, bi: number, dir: -1 | 1) => {
    const body = sections[si].body
    const j = bi + dir
    if (j < 0 || j >= body.length) return
    setSections(sections.map((s, i) => i !== si ? s : { ...s, body: swap(body, bi, j) }))
  }
  const addBlock = (si: number) => {
    const kind = newKind[si] ?? 'gap'
    const block: Block =
      kind === 'rotation' ? { rotation: rotations[0]?.id ?? '' }
        : kind === 'skill' ? { skill: skills[0]?.id ?? '' }
          : kind === 'note' ? { note: '' } : { gap: 100 }
    setSections(sections.map((s, i) => i !== si ? s : { ...s, body: [...s.body, block] }))
  }

  const blockEditor = (b: Block, si: number, bi: number) => (
    <p key={bi} style={{ border: '1px solid #2a2f3a', padding: 4 }}>
      {b.rotation !== undefined && (<>
        【循环】
        <select value={b.rotation}
          onChange={e => setBlock(si, bi, { rotation: e.target.value })}>
          {rotations.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        ×<input style={{ width: 50 }} type="number" min={1}
          value={b.iterations ?? ''} placeholder="∞"
          onChange={e => setBlock(si, bi, {
            iterations: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <input placeholder="循环条件注释（不可执行）" value={b.repeat_note ?? ''}
          onChange={e => setBlock(si, bi, { repeat_note: e.target.value || undefined })} />
      </>)}
      {b.skill !== undefined && (<>
        【技能】
        <select value={b.skill} onChange={e => setBlock(si, bi, { skill: e.target.value })}>
          {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </>)}
      {b.gap !== undefined && (<>
        等待 <input style={{ width: 70 }} type="number"
          value={b.gap} onChange={e => setBlock(si, bi, { gap: Number(e.target.value) })} /> ms
      </>)}
      {b.note !== undefined && (<>
        备注 <input value={b.note} onChange={e => setBlock(si, bi, { note: e.target.value })} />
      </>)}
      <label> <input type="checkbox" checked={b.pinned ?? false}
        onChange={e => setBlock(si, bi, { pinned: e.target.checked || undefined })} />pinned</label>
      <button onClick={() => moveBlock(si, bi, -1)}>↑</button>
      <button onClick={() => moveBlock(si, bi, 1)}>↓</button>
      <button onClick={() => removeBlock(si, bi)}>删</button>
    </p>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12 }}>
      <div>
        <p><button onClick={onBack}>← 返回</button> <strong>{pb.name}</strong> v{pb.version}</p>
        {sections.map((s, si) => (
          <div key={si} style={{ border: '1px solid #345', margin: '8px 0', padding: 6 }}>
            <p>
              § <input value={s.name}
                onChange={e => setSections(sections.map((x, i) =>
                  i !== si ? x : { ...x, name: e.target.value }))} />
              <button onClick={() => setSections(sections.filter((_, i) => i !== si))}>删段落</button>
            </p>
            {s.body.map((b, bi) => blockEditor(b, si, bi))}
            <p>
              <select value={newKind[si] ?? 'gap'}
                onChange={e => setNewKind({ ...newKind, [si]: e.target.value })}>
                <option value="rotation">循环块</option>
                <option value="skill">技能块</option>
                <option value="gap">等待块</option>
                <option value="note">注释块</option>
              </select>
              <button onClick={() => addBlock(si)}>+ 块</button>
            </p>
          </div>
        ))}
        <p>
          <button onClick={() => setSections([...sections, { name: '新段落', body: [] }])}>+ 段落</button>
          <button onClick={async () => {
            const updated = await api.putPlaybook(pb.id, { sections })
            load(updated)
          }}>保存（v{pb.version + 1}）</button>
        </p>
        <p>
          <select value={rollbackTo} onChange={e => setRollbackTo(e.target.value)}>
            <option value="">历史版本…</option>
            {versions.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
          </select>
          <button disabled={!rollbackTo} onClick={async () => {
            const restored = await api.rollbackPlaybook(pb.id, Number(rollbackTo))
            setRollbackTo(''); load(restored)
          }}>回滚到此版本</button>
        </p>
      </div>
      <div>
        <p>
          <button className={tab === 'md' ? 'active' : ''} onClick={() => setTab('md')}>文档预览</button>
          <button className={tab === 'ahk' ? 'active' : ''} onClick={() => setTab('ahk')}>AHK 预览</button>
          <a href={api.playbookExportUrl(pb.id, tab)} download>下载</a>
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#0e1015', padding: 8,
          maxHeight: '85vh', overflow: 'auto' }}>{preview}</pre>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证并提交**

```bash
cd frontend && pnpm build && pnpm test
```

```bash
git add frontend/src/pages/PlaybookEditor.tsx
git commit -m "feat(frontend): playbook block editor with versions and export preview"
```

---

### 任务 12：导航集成与 M3 验收走查

**Files:**
- Modify: `frontend/src/App.tsx`（页面枚举加 `'playbooks'`；编辑器状态）
- Modify: `README.md`（M3 一段）

**Interfaces:**
- Produces: VideoLibrary 头部加「循环与方案」按钮；`App` 增加 `editingPlaybook: string | null` 状态——设置后渲染 `<PlaybookEditor playbookId onBack={() => setEditingPlaybook(null)} />`（onBack 回方案页）

- [ ] **Step 1: 实现导航**

`frontend/src/App.tsx`：
- import 追加 `{ PlaybooksPage } from './pages/PlaybooksPage'`、`{ PlaybookEditor } from './pages/PlaybookEditor'`
- `App()` 改为：

```tsx
export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  const [page, setPage] = useState<'library' | 'catalog' | 'keymap' | 'playbooks'>('library')
  const [editingPlaybook, setEditingPlaybook] = useState<string | null>(null)
  if (video) return <><ErrorBar /><Workbench video={video} onBack={() => setVideo(null)} /></>
  if (editingPlaybook) return <><ErrorBar />
    <PlaybookEditor playbookId={editingPlaybook} onBack={() => setEditingPlaybook(null)} /></>
  if (page === 'catalog') return <><ErrorBar /><CatalogPage onBack={() => setPage('library')} /></>
  if (page === 'keymap') return <><ErrorBar /><KeymapPage onBack={() => setPage('library')} /></>
  if (page === 'playbooks') return <><ErrorBar />
    <PlaybooksPage onBack={() => setPage('library')} onEdit={setEditingPlaybook} /></>
  return <><ErrorBar /><VideoLibrary onOpen={setVideo}
    onCatalog={() => setPage('catalog')} onKeymap={() => setPage('keymap')}
    onPlaybooks={() => setPage('playbooks')} /></>
}
```

- `VideoLibrary` props 加 `onPlaybooks: () => void`，按钮行加 `<button onClick={onPlaybooks}>循环与方案</button>`

`README.md` 追加：

```markdown
## M3 功能

- 首页「循环与方案」：L3/L4 列表与 md/ahk 导出
- 方案块编辑器：段落/块行内编辑、pinned、版本链与回滚、文档与 AHK 并排预览
- 工作台「编排方案」：LLM 把已接受的循环编排成分段方案（无 API key 时确定性兜底为单段），提案逐块勾选裁决
- AHK 产物为 AutoHotkey v2；真机运行验收属 M4（Windows）
```

- [ ] **Step 2: 全量验证并提交**

```bash
cd backend && uv run pytest && cd ../frontend && pnpm test && pnpm build
```

```bash
git add frontend/src README.md
git commit -m "feat: playbook navigation, completing M3 loop"
```

- [ ] **Step 3: M3 验收走查（对照 spec §12-M3：从一个视频走到可读文档 + 能运行的 AHK 脚本；控制器在浏览器执行）**

1. 工作台（已有已接受 rotation）→「编排方案」→ playbook 提案卡出现（无 API key 时为「未命名方案」单段兜底）
2. 取消勾选某个块 →「接受勾选块」→ 方案落库且不含该块
3. 首页「循环与方案」→ 两表均有数据；点循环的 md/ahk 链接可打开文本
4. 「编辑」进入块编辑器：改段落名、加等待块、调 iterations、勾 pinned → 保存 → v2；右侧预览同步更新（md 与 ahk tab 均可见变更）
5. 回滚到 v1 → v3 出现且内容回到 v1；预览同步
6. AHK 预览含 `#Requires AutoHotkey v2.0`、`F12::ExitApp`、`Loop`、`Send`；文档预览结构可读
7. 重启前后端 → 方案、版本链、提案裁决状态原样

---

## 计划外（M3 明确不做，防止执行时膨胀）

- pinned 的 recompose 保护（重编排时保留 pinned 块的确定性合并）——M4/后续随重编排功能一起
- 拖拽重排（spec §8.4-6 优先级低，M3 用 ↑/↓）；从时间轴拖入（§8.4-8）
- 实测值采纳按钮（§8.4-3——rotation body 的 gap 已是实测中位数，M3 无独立标称值可对比）
- 反向溯源跳转（§8.4-7 [来源 ↗]）
- 实时校验红标（§8.4-4——CD/动画锁校验属对齐引擎，块编辑器侧 M4+）
- AHK 真机运行、razer 导出、注入执行——全部 M4
- Segment、撤销/重做——维持既往立场
