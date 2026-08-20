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
