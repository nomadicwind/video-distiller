"""IR → Razer Synapse 宏 XML（spec §9.1；格式未经官方验证——§13.4 documented deviation：
按公开样例结构产出，真实导入由用户在 Windows Synapse 验证）。"""
import uuid
from xml.sax.saxutils import escape, quoteattr

from vd.emit.plan import flatten_events

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # uuid.NAMESPACE_DNS


def _one_line(x) -> str:
    return str(x).replace("\n", " ").replace("\r", " ")


def _events_xml(events: list[dict]) -> list[str]:
    lines: list[str] = []
    prev_t = 0
    for ev in events:
        delta = ev["t_ms"] - prev_t
        if delta > 0:
            lines.append(f'    <Delay ms="{delta}"/>')
        prev_t = ev["t_ms"]
        key = escape(ev.get("key", ""))
        if ev["action"] == "tap":
            lines.append(f'    <KeyDown key="{key}"/>')
            lines.append(f'    <KeyUp key="{key}"/>')
        elif ev["action"] == "down":
            lines.append(f'    <KeyDown key="{key}"/>')
        elif ev["action"] == "up":
            lines.append(f'    <KeyUp key="{key}"/>')
        elif ev["action"] == "wheel":
            lines.append('    <WheelDown/>')
    return lines


def _render(title: str, events, manual_loops, warnings) -> str:
    guid = str(uuid.uuid5(_NS, title))
    head = ['<?xml version="1.0" encoding="utf-8"?>']
    for w in warnings:
        head.append(f"<!-- ⚠ {escape(_one_line(w))} -->")
    for m in manual_loops:
        head.append(f"<!-- ⚠ 手动循环：{escape(_one_line(m))} -->")
    head.append(f'<Macro name={quoteattr(_one_line(title))} guid="{guid}">')
    head.append("  <MacroEvents>")
    body = _events_xml(events)
    tail = ["  </MacroEvents>", "</Macro>", ""]
    return "\n".join(head + body + tail)


def render_playbook_razer(playbook: dict, rotations_by_id: dict,
                          skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        playbook["sections"], rotations_by_id, skills_by_id, binds)
    title = f"方案：{playbook['name']} v{playbook['version']}"
    return _render(title, events, loops, warns)


def render_rotation_razer(rotation: dict, skills_by_id: dict, binds: dict) -> str:
    events, loops, warns = flatten_events(
        [{"name": rotation["name"], "body": [{"rotation": rotation["id"]}]}],
        {rotation["id"]: rotation}, skills_by_id, binds)
    return _render(f"循环：{rotation['name']}", events, loops, warns)
