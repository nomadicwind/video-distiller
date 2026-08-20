from vd import media


def test_target_fps_rule():
    assert media.target_fps(59.94) == 60
    assert media.target_fps(45.0) == 60
    assert media.target_fps(44.9) == 30
    assert media.target_fps(30.0) == 30
    assert media.target_fps(15.0) == 30


def test_thumb_interval_rule():
    assert media.thumb_interval_s(30_000) == 1        # 30s → 每秒 1 张
    assert media.thumb_interval_s(600_000) == 1       # 600s 恰好上限
    assert media.thumb_interval_s(601_000) == 2       # 超上限 → 拉大间隔
    assert media.thumb_interval_s(3_600_000) == 6     # 1h → 6s 一张（600 张封顶）


def test_probe_sample(sample_video):
    info = media.probe(sample_video)
    assert abs(info["fps"] - 15.0) < 0.1
    assert (info["width"], info["height"]) == (320, 240)
    assert abs(info["duration_ms"] - 2000) < 200


def test_transcode_cfr_produces_target_fps(sample_video, tmp_path):
    out = tmp_path / "work.mp4"
    media.transcode_cfr(sample_video, out, 30)
    info = media.probe(out)
    assert abs(info["fps"] - 30.0) < 0.1
    assert abs(info["duration_ms"] - 2000) < 300


def test_make_sprite(sample_video, tmp_path):
    out = tmp_path / "sprite.jpg"
    meta = media.make_sprite(sample_video, out, 2000)
    assert out.exists()
    assert meta["sprite_interval_s"] == 1
    assert meta["sprite_count"] == 2
    assert meta["thumb_w"] == 96
    img = media.probe_image(out)
    assert img["width"] == 96 * 2
    assert img["height"] == meta["thumb_h"]
