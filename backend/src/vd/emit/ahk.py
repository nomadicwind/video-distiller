"""AutoHotkey v2 导出（spec §9.1 ahk 后端、§9.2 编译规则）。纯函数、确定性。"""

_KEY_MAP = {"LMB": "LButton", "RMB": "RButton", "Wheel": "WheelDown"}


def _ahk_key(k: str) -> str:
    if k in _KEY_MAP:
        return _KEY_MAP[k]
    if len(k) == 1 and k.isalpha():
        return k.lower()
    return k


def _skill_fn(skill_id: str) -> str:
    return f"Skill_{skill_id}"


def _rotation_fn(rotation_id: str) -> str:
    return f"Rotation_{rotation_id}"


def skill_lines(skill: dict, binds: dict, skills_by_id: dict) -> tuple[list[str], list[str]]:
    """单技能 → AHK 行（不含函数壳）。返回 (lines, warnings)。"""
    pattern = skill.get("pattern") or []
    lines: list[str] = []
    warnings: list[str] = []
    if pattern:
        for item in pattern:
            op = item["op"]
            if op == "tap":
                lines.append(f'Send "{{{_ahk_key(item["key"])}}}"')
            elif op == "gap":
                lines.append(f'Sleep {item["ms"]}')
            elif op == "hold":
                key = _ahk_key(item.get("key") or item.get("button"))
                lines.append(f'Send "{{{key} down}}"')
                lines.append(f'Sleep {item.get("ms", 100)}')
                lines.append(f'Send "{{{key} up}}"')
            elif op == "chord":
                keys = [_ahk_key(k) for k in item["keys"]]
                inner = "".join(f"{{{k}}}" for k in keys[1:])
                lines.append(f'Send "{{{keys[0]} down}}{inner}{{{keys[0]} up}}"')
            elif op == "wheel":
                lines.append('Send "{WheelDown}"')
            elif op == "skill":
                lines.append(f"{_skill_fn(item['ref'])}()")
        return lines, warnings
    keys = binds.get(skill["id"]) or []
    if keys:
        lines.append(f'Send "{{{_ahk_key(keys[0])}}}"')
        return lines, warnings
    warnings.append(f"技能 {skill['name']} 无 pattern 也无键位绑定")
    lines.append(f"; ⚠ 技能 {skill['name']} 无 pattern 也无键位绑定")
    return lines, warnings


def _collect_skill_ids(body: list, skills_by_id: dict, acc: list[str]) -> None:
    """按出现顺序收集 body 引用的 skill id（含 pattern 里的递归引用），去重保序。"""
    for item in body:
        sid = item.get("skill")
        if sid is None:
            continue
        if sid not in acc:
            acc.append(sid)
            sk = skills_by_id.get(sid)
            if sk:
                _collect_skill_ids(
                    [{"skill": i["ref"]} for i in sk.get("pattern", []) if i.get("op") == "skill"],
                    skills_by_id, acc)


def _block_ahk(block: dict, rotations_by_id: dict, skills_by_id: dict,
               manual_loops: list[str], section_name: str) -> list[str]:
    lines: list[str] = []
    if "skill" in block:
        sk = skills_by_id.get(block["skill"])
        name = sk["name"] if sk else block["skill"]
        lines.append(f"{_skill_fn(block['skill'])}() ; {name}")
    elif "gap" in block:
        lines.append(f"Sleep {block['gap']}")
    elif "note" in block:
        lines.append(f"; {block['note']}")
    else:
        rid = block["rotation"]
        rot = rotations_by_id.get(rid)
        name = rot["name"] if rot else rid
        if block.get("repeat_note"):
            manual_loops.append(f"[{section_name}] {name}：{block['repeat_note']}")
            lines.append(f"Loop {{ ; 循环条件（人工判断）：{block['repeat_note']}")
            lines.append(f"    {_rotation_fn(rid)}()")
            lines.append("}")
        elif block.get("iterations"):
            lines.append(f"Loop {block['iterations']} {{")
            lines.append(f"    {_rotation_fn(rid)}()")
            lines.append("}")
        else:
            lines.append(f"{_rotation_fn(rid)}() ; {name}")
    if block.get("confidence", 1.0) < 0.7:
        lines = [f"; [低置信] {ln}" for ln in lines]
    return lines


