"""真实 LLM 评测：uv run python -m vd.eval（需 ANTHROPIC_API_KEY 或 ant 登录态）。
CI 不跑这里；这是人工触发的 prompt 质量抽查（spec §11）。"""
import sys

from vd import agent

GOLDEN = [
    ({"body": [{"skill": "sk_wh"}, {"gap": 200, "tol": 40}, {"skill": "sk_fb"}],
      "occurrences": [[0, 1300]], "iterations": 6, "unit_len": 2,
      "token_offsets": [0]},
     {"sk_wh": "旋风连", "sk_fb": "火球术"}),
    ({"body": [{"skill": "sk_fb"}, {"gap": 1100, "tol": 60}],
      "occurrences": [[0, 1300]], "iterations": 12, "unit_len": 1,
      "token_offsets": [0]},
     {"sk_fb": "火球术"}),
]


def main() -> int:
    failures = 0
    for cand, names in GOLDEN:
        r = agent.name_candidate(cand, names)
        if r["ok"]:
            print(f"✓ {r['name']} — {r['note']}（参数位 {r['param_positions']}）")
        else:
            failures += 1
            print(f"✗ 失败：{r['error']}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
