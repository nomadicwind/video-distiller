from statistics import median, quantiles


def _iqr(values: list[int]) -> int:
    if len(values) < 2:
        return 0
    q = quantiles(values, n=4, method="inclusive")
    return round(q[2] - q[0])


def aggregate_lane(takes: list[list[dict]], window_ms: int = 300) -> dict:
    """多 Take 聚合（spec §7.2a）：多数派产出稳健时序，少数派永不静默丢弃。"""
    n = len(takes)
    groups: dict[tuple, list[tuple[int, dict]]] = {}
    for idx, marks in enumerate(takes):
        for m in marks:
            groups.setdefault((m["kind"], m["label"]), []).append((idx, m))

    aggregated: list[dict] = []
    minority: list[dict] = []
    for (kind, label), members in groups.items():
        members.sort(key=lambda x: x[1]["t_ms"])
        clusters: list[list[tuple[int, dict]]] = []
        for idx, m in members:
            cur = clusters[-1] if clusters else None
            if (cur is None
                    or m["t_ms"] - cur[-1][1]["t_ms"] > window_ms
                    or any(i == idx for i, _ in cur)):
                clusters.append([(idx, m)])
            else:
                cur.append((idx, m))
        for cluster in clusters:
            ts = [m["t_ms"] for _, m in cluster]
            ends = [m["end_ms"] for _, m in cluster if m["end_ms"] is not None]
            item = {
                "kind": kind,
                "label": label,
                "t_ms": round(median(ts)),
                "end_ms": round(median(ends)) if len(ends) * 2 > len(cluster) else None,
                "iqr_ms": _iqr(ts),
                "support": len(cluster) / n,
                "take_idxs": sorted(i for i, _ in cluster),
            }
            (aggregated if len(cluster) * 2 > n else minority).append(item)

    aggregated.sort(key=lambda x: x["t_ms"])
    minority.sort(key=lambda x: x["t_ms"])
    return {"n_takes": n, "aggregated": aggregated, "minority": minority}
