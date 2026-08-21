import json
import sqlite3
import uuid
from datetime import datetime, timezone

KEYMAP_DEFAULT = "km-default-v1"
LAYERS = ("L0", "L1", "L2")

# Sentinel for "not passed" in optional parameters
_UNSET = object()


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(cur) -> dict | None:
    r = cur.fetchone()
    return dict(r) if r else None


# ---- videos ----

def create_video(conn, *, name, source_kind, source_url=None, original_path=""):
    vid = _id("vid")
    seq = conn.execute("SELECT COALESCE(MAX(seq),0)+1 AS s FROM videos").fetchone()["s"]
    conn.execute(
        "INSERT INTO videos(id,seq,name,source_kind,source_url,original_path,created_at)"
        " VALUES(?,?,?,?,?,?,?)",
        (vid, seq, name, source_kind, source_url, original_path, _now()),
    )
    conn.commit()
    return get_video(conn, vid)


def get_video(conn, video_id):
    return _row(conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)))


def list_videos(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM videos ORDER BY seq")]


def update_video(conn, video_id, **fields):
    keys = ",".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE videos SET {keys} WHERE id=?", (*fields.values(), video_id))
    conn.commit()
    return get_video(conn, video_id)


# ---- analyses ----

def create_analysis(conn, video_id, keymap_label=KEYMAP_DEFAULT):
    video = get_video(conn, video_id)
    if video is None:
        raise ValueError("video not found")
    seq = conn.execute(
        "SELECT COALESCE(MAX(seq),0)+1 AS s FROM analyses WHERE video_id=?", (video_id,)
    ).fetchone()["s"]
    aid = _id("an")
    name = f"video-{video['seq']}_{keymap_label}_a{seq}"
    conn.execute(
        "INSERT INTO analyses(id,video_id,keymap_label,seq,name,created_at) VALUES(?,?,?,?,?,?)",
        (aid, video_id, keymap_label, seq, name, _now()),
    )
    for layer in LAYERS:
        lane_id = _id("ln")
        conn.execute("INSERT INTO lanes(id,analysis_id,layer) VALUES(?,?,?)", (lane_id, aid, layer))
        conn.execute(
            "INSERT INTO takes(id,lane_id,idx,created_at) VALUES(?,?,1,?)",
            (_id("tk"), lane_id, _now()),
        )
    conn.commit()
    return get_analysis_tree(conn, aid)


def get_analysis_tree(conn, analysis_id):
    a = _row(conn.execute("SELECT * FROM analyses WHERE id=?", (analysis_id,)))
    if a is None:
        return None
    lanes = [dict(r) for r in conn.execute(
        "SELECT * FROM lanes WHERE analysis_id=? ORDER BY layer", (analysis_id,))]
    for lane in lanes:
        takes = [dict(r) for r in conn.execute(
            "SELECT * FROM takes WHERE lane_id=? ORDER BY idx", (lane["id"],))]
        for take in takes:
            take["marks"] = [dict(r) for r in conn.execute(
                "SELECT * FROM marks WHERE take_id=? ORDER BY t_ms", (take["id"],))]
        lane["takes"] = takes
    a["lanes"] = lanes
    a["tally"] = [dict(r) for r in conn.execute(
        "SELECT * FROM tally_markers WHERE analysis_id=? ORDER BY t_ms", (analysis_id,))]
    return a


# ---- takes / marks ----

def create_take(conn, lane_id):
    idx = conn.execute(
        "SELECT COALESCE(MAX(idx),0)+1 AS s FROM takes WHERE lane_id=?", (lane_id,)
    ).fetchone()["s"]
    tid = _id("tk")
    conn.execute(
        "INSERT INTO takes(id,lane_id,idx,created_at) VALUES(?,?,?,?)",
        (tid, lane_id, idx, _now()),
    )
    conn.commit()
    return {"id": tid, "lane_id": lane_id, "idx": idx, "marks": []}


def _validate_mark(t_ms, end_ms, kind, label):
    if t_ms < 0:
        raise ValueError("t_ms must be >= 0")
    if end_ms is not None and end_ms <= t_ms:
        raise ValueError("end_ms must be > t_ms")
    if kind == "input" and not label:
        raise ValueError("input mark requires label")
    if kind == "release" and label:
        raise ValueError("release mark must not carry label")


def insert_mark(conn, take_id, *, t_ms, kind, label=None, end_ms=None,
                provenance="human_manual"):
    _validate_mark(t_ms, end_ms, kind, label)
    mid = _id("mk")
    conn.execute(
        "INSERT INTO marks(id,take_id,t_ms,end_ms,kind,label,provenance)"
        " VALUES(?,?,?,?,?,?,?)",
        (mid, take_id, t_ms, end_ms, kind, label, provenance),
    )
    conn.commit()
    return _row(conn.execute("SELECT * FROM marks WHERE id=?", (mid,)))


def update_mark(conn, mark_id, **fields):
    cur = _row(conn.execute("SELECT * FROM marks WHERE id=?", (mark_id,)))
    if cur is None:
        raise ValueError("mark not found")
    merged = {**cur, **fields}
    _validate_mark(merged["t_ms"], merged["end_ms"], merged["kind"], merged["label"])
    keys = ",".join(f"{k}=?" for k in fields)
    conn.execute(
        f"UPDATE marks SET {keys}, provenance='human_edited' WHERE id=?",
        (*fields.values(), mark_id),
    )
    conn.commit()
    return _row(conn.execute("SELECT * FROM marks WHERE id=?", (mark_id,)))


def delete_mark(conn, mark_id):
    conn.execute("DELETE FROM marks WHERE id=?", (mark_id,))
    conn.commit()


# ---- tally ----

def add_tally(conn, analysis_id, t_ms):
    tid = _id("tm")
    conn.execute(
        "INSERT INTO tally_markers(id,analysis_id,t_ms) VALUES(?,?,?)",
        (tid, analysis_id, t_ms),
    )
    conn.commit()
    return {"id": tid, "analysis_id": analysis_id, "t_ms": t_ms}


def clear_tally(conn, analysis_id):
    conn.execute("DELETE FROM tally_markers WHERE analysis_id=?", (analysis_id,))
    conn.commit()


# ---- Skill Catalog（spec §5.4/§5.5）----

PATTERN_OPS = ("tap", "hold", "chord", "wheel", "gap", "skill")


def validate_pattern(pattern: list) -> None:
    if not isinstance(pattern, list):
        raise ValueError("pattern must be a list")
    for item in pattern:
        op = item.get("op")
        if op not in PATTERN_OPS:
            raise ValueError(f"unknown op: {op!r}")
        if op == "tap" and not item.get("key"):
            raise ValueError("tap requires key")
        if op == "hold" and not (item.get("key") or item.get("button")):
            raise ValueError("hold requires key/button")
        if op == "chord" and not item.get("keys"):
            raise ValueError("chord requires keys")
        if op == "gap" and "ms" not in item:
            raise ValueError("gap requires ms")
        if op == "gap" and not isinstance(item.get("ms"), int):
            raise ValueError("gap requires integer ms")
        if op == "skill" and not item.get("ref"):
            raise ValueError("skill requires ref")
        if op == "hold" and "ms" in item and not isinstance(item["ms"], int):
            raise ValueError("hold ms must be integer")
        if "tol_ms" in item and not isinstance(item["tol_ms"], int):
            raise ValueError("tol_ms must be integer")


def skill_layer(skill: dict) -> str:
    """层级判据（spec §3.3）：pattern 含 skill(ref) = L2，否则 L1。"""
    return "L2" if any(i.get("op") == "skill" for i in skill["pattern"]) else "L1"


def _skill_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["pattern"] = json.loads(d["pattern"])
    d["cancelable"] = bool(d["cancelable"])
    return d


def create_skill(conn, *, name, class_=None, cd_ms=None, cast_ms=None,
                 anim_ms=None, cancelable=False, pattern=None):
    pattern = pattern or []
    validate_pattern(pattern)
    sid = _id("sk")
    try:
        conn.execute(
            "INSERT INTO skills(id,name,class,cd_ms,cast_ms,anim_ms,cancelable,pattern,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (sid, name, class_, cd_ms, cast_ms, anim_ms, int(cancelable),
             json.dumps(pattern, ensure_ascii=False), _now()),
        )
    except sqlite3.IntegrityError as e:
        raise ValueError(f"技能名重复：{name}") from e
    conn.commit()
    return get_skill(conn, sid)


