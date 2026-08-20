from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, UploadFile
from pydantic import BaseModel

from vd import aggregate as agg, db, ingest, store
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


class AnalysisReq(BaseModel):
    video_id: str


@app.post("/api/analyses")
def create_analysis(req: AnalysisReq, conn=Depends(get_conn)):
    try:
        return store.create_analysis(conn, req.video_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/analyses")
def list_analyses(video_id: str, conn=Depends(get_conn)):
    rows = conn.execute(
        "SELECT * FROM analyses WHERE video_id=? ORDER BY seq", (video_id,))
    return [dict(r) for r in rows]


@app.get("/api/analyses/{analysis_id}")
def analysis(analysis_id: str, conn=Depends(get_conn)):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    return tree


@app.post("/api/lanes/{lane_id}/takes")
def new_take(lane_id: str, conn=Depends(get_conn)):
    return store.create_take(conn, lane_id)


class MarkReq(BaseModel):
    t_ms: int
    kind: str
    label: str | None = None
    end_ms: int | None = None


@app.post("/api/takes/{take_id}/marks")
def new_mark(take_id: str, req: MarkReq, conn=Depends(get_conn)):
    try:
        return store.insert_mark(conn, take_id, t_ms=req.t_ms, kind=req.kind,
                                 label=req.label, end_ms=req.end_ms)
    except ValueError as e:
        raise HTTPException(400, str(e))


class MarkPatch(BaseModel):
    t_ms: int | None = None
    end_ms: int | None = None
    label: str | None = None
    clear_end: bool = False


@app.patch("/api/marks/{mark_id}")
def patch_mark(mark_id: str, req: MarkPatch, conn=Depends(get_conn)):
    fields = {k: v for k, v in req.model_dump().items()
              if k != "clear_end" and v is not None}
    if req.clear_end:
        fields["end_ms"] = None
    if not fields:
        raise HTTPException(400, "empty patch")
    try:
        return store.update_mark(conn, mark_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/marks/{mark_id}")
def del_mark(mark_id: str, conn=Depends(get_conn)):
    store.delete_mark(conn, mark_id)
    return {"ok": True}


class TallyReq(BaseModel):
    t_ms: int


@app.post("/api/analyses/{analysis_id}/tally")
def add_tally(analysis_id: str, req: TallyReq, conn=Depends(get_conn)):
    return store.add_tally(conn, analysis_id, req.t_ms)


@app.delete("/api/analyses/{analysis_id}/tally")
def clear_tally(analysis_id: str, conn=Depends(get_conn)):
    store.clear_tally(conn, analysis_id)
    return {"ok": True}


@app.get("/api/lanes/{lane_id}/aggregate")
def lane_aggregate(lane_id: str, window_ms: int = 300, conn=Depends(get_conn)):
    takes = []
    for t in conn.execute(
            "SELECT id FROM takes WHERE lane_id=? ORDER BY idx", (lane_id,)):
        marks = [dict(r) for r in conn.execute(
            "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (t["id"],))]
        takes.append(marks)
    return agg.aggregate_lane(takes, window_ms=window_ms)
