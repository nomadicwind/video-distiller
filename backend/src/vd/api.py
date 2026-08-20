import re
from pathlib import Path
from typing import Iterator, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
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


CHUNK = 1 << 20


def _read_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    with path.open("rb") as f:
        f.seek(start)
        left = end - start + 1
        while left > 0:
            data = f.read(min(CHUNK, left))
            if not data:
                break
            left -= len(data)
            yield data


@app.get("/api/videos/{video_id}/file")
def video_file(video_id: str, request: Request, conn=Depends(get_conn)):
    v = store.get_video(conn, video_id)
    if v is None:
        raise HTTPException(404)
    path = Path(v["work_path"] or v["original_path"])
    if not path.exists():
        raise HTTPException(404)
    size = path.stat().st_size
    m = re.match(r"bytes=(\d*)-(\d*)", request.headers.get("range") or "")
    if not m:
        return StreamingResponse(
            _read_range(path, 0, size - 1), media_type="video/mp4",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(size)},
        )
    g1, g2 = m.group(1), m.group(2)
    if not g1 and g2:                      # 后缀形式 bytes=-N：最后 N 字节
        start = max(0, size - int(g2))
        end = size - 1
    else:
        start = int(g1 or 0)
        end = min(int(g2 or size - 1), size - 1)
    if start >= size or start > end:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    return StreamingResponse(
        _read_range(path, start, end), status_code=206, media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(end - start + 1),
        },
    )


@app.get("/api/videos/{video_id}/sprite")
def sprite(video_id: str, conn=Depends(get_conn)):
    v = store.get_video(conn, video_id)
    if v is None:
        raise HTTPException(404)
    p = data_root() / "thumbs" / f"{video_id}.jpg"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


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
    kind: Literal["input", "release"]
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


class SkillReq(BaseModel):
    name: str
    class_: str | None = None
    cd_ms: int | None = None
    cast_ms: int | None = None
    anim_ms: int | None = None
    cancelable: bool = False
    pattern: list = []


@app.get("/api/skills")
def skills(conn=Depends(get_conn)):
    return store.list_skills(conn)


@app.post("/api/skills")
def create_skill(req: SkillReq, conn=Depends(get_conn)):
    try:
        return store.create_skill(conn, name=req.name, class_=req.class_,
                                  cd_ms=req.cd_ms, cast_ms=req.cast_ms,
                                  anim_ms=req.anim_ms, cancelable=req.cancelable,
                                  pattern=req.pattern)
    except ValueError as e:
        raise HTTPException(400, str(e))


class SkillPatch(BaseModel):
    name: str | None = None
    class_: str | None = None
    cd_ms: int | None = None
    cast_ms: int | None = None
    anim_ms: int | None = None
    cancelable: bool | None = None
    pattern: list | None = None


@app.patch("/api/skills/{skill_id}")
def patch_skill(skill_id: str, req: SkillPatch, conn=Depends(get_conn)):
    fields = {("class" if k == "class_" else k): v
              for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "empty patch")
    try:
        result = store.update_skill(conn, skill_id, **fields)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if result is None:
        raise HTTPException(404)
    return result


@app.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: str, conn=Depends(get_conn)):
    store.delete_skill(conn, skill_id)
    return {"ok": True}


class KeymapReq(BaseModel):
    keymap_id: str
    class_: str | None = None
    binds: dict


@app.get("/api/keymaps")
def keymaps(conn=Depends(get_conn)):
    return store.list_keymaps(conn)


@app.post("/api/keymaps")
def save_keymap(req: KeymapReq, conn=Depends(get_conn)):
    return store.save_keymap(conn, keymap_id=req.keymap_id, class_=req.class_,
                             binds=req.binds)


class KeymapBindReq(BaseModel):
    keymap_id: str
    version: int


@app.patch("/api/analyses/{analysis_id}/keymap")
def bind_keymap(analysis_id: str, req: KeymapBindReq, conn=Depends(get_conn)):
    a = store.bind_analysis_keymap(conn, analysis_id, req.keymap_id, req.version)
    if a is None:
        raise HTTPException(404)
    return a


@app.get("/api/analyses/{analysis_id}/proposals")
def proposals(analysis_id: str, conn=Depends(get_conn)):
    return store.list_proposals(conn, analysis_id)


@app.post("/api/proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, conn=Depends(get_conn)):
    p = store.set_proposal_status(conn, proposal_id, "accepted")
    if p is None:
        raise HTTPException(404)
    rotation = store.create_rotation(
        conn, name=p["payload"]["name"], body=p["payload"]["body"],
        params=p["payload"].get("params"), note=p["payload"].get("note"),
        derived_from=[p["analysis_id"]])
    return {"proposal": p, "rotation": rotation}


@app.post("/api/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: str, conn=Depends(get_conn)):
    p = store.set_proposal_status(conn, proposal_id, "rejected")
    if p is None:
        raise HTTPException(404)
    return p


@app.get("/api/rotations")
def rotations(conn=Depends(get_conn)):
    return store.list_rotations(conn)
