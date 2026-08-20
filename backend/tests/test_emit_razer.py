from vd.emit.razer import render_playbook_razer, render_rotation_razer

SKILLS = {
    "sk_a": {"id": "sk_a", "name": "平A", "pattern": [{"op": "tap", "key": "1"}]},
    "sk_h": {"id": "sk_h", "name": "蓄力", "pattern": [
        {"op": "hold", "key": "F", "ms": 300}]},
}
ROT = {"id": "rot_1", "name": "小循环",
       "body": [{"skill": "sk_a"}, {"gap": 150}, {"skill": "sk_h"}]}


def test_rotation_razer_structure():
    xml = render_rotation_razer(ROT, SKILLS, {})
    assert xml.startswith('<?xml version="1.0" encoding="utf-8"?>')
    assert '<Macro name="循环：小循环"' in xml
    assert 'guid="' in xml
    assert xml.index('<KeyDown key="1"/>') < xml.index('<KeyUp key="1"/>')
    assert '<Delay ms="150"/>' in xml
    assert xml.index('<KeyDown key="F"/>') < xml.index('<Delay ms="300"/>') \
        < xml.index('<KeyUp key="F"/>')


def test_razer_deterministic():
    a = render_rotation_razer(ROT, SKILLS, {})
    b = render_rotation_razer(ROT, SKILLS, {})
    assert a == b


def test_playbook_razer_warnings_as_comments():
    pb = {"id": "pb_1", "name": "测试", "version": 1, "sections": [
        {"name": "s", "body": [
            {"rotation": "rot_1", "repeat_note": "看血线"},
            {"skill": "sk_missing"}]}]}
    xml = render_playbook_razer(pb, {"rot_1": ROT}, SKILLS, {})
    assert "<!-- ⚠" in xml
    assert "看血线" in xml
