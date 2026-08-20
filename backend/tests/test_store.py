import pytest

from vd import db, store


@pytest.fixture
def conn():
    c = db.connect()
    yield c
    c.close()


@pytest.fixture
def video(conn):
    return store.create_video(conn, name="a.mp4", source_kind="upload")


def test_create_video_assigns_seq(conn):
    v1 = store.create_video(conn, name="a.mp4", source_kind="upload")
    v2 = store.create_video(conn, name="b.mp4", source_kind="upload")
    assert (v1["seq"], v2["seq"]) == (1, 2)


def test_create_analysis_builds_lanes_and_first_takes(conn, video):
    tree = store.create_analysis(conn, video["id"])
    assert tree["name"] == "video-1_km-default-v1_a1"
    assert [l["layer"] for l in tree["lanes"]] == ["L0", "L1", "L2"]
    assert all(len(l["takes"]) == 1 and l["takes"][0]["idx"] == 1 for l in tree["lanes"])
    tree2 = store.create_analysis(conn, video["id"])
    assert tree2["name"].endswith("_a2")


def test_mark_roundtrip_sorted_by_time(conn, video):
    tree = store.create_analysis(conn, video["id"])
    take = tree["lanes"][0]["takes"][0]
    store.insert_mark(conn, take["id"], t_ms=500, kind="input", label="2")
    store.insert_mark(conn, take["id"], t_ms=100, kind="input", label="Q")
    fresh = store.get_analysis_tree(conn, tree["id"])
    marks = fresh["lanes"][0]["takes"][0]["marks"]
    assert [m["t_ms"] for m in marks] == [100, 500]
    assert marks[0]["provenance"] == "human_manual"


def test_mark_validation(conn, video):
    tree = store.create_analysis(conn, video["id"])
    take = tree["lanes"][0]["takes"][0]
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=-1, kind="input", label="2")
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=10, end_ms=5, kind="input", label="2")
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=10, kind="input")           # input 缺 label
    with pytest.raises(ValueError):
        store.insert_mark(conn, take["id"], t_ms=10, kind="release", label="F")  # 空标记带 label


def test_update_mark_sets_edited_provenance(conn, video):
    tree = store.create_analysis(conn, video["id"])
    take = tree["lanes"][0]["takes"][0]
    m = store.insert_mark(conn, take["id"], t_ms=100, kind="input", label="F")
    m2 = store.update_mark(conn, m["id"], end_ms=400)
    assert m2["end_ms"] == 400 and m2["provenance"] == "human_edited"


def test_new_take_increments_idx(conn, video):
    tree = store.create_analysis(conn, video["id"])
    lane = tree["lanes"][0]
    t2 = store.create_take(conn, lane["id"])
    assert t2["idx"] == 2


def test_tally_add_and_clear(conn, video):
    tree = store.create_analysis(conn, video["id"])
    store.add_tally(conn, tree["id"], 1000)
    store.add_tally(conn, tree["id"], 2000)
    assert len(store.get_analysis_tree(conn, tree["id"])["tally"]) == 2
    store.clear_tally(conn, tree["id"])
    assert store.get_analysis_tree(conn, tree["id"])["tally"] == []
