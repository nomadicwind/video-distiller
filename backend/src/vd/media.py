import json
import math
import subprocess
from pathlib import Path


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or "")[-500:]
        raise RuntimeError(f"{cmd[0]} 失败（{' '.join(cmd[:6])}…）：{tail}") from e


def probe(path: Path) -> dict:
    out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_streams", "-show_format", "-of", "json", str(path),
    ]).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    num, _, den = stream["avg_frame_rate"].partition("/")
    fps = float(num) / float(den or 1)
    duration_s = float(data["format"]["duration"])
    return {
        "fps": fps,
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "duration_ms": round(duration_s * 1000),
    }


def target_fps(src_fps: float) -> int:
    return 60 if src_fps >= 45 else 30


def thumb_interval_s(duration_ms: int) -> int:
    return max(1, math.ceil(duration_ms / 1000 / 600))


def transcode_cfr(src: Path, dst: Path, fps: int) -> None:
    """统一转码为恒定帧率工作副本（spec §4.4）。原始文件不动。"""
    _run([
        "ffmpeg", "-y", "-i", str(src),
        "-vf", f"fps={fps}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "+faststart", str(dst),
    ])


def probe_image(path: Path) -> dict:
    out = _run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", str(path),
    ]).stdout
    s = json.loads(out)["streams"][0]
    return {"width": int(s["width"]), "height": int(s["height"])}


def make_sprite(work: Path, out_jpg: Path, duration_ms: int) -> dict:
    """横向单行 sprite：每 interval 秒一张 96px 宽缩略图，tile 成一张 JPEG。
    interval 规则保证总张数 ≤600（JPEG 宽度上限约 65500px）。"""
    interval = thumb_interval_s(duration_ms)
    count = max(1, math.ceil(duration_ms / 1000 / interval))
    _run([
        "ffmpeg", "-y", "-i", str(work),
        "-vf", f"fps=1/{interval},scale=96:-2,tile={count}x1",
        "-frames:v", "1", str(out_jpg),
    ])
    meta = probe_image(out_jpg)
    return {
        "sprite_interval_s": interval,
        "sprite_count": count,
        "thumb_w": 96,
        "thumb_h": meta["height"],
    }
