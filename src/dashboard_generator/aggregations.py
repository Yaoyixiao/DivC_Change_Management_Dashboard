"""对 load_payload() 返回的内存图做各种维度聚合。全部纯函数。

聚合产物会被注入到 __PAYLOAD__.aggregations，供前端模块消费。
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

# 状态颜色映射（与 manifest 实际状态一致；浅色主题下用饱和度更高的色调）
STATE_COLORS: dict[str, str] = {
    "ALM_Closed":     "#16a34a",  # 绿
    "ALM_Realized":   "#0891b2",  # 青
    "ALM_Initiated":  "#d97706",  # 琥珀
    "ALM_Defined":    "#64748b",  # 灰
    "ALM_Analysed":   "#8b5cf6",  # 紫
    "ALM_Started":    "#2563eb",  # 蓝
    "ALM_Checked":    "#65a30d",  # 橄榄
    "ALM_Rejected":   "#dc2626",  # 红
    "ALM_Cancelled":  "#991b1b",  # 暗红
    "ALM_Approved":   "#0d9488",  # 翠绿
    "ALM_Planned":    "#a16207",  # 棕
}

# 节点类型颜色（KPI / 树 / 柱状图共用）
NODE_COLORS: dict[str, str] = {
    "ra_op":            "#7c3aed",  # 紫
    "parent_op":        "#2563eb",  # 蓝
    "child_op":         "#06b6d4",  # 青
    "delivery":         "#f97316",  # 橙
    "change_request":   "#22c55e",  # 绿
    "build":            "#ec4899",  # 粉
}

# 成熟度颜色
MATURITY_COLORS: dict[str, str] = {
    "CAT 2": "#22c55e",
    "CAT 3": "#84cc16",
    "CAT 4": "#f59e0b",
    "CAT 5": "#ef4444",
    "Not Applicable": "#94a3b8",
    "": "#cbd5e1",
}

# 视为"已闭环"的状态集合（业务定义：已 dispositioned，无论 pass/fail）
# Open  = Initiated/Defined/Analysed/Checked/Started/Planned
# Closed = Closed/Realized/Approved/Rejected/Cancelled
OPEN_STATES: frozenset[str] = frozenset({
    "ALM_Initiated", "ALM_Defined", "ALM_Analysed", "ALM_Checked",
    "ALM_Started",   "ALM_Planned",
})
CLOSED_STATES: frozenset[str] = frozenset({
    "ALM_Closed",   "ALM_Realized", "ALM_Approved",
    "ALM_Rejected", "ALM_Cancelled",
})


# ---------- KPI ----------

def compute_kpis(payload: dict[str, Any]) -> dict[str, Any]:
    counts = {k: len(payload[k]) for k in [
        "ra_ops", "parent_ops", "child_ops",
        "deliveries", "change_requests", "builds",
    ]}
    parent_closed = sum(1 for r in payload["parent_ops"] if r["state"] in CLOSED_STATES)
    cr_closed     = sum(1 for r in payload["change_requests"] if r["state"] in CLOSED_STATES)
    child_closed  = sum(1 for r in payload["child_ops"] if r["state"] in CLOSED_STATES)
    closure_rate  = round(100 * parent_closed / max(counts["parent_ops"], 1), 1)

    cr_per_child   = counts["change_requests"] / max(counts["child_ops"], 1)
    builds_per_cr  = len(payload["edges"]["cr_to_build"]) / max(counts["change_requests"], 1)

    # 进行中：状态不在 CLOSED_STATES 也不在 REJECTED/CANCELLED 的 child_op
    active_states = CLOSED_STATES | {"ALM_Rejected", "ALM_Cancelled"}
    in_progress = sum(1 for r in payload["child_ops"] if r["state"] not in active_states)

    return {
        "counts": counts,
        "closure_rate_percent": closure_rate,
        "closed": {
            "parent_ops":       parent_closed,
            "child_ops":        child_closed,
            "change_requests":  cr_closed,
        },
        "in_progress_child_ops": in_progress,
        "avg_links": {
            "change_requests_per_child_op":  round(cr_per_child, 2),
            "builds_per_change_request":     round(builds_per_cr, 2),
        },
    }


def compute_opened_closed_rates(payload: dict[str, Any]) -> dict[str, dict[str, int | float]]:
    """按新业务分类（Open/Closed）计算 child_op 与 change_request 的关闭率。

    Returns
    -------
    {
      "child_op": {total, open, closed, closed_percent},
      "change_request": {total, open, closed, closed_percent},
    }
    """
    def _bucket(records):
        total = len(records)
        closed = sum(1 for r in records if r.get("state") in CLOSED_STATES)
        open_  = sum(1 for r in records if r.get("state") in OPEN_STATES)
        pct    = round(100 * closed / max(total, 1), 1)
        return {"total": total, "open": open_, "closed": closed, "closed_percent": pct}

    return {
        "child_op":        _bucket(payload["child_ops"]),
        "change_request":  _bucket(payload["change_requests"]),
    }


# ---------- 分布 ----------

def _dist(records: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    """Counter((r.get(key) or "(empty)")) → [{key, count}, ...] 按 count 倒序。"""
    c = Counter(r.get(key) or "(empty)" for r in records)
    return [{"key": k, "count": v} for k, v in c.most_common()]


def compute_state_distributions(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {
        "parent_ops":      _dist(payload["parent_ops"], "state"),
        "child_ops":       _dist(payload["child_ops"], "state"),
        "change_requests": _dist(payload["change_requests"], "state"),
    }


def compute_project_distributions(payload: dict[str, Any], top_n: int = 12) -> dict[str, Any]:
    """对 5 类实体按 project 维度的 Top-N + Other 计数。"""
    kinds = ["parent_ops", "child_ops", "change_requests", "deliveries", "builds"]
    out: dict[str, Any] = {}
    for kind in kinds:
        records = payload[kind]
        total = len(records)
        c: Counter = Counter(r.get("project") or "(empty)" for r in records)
        top = c.most_common(top_n)
        top_sum = sum(v for _, v in top)
        other = max(total - top_sum, 0)
        out[kind] = {
            "top": [{"project": k, "count": v} for k, v in top],
            "other_count": other,
            "total": total,
        }
    return out


def compute_build_maturity(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return _dist(payload["builds"], "maturity_level")


# ---------- 时间线 ----------

def compute_delivery_timeline(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """交付件的 target_date 按 YYYY-MM 聚合，按时间升序。"""
    c: Counter = Counter()
    for d in payload["deliveries"]:
        ym = (d.get("target_date") or "")[:7]
        if ym:
            c[ym] += 1
    return [{"month": k, "count": v} for k, v in sorted(c.items())]


def compute_build_target_timeline(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """构建的 target_date 按 YYYY-MM 聚合。"""
    c: Counter = Counter()
    for b in payload["builds"]:
        ym = (b.get("target_date") or "")[:7]
        if ym:
            c[ym] += 1
    return [{"month": k, "count": v} for k, v in sorted(c.items())]


# ---------- Owner / Team 排行 ----------

def _split_owners(owners_field: str) -> list[str]:
    return [s.strip() for s in (owners_field or "").split(",") if s.strip()]


def compute_owner_rank(payload: dict[str, Any], top: int = 20) -> list[dict[str, Any]]:
    """Owner 名下的 CR 数量排行。一个 CR 多 owner 时每个 owner 各 +1。"""
    c: Counter = Counter()
    for cr in payload["change_requests"]:
        for o in _split_owners(cr.get("owners") or ""):
            c[o] += 1
    return [{"owner": k, "count": v} for k, v in c.most_common(top)]


def compute_team_rank(payload: dict[str, Any], top: int = 20) -> list[dict[str, Any]]:
    c: Counter = Counter()
    for cr in payload["change_requests"]:
        t = (cr.get("team") or "").strip()
        if t:
            c[t] += 1
    return [{"team": k, "count": v} for k, v in c.most_common(top)]


# ---------- Child OP × Project × State 矩阵 ----------

def compute_child_op_by_project_state(
    payload: dict[str, Any],
) -> dict[str, Any]:
    """大柱状图数据（全部项目各自成柱，不归并 Other；前端横向滚动查看）。

    Returns
    -------
    {
      "projects":  [...],                # 行顺序：按 total 倒序
      "states":    [...],                # 列顺序：按全局该 state 出现次数倒序
      "matrix":    [[c00, c01, ...],     # shape = (len(projects), len(states))
                    ...
                   ],
      "totals":    [...],                # 每行总数
      "top_n":     12,
    }
    """
    child_ops = payload["child_ops"]
    project_counts = Counter(r.get("project") or "(empty)" for r in child_ops)
    # 每个项目独立成柱，不再截断 / 归并 "__other__"
    projects_all = [p for p, _ in project_counts.most_common()]

    matrix_rows: dict[str, Counter] = {p: Counter() for p in projects_all}
    for r in child_ops:
        p = r.get("project") or "(empty)"
        s = r.get("state") or "(empty)"
        matrix_rows[p][s] += 1

    # 行顺序：按该项目的 Child OP 总数倒序
    projects_sorted = sorted(
        projects_all,
        key=lambda p: sum(matrix_rows[p].values()),
        reverse=True,
    )

    # 列顺序：按所有项目该 state 总数倒序（稳定图例位置）
    state_totals: Counter = Counter()
    for row in matrix_rows.values():
        state_totals.update(row)
    states_sorted = [s for s, _ in state_totals.most_common()]

    matrix = [
        [row.get(s, 0) for s in states_sorted]
        for row in (matrix_rows[p] for p in projects_sorted)
    ]
    totals = [sum(matrix_rows[p].values()) for p in projects_sorted]

    return {
        "projects": projects_sorted,
        "states":   states_sorted,
        "matrix":   matrix,
        "totals":   totals,
    }


# ---------- RA-OP 时间：优先用自身 created_date，缺失时退回子树最早 target_date 代理 ----------

def compute_ra_op_time(payload: dict[str, Any]) -> dict[int, str | None]:
    """对每个 RA-OP，优先取 DB 中的 created_date；缺失（旧库）时从其
    5 层子树（child_op → delivery / change_request → build）收集 target_date
    取最小值作为「RA-OP effective start」的近似。

    返回：{ ra_op_id (int): "YYYY-MM-DD" 或 None }。
    """
    # child_op → [delivery_id]
    child_to_del: dict[int, list[int]] = defaultdict(list)
    for e in payload["edges"]["related_to_delivery"]:
        child_to_del[e["related_id"]].append(e["delivery_id"])
    # child_op → [cr_id]
    child_to_cr: dict[int, list[int]] = defaultdict(list)
    for e in payload["edges"]["related_to_cr"]:
        child_to_cr[e["related_id"]].append(e["change_request_id"])
    # cr → [build_id]
    cr_to_b: dict[int, list[int]] = defaultdict(list)
    for e in payload["edges"]["cr_to_build"]:
        cr_to_b[e["change_request_id"]].append(e["build_id"])
    # id → target_date
    del_date: dict[int, str | None] = {d["id"]: d.get("target_date") for d in payload["deliveries"]}
    build_date: dict[int, str | None] = {}
    for b in payload["builds"]:
        build_date[b["id"]] = b.get("target_date") or b.get("planned_completion_date")
    # ra_op → [child_id]
    ra_to_children: dict[int, list[int]] = defaultdict(list)
    for e in payload["edges"]["ra_to_child"]:
        ra_to_children[e["ra_op_id"]].append(e["child_op_id"])

    result: dict[int, str | None] = {}
    for ra in payload["ra_ops"]:
        created = ra.get("created_date")
        if isinstance(created, str) and len(created) >= 10:
            result[ra["id"]] = created
            continue
        dates: list[str] = []
        for cid in ra_to_children.get(ra["id"], []):
            for did in child_to_del.get(cid, []):
                d = del_date.get(did)
                if d: dates.append(d)
            for crid in child_to_cr.get(cid, []):
                for bid in cr_to_b.get(crid, []):
                    d = build_date.get(bid)
                    if d: dates.append(d)
        valid = [d for d in dates if isinstance(d, str) and len(d) >= 10]
        result[ra["id"]] = min(valid) if valid else None
    return result


# ---------- 入口 ----------

def compute_all_aggregations(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "kpis":                      compute_kpis(payload),
        "opened_closed_rates":       compute_opened_closed_rates(payload),
        "state_distributions":       compute_state_distributions(payload),
        "project_distributions":     compute_project_distributions(payload),
        "build_maturity":            compute_build_maturity(payload),
        "delivery_timeline":         compute_delivery_timeline(payload),
        "build_target_timeline":     compute_build_target_timeline(payload),
        "owner_rank":                compute_owner_rank(payload),
        "team_rank":                 compute_team_rank(payload),
        "child_op_by_project_state": compute_child_op_by_project_state(payload),
        "ra_op_time":                compute_ra_op_time(payload),
        "state_colors":              STATE_COLORS,
        "node_colors":               NODE_COLORS,
        "maturity_colors":           MATURITY_COLORS,
        "open_states":               list(OPEN_STATES),
        "closed_states":             list(CLOSED_STATES),
    }


if __name__ == "__main__":
    # CLI 自检：python -m dashboard_generator.aggregations
    from data_loader import load_payload
    import json

    p = load_payload()
    aggs = compute_all_aggregations(p)
    print(json.dumps(
        {
            "kpis": aggs["kpis"],
            "child_op_by_project_state_keys":
                list(aggs["child_op_by_project_state"].keys()),
            "child_op_by_project_state_shape":
                [len(aggs["child_op_by_project_state"]["projects"]),
                 len(aggs["child_op_by_project_state"]["states"])],
            "top_owner": aggs["owner_rank"][:3],
            "delivery_timeline_range":
                [aggs["delivery_timeline"][0]["month"] if aggs["delivery_timeline"] else None,
                 aggs["delivery_timeline"][-1]["month"] if aggs["delivery_timeline"] else None],
        },
        ensure_ascii=False,
        indent=2,
    ))