from vd.emit.ahk import render_playbook_ahk, render_rotation_ahk

SKILLS = {
    "sk_wh": {"id": "sk_wh", "name": "旋风连", "pattern": [
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 200, "tol_ms": 60},
        {"op": "hold", "button": "LMB", "ms": 300, "tol_ms": 100}]},
    "sk_fb": {"id": "sk_fb", "name": "火球术", "pattern": [{"op": "tap", "key": "2"}]},
    "sk_blink": {"id": "sk_blink", "name": "闪现", "pattern": [
        {"op": "chord", "keys": ["Shift", "2"]}]},
    "sk_bound": {"id": "sk_bound", "name": "只有键位", "pattern": []},
    "sk_naked": {"id": "sk_naked", "name": "裸技能", "pattern": []},
    "sk_combo": {"id": "sk_combo", "name": "冰火连携", "pattern": [
        {"op": "skill", "ref": "sk_fb"}, {"op": "gap", "ms": 300},
        {"op": "skill", "ref": "sk_fb"}]},
}
BINDS = {"sk_bound": ["3"]}
ROT = {"id": "rot_1", "name": "单体稳定输出",
       "body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
       "note": None, "derived_from": [], "params": []}
PB = {"id": "pb_1", "name": "法师单体", "version": 2,
      "keymap_id": "km-default", "keymap_version": 1, "derived_from": ["an_1"],
      "sections": [
          {"name": "开场", "body": [
              {"skill": "sk_blink"}, {"gap": 400},
              {"rotation": "rot_1", "iterations": 2}]},
          {"name": "稳定输出", "body": [
              {"rotation": "rot_1", "repeat_note": "直到目标死亡"},
              {"skill": "sk_bound"}, {"skill": "sk_naked"},
              {"skill": "sk_combo"},
              {"gap": 100, "confidence": 0.5}]},
      ]}


def test_playbook_ahk_structure():
    out = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    assert out.startswith("#Requires AutoHotkey v2.0")
    assert "F12::ExitApp" in out
    assert "F9::" in out
    assert "直到目标死亡" in out.split("F12::ExitApp")[0]      # 头部汇总
    assert 'Send "{q}"' in out                                  # 字母小写
    assert 'Send "{Shift down}{2}{Shift up}"' in out            # chord
    assert 'Send "{LButton down}"' in out and "Sleep 300" in out
    assert "Loop 2 {" in out                                    # 固定次数
    assert "Loop {" in out                                      # 条件循环
    assert "循环条件（人工判断）：直到目标死亡" in out
    assert 'Send "{3}"' in out                                  # 空 pattern 用键位首键
    assert "; ⚠ 技能 裸技能 无 pattern 也无键位绑定" in out     # 绝不静默包含
    assert "Skill_sk_combo" in out and out.count("Skill_sk_fb()") >= 3  # 递归引用被展开为函数调用
    assert "; [低置信] Sleep 100" in out                         # 低置信注释化


def test_rotation_ahk_single():
    out = render_rotation_ahk(ROT, SKILLS, {})
    assert "#Requires AutoHotkey v2.0" in out
    assert "Rotation_rot_1()" in out
    assert "Sleep 200" in out
    assert "F9::" in out and "F12::ExitApp" in out


def test_deterministic_output():
    a = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    b = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    assert a == b


def test_low_confidence_block_recorded_in_header_warnings():
    out = render_playbook_ahk(PB, {"rot_1": ROT}, SKILLS, BINDS)
    header = out.split("F12::ExitApp")[0]
    assert "低置信块已注释化" in header


def test_chord_bind_emits_valid_ahk_chord():
    """Fix 1: bind 值为 "Shift+2" 的裸键位技能需拆成 AHK chord，而非非法的 {Shift+2}。"""
    skills = dict(SKILLS)
    skills["sk_chord_bound"] = {"id": "sk_chord_bound", "name": "组合键位技能", "pattern": []}
    binds = dict(BINDS)
    binds["sk_chord_bound"] = ["Shift+2"]
    rot = {"id": "rot_chord", "name": "组合键循环",
           "body": [{"skill": "sk_chord_bound"}]}
    pb = {"id": "pb_chord", "name": "组合键方案", "version": 1,
          "keymap_id": "km-default", "keymap_version": 1, "derived_from": [],
          "sections": [{"name": "唯一段", "body": [{"rotation": "rot_chord"}]}]}
    out = render_playbook_ahk(pb, {"rot_chord": rot}, skills, binds)
    assert 'Send "{Shift down}{2}{Shift up}"' in out
    assert "{Shift+2}" not in out


def test_raw_op_rotation_body_emits_send_lines():
    """Fix 2: 循环体中的原始操作项（discover.build_candidate 产物）应被编译为真实 Send 行。"""
    rot = {"id": "rot_raw", "name": "原始操作循环",
           "body": [{"op": "tap", "key": "R"}, {"gap": 150}]}
    pb = {"id": "pb_raw", "name": "原始操作方案", "version": 1,
          "keymap_id": "km-default", "keymap_version": 1, "derived_from": [],
          "sections": [{"name": "唯一段", "body": [{"rotation": "rot_raw"}]}]}
    out = render_playbook_ahk(pb, {"rot_raw": rot}, SKILLS, {})
    assert 'Send "{r}"' in out
    assert "Sleep 150" in out


def test_unknown_raw_op_emits_comment_and_header_warning():
    """Fix 2: 未知 op 种类要注释化且记录到头部警告，不能静默丢弃。"""
    rot = {"id": "rot_bad_op", "name": "未知操作循环",
           "body": [{"op": "teleport", "key": "X"}]}
    pb = {"id": "pb_bad_op", "name": "未知操作方案", "version": 1,
          "keymap_id": "km-default", "keymap_version": 1, "derived_from": [],
          "sections": [{"name": "唯一段", "body": [{"rotation": "rot_bad_op"}]}]}
    out = render_playbook_ahk(pb, {"rot_bad_op": rot}, SKILLS, {})
    assert "; ⚠ 未知操作" in out
    header = out.split("F12::ExitApp")[0]
    assert "⚠ 警告" in header
    assert "teleport" in header


def test_newline_injection_in_playbook_name_is_neutralized():
    """Fix 4: 方案名中嵌入换行 + 伪造 Send 指令，不得逃逸注释生成可执行行。"""
    evil = dict(PB)
    evil["name"] = "邪恶方案\nSend {F4}"
    out = render_playbook_ahk(evil, {"rot_1": ROT}, SKILLS, BINDS)
    for line in out.splitlines():
        assert not line.strip().startswith("Send {F4}")
