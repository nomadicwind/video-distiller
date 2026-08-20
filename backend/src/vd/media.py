import json
import math
import subprocess
from pathlib import Path


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


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
