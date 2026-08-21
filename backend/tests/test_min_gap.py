"""M9 任务 1：最小间距校验（同一帧内两个标记视为冲突）。

sample_video 为 15fps 源，ingest 转码目标固定 30fps → 帧长 round(1000/30) = 33ms。
"""


def test_min_gap_rejects_sub_frame_spacing(client, analysis):
    take = analysis["lanes"][0]["takes"][0]
    r1 = client.post(f"/api/takes/{take['id']}/marks",
                      json={"t_ms": 1000, "kind": "input", "label": "Q"})
    assert r1.status_code == 200
    r2 = client.post(f"/api/takes/{take['id']}/marks",
                      json={"t_ms": 1010, "kind": "input", "label": "W"})
    assert r2.status_code == 400
    assert "距离过近" in r2.json()["detail"]


def test_min_gap_allows_spacing_at_exact_frame_length(client, analysis):
    take = analysis["lanes"][0]["takes"][0]
    r1 = client.post(f"/api/takes/{take['id']}/marks",
                      json={"t_ms": 1000, "kind": "input", "label": "Q"})
    assert r1.status_code == 200
    r2 = client.post(f"/api/takes/{take['id']}/marks",
                      json={"t_ms": 1033, "kind": "input", "label": "W"})
    assert r2.status_code == 200


def test_min_gap_patch_checks_neighbors_but_allows_restore_and_noop(client, analysis):
    take = analysis["lanes"][0]["takes"][0]
    m1 = client.post(f"/api/takes/{take['id']}/marks",
                      json={"t_ms": 1000, "kind": "input", "label": "Q"}).json()
    m2 = client.post(f"/api/takes/{take['id']}/marks",
                      json={"t_ms": 1033, "kind": "input", "label": "W"}).json()

    # 移到距 m1 <33ms 处 → 400
    r_bad = client.patch(f"/api/marks/{m2['id']}", json={"t_ms": 1010})
    assert r_bad.status_code == 400
    assert "距离过近" in r_bad.json()["detail"]

    # 移回合法位置 → 200
    r_ok = client.patch(f"/api/marks/{m2['id']}", json={"t_ms": 1033})
    assert r_ok.status_code == 200

    # 对自身原位（t 不变）→ 200（排除自身 id，不与自己冲突）
    r_noop = client.patch(f"/api/marks/{m2['id']}", json={"t_ms": 1033})
    assert r_noop.status_code == 200
    assert m1["id"] != m2["id"]


def test_min_gap_execution_log_insert_bypasses_check(analysis):
    """execution_log 豁免：真实和弦事件可合法共享同一帧（store 层直连测试）。"""
    from vd import db, store

    conn = db.connect()
    take_id = analysis["lanes"][0]["takes"][0]["id"]
    m1 = store.insert_mark(conn, take_id, t_ms=2000, kind="input", label="Shift",
                            provenance="execution_log")
    m2 = store.insert_mark(conn, take_id, t_ms=2000, kind="input", label="2",
                            provenance="execution_log")
    conn.close()
    assert m1["t_ms"] == m2["t_ms"] == 2000
    assert m1["id"] != m2["id"]


def test_min_gap_exec_backfeed_chord_same_tms_regression(client, analysis, monkeypatch):
    """回灌回归锚点：和弦（down Shift 与 tap 2 同 t_ms）经 exec_backfeed 全量入库不得 500/400。"""
    from vd import api as api_module

    class FakeSession:
        def __init__(self, log):
            self.state = "done"
            self.log = log

    log = [
        {"t_ms": 500, "action": "down", "key": "Shift"},
        {"t_ms": 500, "action": "tap", "key": "2"},
        {"t_ms": 600, "action": "up", "key": "Shift"},
    ]
    monkeypatch.setattr(api_module, "_exec_session", FakeSession(log))

    r = client.post("/api/exec/backfeed", json={"analysis_id": analysis["id"]})
    assert r.status_code == 200
    marks = r.json()["marks"]
    # down Shift+up Shift 配对为一条（end_ms=600），tap 2 为另一条：两条都在 t_ms=500，
    # 若无豁免会因“同一帧内”互斥而炸掉
    assert len(marks) == 2
    assert all(m["t_ms"] == 500 for m in marks)
    assert all(m["provenance"] == "execution_log" for m in marks)
