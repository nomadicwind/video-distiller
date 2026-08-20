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


def test_connection_usable_across_threads():
    import threading

    conn = db.connect()
    errors: list[Exception] = []

    def use():
        try:
            conn.execute("SELECT COUNT(*) FROM videos").fetchone()
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    t = threading.Thread(target=use)
    t.start()
    t.join()
    assert errors == []
    conn.close()
