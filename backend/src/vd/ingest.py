from pathlib import Path

from vd import db, media, store
from vd.config import data_root


def process(video_id: str) -> None:
    """摄取管线后台任务。失败落库为 failed，绝不抛出（spec §10）。"""
    conn = db.connect()
    try:
        video = store.get_video(conn, video_id)
        store.update_video(conn, video_id, status="transcoding")
        src = Path(video["original_path"])
        info = media.probe(src)
        fps = media.target_fps(info["fps"])
        work = data_root() / "work" / f"{video_id}.mp4"
        media.transcode_cfr(src, work, fps)
        winfo = media.probe(work)
        sprite = data_root() / "thumbs" / f"{video_id}.jpg"
        smeta = media.make_sprite(work, sprite, winfo["duration_ms"])
        store.update_video(
            conn, video_id,
            work_path=str(work), fps=winfo["fps"], width=winfo["width"],
            height=winfo["height"], duration_ms=winfo["duration_ms"],
            status="ready", **smeta,
        )
    except Exception as e:  # noqa: BLE001 —— 管线失败必须落库而非崩掉进程
        store.update_video(conn, video_id, status="failed", error=str(e))
    finally:
        conn.close()
