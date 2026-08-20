import json

from vd.emit.plan import flatten_events, render_playbook_plan, render_rotation_plan

SKILLS = {
    "sk_a": {"id": "sk_a", "name": "平A", "pattern": [{"op": "tap", "key": "1"}]},
    "sk_h": {"id": "sk_h", "name": "蓄力", "pattern": [
        {"op": "hold", "key": "LMB", "ms": 300}]},
    "sk_b": {"id": "sk_b", "name": "闪现", "pattern": []},   # 仅绑定
    "sk_n": {"id": "sk_n", "name": "孤儿", "pattern": []},   # 无 pattern 无绑定
}
ROTS = {"rot_1": {"id": "rot_1", "name": "小循环", "body": [
    {"skill": "sk_a"}, {"gap": 150}, {"op": "tap", "key": "E"}]}}
BINDS = {"sk_b": ["Shift+2"]}


def test_flatten_rotation_body_with_gap_and_raw_op():
    events, loops, warns = flatten_events(
        [{"name": "s", "body": [{"rotation": "rot_1"}]}], ROTS, SKILLS, {})
    assert events == [
        {"t_ms": 0, "action": "tap", "key": "1"},
        {"t_ms": 150, "action": "tap", "key": "E"},
    ]
    assert loops == [] and warns == []


def test_hold_emits_down_up_and_advances_clock():
    events, _, _ = flatten_events(
        [{"name": "s", "body": [{"skill": "sk_h"}, {"gap": 100},
                                 {"skill": "sk_a"}]}], {}, SKILLS, {})
    assert events == [
        {"t_ms": 0, "action": "down", "key": "LMB"},
        {"t_ms": 300, "action": "up", "key": "LMB"},
        {"t_ms": 400, "action": "tap", "key": "1"},
    ]


def test_chord_bind_expands_first_key_wrapped():
    events, _, warns = flatten_events(
        [{"name": "s", "body": [{"skill": "sk_b"}]}], {}, SKILLS, BINDS)
    assert events == [
        {"t_ms": 0, "action": "down", "key": "Shift"},
        {"t_ms": 0, "action": "tap", "key": "2"},
        {"t_ms": 0, "action": "up", "key": "Shift"},
    ]
    assert warns == []


def test_unbindable_skill_skipped_with_warning():
    events, _, warns = flatten_events(
        [{"name": "s", "body": [{"skill": "sk_n"}]}], {}, SKILLS, {})
    assert events == []
    assert any("孤儿" in w for w in warns)


def test_iterations_unroll_and_manual_loop():
    sections = [{"name": "s", "body": [
        {"rotation": "rot_1", "iterations": 2},
        {"rotation": "rot_1", "repeat_note": "打到红血停"},
    ]}]
    events, loops, _ = flatten_events(sections, ROTS, SKILLS, {})
    assert len([e for e in events if e["key"] == "1"]) == 3   # 2 + 1
    assert loops == ["[s] 小循环：打到红血停"]


def test_low_confidence_block_skipped_with_warning():
    sections = [{"name": "s", "body": [
        {"skill": "sk_a", "confidence": 0.4}]}]
    events, _, warns = flatten_events(sections, {}, SKILLS, {})
    assert events == []
    assert any("低置信" in w for w in warns)


def test_render_playbook_plan_shape():
    pb = {"id": "pb_1", "name": "测试方案", "version": 2,
          "sections": [{"name": "s", "body": [{"rotation": "rot_1"}]}]}
    doc = json.loads(render_playbook_plan(pb, ROTS, SKILLS, {}))
    assert doc["format"] == "vd-plan" and doc["version"] == 1
    assert doc["stop_hotkey"] == "F12"
    assert doc["title"] == "方案：测试方案 v2"
    assert len(doc["events"]) == 2


def test_render_rotation_plan_shape():
    doc = json.loads(render_rotation_plan(ROTS["rot_1"], SKILLS, {}))
    assert doc["title"] == "循环：小循环"
    assert doc["events"][0] == {"t_ms": 0, "action": "tap", "key": "1"}
