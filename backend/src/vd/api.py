from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, UploadFile
from pydantic import BaseModel

from vd import db, ingest, store
from vd.config import data_root

app = FastAPI(title="Video Distiller")


def get_conn():
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


@app.get("/api/videos")
def videos(conn=Depends(get_conn)):
    return store.list_videos(conn)


@app.get("/api/videos/{video_id}")
def video(video_id: str, conn=Depends(get_conn)):
    v = store.get_video(conn, video_id)
    if v is None:
        raise HTTPException(404)
    return v


@app.post("/api/videos/upload")
def upload(file: UploadFile, background_tasks: BackgroundTasks, conn=Depends(get_conn)):
    v = store.create_video(conn, name=file.filename or "未命名", source_kind="upload")
    suffix = Path(file.filename or "v.mp4").suffix or ".mp4"
    dest = data_root() / "originals" / f"{v['id']}{suffix}"
    with dest.open("wb") as f:
        while chunk := file.file.read(1 << 20):
            f.write(chunk)
    v = store.update_video(conn, v["id"], original_path=str(dest))
    background_tasks.add_task(ingest.process, v["id"])
    return v


class PullReq(BaseModel):
    url: str


@app.post("/api/videos/pull")
def pull(req: PullReq, background_tasks: BackgroundTasks, conn=Depends(get_conn)):
    v = store.create_video(conn, name=req.url, source_kind="bilibili", source_url=req.url)
    background_tasks.add_task(_pull_then_process, v["id"], req.url)
    return v


def _pull_then_process(video_id: str, url: str) -> None:
    conn = db.connect()
    try:
        dest = data_root() / "originals" / f"{video_id}.mp4"
        ingest.pull_bilibili(url, dest)
        store.update_video(conn, video_id, original_path=str(dest))
    except Exception as e:  # noqa: BLE001
        store.update_video(conn, video_id, status="failed", error=str(e))
        return
    finally:
        conn.close()
    ingest.process(video_id)
