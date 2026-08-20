import pytest

from vd import db, store


@pytest.fixture
def conn():
    c = db.connect()
    yield c
    c.close()


def test_skill_crud_roundtrip(conn):
    s = store.create_skill(conn, name="火球术", class_="法师", cd_ms=6000,
                           cast_ms=400, anim_ms=720,
                           pattern=[{"op": "tap", "key": "2"}])
    assert s["pattern"] == [{"op": "tap", "key": "2"}]
    assert store.skill_layer(s) == "L1"
    s2 = store.update_skill(conn, s["id"], anim_ms=750)
    assert s2["anim_ms"] == 750
    assert len(store.list_skills(conn)) == 1
    store.delete_skill(conn, s["id"])
    assert store.list_skills(conn) == []


def test_skill_layer_by_content(conn):
    combo = store.create_skill(conn, name="冰火连携", pattern=[
        {"op": "skill", "ref": "sk_a"},
        {"op": "gap", "ms": 300, "tol_ms": 80},
        {"op": "skill", "ref": "sk_b"}])
    assert store.skill_layer(combo) == "L2"
    multikey = store.create_skill(conn, name="旋风连", pattern=[
        {"op": "tap", "key": "Q"}, {"op": "gap", "ms": 300},
        {"op": "tap", "key": "Q"}])
    assert store.skill_layer(multikey) == "L1"     # 纯操作多步仍是 L1（spec §3.3）


def test_pattern_validation(conn):
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏", pattern=[{"op": "explode"}])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏2", pattern=[{"op": "tap"}])   # tap 缺 key
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏3", pattern=[{"op": "skill"}]) # skill 缺 ref


def test_keymap_always_new_version(conn):
    k1 = store.save_keymap(conn, keymap_id="km_mage", class_="法师",
                           binds={"sk_fireball": ["2"]})
    k2 = store.save_keymap(conn, keymap_id="km_mage",
                           binds={"sk_fireball": ["2"], "sk_blink": ["Shift+2"]})
    assert (k1["version"], k2["version"]) == (1, 2)
    old = store.get_keymap(conn, "km_mage", 1)
    assert old["binds"] == {"sk_fireball": ["2"]}      # 旧版本语义不漂移（spec §5.6）


def test_analysis_keymap_binding(conn):
    v = store.create_video(conn, name="a.mp4", source_kind="upload")
    tree = store.create_analysis(conn, v["id"])
    store.save_keymap(conn, keymap_id="km_mage", binds={})
    a = store.bind_analysis_keymap(conn, tree["id"], "km_mage", 1)
    assert (a["keymap_id"], a["keymap_version"]) == ("km_mage", 1)


def test_proposal_lifecycle(conn):
    v = store.create_video(conn, name="a.mp4", source_kind="upload")
    tree = store.create_analysis(conn, v["id"])
    p = store.create_proposal(conn, analysis_id=tree["id"], kind="rotation",
                              payload={"name": "x", "body": []},
                              report={"coverage": 0.9})
    assert p["status"] == "pending"
    assert p["payload"]["name"] == "x"
    p2 = store.set_proposal_status(conn, p["id"], "accepted")
    assert p2["status"] == "accepted"
    assert len(store.list_proposals(conn, tree["id"])) == 1


def test_rotation_create(conn):
    r = store.create_rotation(conn, name="单体稳定输出",
                              body=[{"skill": "sk_a"}, {"gap": 180}],
                              derived_from=["an_1"])
    assert store.list_rotations(conn)[0]["name"] == "单体稳定输出"
    assert r["derived_from"] == ["an_1"]


def test_pattern_ms_must_be_int(conn):
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏4", pattern=[{"op": "gap", "ms": None}])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏5", pattern=[{"op": "gap", "ms": "300"}])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="坏6", pattern=[{"op": "hold", "key": "F", "ms": None}])


def test_duplicate_skill_name_raises_value_error(conn):
    store.create_skill(conn, name="重复", pattern=[])
    with pytest.raises(ValueError):
        store.create_skill(conn, name="重复", pattern=[])


def test_delete_pending_proposals_keeps_adjudicated(conn):
    v = store.create_video(conn, name="a.mp4", source_kind="upload")
    tree = store.create_analysis(conn, v["id"])
    p1 = store.create_proposal(conn, analysis_id=tree["id"], kind="rotation",
                               payload={"name": "a", "body": []}, report={})
    p2 = store.create_proposal(conn, analysis_id=tree["id"], kind="rotation",
                               payload={"name": "b", "body": []}, report={})
    store.set_proposal_status(conn, p1["id"], "accepted")
    assert store.delete_pending_proposals(conn, tree["id"], kind="rotation") == 1
    remaining = store.list_proposals(conn, tree["id"])
    assert [p["status"] for p in remaining] == ["accepted"]


def test_playbook_lifecycle_with_versions(conn):
    pb = store.create_playbook(conn, name="法师单体", sections=[
        {"name": "开场", "body": [{"skill": "sk_a"}, {"gap": 400}]}])
    assert pb["version"] == 1
    pb2 = store.save_playbook(conn, pb["id"], sections=[
        {"name": "开场", "body": [{"skill": "sk_a"}]},
        {"name": "稳定输出", "body": [{"rotation": "rot_1", "iterations": 2, "pinned": True}]}])
    assert pb2["version"] == 2
    versions = store.list_playbook_versions(conn, pb["id"])
    assert [v["version"] for v in versions] == [1, 2]
    pb3 = store.rollback_playbook(conn, pb["id"], 1)
    assert pb3["version"] == 3                          # 回滚 = 旧快照存为新版本
    assert pb3["sections"][0]["body"] == [{"skill": "sk_a"}, {"gap": 400}]


def test_validate_sections_rejects_bad_blocks(conn):
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏", sections=[{"name": "s", "body": [{"boom": 1}]}])
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏2", sections=[{"name": "s", "body": [
            {"rotation": "r", "iterations": 0}]}])
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏3", sections=[{"name": "s", "body": [{"gap": "x"}]}])
    with pytest.raises(ValueError):
        store.create_playbook(conn, name="坏4", sections=[{"body": []}])       # 段落缺 name


def test_get_rotation(conn):
    r = store.create_rotation(conn, name="r", body=[])
    assert store.get_rotation(conn, r["id"])["name"] == "r"
    assert store.get_rotation(conn, "nope") is None
