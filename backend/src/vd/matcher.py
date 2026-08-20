"""确定性 pattern 匹配器（spec §7.4）：最长优先、歧义不自动猜、失败保留。纯函数。"""

DEFAULT_GAP_TOL = 80
DEFAULT_HOLD_TOL = 100


def _token_end(tok: dict) -> int:
    return tok["end_ms"] if tok.get("end_ms") is not None else tok["t_ms"]


def _item_matches_token(item: dict, tok: dict) -> bool:
    op = item["op"]
    if op == "tap":
        return tok["kind"] == "tap" and tok["key"] == item["key"]
    if op == "wheel":
        return tok["kind"] == "wheel"
    if op == "chord":
        return tok["kind"] == "chord" and sorted(item["keys"]) == sorted(tok.get("keys") or [])
    if op == "hold":
        if tok["kind"] != "hold":
            return False
        want = item.get("key") or item.get("button")
        if tok["key"] != want:
            return False
        if "ms" in item:
            tol = item.get("tol_ms", DEFAULT_HOLD_TOL)
            return abs((_token_end(tok) - tok["t_ms"]) - item["ms"]) <= tol
        return True
    if op == "skill":
        return tok["kind"] == "skill" and tok["skill_id"] == item["ref"]
    return False


def match_at(tokens: list[dict], start: int, pattern: list[dict]) -> int | None:
    j = start
    prev_tok = None
    pending_gap = None
    for item in pattern:
        if item["op"] == "gap":
            pending_gap = item
            continue
        if j >= len(tokens):
            return None
        tok = tokens[j]
        if pending_gap is not None and prev_tok is not None:
            gap = tok["t_ms"] - _token_end(prev_tok)
            tol = pending_gap.get("tol_ms", DEFAULT_GAP_TOL)
            if abs(gap - pending_gap["ms"]) > tol:
                return None
        pending_gap = None
        if not _item_matches_token(item, tok):
            return None
        prev_tok = tok
        j += 1
    return j - start if j > start else None


def match_pass(tokens: list[dict], skills: list[dict]):
    out: list[dict] = []
    matches: list[dict] = []
    ambiguities: list[dict] = []
    i = 0
    while i < len(tokens):
        best = 0
        winners: list[dict] = []
        for sk in skills:
            n = match_at(tokens, i, sk["pattern"])
            if n and n > best:
                best, winners = n, [sk]
            elif n and n == best:
                winners.append(sk)
        if best > 0 and len(winners) == 1:
            sk = winners[0]
            seg = tokens[i:i + best]
            rec = {"skill_id": sk["id"], "name": sk["name"],
                   "t_ms": seg[0]["t_ms"], "end_ms": _token_end(seg[-1]),
                   "token_count": best}
            matches.append(rec)
            out.append({"kind": "skill", "skill_id": sk["id"], "name": sk["name"],
                        "t_ms": rec["t_ms"], "end_ms": rec["end_ms"]})
            i += best
        else:
            if best > 0:
                ambiguities.append({"t_ms": tokens[i]["t_ms"],
                                    "skills": sorted(s["id"] for s in winners)})
            out.append(tokens[i])
            i += 1
    return out, matches, ambiguities


def match_all(ops: list[dict], skills: list[dict]) -> dict:
    """自底向上多趟（spec §7.4）：纯操作 pattern 先，skill-ref pattern 循环至不动点。"""
    pure = [s for s in skills if all(i["op"] != "skill" for i in s["pattern"])]
    refs = [s for s in skills if any(i["op"] == "skill" for i in s["pattern"])]
    tokens, matches, ambiguities = match_pass(list(ops), pure)
    while refs:
        tokens, m2, a2 = match_pass(tokens, refs)
        matches += m2
        ambiguities += a2
        if not m2:
            break
    unmatched = [t for t in tokens if t["kind"] != "skill"]
    return {"tokens": tokens, "matches": matches,
            "ambiguities": ambiguities, "unmatched": unmatched}
