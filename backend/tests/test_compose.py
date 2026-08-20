from vd import agent
from vd.agent import PlaybookPlan, SectionPlan

ROTS = [{"id": "rot_1", "name": "单体稳定输出", "note": "主循环"},
        {"id": "rot_2", "name": "爆发循环", "note": ""}]


class FakeComposeResponse:
    stop_reason = "end_turn"
    parsed_output = PlaybookPlan(name="法师单体方案", sections=[
        SectionPlan(name="开场爆发", rotation_ids=["rot_2", "rot_ghost"]),
        SectionPlan(name="稳定输出", rotation_ids=[])])


class FakeMessages:
    def __init__(self, response=None, exc=None):
        self.response, self.exc = response, exc

    def parse(self, **kwargs):
        if self.exc:
            raise self.exc
        return self.response


class FakeComposeClient:
    def __init__(self, response=None, exc=None):
        self.messages = FakeMessages(response, exc)


def test_compose_success():
    r = agent.compose_playbook(ROTS, client=FakeComposeClient(FakeComposeResponse()))
    assert r["ok"] and r["name"] == "法师单体方案"
    assert r["sections"][0]["rotation_ids"] == ["rot_2", "rot_ghost"]


def test_compose_failure_contained():
    r = agent.compose_playbook(ROTS, client=FakeComposeClient(exc=RuntimeError("炸")))
    assert r["ok"] is False and "炸" in r["error"]
