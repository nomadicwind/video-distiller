from vd.ops import marks_to_ops


def mk(t, label="2", kind="input", end=None, mid="m"):
    return {"id": mid, "t_ms": t, "end_ms": end, "kind": kind, "label": label}


def test_tap_hold_chord_wheel():
    ops = marks_to_ops([
        mk(100, "2"),
        mk(400, "F", end=700),
        mk(1000, "Alt+3"),
        mk(1500, "Wheel"),
    ])
    assert [o["kind"] for o in ops] == ["tap", "hold", "chord", "wheel"]
    assert ops[1]["end_ms"] == 700
    assert ops[2]["keys"] == ["3", "Alt"]


def test_release_marks_skipped():
    ops = marks_to_ops([mk(100, "F", end=400), mk(400, None, kind="release")])
    assert len(ops) == 1


def test_aggregated_marks_without_id_work():
    ops = marks_to_ops([{"t_ms": 100, "end_ms": None, "kind": "input", "label": "Q"}])
    assert ops[0]["kind"] == "tap" and ops[0]["source"] == []
