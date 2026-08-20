"""跨层对齐、三方冲突、补区间（spec §7.2b/d、§7.6）。纯函数。"""

ALIGN_WINDOW_MS = 500


def align_l1(l0_ops: list[dict], l1_marks: list[dict],
             skills_by_name: dict, binds: dict) -> tuple[list, list]:
    key_to_skills: dict[str, set] = {}
    for sid, keys in (binds or {}).items():
        for k in keys:
            key_to_skills.setdefault(k, set()).add(sid)
    links, conflicts = [], []
    for m in l1_marks:
        name = m["label"]
        sk = skills_by_name.get(name)
        if sk is None:
            conflicts.append({"type": "undefined_skill", "t_ms": m["t_ms"], "label": name})
        best, best_dt = None, ALIGN_WINDOW_MS + 1
        for o in l0_ops:
            dt = abs(o["t_ms"] - m["t_ms"])
            if dt < best_dt:
                best, best_dt = o, dt
        if best is None or best_dt > ALIGN_WINDOW_MS:
            conflicts.append({"type": "no_l0", "t_ms": m["t_ms"], "label": name})
            continue
        links.append({"l1_t_ms": m["t_ms"], "label": name,
                      "l0_key": best["key"], "l0_t_ms": best["t_ms"],
                      "dt_ms": best_dt})
        if sk is not None and binds:
            allowed = key_to_skills.get(best["key"], set())
            if sk["id"] not in allowed:
                conflicts.append({
                    "type": "three_way", "t_ms": m["t_ms"],
                    "l0_key": best["key"], "l1_label": name,
                    "keymap_expected": sorted(binds.get(sk["id"], []))})
    return links, conflicts


def complete_spans(l1_marks: list[dict], skills_by_name: dict) -> list[dict]:
    out = []
    for m in l1_marks:
        if m.get("end_ms") is not None:
            continue
        sk = skills_by_name.get(m["label"])
        if sk and sk.get("cast_ms") is not None and sk.get("anim_ms") is not None:
            out.append({"mark_id": m.get("id"), "t_ms": m["t_ms"],
                        "proposed_end_ms": m["t_ms"] + sk["cast_ms"] + sk["anim_ms"],
                        "confidence": 0.6})
    return out


def infer_keymap(links: list[dict], skills_by_name: dict) -> list[dict]:
    """共现统计反推键位（spec §7.2c）。"""
    counts: dict[str, dict[str, int]] = {}
    for ln in links:
        sk = skills_by_name.get(ln["label"])
        if sk is None:
            continue
        by_key = counts.setdefault(sk["id"], {})
        by_key[ln["l0_key"]] = by_key.get(ln["l0_key"], 0) + 1
    suggestions = []
    for sid in sorted(counts):
        by_key = counts[sid]
        total = sum(by_key.values())
        key, n = max(by_key.items(), key=lambda kv: kv[1])
        if n >= 2 and n / total > 0.6:
            suggestions.append({"skill_id": sid, "key": key,
                                "support": n, "total": total})
    return suggestions
