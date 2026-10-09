"""Full-snapshot aggregations for the new-schema payload (items/edges era).

These are the UNFILTERED baselines for the five Home bento cards
(dashboard-content.md §3). The frontend recomputes every card from the
current filtered result set (§3.1) and, with no filters active, the card
values must equal these payload aggregations value-for-value
(Handoff/workflow.md §4 invariant #3 — that equality is the self-check).

Also emits the CLOSED state set actually used by the generator so debugging
and the frontend share one dichotomy: ALM_Completed is CLOSED (decision #14).
"""
from __future__ import annotations

from typing import Any

from .data_loader import CLOSED_STATES, num

TOP_TEAMS = 5  # Effort-by-Team card folds beyond the top N into "Other"


def _wi_with_own_effort(items: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """Card scope (#12): work items carrying an own planned_effort value.
    Actions are excluded (their effort fill rate is 4%); rows without own
    effort stay out of the sums but still exist for the frontend recompute."""
    return [it for it in items.values()
            if it["kind"] == "work_item" and num(it["planned_effort"]) is not None]


def compute_counts(items: dict[int, dict[str, Any]]) -> dict[str, int]:
    """Totals card: entity-deduped kind counts (a shared WI counts once,
    matching the manifest), not edge counts."""
    counts = {"ecr": 0, "work_item": 0, "action": 0, "build": 0}
    for it in items.values():
        if it["kind"] in counts:
            counts[it["kind"]] += 1
    return counts


def compute_effort_totals(ecrs: list[dict[str, Any]]) -> dict[str, int]:
    """Effort card: sum of ECR rollup fields only (ECR-level rollups are 100%
    filled; per-WI effort is not comparable across trees)."""
    return {
        "plannedTotal": round(sum(e["planned"] or 0 for e in ecrs)),
        "actualTotal": round(sum(e["actual"] or 0 for e in ecrs)),
    }


def compute_by_process_area(items: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """Effort-by-Process-Area card: own WI planned effort grouped by the
    derived process_area, descending, "Other" sinks last. Mirrors the
    mockup's rounding (per-item round, then group sum)."""
    groups: dict[str, int] = {}
    for it in _wi_with_own_effort(items):
        k = it["process_area"] or "Other"
        groups[k] = groups.get(k, 0) + round(num(it["planned_effort"]))
    rows = [{"name": k, "value": v}
            for k, v in sorted(groups.items(), key=lambda kv: -kv[1])]
    return ([r for r in rows if r["name"] != "Other"]
            + [r for r in rows if r["name"] == "Other"])


def compute_by_team(items: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    """Effort-by-Team card: same scope, top N teams + folded "Other"."""
    groups: dict[str, float] = {}
    for it in _wi_with_own_effort(items):
        k = it["team"] or "Other"
        groups[k] = groups.get(k, 0.0) + num(it["planned_effort"])
    ranked = sorted(groups.items(), key=lambda kv: -kv[1])
    rows = [{"name": k, "value": round(v)} for k, v in ranked[:TOP_TEAMS]]
    if ranked[TOP_TEAMS:]:
        rows.append({"name": "Other",
                     "value": round(sum(v for _, v in ranked[TOP_TEAMS:]))})
    return rows


def compute_all_aggregations(payload: dict[str, Any]) -> dict[str, Any]:
    """Entry point consumed by generate_dashboard.py -> __PAYLOAD__.aggregations."""
    items = payload["items"]
    ecrs = payload["ecrs"]
    totals = compute_effort_totals(ecrs)
    observed = {it.get("state") for it in items.values() if it.get("state")}
    return {
        "counts": compute_counts(items),
        "plannedTotal": totals["plannedTotal"],
        "actualTotal": totals["actualTotal"],
        "byProcessArea": compute_by_process_area(items),
        "byTeam": compute_by_team(items),
        # dichotomy definition + observed open states (debugging aid)
        "closed_states": sorted(CLOSED_STATES),
        "open_states": sorted(s for s in observed if s not in CLOSED_STATES),
    }


if __name__ == "__main__":
    # CLI self-check: python -m dashboard_generator.aggregations
    import json
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from dashboard_generator.data_loader import load_payload

    print(json.dumps(compute_all_aggregations(load_payload()),
                     indent=2, ensure_ascii=False))
