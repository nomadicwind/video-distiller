"""Markdown 导出（spec §9.1 md 后端）。纯函数：IR dict → 文本。"""


def _skill_name(sid: str, skills_by_id: dict) -> str:
    sk = skills_by_id.get(sid)
    return sk["name"] if sk else sid


def _body_line(body: list, skills_by_id: dict) -> str:
    parts = []
    has_tol = []
    for item in body:
        if "skill" in item:
            parts.append(_skill_name(item["skill"], skills_by_id))
            has_tol.append(False)
        elif "gap" in item:
            tol = f"（±{item['tol']}）" if item.get("tol") is not None else ""
            parts.append(f"等待 {item['gap']}ms{tol}")
            has_tol.append(bool(tol))
        else:
            parts.append(f"{item.get('op', '?')} {item.get('key', '')}".strip())
            has_tol.append(False)

    result = []
    for i, part in enumerate(parts):
        result.append(part)
        if i < len(parts) - 1:
            if has_tol[i]:
                result.append("→ ")
            else:
                result.append(" → ")
    return "".join(result)


def _block_lines(block: dict, rotations_by_id: dict, skills_by_id: dict) -> list[str]:
    prefix = "⚠️[低置信] " if block.get("confidence", 1.0) < 0.7 else ""
    if "skill" in block:
        return [f"{prefix}【技能】{_skill_name(block['skill'], skills_by_id)}"]
    if "gap" in block:
        return [f"{prefix}等待 {block['gap']}ms"]
    if "note" in block:
        return [f"> 备注：{block['note']}"]
    rot = rotations_by_id.get(block["rotation"])
    name = rot["name"] if rot else block["rotation"]
    if block.get("repeat_note"):
        head = f"{prefix}【循环】{name} —— 循环条件（人工判断）：{block['repeat_note']}"
    elif block.get("iterations"):
        head = f"{prefix}【循环】{name} ×{block['iterations']}"
    else:
        head = f"{prefix}【循环】{name}"
    lines = [head]
    if rot:
        lines.append(f"   - {_body_line(rot['body'], skills_by_id)}")
    return lines


def render_rotation_md(rotation: dict, skills_by_id: dict) -> str:
    lines = [f"# 循环：{rotation['name']}", ""]
    if rotation.get("note"):
        lines += [f"> {rotation['note']}", ""]
    lines += [_body_line(rotation["body"], skills_by_id), ""]
    if rotation.get("derived_from"):
        lines.append(f"来源：{'、'.join(rotation['derived_from'])}")
    return "\n".join(lines) + "\n"


def render_playbook_md(playbook: dict, rotations_by_id: dict, skills_by_id: dict) -> str:
    lines = [f"# 方案：{playbook['name']} v{playbook['version']}", ""]
    meta = []
    if playbook.get("keymap_id"):
        meta.append(f"键位：{playbook['keymap_id']} v{playbook['keymap_version']}")
    if playbook.get("derived_from"):
        meta.append(f"来源：{'、'.join(playbook['derived_from'])}")
    if meta:
        lines += [f"> {' · '.join(meta)}", ""]
    for sec in playbook["sections"]:
        lines += [f"## {sec['name']}", ""]
        n = 0
        for block in sec.get("body", []):
            rendered = _block_lines(block, rotations_by_id, skills_by_id)
            if rendered[0].startswith(">"):
                lines += rendered
            else:
                n += 1
                lines.append(f"{n}. {rendered[0]}")
                lines += rendered[1:]
        lines.append("")
    return "\n".join(lines)
