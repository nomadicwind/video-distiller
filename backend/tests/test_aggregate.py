from vd.aggregate import aggregate_lane


def mk(t, label="2", kind="input", end=None):
    return {"t_ms": t, "end_ms": end, "kind": kind, "label": label}


def test_three_takes_full_agreement():
    takes = [[mk(100), mk(1000)], [mk(120), mk(980)], [mk(90), mk(1010)]]
    r = aggregate_lane(takes)
    assert r["n_takes"] == 3
    assert [a["t_ms"] for a in r["aggregated"]] == [100, 1000]
    assert all(a["support"] == 1.0 for a in r["aggregated"])
    assert r["minority"] == []


def test_majority_included_with_reduced_support():
    takes = [[mk(100)], [mk(110)], []]           # 第 3 遍漏标
    r = aggregate_lane(takes)
    assert len(r["aggregated"]) == 1
    assert abs(r["aggregated"][0]["support"] - 2 / 3) < 1e-9
    assert r["aggregated"][0]["take_idxs"] == [0, 1]


def test_minority_never_dropped():
    takes = [[mk(100)], [], []]                  # 只有 1/3 出现
    r = aggregate_lane(takes)
    assert r["aggregated"] == []
    assert len(r["minority"]) == 1
    assert r["minority"][0]["t_ms"] == 100


def test_same_take_marks_split_into_clusters():
    # 同一 Take 的两次按键相距 200ms（< window），不得并簇
    takes = [[mk(100), mk(300)], [mk(110), mk(310)]]
    r = aggregate_lane(takes)
    assert [a["t_ms"] for a in r["aggregated"]] == [105, 305]


def test_different_labels_never_merge():
    takes = [[mk(100, label="2"), mk(105, label="3")]]
    r = aggregate_lane(takes)
    assert len(r["aggregated"]) == 2


def test_span_aggregated_when_majority_has_end():
    takes = [[mk(100, end=400)], [mk(110, end=420)], [mk(90)]]
    r = aggregate_lane(takes)
    assert r["aggregated"][0]["end_ms"] == 410


def test_iqr_reflects_spread():
    takes = [[mk(100)], [mk(140)], [mk(180)]]
    r = aggregate_lane(takes)
    assert r["aggregated"][0]["t_ms"] == 140
    assert r["aggregated"][0]["iqr_ms"] > 0
