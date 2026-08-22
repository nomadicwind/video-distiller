from vd import db, store


def _make_video(status="ready"):
    conn = db.connect()
    try:
        v = store.create_video(conn, name="cmp", source_kind="upload")
        v = store.update_video(conn, v["id"], status=status)
    finally:
        conn.close()
    return v


def test_set_compare_persists_and_reflects_in_get(client, analysis):
    v2 = _make_video(status="ready")
    r = client.patch(f"/api/analyses/{analysis['id']}/compare",
                     json={"video_id": v2["id"], "offset_ms": 5200})
    assert r.status_code == 200
    body = r.json()
    assert body["compare_video_id"] == v2["id"]
    assert body["compare_offset_ms"] == 5200
    tree = client.get(f"/api/analyses/{analysis['id']}").json()
    assert tree["compare_video_id"] == v2["id"]
    assert tree["compare_offset_ms"] == 5200


def test_set_compare_offset_can_be_negative(client, analysis):
    v2 = _make_video(status="ready")
    r = client.patch(f"/api/analyses/{analysis['id']}/compare",
                     json={"video_id": v2["id"], "offset_ms": -3000})
    assert r.status_code == 200
    assert r.json()["compare_offset_ms"] == -3000


def test_set_compare_invalid_or_not_ready_video_is_400(client, analysis):
    r = client.patch(f"/api/analyses/{analysis['id']}/compare",
                     json={"video_id": "nope", "offset_ms": 0})
    assert r.status_code == 400
    assert "不存在或未就绪" in r.json()["detail"]

    v2 = _make_video(status="transcoding")
    r2 = client.patch(f"/api/analyses/{analysis['id']}/compare",
                      json={"video_id": v2["id"], "offset_ms": 0})
    assert r2.status_code == 400
    assert "不存在或未就绪" in r2.json()["detail"]


def test_set_compare_clear_resets_both_fields(client, analysis):
    v2 = _make_video(status="ready")
    client.patch(f"/api/analyses/{analysis['id']}/compare",
                json={"video_id": v2["id"], "offset_ms": 1000})
    r = client.patch(f"/api/analyses/{analysis['id']}/compare",
                     json={"video_id": None, "offset_ms": 0})
    assert r.status_code == 200
    body = r.json()
    assert body["compare_video_id"] is None
    assert body["compare_offset_ms"] is None


def test_set_compare_missing_analysis_is_404(client):
    r = client.patch("/api/analyses/nope/compare",
                     json={"video_id": None, "offset_ms": 0})
    assert r.status_code == 404
