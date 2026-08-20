import json
import time

import pytest


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


def test_sprite_unknown_video_404(client):
    assert client.get("/api/videos/nope/sprite").status_code == 404


def test_video_file_range_beyond_size_416(client, sample_video):
    vid = _ready_video(client, sample_video)
    r = client.get(f"/api/videos/{vid}/file", headers={"Range": "bytes=99999999-"})
    assert r.status_code == 416
    assert r.headers["content-range"].startswith("bytes */")


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


def test_analysis_create_and_fetch(client, analysis):
    assert analysis["name"].endswith("_a1")
    tree = client.get(f"/api/analyses/{analysis['id']}").json()
    assert [l["layer"] for l in tree["lanes"]] == ["L0", "L1", "L2"]


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


def test_proposal_accept_is_idempotent(client, analysis):
    from vd import db, store
    conn = db.connect()
    p = store.create_proposal(conn, analysis_id=analysis["id"], kind="rotation",
                              payload={"name": "x", "body": []}, report={})
    conn.close()
    assert client.post(f"/api/proposals/{p['id']}/accept").status_code == 200
    assert client.post(f"/api/proposals/{p['id']}/accept").status_code == 409
    assert len(client.get("/api/rotations").json()) == 1
    assert client.post(f"/api/proposals/{p['id']}/reject").status_code == 409
    assert client.post("/api/proposals/nope/accept").status_code == 404


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


def test_export_plan_and_razer_routes(client, analysis):
    rot, pb = _make_playbook(client, analysis)
    r = client.get(f"/api/playbooks/{pb['id']}/export.plan")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/json; charset=utf-8"
    doc = r.json()
    assert doc["format"] == "vd-plan" and doc["stop_hotkey"] == "F12"
    r2 = client.get(f"/api/rotations/{rot['id']}/export.razer")
    assert r2.status_code == 200
    assert r2.headers["content-type"] == "application/xml; charset=utf-8"
    assert "<Macro name=" in r2.text
    assert client.get(f"/api/playbooks/{pb['id']}/export.exe").status_code == 400


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


def test_accept_playbook_malformed_payload_500_keeps_pending(client, analysis):
    from vd import db, store
    conn = db.connect()
    p = store.create_proposal(conn, analysis_id=analysis["id"], kind="playbook",
                              payload={"note": "缺 name 和 sections"}, report={})
    conn.close()
    r = client.post(f"/api/proposals/{p['id']}/accept")
    assert r.status_code == 500                       # 畸形 payload 仍失败……
    conn = db.connect()
    fresh = store.list_proposals(conn, analysis["id"])
    conn.close()
    bad = [x for x in fresh if x["id"] == p["id"]][0]
    assert bad["status"] == "pending"                 # ……但状态未被卡死，可重试/拒绝


def test_playbook_versions_nonexistent_404(client):
    r = client.get("/api/playbooks/nope/versions")
    assert r.status_code == 404


def test_put_playbook_rejects_non_dict_block_400(client, analysis):
    _, pb = _make_playbook(client, analysis)
    r = client.put(f"/api/playbooks/{pb['id']}",
                   json={"sections": [{"name": "x", "body": ["rotation"]}]})
    assert r.status_code == 400


def test_exec_lifecycle_and_backfeed(client, analysis, monkeypatch):
    from vd import api as api_module
    from vd.host import MockHost
    h = MockHost()
    monkeypatch.setattr(api_module, "_exec_host", h)

    _, pb = _make_playbook(client, analysis)
    an_id = analysis["id"]

    r = client.post("/api/exec/start", json={"kind": "playbook", "id": pb["id"]})
    assert r.status_code == 200
    st = None
    for _ in range(100):
        st = client.get("/api/exec/status").json()
        if st["state"] == "done":
            break
        time.sleep(0.02)
    assert st["state"] == "done"
    assert len(h.injected) == st["total"] > 0

    r = client.post("/api/exec/backfeed", json={"analysis_id": an_id})
    assert r.status_code == 200
    take = r.json()
    assert take["marks"]
    assert all(m["provenance"] == "execution_log" for m in take["marks"])


def test_exec_start_conflict_and_stop(client, analysis, monkeypatch):
    from vd import api as api_module
    from vd.host import MockHost
    monkeypatch.setattr(api_module, "_exec_host", MockHost())
    _, pb = _make_playbook(client, analysis)
    slow_events = [{"t_ms": i * 100, "action": "tap", "key": "q"} for i in range(50)]
    monkeypatch.setattr(
        api_module.emit_plan, "render_playbook_plan",
        lambda *a, **k: json.dumps({"format": "vd-plan", "version": 1,
                                    "title": "t", "stop_hotkey": "F12",
                                    "events": slow_events,
                                    "manual_loops": [], "warnings": []}))
    assert client.post("/api/exec/start",
                       json={"kind": "playbook", "id": pb["id"]}).status_code == 200
    assert client.post("/api/exec/start",
                       json={"kind": "playbook", "id": pb["id"]}).status_code == 409
    assert client.post("/api/exec/stop").status_code == 200
    assert client.get("/api/exec/status").json()["state"] == "stopped"


def test_execution_log_takes_excluded_from_aggregation(client, analysis):
    lane = analysis["lanes"][0]
    t1 = lane["takes"][0]
    client.post(f"/api/takes/{t1['id']}/marks",
                json={"t_ms": 1000, "kind": "input", "label": "Q"})
    from vd import db, store
    conn = db.connect()
    t2 = store.create_take(conn, lane["id"])
    store.insert_mark(conn, t2["id"], t_ms=99000, kind="input", label="Q",
                      provenance="execution_log")
    conn.close()
    agg = client.get(f"/api/lanes/{lane['id']}/aggregate").json()["aggregated"]
    assert [m["t_ms"] for m in agg] == [1000]   # 99000 不得影响中位数


def test_capture_roundtrip_with_mock(client, sample_video, monkeypatch, tmp_path):
    from vd import api as api_module
    from vd.host import MockHost
    fixture = tmp_path / "cap.mp4"
    import shutil
    shutil.copyfile(sample_video, fixture)
    monkeypatch.setattr(api_module, "_exec_host", MockHost(capture_fixture=str(fixture)))
    assert client.post("/api/capture/start").status_code == 200
    r = client.post("/api/capture/stop")
    assert r.status_code == 200
    assert r.json()["id"].startswith("vid_")
