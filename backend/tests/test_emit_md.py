from vd.emit.md import render_playbook_md, render_rotation_md

SKILLS = {
    "sk_wh": {"id": "sk_wh", "name": "旋风连", "pattern": [
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "tap", "key": "Q"}]},
    "sk_fb": {"id": "sk_fb", "name": "火球术", "pattern": [{"op": "tap", "key": "2"}]},
}
ROT = {"id": "rot_1", "name": "单体稳定输出",
       "body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
       "note": "旋风接火球", "derived_from": ["an_1"], "params": []}
PB = {"id": "pb_1", "name": "法师单体", "version": 2,
      "keymap_id": "km-default", "keymap_version": 1, "derived_from": ["an_1"],
      "sections": [
          {"name": "开场爆发", "body": [
              {"skill": "sk_fb"}, {"gap": 400},
              {"rotation": "rot_1", "iterations": 2}]},
          {"name": "稳定输出", "body": [
              {"rotation": "rot_1", "repeat_note": "直到目标死亡"},
              {"note": "留意走位"},
              {"skill": "sk_fb", "confidence": 0.5}]},
      ]}


def test_rotation_md():
    out = render_rotation_md(ROT, SKILLS)
    assert "# 循环：单体稳定输出" in out
    assert "旋风连 → 等待 200ms（±40）→ 火球术" in out
    assert "旋风接火球" in out
    assert "an_1" in out


def test_playbook_md_structure():
    out = render_playbook_md(PB, {"rot_1": ROT}, SKILLS)
    assert out.startswith("# 方案：法师单体 v2")
    assert "> 键位：km-default v1" in out
    assert "## 开场爆发" in out and "## 稳定输出" in out
    assert "【技能】火球术" in out
    assert "等待 400ms" in out
    assert "【循环】单体稳定输出 ×2" in out
    assert "循环条件（人工判断）：直到目标死亡" in out
    assert "> 备注：留意走位" in out
    assert "⚠️[低置信] 【技能】火球术" in out
    assert "旋风连 → 等待 200ms（±40）→ 火球术" in out   # 循环块附 body 展开


def test_unknown_skill_id_falls_back():
    out = render_rotation_md({**ROT, "body": [{"skill": "sk_ghost"}]}, SKILLS)
    assert "sk_ghost" in out
