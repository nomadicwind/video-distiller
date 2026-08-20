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
