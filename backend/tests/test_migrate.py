from vd import db


def _tables(conn):
    return {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}


def _cols(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_fresh_db_is_v4():
    conn = db.connect()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 4
    assert {"skills", "keymaps", "rotations", "proposals"} <= _tables(conn)
    assert {"keymap_id", "keymap_version"} <= _cols(conn, "analyses")
    assert {"playbooks", "playbook_versions"} <= _tables(conn)
    assert {"compare_video_id", "compare_offset_ms"} <= _cols(conn, "analyses")


def test_migration_from_v1_is_idempotent(data_dir):
    # 模拟 M1 旧库：先建 v1 表（user_version 0），再连接触发迁移
    import sqlite3
    p = data_dir / "vd.sqlite3"
    data_dir.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(p)
    raw.executescript(db.SCHEMA)          # v1 部分（IF NOT EXISTS）
    raw.close()
    conn = db.connect()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 4
    conn.close()
    conn2 = db.connect()                  # 再连不报错（幂等）
    assert {"keymap_id", "keymap_version"} <= _cols(conn2, "analyses")
    assert {"playbooks", "playbook_versions"} <= _tables(conn2)
    assert {"compare_video_id", "compare_offset_ms"} <= _cols(conn2, "analyses")


def test_v3_adds_playbooks_and_extends_proposal_kind():
    conn = db.connect()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 4
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
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 4
