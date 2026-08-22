import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Iterator, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from vd import agent, align, aggregate as agg, db, ingest, store, discover, matcher, ops as ops_module
from vd import executor as vd_executor
from vd import host as vd_host
from vd.config import data_root
from vd.emit import ahk as emit_ahk, md as emit_md, plan as emit_plan, razer as emit_razer

app = FastAPI(title="Video Distiller")

_exec_host = vd_host.get_host()
_exec_session: vd_executor.ExecutionSession | None = None
# 会话级读写锁：exec_start 的“检查 409 冲突 + 换上新会话”必须原子化，
# 否则并发 start 请求可能都通过冲突检查后各建一个会话，后写者覆盖前者
# （M4 review Fix 5）。
_exec_lock = threading.Lock()


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


class ComparePatch(BaseModel):
    video_id: str | None
    offset_ms: int = 0


@app.patch("/api/analyses/{analysis_id}/compare")
def set_compare(analysis_id: str, req: ComparePatch, conn=Depends(get_conn)):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    try:
        store.set_compare(conn, analysis_id, req.video_id, req.offset_ms)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return store.get_analysis_tree(conn, analysis_id)


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


def _lane_takes_marks(conn, lane_id: str) -> list[list[dict]]:
    """按 take 收集 marks；跳过非空且全部 marks provenance=='execution_log' 的
    take（回灌产生的执行日志本身不参与聚合，spec §9.3）。"""
    takes = []
    for t in conn.execute(
            "SELECT id FROM takes WHERE lane_id=? ORDER BY idx", (lane_id,)):
        marks = [dict(r) for r in conn.execute(
            "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (t["id"],))]
        if marks and all(m["provenance"] == "execution_log" for m in marks):
            continue
        takes.append(marks)
    return takes


@app.get("/api/lanes/{lane_id}/aggregate")
def lane_aggregate(lane_id: str, window_ms: int = 300, conn=Depends(get_conn)):
    takes = _lane_takes_marks(conn, lane_id)
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


class AcceptReq(BaseModel):
    sections: list | None = None


@app.post("/api/proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, req: AcceptReq | None = None,
                    conn=Depends(get_conn)):
    row = conn.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    if row["status"] != "pending":
        raise HTTPException(409, "proposal 已裁决")
    payload = json.loads(row["payload"])
    if row["kind"] == "playbook":
        try:
            sections = req.sections if (req and req.sections is not None) else payload["sections"]
            store.validate_sections(sections)
            tree = store.get_analysis_tree(conn, row["analysis_id"])
            playbook = store.create_playbook(
                conn, name=payload["name"], sections=sections,
                keymap_id=tree.get("keymap_id") if tree else None,
                keymap_version=tree.get("keymap_version") if tree else None,
                derived_from=[row["analysis_id"]])
        except (KeyError, ValueError, TypeError) as e:
            raise HTTPException(500, str(e))
        p = store.set_proposal_status(conn, proposal_id, "accepted")
        return {"proposal": p, "playbook": playbook}
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


class RotationPatch(BaseModel):
    name: str | None = None
    note: str | None = None
    clear_note: bool = False


@app.patch("/api/rotations/{rotation_id}")
def update_rotation(rotation_id: str, req: RotationPatch, conn=Depends(get_conn)):
    try:
        # Determine note value: clear_note=True → None, else note value if provided
        note_value = store._UNSET
        if req.clear_note:
            note_value = None
        elif req.note is not None:
            note_value = req.note

        rot = store.update_rotation(conn, rotation_id, name=req.name, note=note_value)
        if rot is None:
            raise HTTPException(404)
        return rot
    except ValueError as e:
        raise HTTPException(400, str(e))


def _agent_client():
    """真实运行返回 None（agent 自建客户端）；测试 monkeypatch 注入 fake。"""
    return None


def _aggregated_lane_marks(conn, lane_id: str) -> list[dict]:
    return agg.aggregate_lane(_lane_takes_marks(conn, lane_id))["aggregated"]


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


@app.post("/api/analyses/{analysis_id}/compose")
def run_compose(analysis_id: str, conn=Depends(get_conn)):
    tree = store.get_analysis_tree(conn, analysis_id)
    if tree is None:
        raise HTTPException(404)
    rotations = store.list_rotations(conn)
    if not rotations:
        raise HTTPException(400, "还没有已接受的循环，先在推断面板接受一个 Rotation")
    store.delete_pending_proposals(conn, analysis_id, kind="playbook")
    known = {r["id"] for r in rotations}
    result = agent.compose_playbook(
        [{"id": r["id"], "name": r["name"], "note": r.get("note") or ""}
         for r in rotations],
        client=_agent_client())
    unknown_dropped: list[str] = []
    fallback = not result["ok"]
    if result["ok"]:
        name = result["name"]
        note = ""
        sections = []
        used: set[str] = set()
        for s in result["sections"]:
            ids = []
            for rid in s["rotation_ids"]:
                if rid in known and rid not in used:
                    ids.append(rid)
                    used.add(rid)
                elif rid not in known:
                    unknown_dropped.append(rid)
            sections.append({"name": s["name"],
                             "body": [{"rotation": rid} for rid in ids]})
        missing = [r["id"] for r in rotations if r["id"] not in used]
        if missing:
            target = sections[-1] if sections else None
            if target is None:
                sections.append({"name": "主循环", "body": []})
                target = sections[-1]
            target["body"] += [{"rotation": rid} for rid in missing]
        sections = [s for s in sections if s["body"]] or [
            {"name": "主循环", "body": [{"rotation": r["id"]} for r in rotations]}]
        missing_appended = len(missing)
    else:
        name = "未命名方案"
        note = result["error"]
        sections = [{"name": "主循环",
                     "body": [{"rotation": r["id"]} for r in rotations]}]
        missing_appended = 0
    payload = {"name": name, "note": note, "sections": sections}
    report = {"rotations_used": len(rotations), "unknown_dropped": unknown_dropped,
              "missing_appended": missing_appended, "fallback": fallback}
    proposal = store.create_proposal(conn, analysis_id=analysis_id, kind="playbook",
                                     payload=payload, report=report)
    return {"proposal": proposal}


def _export_context(conn):
    skills_by_id = {s["id"]: s for s in store.list_skills(conn)}
    rotations_by_id = {r["id"]: r for r in store.list_rotations(conn)}
    return skills_by_id, rotations_by_id


_EXPORT_MEDIA = {
    "md": "text/markdown; charset=utf-8",
    "ahk": "text/plain; charset=utf-8",
    "plan": "application/json; charset=utf-8",
    "razer": "application/xml; charset=utf-8",
}


def _text_response(text: str, fmt: str):
    return PlainTextResponse(text, media_type=_EXPORT_MEDIA[fmt])


@app.get("/api/rotations/{rotation_id}/export.{fmt}")
def export_rotation(rotation_id: str, fmt: str, conn=Depends(get_conn)):
    if fmt not in ("md", "ahk", "plan", "razer"):
        raise HTTPException(400, "fmt 仅支持 md/ahk/plan/razer")
    rot = store.get_rotation(conn, rotation_id)
    if rot is None:
        raise HTTPException(404)
    skills_by_id, _ = _export_context(conn)
    if fmt == "md":
        text = emit_md.render_rotation_md(rot, skills_by_id)
    elif fmt == "ahk":
        text = emit_ahk.render_rotation_ahk(rot, skills_by_id, {})
    elif fmt == "plan":
        text = emit_plan.render_rotation_plan(rot, skills_by_id, {})
    else:
        text = emit_razer.render_rotation_razer(rot, skills_by_id, {})
    return _text_response(text, fmt)


@app.get("/api/playbooks/{playbook_id}/export.{fmt}")
def export_playbook(playbook_id: str, fmt: str, conn=Depends(get_conn)):
    if fmt not in ("md", "ahk", "plan", "razer"):
        raise HTTPException(400, "fmt 仅支持 md/ahk/plan/razer")
    pb = store.get_playbook(conn, playbook_id)
    if pb is None:
        raise HTTPException(404)
    skills_by_id, rotations_by_id = _export_context(conn)
    binds = {}
    if pb.get("keymap_id"):
        km = store.get_keymap(conn, pb["keymap_id"], pb["keymap_version"])
        binds = km["binds"] if km else {}
    if fmt == "md":
        text = emit_md.render_playbook_md(pb, rotations_by_id, skills_by_id)
    elif fmt == "ahk":
        text = emit_ahk.render_playbook_ahk(pb, rotations_by_id, skills_by_id, binds)
    elif fmt == "plan":
        text = emit_plan.render_playbook_plan(pb, rotations_by_id, skills_by_id, binds)
    else:
        text = emit_razer.render_playbook_razer(pb, rotations_by_id, skills_by_id, binds)
    return _text_response(text, fmt)


@app.get("/api/playbooks")
def playbooks(conn=Depends(get_conn)):
    return store.list_playbooks(conn)


@app.get("/api/playbooks/{playbook_id}")
def playbook(playbook_id: str, conn=Depends(get_conn)):
    pb = store.get_playbook(conn, playbook_id)
    if pb is None:
        raise HTTPException(404)
    return pb


class PlaybookPut(BaseModel):
    name: str | None = None
    sections: list


@app.put("/api/playbooks/{playbook_id}")
def put_playbook(playbook_id: str, req: PlaybookPut, conn=Depends(get_conn)):
    try:
        return store.save_playbook(conn, playbook_id, sections=req.sections,
                                   name=req.name)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/playbooks/{playbook_id}/versions")
def playbook_versions(playbook_id: str, conn=Depends(get_conn)):
    pb = store.get_playbook(conn, playbook_id)
    if pb is None:
        raise HTTPException(404)
    return store.list_playbook_versions(conn, playbook_id)


class RollbackReq(BaseModel):
    version: int


@app.post("/api/playbooks/{playbook_id}/rollback")
def rollback(playbook_id: str, req: RollbackReq, conn=Depends(get_conn)):
    try:
        return store.rollback_playbook(conn, playbook_id, req.version)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---- 执行控制台 / 采集 / 回灌（spec §9.3）----
#
# 进程内单会话：本地单用户工具，不需要跨会话/跨进程的执行状态。
#
# ⚠ 路由注册顺序约束：/api/exec/start 与 /api/exec/backfeed 必须先于
# /api/exec/{cmd} 注册，否则会被 {cmd} 的路径参数通配捕获。


class ExecStartReq(BaseModel):
    kind: str
    id: str
    speed: float = 1.0
    paused: bool = False


@app.post("/api/exec/start")
def exec_start(req: ExecStartReq, conn=Depends(get_conn)):
    global _exec_session
    if req.kind not in ("rotation", "playbook"):
        raise HTTPException(400, "kind 须为 rotation|playbook")
    if _exec_session is not None and _exec_session.state in ("running", "paused"):
        raise HTTPException(409, "已有执行在进行")
    skills_by_id, rotations_by_id = _export_context(conn)
    if req.kind == "playbook":
        pb = store.get_playbook(conn, req.id)
        if pb is None:
            raise HTTPException(404, "playbook not found")
        binds = {}
        if pb.get("keymap_id"):
            km = store.get_keymap(conn, pb["keymap_id"], pb["keymap_version"])
            binds = km["binds"] if km else {}
        text = emit_plan.render_playbook_plan(pb, rotations_by_id, skills_by_id, binds)
    else:
        rot = store.get_rotation(conn, req.id)
        if rot is None:
            raise HTTPException(404, "rotation not found")
        text = emit_plan.render_rotation_plan(rot, skills_by_id, {})
    plan_doc = json.loads(text)
    # 409 冲突检查 + 换上新会话必须原子化（M4 review Fix 5）：上面那次检查只
    # 是为了让常见情况快速失败、避免白构建 plan；这里在持锁期间重新检查一
    # 遍才是真正防并发的关卡。
    with _exec_lock:
        if _exec_session is not None and _exec_session.state in ("running", "paused"):
            raise HTTPException(409, "已有执行在进行")
        session = vd_executor.ExecutionSession(plan_doc, _exec_host, speed=req.speed)
        _exec_session = session
    if not req.paused:
        try:
            session.start()
        except vd_host.HostError as e:
            raise HTTPException(500, {"code": e.code, "hint": e.hint})
    return session.status()


class BackfeedReq(BaseModel):
    analysis_id: str


@app.post("/api/exec/backfeed")
def exec_backfeed(req: BackfeedReq, conn=Depends(get_conn)):
    s = _exec_session
    if s is None or s.state not in ("stopped", "done"):
        raise HTTPException(409, "执行未结束，不能回灌")
    tree = store.get_analysis_tree(conn, req.analysis_id)
    if tree is None:
        raise HTTPException(404, "analysis not found")
    l0 = next((l for l in tree["lanes"] if l["layer"] == "L0"), None)
    if l0 is None:
        raise HTTPException(404, "L0 泳道不存在")
    take = store.create_take(conn, l0["id"])
    marks = []
    log = list(s.log)
    used: set[int] = set()
    for i, ev in enumerate(log):
        if i in used:
            continue
        if ev["action"] == "down":
            end = None
            for j in range(i + 1, len(log)):
                if j not in used and log[j]["action"] == "up" \
                        and log[j]["key"] == ev["key"]:
                    end = log[j]["t_ms"]
                    used.add(j)
                    break
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], end_ms=end, kind="input",
                label=ev["key"], provenance="execution_log"))
        elif ev["action"] == "tap":
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], kind="input",
                label=ev["key"], provenance="execution_log"))
        elif ev["action"] == "wheel":
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], kind="input",
                label="Wheel", provenance="execution_log"))
        elif ev["action"] == "up":
            # 孤立 up（未被前面的 down 配对）→ release mark；release 不可携带
            # label（store._validate_mark 强制），已配对的 up 已在上面被
            # used 标记跳过，不会走到这支。
            marks.append(store.insert_mark(
                conn, take["id"], t_ms=ev["t_ms"], kind="release",
                label=None, provenance="execution_log"))
    take["marks"] = marks
    return take