def get_skill(conn, skill_id):
    return _skill_row(conn.execute("SELECT * FROM skills WHERE id=?", (skill_id,)).fetchone())


def list_skills(conn):
    return [_skill_row(r) for r in conn.execute("SELECT * FROM skills ORDER BY name")]


def update_skill(conn, skill_id, **fields):
    if "pattern" in fields:
        validate_pattern(fields["pattern"])
        fields["pattern"] = json.dumps(fields["pattern"], ensure_ascii=False)
    if "cancelable" in fields:
        fields["cancelable"] = int(fields["cancelable"])
    keys = ",".join(f"{k}=?" for k in fields)
    conn.execute(f"UPDATE skills SET {keys} WHERE id=?", (*fields.values(), skill_id))
    conn.commit()
    return get_skill(conn, skill_id)


def delete_skill(conn, skill_id):
    conn.execute("DELETE FROM skills WHERE id=?", (skill_id,))
    conn.commit()


# ---- Keymap（spec §5.6：改动 = 新版本）----

def _keymap_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["binds"] = json.loads(d["binds"])
    return d


def save_keymap(conn, *, keymap_id, class_=None, binds):
    version = conn.execute(
        "SELECT COALESCE(MAX(version),0)+1 AS v FROM keymaps WHERE id=?", (keymap_id,)
    ).fetchone()["v"]
    conn.execute(
        "INSERT INTO keymaps(id,version,class,binds,created_at) VALUES(?,?,?,?,?)",
        (keymap_id, version, class_, json.dumps(binds, ensure_ascii=False), _now()),
    )
    conn.commit()
    return get_keymap(conn, keymap_id, version)


