from vd.discover import build_candidate, discover_rotations, find_candidates, verify


def sk(t, sid, end=None):
    return {"kind": "skill", "skill_id": sid, "name": sid,
            "t_ms": t, "end_ms": end if end is not None else t + 500}


def tap(t, key):
    return {"kind": "tap", "key": key, "t_ms": t, "end_ms": None, "source": []}


def cycle(base):
    """一次循环：旋风连 → 200ms → 火球，总长 1500ms。"""
    return [sk(base, "sk_wh", base + 800), sk(base + 1000, "sk_fb", base + 1300)]


TOKENS = cycle(0) + cycle(1500) + cycle(3000)


def test_find_candidates_repeating_pair():
    cands = find_candidates(TOKENS)
    units = [u for u, _ in cands]
    assert ("sk:sk_wh", "sk:sk_fb") in units
    unit, offsets = next((u, o) for u, o in cands if u == ("sk:sk_wh", "sk:sk_fb"))
    assert offsets == [0, 2, 4]


def test_build_candidate_gap_stats():
    c = build_candidate(TOKENS, 2, [0, 2, 4])
    assert c["body"][0] == {"skill": "sk_wh"}
    assert c["body"][1]["gap"] == 200                # 1000-800，三次一致
    assert c["body"][2] == {"skill": "sk_fb"}
    assert c["iterations"] == 3
    assert c["occurrences"][0] == [0, 1300]


def test_verify_full_coverage():
    c = build_candidate(TOKENS, 2, [0, 2, 4])
    r = verify(TOKENS, c)
    assert r["iterations"] == 3 and r["complete"] == 3
    assert r["coverage"] == 1.0
    assert r["warnings"] == [] and r["uncovered_before"] == 0


def test_verify_flags_deviant_gap():
    toks = cycle(0) + cycle(1500) + [sk(3000, "sk_wh", 3800), sk(4400, "sk_fb", 4700)]
    # 第三次 gap = 600，远离中位数 200
    cands = find_candidates(toks)
    unit, offsets = next((u, o) for u, o in cands if u == ("sk:sk_wh", "sk:sk_fb"))
    c = build_candidate(toks, 2, offsets)
    r = verify(toks, c)
    assert r["complete"] < r["iterations"]
    assert any("超出" in w for w in r["warnings"])


def test_uncovered_counted():
    toks = [tap(0, "9")] + cycle(1000) + cycle(2500)
    cands = find_candidates(toks)
    unit, offsets = next((u, o) for u, o in cands if u == ("sk:sk_wh", "sk:sk_fb"))
    c = build_candidate(toks, 2, offsets)
    r = verify(toks, c)
    assert r["uncovered_before"] == 1


def test_discover_rotations_top():
    out = discover_rotations(TOKENS)
    assert out and out[0][1]["coverage"] == 1.0