@app.post("/api/exec/{cmd}")
def exec_cmd(cmd: str):
    if cmd not in ("pause", "resume", "stop", "step"):
        raise HTTPException(400, "未知命令")
    s = _exec_session
    if s is None:
        raise HTTPException(404, "没有执行会话")
    try:
        getattr(s, cmd)()
    except ValueError as e:
        raise HTTPException(409, str(e))
    except vd_host.HostError as e:
        raise HTTPException(500, {"code": e.code, "hint": e.hint})
    return s.status()


@app.get("/api/exec/status")
def exec_status():
    s = _exec_session
    if s is None:
        return {"state": "idle"}
    return s.status()


@app.post("/api/capture/start")
def capture_start():
    cap_dir = data_root() / "captures"
    cap_dir.mkdir(parents=True, exist_ok=True)
    out = cap_dir / f"cap-{int(time.time())}.mp4"
    try:
        _exec_host.start_capture(str(out))
    except vd_host.HostError as e:
        raise HTTPException(500, {"code": e.code, "hint": e.hint})
    return {"path": str(out)}


@app.post("/api/capture/stop")
def capture_stop(conn=Depends(get_conn)):
    try:
        path = _exec_host.stop_capture()
    except vd_host.HostError as e:
        raise HTTPException(500, {"code": e.code, "hint": e.hint})
    v = store.create_video(conn, name=Path(path).stem, source_kind="upload",
                           original_path=path)
    ingest.process(v["id"])
    return store.get_video(conn, v["id"])