def get_keymap(conn, keymap_id, version):
    return _keymap_row(conn.execute(
        "SELECT * FROM keymaps WHERE id=? AND version=?", (keymap_id, version)).fetchone())


def list_keymaps(conn):
    return [_keymap_row(r) for r in conn.execute(
        "SELECT * FROM keymaps ORDER BY id, version")]


def bind_analysis_keymap(conn, analysis_id, keymap_id, version):
    conn.execute("UPDATE analyses SET keymap_id=?, keymap_version=? WHERE id=?",
                 (keymap_id, version, analysis_id))
    conn.commit()
    return _row(conn.execute("SELECT * FROM analyses WHERE id=?", (analysis_id,)))


# ---- Proposal / Rotation（spec §7.7）----

def _proposal_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"])
    d["report"] = json.loads(d["report"])
    return d


def create_proposal(conn, *, analysis_id, kind, payload, report):
    pid = _id("pp")
    conn.execute(
        "INSERT INTO proposals(id,analysis_id,kind,payload,report,created_at)"
        " VALUES(?,?,?,?,?,?)",
        (pid, analysis_id, kind, json.dumps(payload, ensure_ascii=False),
         json.dumps(report, ensure_ascii=False), _now()),
    )
    conn.commit()
    return _proposal_row(conn.execute("SELECT * FROM proposals WHERE id=?", (pid,)).fetchone())


def list_proposals(conn, analysis_id):
    return [_proposal_row(r) for r in conn.execute(
        "SELECT * FROM proposals WHERE analysis_id=? ORDER BY created_at", (analysis_id,))]


