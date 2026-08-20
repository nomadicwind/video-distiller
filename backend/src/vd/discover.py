"""循环发现（spec §7.3 候选发现 + §7.5 验证报告）。确定性，纯函数。"""
from statistics import median


def _symbol(tok: dict) -> str:
    if tok["kind"] == "skill":
        return f"sk:{tok['skill_id']}"
    return f"{tok['kind']}:{tok.get('key', '')}"


def _token_end(tok: dict) -> int:
    return tok["end_ms"] if tok.get("end_ms") is not None else tok["t_ms"]


def _is_contig_sub(small: tuple, big: tuple) -> bool:
    if len(small) >= len(big):
        return False
    return any(big[i:i + len(small)] == small
               for i in range(len(big) - len(small) + 1))


def find_candidates(tokens: list[dict], min_len: int = 2, max_len: int = 8,
                    min_repeats: int = 2) -> list[tuple[tuple, list[int]]]:
    syms = [_symbol(t) for t in tokens]
    found: dict[tuple, list[int]] = {}
    upper = min(max_len, len(syms) // min_repeats)
    for n in range(min_len, upper + 1):
        for start in range(0, len(syms) - n + 1):
            unit = tuple(syms[start:start + n])
            if unit in found:
                continue
            occs, j = [], start
            while j + n <= len(syms):
                if tuple(syms[j:j + n]) == unit:
                    occs.append(j)
                    j += n
                else:
                    j += 1
            if len(occs) >= min_repeats:
                found[unit] = occs
    ranked = sorted(found.items(),
                    key=lambda kv: len(kv[0]) * len(kv[1]), reverse=True)
    kept: list[tuple[tuple, list[int]]] = []
    for unit, occs in ranked:
        if any(_is_contig_sub(unit, k_unit) for k_unit, _ in kept):
            continue
        kept.append((unit, occs))
    return kept


def build_candidate(tokens: list[dict], unit_len: int, offsets: list[int]) -> dict:
    body: list[dict] = []
    first = offsets[0]
    for k in range(unit_len):
        tok = tokens[first + k]
        if tok["kind"] == "skill":
            body.append({"skill": tok["skill_id"]})
        else:
            body.append({"op": tok["kind"], "key": tok.get("key", "")})
        if k + 1 < unit_len:
            gaps = sorted(
                tokens[o + k + 1]["t_ms"] - _token_end(tokens[o + k])
                for o in offsets)
            spread = gaps[-1] - gaps[0]
            body.append({"gap": round(median(gaps)),
                         "tol": max(40, round(spread / 2) + 20)})
    spans = [[tokens[o]["t_ms"], _token_end(tokens[o + unit_len - 1])]
             for o in offsets]
    return {"body": body, "occurrences": spans, "iterations": len(offsets),
            "unit_len": unit_len, "token_offsets": offsets}


def verify(tokens: list[dict], candidate: dict) -> dict:
    """确定性回放验证（spec §7.5）：提案是假设，报告是证据。"""
    n = candidate["unit_len"]
    offsets = candidate["token_offsets"]
    gap_items = [b for b in candidate["body"] if "gap" in b]
    warnings: list[str] = []
    complete = 0
    for idx, o in enumerate(offsets):
        ok = True
        for k in range(n - 1):
            a, b = tokens[o + k], tokens[o + k + 1]
            gap = b["t_ms"] - _token_end(a)
            spec = gap_items[k]
            if abs(gap - spec["gap"]) > spec["tol"]:
                warnings.append(
                    f"第 {idx + 1} 次迭代 gap 实测 {gap}ms，超出 {spec['gap']}±{spec['tol']}")
                ok = False
        if ok:
            complete += 1
    covered = n * len(offsets)
    coverage = round(covered / len(tokens), 3) if tokens else 0.0
    return {"iterations": len(offsets), "complete": complete,
            "coverage": coverage, "warnings": warnings,
            "uncovered_before": offsets[0],
            "uncovered_after": len(tokens) - (offsets[-1] + n)}


def discover_rotations(tokens: list[dict], top_n: int = 3):
    out = []
    for unit, offsets in find_candidates(tokens)[:top_n]:
        cand = build_candidate(tokens, len(unit), offsets)
        out.append((cand, verify(tokens, cand)))
    return out
