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
