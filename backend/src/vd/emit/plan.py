"""IR → 注入计划 JSON（spec §9.1 plan 后端、§9.3 执行器输入）。"""
import json


def _ev(t: int, action: str, key: str = "") -> dict:
    return {"t_ms": t, "action": action, "key": key}


def _op_events(item: dict, t: int, warnings: list[str]) -> tuple[list[dict], int]:
    """单个 op 项 → 事件列表 + 推进后的时钟。与 emit/ahk._op_lines 语义对齐。"""
    op = item.get("op")
    if op == "tap":
        return [_ev(t, "tap", item["key"])], t
    if op == "gap":
        return [], t + int(item["ms"])
    if op == "hold":
        key = item.get("key") or item.get("button")
        ms = int(item.get("ms", 100))
        return [_ev(t, "down", key), _ev(t + ms, "up", key)], t + ms
    if op == "chord":
        keys = item.get("keys")
        if keys is None:
            keys = (item.get("key") or "").split("+")
        evs = [_ev(t, "down", keys[0])]
        for k in keys[1:]:
            evs.append(_ev(t, "tap", k))
        evs.append(_ev(t, "up", keys[0]))
        return evs, t
    if op == "wheel":
        return [_ev(t, "wheel")], t
    warnings.append(f"未知操作已跳过：{item!r}")
    return [], t


def _chord_events(parts: list[str], t: int) -> list[dict]:
    evs = [_ev(t, "down", parts[0])]
    for k in parts[1:]:
        evs.append(_ev(t, "tap", k))
    evs.append(_ev(t, "up", parts[0]))
    return evs


def _skill_events(skill: dict, binds: dict, t: int,
                  warnings: list[str]) -> tuple[list[dict], int]:
    pattern = skill.get("pattern") or []
    if pattern:
        evs: list[dict] = []
        for item in pattern:
            got, t = _op_events(item, t, warnings)
            evs.extend(got)
        return evs, t
    keys = binds.get(skill["id"]) or []
    if keys:
        parts = keys[0].split("+")
        if len(parts) > 1:
            return _chord_events(parts, t), t
        return [_ev(t, "tap", parts[0])], t
    warnings.append(f"技能 {skill['name']} 无 pattern 也无键位绑定，已跳过")
    return [], t


def _rotation_events(rotation: dict, skills_by_id: dict, binds: dict, t: int,
                     warnings: list[str]) -> tuple[list[dict], int]:
    evs: list[dict] = []
    for item in rotation["body"]:
        if "skill" in item:
            sk = skills_by_id.get(item["skill"])
            if sk is None:
                warnings.append(f"未知技能 {item['skill']}，已跳过")
                continue
            got, t = _skill_events(sk, binds, t, warnings)
            evs.extend(got)
        elif "gap" in item:
            t += int(item["gap"])
        elif "op" in item:
            got, t = _op_events(item, t, warnings)
            evs.extend(got)
        else:
            warnings.append(f"循环体未知项已跳过：{item!r}")
    return evs, t


def flatten_events(sections: list, rotations_by_id: dict, skills_by_id: dict,
                   binds: dict) -> tuple[list[dict], list[str], list[str]]:
    events: list[dict] = []
    manual_loops: list[str] = []
    warnings: list[str] = []
    t = 0
    for sec in sections:
        for block in sec.get("body", []):
            if block.get("confidence", 1.0) < 0.7:
                warnings.append(f"[{sec.get('name', '')}] 低置信块已跳过：{block!r}")
                continue
            if "note" in block:
                continue
            if "skill" in block:
                sk = skills_by_id.get(block["skill"])
                if sk is None:
                    warnings.append(f"未知技能 {block['skill']}，已跳过")
                    continue
                got, t = _skill_events(sk, binds, t, warnings)
                events.extend(got)
            elif "gap" in block:
                t += int(block["gap"])
            elif "rotation" in block:
                rot = rotations_by_id.get(block["rotation"])
                if rot is None:
                    warnings.append(f"未知循环 {block['rotation']}，已跳过")
                    continue
                if block.get("repeat_note"):
                    manual_loops.append(
                        f"[{sec.get('name', '')}] {rot['name']}：{block['repeat_note']}")
                    reps = 1
                else:
                    reps = int(block.get("iterations") or 1)
                for _ in range(reps):
                    got, t = _rotation_events(rot, skills_by_id, binds, t, warnings)
                    events.extend(got)
    return events, manual_loops, warnings


def _render(title: str, events, manual_loops, warnings) -> str:
    return json.dumps({
        "format": "vd-plan", "version": 1, "title": title,
        "stop_hotkey": "F12", "events": events,
        "manual_loops": manual_loops, "warnings": warnings,
    }, ensure_ascii=False, indent=2)


def render_playbook_plan(playbook: dict, rotations_by_id: dict,
                         skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        playbook["sections"], rotations_by_id, skills_by_id, binds)
    title = f"方案：{playbook['name']} v{playbook['version']}"
    return _render(title, events, loops, warns)


def render_rotation_plan(rotation: dict, skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        [{"name": rotation["name"], "body": [{"rotation": rotation["id"]}]}],
        {rotation["id"]: rotation}, skills_by_id, binds)
    return _render(f"循环：{rotation['name']}", events, loops, warns)
