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
