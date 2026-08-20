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
