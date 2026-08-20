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


def test_razer_key_escaping_with_quotes_and_angles():
    """Verify keys with " and < are properly escaped in XML attributes."""
    sk_special = {
        "sk_special": {
            "id": "sk_special",
            "name": "特殊键",
            "pattern": [{"op": "tap", "key": 'F"/><Injected foo="bar'}]
        }
    }
    rot = {
        "id": "rot_special",
        "name": "特殊循环",
        "body": [{"skill": "sk_special"}]
    }
    xml = render_rotation_razer(rot, sk_special, {})
    # Verify XML is well-formed and the raw quote/angle characters don't appear
    # inside an unquoted attribute boundary
    assert 'key=' in xml
    # The key should be properly escaped via quoteattr, not raw
    assert 'key="F' not in xml  # Raw quote shouldn't start an attribute
    # Verify the XML can be parsed (well-formed)
    import xml.etree.ElementTree as ET
    try:
        ET.fromstring(xml)
    except ET.ParseError as e:
        raise AssertionError(f"Generated XML is malformed: {e}\nXML:\n{xml}")
