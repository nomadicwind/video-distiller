from vd.align import align_l1, complete_spans


def op(t, key):
    return {"kind": "tap", "key": key, "t_ms": t, "end_ms": None, "source": []}


def l1(t, label, mid="m1", end=None):
    return {"id": mid, "t_ms": t, "end_ms": end, "kind": "input", "label": label}


SKILLS = {
    "火球术": {"id": "sk_fb", "name": "火球术", "cast_ms": 400, "anim_ms": 720, "pattern": []},
    "轻击一": {"id": "sk_a1", "name": "轻击一", "cast_ms": None, "anim_ms": None, "pattern": []},
    "轻击二": {"id": "sk_a2", "name": "轻击二", "cast_ms": None, "anim_ms": None, "pattern": []},
}


def test_link_and_three_way_conflict():
    binds = {"sk_fb": ["2"]}
    links, conflicts = align_l1([op(1000, "3")], [l1(1100, "火球术")], SKILLS, binds)
    assert links[0]["l0_key"] == "3" and links[0]["dt_ms"] == 100
    tw = [c for c in conflicts if c["type"] == "three_way"]
    assert tw[0]["l1_label"] == "火球术" and tw[0]["keymap_expected"] == ["2"]


def test_set_semantics_one_key_many_skills():
    binds = {"sk_a1": ["LMB"], "sk_a2": ["LMB"]}       # 一键多技能（spec §5.6）
    _, c1 = align_l1([op(1000, "LMB")], [l1(1050, "轻击一")], SKILLS, binds)
    _, c2 = align_l1([op(2000, "LMB")], [l1(2050, "轻击二")], SKILLS, binds)
    assert not [c for c in c1 + c2 if c["type"] == "three_way"]


def test_undefined_skill_and_no_l0():
    links, conflicts = align_l1([], [l1(100, "神秘技能")], SKILLS, {})
    types = sorted(c["type"] for c in conflicts)
    assert types == ["no_l0", "undefined_skill"]
    assert links == []


def test_window_limit():
    links, conflicts = align_l1([op(0, "2")], [l1(900, "火球术")], SKILLS, {})
    assert [c["type"] for c in conflicts] == ["no_l0"]   # 900ms 超 500ms 窗口


def test_complete_spans():
    out = complete_spans([l1(1000, "火球术"), l1(2000, "轻击一"),
                          l1(3000, "火球术", end=3500)], SKILLS)
    assert out == [{"mark_id": "m1", "t_ms": 1000,
                    "proposed_end_ms": 2120, "confidence": 0.6}]
