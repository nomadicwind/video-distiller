import json
import subprocess

import pytest

from vd import agent

CAND = {"body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
        "occurrences": [[0, 1300]], "iterations": 3, "unit_len": 2,
        "token_offsets": [0]}
NAMES = {"sk_wh": "旋风连", "sk_fb": "火球术"}

ROTS = [{"id": "rot_1", "name": "单体稳定输出", "note": "主循环"},
        {"id": "rot_2", "name": "爆发循环", "note": ""}]


class FakeCompleted:
    def __init__(self, stdout, returncode=0):
        self.stdout = stdout
        self.returncode = returncode
        self.stderr = ""


def _envelope(result: str, ok=True):
    return json.dumps({
        "is_error": not ok, "subtype": "success" if ok else "error_during_execution",
        "result": result,
    })


def test_resolve_backend_order(monkeypatch):
    monkeypatch.delenv("VD_LLM", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-x")
    assert agent._resolve_backend() == "api"
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(agent.shutil, "which", lambda _: "/usr/local/bin/claude")
    assert agent._resolve_backend() == "claude-cli"
    monkeypatch.setattr(agent.shutil, "which", lambda _: None)
    assert agent._resolve_backend() is None
    monkeypatch.setenv("VD_LLM", "off")
    assert agent._resolve_backend() is None
    monkeypatch.setenv("VD_LLM", "claude-cli")
    assert agent._resolve_backend() == "claude-cli"


def test_cli_generate_strips_fences(monkeypatch):
    payload = '```json\n{"name":"剑势连击","note":null}\n```'
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope(payload)))
    assert json.loads(agent._cli_generate("x")) == {"name": "剑势连击", "note": None}


def test_cli_generate_envelope_error(monkeypatch):
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope("boom", ok=False)))
    with pytest.raises(RuntimeError):
        agent._cli_generate("x")


def test_cli_generate_nonzero_exit(monkeypatch):
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope("boom"), returncode=1))
    with pytest.raises(RuntimeError):
        agent._cli_generate("x")


def test_cli_generate_bad_stdout_json(monkeypatch):
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted("这不是信封 JSON"))
    with pytest.raises(RuntimeError):
        agent._cli_generate("x")


def test_cli_generate_timeout(monkeypatch):
    def boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="claude", timeout=120)
    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(RuntimeError):
        agent._cli_generate("x")


def test_name_candidate_via_cli(monkeypatch):
    monkeypatch.setenv("VD_LLM", "claude-cli")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeCompleted(
        _envelope('{"name":"剑势连击","note":"起手段","param_positions":[1]}')))
    out = agent.name_candidate(CAND, NAMES)
    assert out["ok"] and out["name"] == "剑势连击"
    assert out["note"] == "起手段"
    assert out["param_positions"] == [1]


def test_name_candidate_cli_bad_json_degrades(monkeypatch):
    monkeypatch.setenv("VD_LLM", "claude-cli")
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope("这不是 JSON")))
    out = agent.name_candidate(CAND, NAMES)
    assert out["ok"] is False and "error" in out


def test_no_backend_degrades(monkeypatch):
    monkeypatch.delenv("VD_LLM", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(agent.shutil, "which", lambda _: None)
    out = agent.name_candidate(CAND, NAMES)
    assert out["ok"] is False
    assert "LLM 后端" in out["error"]


def test_compose_via_cli(monkeypatch):
    monkeypatch.setenv("VD_LLM", "claude-cli")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: FakeCompleted(_envelope(
        '{"name":"法师单体方案","sections":[{"name":"开场爆发","rotation_ids":["rot_2"]}]}'
    )))
    out = agent.compose_playbook(ROTS)
    assert out["ok"] and out["name"] == "法师单体方案"
    assert out["sections"] == [{"name": "开场爆发", "rotation_ids": ["rot_2"]}]


def test_compose_cli_bad_json_degrades(monkeypatch):
    monkeypatch.setenv("VD_LLM", "claude-cli")
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(_envelope("这不是 JSON")))
    out = agent.compose_playbook(ROTS)
    assert out["ok"] is False and "error" in out