def _fn(name: str, body_lines: list[str], comment: str = "") -> list[str]:
    head = f"{name}() {{" + (f" ; {comment}" if comment else "")
    return [head] + [f"    {ln}" for ln in body_lines] + ["}", ""]


def _skill_functions(skill_ids: list[str], skills_by_id: dict, binds: dict,
                     warnings: list[str]) -> list[str]:
    out: list[str] = []
    for sid in skill_ids:
        sk = skills_by_id.get(sid)
        if sk is None:
            warnings.append(f"未知技能 id {sid}")
            out += _fn(_skill_fn(sid), [f"; ⚠ 未知技能 id {sid}"])
            continue
        lines, warns = skill_lines(sk, binds, skills_by_id)
        warnings.extend(warns)
        out += _fn(_skill_fn(sid), lines, sk["name"])
    return out


def _header(title: str, manual_loops: list[str], warnings: list[str]) -> list[str]:
    lines = ["#Requires AutoHotkey v2.0", f"; Video Distiller 导出 · {title}"]
    if manual_loops:
        lines.append("; ⚠ 人工判断的循环条件（不可执行，运行中按 F12 急停）：")
        lines += [f";   - {m}" for m in manual_loops]
    if warnings:
        lines.append("; ⚠ 警告：")
        lines += [f";   - {w}" for w in warnings]
    lines += ["", "F12::ExitApp", ""]
    return lines


def render_playbook_ahk(playbook: dict, rotations_by_id: dict,
                        skills_by_id: dict, binds: dict) -> str:
    manual_loops: list[str] = []
    warnings: list[str] = []
    section_fns: list[str] = []
    section_bodies: list[list[str]] = []
    all_skill_ids: list[str] = []
    rotation_ids: list[str] = []

    for i, sec in enumerate(playbook["sections"], 1):
        body_lines: list[str] = []
        for block in sec.get("body", []):
            body_lines += _block_ahk(block, rotations_by_id, skills_by_id,
                                     manual_loops, sec["name"])
            if "rotation" in block and block["rotation"] not in rotation_ids:
                rotation_ids.append(block["rotation"])
        _collect_skill_ids(sec.get("body", []), skills_by_id, all_skill_ids)
        section_fns.append(f"Section_{i}")
        section_bodies.append(body_lines)

    for rid in rotation_ids:
        rot = rotations_by_id.get(rid)
        if rot:
            _collect_skill_ids(rot["body"], skills_by_id, all_skill_ids)

    parts: list[str] = []
    parts += ["F9:: {"] + [f"    {fn}()" for fn in section_fns] + ["}", ""]
    for fn, body, sec in zip(section_fns, section_bodies,
                             playbook["sections"]):
        parts += _fn(fn, body, sec["name"])
    for rid in rotation_ids:
        rot = rotations_by_id.get(rid)
        if rot is None:
            warnings.append(f"未知循环 id {rid}")
            parts += _fn(_rotation_fn(rid), [f"; ⚠ 未知循环 id {rid}"])
            continue
        body_lines: list[str] = []
        for item in rot["body"]:
            if "skill" in item:
                body_lines.append(f"{_skill_fn(item['skill'])}()")
            elif "gap" in item:
                body_lines.append(f"Sleep {item['gap']}")
        parts += _fn(_rotation_fn(rid), body_lines, rot["name"])
    parts += _skill_functions(all_skill_ids, skills_by_id, binds, warnings)

    title = f"方案：{playbook['name']} v{playbook['version']}"
    return "\n".join(_header(title, manual_loops, warnings) + parts)


def render_rotation_ahk(rotation: dict, skills_by_id: dict, binds: dict) -> str:
    warnings: list[str] = []
    all_skill_ids: list[str] = []
    _collect_skill_ids(rotation["body"], skills_by_id, all_skill_ids)
    body_lines: list[str] = []
    for item in rotation["body"]:
        if "skill" in item:
            body_lines.append(f"{_skill_fn(item['skill'])}()")
        elif "gap" in item:
            body_lines.append(f"Sleep {item['gap']}")
    parts = ["F9:: {", f"    {_rotation_fn(rotation['id'])}()", "}", ""]
    parts += _fn(_rotation_fn(rotation["id"]), body_lines, rotation["name"])
    parts += _skill_functions(all_skill_ids, skills_by_id, binds, warnings)
    return "\n".join(_header(f"循环：{rotation['name']}", [], warnings) + parts)
