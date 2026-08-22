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


def _ytdlp_opts_from_argv(argv: list[str]) -> tuple[dict, str]:
    """把子进程风格的 argv（pull_bilibili 统一构造的那份）解析成 yt_dlp
    Python API 的等价 opts，避免为冻结/非冻结两条路径各写一套参数拼接。"""
    url = argv[-1]
    flag_to_key = {
        "-f": "format",
        "--merge-output-format": "merge_output_format",
        "-o": "outtmpl",
    }
    opts: dict = {}
    i = 0
    while i < len(argv) - 1:
        key = flag_to_key.get(argv[i])
        if key is not None:
            opts[key] = argv[i + 1]
            i += 2
        else:
            i += 1
    return opts, url


def _run_ytdlp(argv: list[str]) -> None:
    """冻结态（PyInstaller 打包后）sys.executable 是打包出的 exe 自身，不能
    再 `-m yt_dlp` 子进程调用自己 —— 改走 yt_dlp Python API，同语义下载；
    非冻结沿用现状子进程调用，保持 runner 注入测试口径不变。"""
    if getattr(sys, "frozen", False):
        import yt_dlp  # 延迟导入：非冻结路径/常规测试不需要，也便于测试 monkeypatch 假模块

        opts, url = _ytdlp_opts_from_argv(argv)
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except Exception as e:  # noqa: BLE001 —— 与子进程分支保持同样的错误语义
            raise RuntimeError(f"yt-dlp 失败：{e}") from e
        return
    default_runner(argv)


def pull_bilibili(url: str, dest: Path, runner=_run_ytdlp) -> Path:
    """B 站拉取（spec §4.4：仅 B 站；抖音走手动上传）。"""
    runner([
        sys.executable, "-m", "yt_dlp",
        "-f", "bv*+ba/b", "--merge-output-format", "mp4",
        "-o", str(dest), url,
    ])
    if not dest.exists():
        raise RuntimeError("yt-dlp 未产出文件，请手动下载后上传")
    return dest