def set_proposal_status(conn, proposal_id, status):
    conn.execute("UPDATE proposals SET status=? WHERE id=?", (status, proposal_id))
    conn.commit()
    return _proposal_row(conn.execute(
        "SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone())


def _rotation_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["body"] = json.loads(d["body"])
    d["params"] = json.loads(d["params"])
    d["derived_from"] = json.loads(d["derived_from"])
    return d


def create_rotation(conn, *, name, body, params=None, note=None, derived_from=None):
    rid = _id("rot")
    conn.execute(
        "INSERT INTO rotations(id,name,body,params,note,derived_from,created_at)"
        " VALUES(?,?,?,?,?,?,?)",
        (rid, name, json.dumps(body, ensure_ascii=False),
         json.dumps(params or [], ensure_ascii=False), note,
         json.dumps(derived_from or [], ensure_ascii=False), _now()),
    )
    conn.commit()
    return _rotation_row(conn.execute("SELECT * FROM rotations WHERE id=?", (rid,)).fetchone())


def list_rotations(conn):
    return [_rotation_row(r) for r in conn.execute(
        "SELECT * FROM rotations ORDER BY created_at")]


def delete_pending_proposals(conn, analysis_id, kind) -> int:
    cur = conn.execute(
        "DELETE FROM proposals WHERE analysis_id=? AND status='pending' AND kind=?",
        (analysis_id, kind))
    conn.commit()
    return cur.rowcount


# ---- Playbook（spec §5.8/§7.7 版本链）----

VALID_BLOCK_KEYS = ("rotation", "skill", "gap", "note")


def validate_sections(sections: list) -> None:
    if not isinstance(sections, list):
        raise ValueError("sections must be a list")
    for sec in sections:
        if not isinstance(sec, dict) or not sec.get("name"):
            raise ValueError("每个段落必须有 name")
        body = sec.get("body", [])
        if not isinstance(body, list):
            raise ValueError("body 必须是列表")
        for block in body:
            if not isinstance(block, dict):
                raise ValueError(f"块必须是对象: {block!r}")
            keys = [k for k in VALID_BLOCK_KEYS if k in block]
            if len(keys) != 1:
                raise ValueError(f"块必须恰含一个主键 {VALID_BLOCK_KEYS}: {block!r}")
            kind = keys[0]
            if kind == "rotation" and "iterations" in block:
                if not isinstance(block["iterations"], int) or block["iterations"] < 1:
                    raise ValueError("iterations 必须是 ≥1 的整数")
            if kind == "gap" and not isinstance(block["gap"], int):
                raise ValueError("gap 块 ms 必须是整数")


def _playbook_row(r) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["sections"] = json.loads(d["sections"])
    d["derived_from"] = json.loads(d["derived_from"])
    return d


def _snapshot_playbook(conn, playbook: dict) -> None:
    conn.execute(
        "INSERT INTO playbook_versions(id,playbook_id,version,snapshot,created_at)"
        " VALUES(?,?,?,?,?)",
        (_id("pv"), playbook["id"], playbook["version"],
         json.dumps(playbook, ensure_ascii=False), _now()),
    )


def create_playbook(conn, *, name, class_=None, keymap_id=None, keymap_version=None,
                    sections=None, derived_from=None):
    sections = sections or []
    validate_sections(sections)
    pid = _id("pb")
    conn.execute(
        "INSERT INTO playbooks(id,name,class,keymap_id,keymap_version,sections,"
        "derived_from,version,created_at) VALUES(?,?,?,?,?,?,?,1,?)",
        (pid, name, class_, keymap_id, keymap_version,
         json.dumps(sections, ensure_ascii=False),
         json.dumps(derived_from or [], ensure_ascii=False), _now()),
    )
    pb = get_playbook(conn, pid)
    _snapshot_playbook(conn, pb)
    conn.commit()
    return pb


def get_playbook(conn, playbook_id):
    return _playbook_row(conn.execute(
        "SELECT * FROM playbooks WHERE id=?", (playbook_id,)).fetchone())


def list_playbooks(conn):
    return [_playbook_row(r) for r in conn.execute(
        "SELECT * FROM playbooks ORDER BY created_at")]


def save_playbook(conn, playbook_id, *, sections, name=None):
    validate_sections(sections)
    pb = get_playbook(conn, playbook_id)
    if pb is None:
        raise ValueError("playbook not found")
    new_version = pb["version"] + 1
    conn.execute(
        "UPDATE playbooks SET sections=?, version=?, name=? WHERE id=?",
        (json.dumps(sections, ensure_ascii=False), new_version,
         name or pb["name"], playbook_id),
    )
    pb = get_playbook(conn, playbook_id)
    _snapshot_playbook(conn, pb)
    conn.commit()
    return pb


def list_playbook_versions(conn, playbook_id):
    return [{"version": r["version"], "created_at": r["created_at"]}
            for r in conn.execute(
                "SELECT version, created_at FROM playbook_versions"
                " WHERE playbook_id=? ORDER BY version", (playbook_id,))]


def rollback_playbook(conn, playbook_id, version):
    row = conn.execute(
        "SELECT snapshot FROM playbook_versions WHERE playbook_id=? AND version=?",
        (playbook_id, version)).fetchone()
    if row is None:
        raise ValueError("version not found")
    old = json.loads(row["snapshot"])
    return save_playbook(conn, playbook_id, sections=old["sections"], name=old["name"])


def get_rotation(conn, rotation_id):
    return _rotation_row(conn.execute(
        "SELECT * FROM rotations WHERE id=?", (rotation_id,)).fetchone())


def update_rotation(conn, rotation_id, *, name=None, note=_UNSET):
    """Update rotation name and/or note.

    Args:
        conn: Database connection
        rotation_id: ID of rotation to update
        name: None=不改；str 去空白后须非空否则 ValueError
        note: 未传=不改；传 None=清空；传 str=更新（哨兵用 _UNSET）

    Returns:
        Updated rotation dict; None if rotation doesn't exist
    """
    rot = get_rotation(conn, rotation_id)
    if rot is None:
        return None

    updates = {}
    if name is not None:
        name_stripped = name.strip()
        if not name_stripped:
            raise ValueError("name cannot be blank")
        updates["name"] = name_stripped

    if note is not _UNSET:
        updates["note"] = note

    if updates:
        keys = ",".join(f"{k}=?" for k in updates)
        conn.execute(
            f"UPDATE rotations SET {keys} WHERE id=?",
            (*updates.values(), rotation_id)
        )
        conn.commit()

    return get_rotation(conn, rotation_id)
