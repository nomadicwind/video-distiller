import subprocess
import sys
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


def default_runner(cmd: list[str]) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or "")[-500:]
        raise RuntimeError(f"yt-dlp 失败：{tail}") from e


def pull_bilibili(url: str, dest: Path, runner=default_runner) -> Path:
    """B 站拉取（spec §4.4：仅 B 站；抖音走手动上传）。"""
    runner([
        sys.executable, "-m", "yt_dlp",
        "-f", "bv*+ba/b", "--merge-output-format", "mp4",
        "-o", str(dest), url,
    ])
    if not dest.exists():
        raise RuntimeError("yt-dlp 未产出文件，请手动下载后上传")
    return dest
