"""黄金样例评测集（spec §11）。改 prompt、改匹配器、改发现算法都必须先过这里。"""


def test_golden_rotation_discovery_end_to_end(client, analysis, monkeypatch):
    from test_agent import FakeClient, FakeResponse
    from test_api import _seed_rotation_annotation
    from vd import api as api_module
    monkeypatch.setattr(api_module, "_agent_client", lambda: FakeClient(FakeResponse()))

    sk_wh, sk_fb = _seed_rotation_annotation(client, analysis)
    body = client.post(f"/api/analyses/{analysis['id']}/discover").json()

    assert body["proposals"], "黄金样例必须发现至少一个循环"
    best = max(body["proposals"], key=lambda p: p["report"]["coverage"])
    assert best["report"]["coverage"] >= 0.6, f"覆盖率退化：{best['report']}"
    skill_refs = [i["skill"] for i in best["payload"]["body"] if "skill" in i]
    assert sk_wh["id"] in skill_refs and sk_fb["id"] in skill_refs, \
        f"循环体应含旋风连与火球术：{best['payload']['body']}"
    assert best["report"]["iterations"] >= 2

    accepted = client.post(f"/api/proposals/{best['id']}/accept").json()
    assert accepted["rotation"]["derived_from"] == [analysis["id"]]
    assert client.get("/api/rotations").json()