# ---- 前端静态托管（M13：Windows 打包）----
#
# ⚠ 必须在全部 /api 路由注册完毕后才能挂载：StaticFiles(html=True) 挂在
# "/" 上会兜底任意未匹配路径，若挂载提前，会在路由查找阶段抢在 /api/* 之前
# （事实上不会，因为 FastAPI 按注册顺序 + 更具体路径优先匹配；但把它放在
# 模块末尾可以让这份不变量一目了然，不依赖路由匹配算法的细节）。
# 目录解析顺序（不是“依次尝试兜底”，是互斥优先级——选中哪一级就只看那一
# 级是否有 index.html，不落到下一级）：
#   1. 环境变量 VD_WEB_DIST 显式指定
#   2. 冻结态（PyInstaller onedir，getattr(sys, 'frozen', False)）：
#      打包目录（_MEIPASS 或 exe 所在目录）下的 webdist/
#   3. 仓库开发路径 frontend/dist
# 缺 index.html 时返回 None，完全跳过挂载 —— 纯 API 模式与今天的现状逐字节
# 一致（GET / 404，/api/* 不受影响）。
def _web_dist() -> Path | None:
    env = os.environ.get("VD_WEB_DIST")
    if env:
        candidate = Path(env)
    elif getattr(sys, "frozen", False):
        candidate = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "webdist"
    else:
        candidate = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    return candidate if (candidate / "index.html").exists() else None


_dist = _web_dist()
if _dist is not None:
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="web")
