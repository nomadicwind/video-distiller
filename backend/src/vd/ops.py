"""标注 marks → 操作流（spec §3.2 操作流表示）。纯函数，不依赖 store/api。"""


def marks_to_ops(marks: list[dict]) -> list[dict]:
    ops = []
    for m in marks:
        if m["kind"] == "release":
            continue  # 空标记只充当 hold 终点，自身不产生操作（spec §6.3）
        label = m["label"] or ""
        if m.get("end_ms") is not None:
            kind = "hold"
        elif label == "Wheel":
            kind = "wheel"
        elif "+" in label:
            kind = "chord"
        else:
            kind = "tap"
        op = {"kind": kind, "key": label, "t_ms": m["t_ms"],
              "end_ms": m.get("end_ms"),
              "source": [m["id"]] if "id" in m else []}
        if kind == "chord":
            op["keys"] = sorted(label.split("+"))
        ops.append(op)
    return ops
