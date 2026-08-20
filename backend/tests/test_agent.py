from vd import agent
from vd.agent import RotationNaming

CAND = {"body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
        "occurrences": [[0, 1300]], "iterations": 3, "unit_len": 2,
        "token_offsets": [0]}
NAMES = {"sk_wh": "旋风连", "sk_fb": "火球术"}


class FakeResponse:
    stop_reason = "end_turn"
    parsed_output = RotationNaming(name="单体稳定输出", note="旋风接火球的填充循环",
                                   param_positions=[1])


class FakeMessages:
    def __init__(self, response=None, exc=None):
        self.response, self.exc, self.calls = response, exc, []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return self.response


class FakeClient:
    def __init__(self, response=None, exc=None):
        self.messages = FakeMessages(response, exc)


def test_describe_candidate_uses_names():
    text = agent.describe_candidate(CAND, NAMES)
    assert "旋风连" in text and "等待200ms" in text and "重复 3 次" in text


def test_name_candidate_success():
    fake = FakeClient(response=FakeResponse())
    r = agent.name_candidate(CAND, NAMES, client=fake)
    assert r == {"ok": True, "name": "单体稳定输出",
                 "note": "旋风接火球的填充循环", "param_positions": [1]}
    assert fake.messages.calls[0]["model"] == "claude-opus-5"
    assert fake.messages.calls[0]["output_format"] is RotationNaming


def test_name_candidate_refusal():
    resp = FakeResponse()
    resp.stop_reason = "refusal"
    r = agent.name_candidate(CAND, NAMES, client=FakeClient(response=resp))
    assert r["ok"] is False and "拒绝" in r["error"]


def test_name_candidate_exception_is_contained():
    r = agent.name_candidate(CAND, NAMES, client=FakeClient(exc=RuntimeError("网络炸了")))
    assert r["ok"] is False and "网络炸了" in r["error"]
