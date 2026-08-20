import uuid
from datetime import datetime, timezone

KEYMAP_DEFAULT = "km-default-v1"
LAYERS = ("L0", "L1", "L2")


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


def insert_mark(conn, take_id, *, t_ms, kind, label=None, end_ms=None):
    _validate_mark(t_ms, end_ms, kind, label)
    mid = _id("mk")
    conn.execute(
        "INSERT INTO marks(id,take_id,t_ms,end_ms,kind,label) VALUES(?,?,?,?,?,?)",
        (mid, take_id, t_ms, end_ms, kind, label),
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
