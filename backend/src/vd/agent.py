"""LLM 命名与解释（spec §7.3 解释与命名步）。纯函数：失败返回错误、无副作用（spec §10）。
只发送 IR 文本与 Catalog 名称，绝不发送画面（spec §7.1）。"""
import anthropic
from pydantic import BaseModel

MODEL = "claude-opus-5"

SYSTEM = (
    "你是动作游戏攻略专家。给你一个从操作录像里发现的重复循环"
    "（技能/按键序列与节奏统计），请给它起一个简短贴切的中文名字（不超过 8 个字），"
    "写一句玩家能读懂的说明，并给出 body 中适合作为可替换参数的位置下标"
    "（0 起，按含 gap 在内的 body 数组下标）。没有合适的参数位就给空列表。"
)


class RotationNaming(BaseModel):
    name: str
    note: str
    param_positions: list[int]


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
    client = client or anthropic.Anthropic()
    try:
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
        return {"ok": True, "name": p.name, "note": p.note,
                "param_positions": p.param_positions}
    except Exception as e:  # noqa: BLE001 —— agent 失败必须被包住（spec §10）
        return {"ok": False, "error": str(e)}
