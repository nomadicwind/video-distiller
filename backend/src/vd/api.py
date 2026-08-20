import json
import re
from pathlib import Path
from typing import Iterator, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel

from vd import agent, align, aggregate as agg, db, ingest, store, discover, matcher, ops as ops_module
from vd.config import data_root
from vd.emit import ahk as emit_ahk, md as emit_md

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
    row = conn.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    if row["status"] != "pending":
        raise HTTPException(409, "proposal 已裁决")
    payload = json.loads(row["payload"])
    try:
        rotation = store.create_rotation(
            conn, name=payload["name"], body=payload["body"],
            params=payload.get("params"), note=payload.get("note"),
            derived_from=[row["analysis_id"]])
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(500, str(e))
    p = store.set_proposal_status(conn, proposal_id, "accepted")
    return {"proposal": p, "rotation": rotation}


@app.post("/api/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: str, conn=Depends(get_conn)):
    row = conn.execute("SELECT status FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    if row["status"] != "pending":
        raise HTTPException(409, "proposal 已裁决")
    p = store.set_proposal_status(conn, proposal_id, "rejected")
    return p


@app.get("/api/rotations")
def rotations(conn=Depends(get_conn)):
    return store.list_rotations(conn)


def _agent_client():
    """真实运行返回 None（agent 自建客户端）；测试 monkeypatch 注入 fake。"""
    return None


def _aggregated_lane_marks(conn, lane_id: str) -> list[dict]:
    takes = []
    for t in conn.execute(
            "SELECT id FROM takes WHERE lane_id=? ORDER BY idx", (lane_id,)):
        takes.append([dict(r) for r in conn.execute(
            "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (t["id"],))])
    return agg.aggregate_lane(takes)["aggregated"]


def _analysis_inputs(conn, analysis_id: str):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    lanes = {l["layer"]: l for l in tree["lanes"]}
    l0_ops = ops_module.marks_to_ops(_aggregated_lane_marks(conn, lanes["L0"]["id"]))
    l1_marks = _aggregated_lane_marks(conn, lanes["L1"]["id"])
    skills = store.list_skills(conn)
    binds = {}
    if tree.get("keymap_id"):
        km = store.get_keymap(conn, tree["keymap_id"], tree["keymap_version"])
        binds = km["binds"] if km else {}
    return tree, l0_ops, l1_marks, skills, binds


@app.post("/api/analyses/{analysis_id}/infer")
def run_infer(analysis_id: str, conn=Depends(get_conn)):
    _, l0_ops, l1_marks, skills, binds = _analysis_inputs(conn, analysis_id)
    by_name = {s["name"]: s for s in skills}
    links, conflicts = align.align_l1(l0_ops, l1_marks, by_name, binds)
    suggestions = [s for s in align.infer_keymap(links, by_name)
                   if s["key"] not in (binds.get(s["skill_id"]) or [])]  # 已绑定一致的不再提议
    return {"links": links, "conflicts": conflicts,
            "keymap_suggestions": suggestions,
            "span_proposals": align.complete_spans(l1_marks, by_name)}


@app.post("/api/analyses/{analysis_id}/discover")
def run_discover(analysis_id: str, conn=Depends(get_conn)):
    _, l0_ops, _, skills, _ = _analysis_inputs(conn, analysis_id)
    store.delete_pending_proposals(conn, analysis_id, kind="rotation")
    matched = matcher.match_all(l0_ops, skills)
    skill_names = {s["id"]: s["name"] for s in skills}
    results = []
    for cand, report in discover.discover_rotations(matched["tokens"]):
        naming = agent.name_candidate(cand, skill_names, client=_agent_client())
        payload = {
            "name": naming.get("name") or "未命名循环",
            "note": naming.get("note") or naming.get("error", ""),
            "body": cand["body"],
            "occurrences": cand["occurrences"],
            "param_positions": naming.get("param_positions", []),
        }
        results.append(store.create_proposal(
            conn, analysis_id=analysis_id, kind="rotation",
            payload=payload, report=report))
    return {"proposals": results,
            "unmatched": len(matched["unmatched"]),
            "ambiguities": matched["ambiguities"]}


def _export_context(conn):
    skills_by_id = {s["id"]: s for s in store.list_skills(conn)}
    rotations_by_id = {r["id"]: r for r in store.list_rotations(conn)}
    return skills_by_id, rotations_by_id


def _text_response(text: str, fmt: str):
    media = "text/markdown; charset=utf-8" if fmt == "md" else "text/plain; charset=utf-8"
    return PlainTextResponse(text, media_type=media)


@app.get("/api/rotations/{rotation_id}/export.{fmt}")
def export_rotation(rotation_id: str, fmt: str, conn=Depends(get_conn)):
    if fmt not in ("md", "ahk"):
        raise HTTPException(400, "fmt 仅支持 md/ahk")
    rot = store.get_rotation(conn, rotation_id)
    if rot is None:
        raise HTTPException(404)
    skills_by_id, _ = _export_context(conn)
    if fmt == "md":
        return _text_response(emit_md.render_rotation_md(rot, skills_by_id), fmt)
    return _text_response(emit_ahk.render_rotation_ahk(rot, skills_by_id, {}), fmt)


@app.get("/api/playbooks/{playbook_id}/export.{fmt}")
def export_playbook(playbook_id: str, fmt: str, conn=Depends(get_conn)):
    if fmt not in ("md", "ahk"):
        raise HTTPException(400, "fmt 仅支持 md/ahk")
    pb = store.get_playbook(conn, playbook_id)
    if pb is None:
        raise HTTPException(404)
    skills_by_id, rotations_by_id = _export_context(conn)
    binds = {}
    if pb.get("keymap_id"):
        km = store.get_keymap(conn, pb["keymap_id"], pb["keymap_version"])
        binds = km["binds"] if km else {}
    if fmt == "md":
        return _text_response(
            emit_md.render_playbook_md(pb, rotations_by_id, skills_by_id), fmt)
    return _text_response(
        emit_ahk.render_playbook_ahk(pb, rotations_by_id, skills_by_id, binds), fmt)
