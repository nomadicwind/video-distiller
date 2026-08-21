"""LLM 命名与解释（spec §7.3 解释与命名步）。纯函数：失败返回错误、无副作用（spec §10）。
只发送 IR 文本与 Catalog 名称，绝不发送画面（spec §7.1）。"""
import json
import os
import shutil
import subprocess

import anthropic
from pydantic import BaseModel

from vd.config import data_root

MODEL = "claude-opus-5"

SYSTEM = (
    "你是动作游戏攻略专家。给你一个从操作录像里发现的重复循环"
    "（技能/按键序列与节奏统计），请给它起一个简短贴切的中文名字（不超过 8 个字），"
    "写一句玩家能读懂的说明，并给出 body 中适合作为可替换参数的位置下标"
    "（0 起，按含 gap 在内的 body 数组下标）。没有合适的参数位就给空列表。"
)

COMPOSE_SYSTEM = (
    "你是动作游戏攻略专家。给你一组已确认的循环（rotation），"
    "请把它们编排成一个完整打法方案：给方案起名（≤10字），"
    "分成若干命名段落（如 开场爆发/稳定输出/收尾），"
    "每段列出该段使用的 rotation id（按执行顺序）。"
    "只能使用给定的 id，不要发明新的。"
)


class RotationNaming(BaseModel):
    name: str
    note: str
    param_positions: list[int]


def _resolve_backend() -> str | None:
    """决定本次调用走哪个 LLM 后端。

    解析顺序：VD_LLM 显式指定优先生效（"off"→None，"api"/"claude-cli"→原样，
    强制生效时不校验对应后端是否真的可用——不可用则由调用处自然失败并降级）；
    未显式指定时自动探测：有 ANTHROPIC_API_KEY→"api"，否则有 claude CLI→
    "claude-cli"，都没有→None。
    """
    forced = os.environ.get("VD_LLM")
    if forced == "off":
        return None
    if forced in ("api", "claude-cli"):
        return forced
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "api"
    if shutil.which("claude"):
        return "claude-cli"
    return None


def _model_field_hint(model: type[BaseModel]) -> str:
    """给 CLI 提示词用的一行字段说明，来自 Pydantic JSON schema。"""
    schema = model.model_json_schema()
    props = schema.get("properties", {})
    parts = [f"{name}:{info.get('type') or info.get('$ref', 'any')}"
             for name, info in props.items()]
    return f"{model.__name__} {{{', '.join(parts)}}}"


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _cli_generate(prompt: str, timeout_s: int = 120) -> str:
    """调用 claude CLI 生成文本。成功返回 result 正文（已剥围栏与首尾空白）；
    一切失败（非零退出/超时/stdout 非 JSON/信封标记错误）raise RuntimeError。"""
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "json"],
            capture_output=True, text=True, timeout=timeout_s,
            cwd=str(data_root()),
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"claude CLI 超时：{e}") from e
    except OSError as e:
        raise RuntimeError(f"claude CLI 启动失败：{e}") from e

    if proc.returncode != 0:
        raise RuntimeError(f"claude CLI 退出码非零：{proc.returncode}")

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"claude CLI 输出非 JSON：{e}") from e

    if envelope.get("is_error") or envelope.get("subtype") != "success":
        raise RuntimeError(f"claude CLI 返回失败信封：{envelope}")

    return _strip_fences(envelope.get("result", ""))


def describe_candidate(candidate: dict, skill_names: dict[str, str]) -> str:
    parts = []
    for item in candidate["body"]:
        if "skill" in item:
            parts.append(skill_names.get(item["skill"], item["skill"]))
        elif "gap" in item:
            parts.append(f"等待{item['gap']}ms±{item['tol']}")
        else:
            parts.append(f"{item['op']} {item.get('key', '')}".strip())
    return (f"循环体：[{' → '.join(parts)}]，"
            f"在录像中连续重复 {candidate['iterations']} 次。")


def name_candidate(candidate: dict, skill_names: dict[str, str],
                   client=None) -> dict:
    try:
        # 显式注入 client（测试专用）始终走 api 路径，不参与后端解析——
        # 保证既有 FakeLLM 测试与本机环境（例如恰好装了 claude CLI）无关。
        backend = "api" if client is not None else _resolve_backend()
        if backend is None:
            raise RuntimeError("未配置 LLM 后端（API key 或 claude CLI 均不可用）")
        if backend == "api":
            client = client or anthropic.Anthropic()
            response = client.messages.parse(
                model=MODEL,
                max_tokens=2048,
                system=SYSTEM,
                messages=[{"role": "user",
                           "content": describe_candidate(candidate, skill_names)}],
                output_format=RotationNaming,
            )
            if response.stop_reason == "refusal":
                return {"ok": False, "error": "LLM 拒绝了该请求"}
            p = response.parsed_output
        else:  # claude-cli
            prompt = (
                f"{SYSTEM}\n\n"
                f"{describe_candidate(candidate, skill_names)}\n\n"
                "只输出一个符合下述结构的 JSON 对象，不要输出任何其他文字："
                f"{_model_field_hint(RotationNaming)}"
            )
            data = json.loads(_cli_generate(prompt))
            p = RotationNaming.model_validate(data)
        return {"ok": True, "name": p.name, "note": p.note,
                "param_positions": p.param_positions}
    except Exception as e:  # noqa: BLE001 —— agent 失败必须被包住（spec §10）
        return {"ok": False, "error": str(e)}


class SectionPlan(BaseModel):
    name: str
    rotation_ids: list[str]


class PlaybookPlan(BaseModel):
    name: str
    sections: list[SectionPlan]


def compose_playbook(rotations: list[dict], client=None) -> dict:
    """LLM 方案编排（spec §7.2f）。只发文本；失败无副作用（spec §10）。"""
    desc = "\n".join(f"- {r['id']}：{r['name']}" + (f"（{r['note']}）" if r.get("note") else "")
                     for r in rotations)
    try:
        # 显式注入 client（测试专用）始终走 api 路径，不参与后端解析——
        # 保证既有 FakeLLM 测试与本机环境（例如恰好装了 claude CLI）无关。
        backend = "api" if client is not None else _resolve_backend()
        if backend is None:
            raise RuntimeError("未配置 LLM 后端（API key 或 claude CLI 均不可用）")
        if backend == "api":
            client = client or anthropic.Anthropic()
            response = client.messages.parse(
                model=MODEL,
                max_tokens=2048,
                system=COMPOSE_SYSTEM,
                messages=[{"role": "user", "content": f"可用循环：\n{desc}"}],
                output_format=PlaybookPlan,
            )
            if response.stop_reason == "refusal":
                return {"ok": False, "error": "LLM 拒绝了该请求"}
            plan = response.parsed_output
        else:  # claude-cli
            prompt = (
                f"{COMPOSE_SYSTEM}\n\n"
                f"可用循环：\n{desc}\n\n"
                "只输出一个符合下述结构的 JSON 对象，不要输出任何其他文字："
                f"{_model_field_hint(PlaybookPlan)}"
            )
            data = json.loads(_cli_generate(prompt))
            plan = PlaybookPlan.model_validate(data)
        return {"ok": True, "name": plan.name,
                "sections": [{"name": s.name, "rotation_ids": s.rotation_ids}
                             for s in plan.sections]}
    except Exception as e:  # noqa: BLE001 —— agent 失败必须被包住（spec §10）
        return {"ok": False, "error": str(e)}
