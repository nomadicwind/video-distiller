from vd.matcher import match_at, match_pass


def tap(t, key):
    return {"kind": "tap", "key": key, "t_ms": t, "end_ms": None, "source": []}


def hold(t, key, end):
    return {"kind": "hold", "key": key, "t_ms": t, "end_ms": end, "source": []}


def chord(t, keys):
    return {"kind": "chord", "key": "+".join(keys), "keys": list(keys),
            "t_ms": t, "end_ms": None, "source": []}


FIREBALL = {"id": "sk_fb", "name": "火球术", "pattern": [{"op": "tap", "key": "2"}]}
WHIRL = {"id": "sk_wh", "name": "旋风连", "pattern": [
    {"op": "tap", "key": "Q"},
    {"op": "gap", "ms": 300, "tol_ms": 80},
    {"op": "tap", "key": "Q"},
    {"op": "gap", "ms": 200, "tol_ms": 60},
    {"op": "hold", "button": "LMB", "ms": 300, "tol_ms": 100}]}
DOUBLE_FB = {"id": "sk_dfb", "name": "强化火球", "pattern": [
    {"op": "tap", "key": "2"},
    {"op": "gap", "ms": 200, "tol_ms": 80},
    {"op": "tap", "key": "2"}]}
BLINK = {"id": "sk_blink", "name": "闪现", "pattern": [{"op": "chord", "keys": ["Shift", "2"]}]}


def test_match_at_single_tap():
    assert match_at([tap(100, "2")], 0, FIREBALL["pattern"]) == 1
    assert match_at([tap(100, "3")], 0, FIREBALL["pattern"]) is None


def test_match_at_multikey_with_gaps():
    toks = [tap(0, "Q"), tap(310, "Q"), hold(500, "LMB", 810)]
    assert match_at(toks, 0, WHIRL["pattern"]) == 3


def test_gap_outside_tol_fails():
    toks = [tap(0, "Q"), tap(500, "Q"), hold(690, "LMB", 990)]   # 第一 gap 500 超 300±80
    assert match_at(toks, 0, WHIRL["pattern"]) is None


def test_hold_duration_tol():
    toks = [tap(0, "Q"), tap(300, "Q"), hold(500, "LMB", 1000)]  # 时长 500 超 300±100
    assert match_at(toks, 0, WHIRL["pattern"]) is None


def test_longest_first():
    toks = [tap(0, "2"), tap(200, "2")]
    out, matches, amb = match_pass(toks, [FIREBALL, DOUBLE_FB])
    assert [m["skill_id"] for m in matches] == ["sk_dfb"]        # 最长优先
    assert out[0]["kind"] == "skill" and len(out) == 1
    assert amb == []


def test_ambiguity_not_consumed():
    other = {"id": "sk_x", "name": "同型", "pattern": [{"op": "tap", "key": "2"}]}
    toks = [tap(0, "2")]
    out, matches, amb = match_pass(toks, [FIREBALL, other])
    assert matches == []
    assert out[0]["kind"] == "tap"                               # 保留原 token 交人裁决
    assert amb == [{"t_ms": 0, "skills": ["sk_fb", "sk_x"]}]


def test_unmatched_tokens_kept():
    toks = [tap(0, "9"), tap(300, "2")]
    out, matches, amb = match_pass(toks, [FIREBALL])
    assert out[0]["kind"] == "tap" and out[1]["kind"] == "skill"


def test_chord_matches_regardless_of_key_order():
    assert match_at([chord(0, ["2", "Shift"])], 0, BLINK["pattern"]) == 1
    assert match_at([chord(0, ["Shift", "2"])], 0, BLINK["pattern"]) == 1
    assert match_at([chord(0, ["Alt", "2"])], 0, BLINK["pattern"]) is None


def test_chord_not_matched_by_tap():
    assert match_at([tap(0, "Shift+2")], 0, BLINK["pattern"]) is None
