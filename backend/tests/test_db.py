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
