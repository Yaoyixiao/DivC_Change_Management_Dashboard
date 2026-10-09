"""Load the ECR snapshot from dashboard.db into the dashboard payload.

Reads the three tables written by the fetch chain (items / edges / metadata —
Handoff/data-pipeline.md §5.1) and builds the JSON-serializable payload the
frontend consumes. Entity/field shapes follow the locked content spec
(Handoff/dashboard-content.md §3–§6); .zcode/mockup_build.py is the reference
implementation mirrored here (it injects the same shapes into the design
mockup).

Payload shape
-------------
{
  "meta":   {schema_version, generated_at, config_file, root_item_ids},
  "ecrs":   [nested ECR trees: children (WI L0-L2) + actions, #27 effort rule],
  "builds": [drawer-only build entries (#39)],
  "items":  {id -> full raw item row (drawer full-field sheet, #9);
             the two garbage overdue_* columns are dropped (§7 rule 2)},
  "graph":  {nodes (incl. teamDist/paDist/level/effort), edges by relation,
             generatedAt},
}

`overdue` is intentionally NOT baked in: the locked rule (§7 rule 2) says the
frontend computes it itself (planned_completion_date < generated_at AND open),
so the generator stays out of that decision.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from typing import Any, Callable

SRC = Path(__file__).resolve().parent.parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from config import DATABASE_PATH  # noqa: E402

# Status dichotomy (dashboard-content.md §7 rule 1): ALM_Completed is CLOSED —
# 99/129 work items carry it, missing it would flip the whole dashboard open.
CLOSED_STATES = frozenset({
    "ALM_Closed", "ALM_Realized", "ALM_Rejected", "ALM_Cancelled", "ALM_Completed",
})
CR_TYPE = "ALM_Change Request"

# Columns the payload construction itself depends on. The full schema stays
# dynamic (driven by ECR_Config.xlsx); this is only the generator's own
# contract with the DB, checked so a wrong/old DB fails with a clear error.
REQUIRED_COLUMNS = (
    "id", "kind", "level", "process_area", "type", "summary", "state",
    "owners", "created_date", "closed_date", "planned_completion_date",
    "target_date", "analysis_target_date", "team", "project",
    "classification", "maturity_level", "planned_effort",
    "rollup_planned_effort", "rollup_actual_effort",
)
# Locked rule (§7 rule 2): upstream date bug makes these garbage — never ship.
DROPPED_COLUMNS = ("overdue_planned_completion_date", "overdue_first_build_date")

RELATIONS = ("work_items", "actions", "work_item_for")

Items = dict[int, dict[str, Any]]
Children = dict[int, list[int]]


def _is_open(state: str | None) -> bool:
    return state not in CLOSED_STATES


def num(v: Any) -> float | None:
    """Coerce TEXT-typed numeric columns (effort, durations) to float/None."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def display_effort(it: dict[str, Any]) -> float | None:
    """Planned-effort display rule (#27): Change Request items carry no own
    effort in PTC (own value always 0), so they show the rollup; everything
    else shows its own planned effort, falling back to the rollup when the
    own value is empty. `planned` keeps the raw own value for the card /
    scoped aggregations — the two fields must not be mixed up."""
    own, rollup = num(it["planned_effort"]), num(it["rollup_planned_effort"])
    if it["type"] == CR_TYPE:
        return rollup
    return own if own is not None else rollup


def _validate_columns(con: sqlite3.Connection, db_path: Path) -> None:
    cur = con.execute("SELECT * FROM items LIMIT 0")
    cols = {d[0] for d in cur.description}
    missing = [c for c in REQUIRED_COLUMNS if c not in cols]
    if missing:
        raise ValueError(
            f"{db_path}: items table is missing required columns {missing}. "
            "This does not look like a dashboard.db produced by the current "
            "fetch chain (see Handoff/data-pipeline.md §5.1)."
        )


def load_payload(db_path: str | Path = DATABASE_PATH) -> dict[str, Any]:
    """Read dashboard.db -> JSON-serializable payload (see module docstring)."""
    db_path = Path(db_path)
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    try:
        _validate_columns(con, db_path)
        items: Items = {
            r["id"]: dict(r) for r in con.execute("SELECT * FROM items ORDER BY id")
        }
        edge_rows = list(con.execute(
            "SELECT relation, parent_id, child_id FROM edges ORDER BY parent_id, child_id"
        ))
        children_of: Children = {}
        for r in edge_rows:
            children_of.setdefault(r["parent_id"], []).append(r["child_id"])
        meta = dict(con.execute("SELECT key, value FROM metadata").fetchall())
    finally:
        con.close()

    generated_at = meta.get("generated_at") or ""
    return {
        "meta": meta,
        "ecrs": [_ecr_entry(items, children_of, it)
                 for it in items.values() if it["kind"] == "ecr"],
        "builds": [_build_entry(it) for it in items.values() if it["kind"] == "build"],
        "items": {iid: {k: v for k, v in row.items() if k not in DROPPED_COLUMNS}
                  for iid, row in items.items()},
        "graph": _build_graph(items, children_of, edge_rows, generated_at),
    }


def _wi_node(items: Items, children_of: Children, node_id: int) -> dict[str, Any]:
    """Work-item subtree node: WI children only (actions/builds hang off the
    ECR side); shared WIs appear under every referencing ECR here — the graph
    payload dedupes them instead (decision #35)."""
    it = items[node_id]
    kids = [c for c in children_of.get(node_id, [])
            if c in items and items[c]["kind"] == "work_item"]
    return {
        "id": node_id,
        "summary": it["summary"],
        "state": it["state"],
        "open": _is_open(it["state"]),
        "type": it["type"],
        "planned": num(it["planned_effort"]),
        "rollupPlanned": num(it["rollup_planned_effort"]),
        "effort": display_effort(it),
        "plannedCompletion": it["planned_completion_date"] or None,
        "created": it["created_date"] or None,
        "closed": it["closed_date"] or None,
        "owners": it["owners"] or None,
        "project": it["project"] or None,
        "team": it["team"] or None,
        "processArea": it["process_area"] or None,
        "children": [_wi_node(items, children_of, k) for k in kids],
    }


def _ecr_entry(items: Items, children_of: Children, it: dict[str, Any]) -> dict[str, Any]:
    kids = children_of.get(it["id"], [])
    l0 = [_wi_node(items, children_of, c)
          for c in kids if c in items and items[c]["kind"] == "work_item"]
    actions = []
    for c in kids:
        a = items.get(c)
        if a and a["kind"] == "action":
            actions.append({
                "id": c, "summary": a["summary"], "state": a["state"],
                "open": _is_open(a["state"]),
                "type": a["type"],
                "planned": num(a["planned_effort"]),
                "rollupPlanned": num(a["rollup_planned_effort"]),
                "effort": display_effort(a),
                # an action's planned completion is its PTC target date
                "plannedCompletion": a["target_date"] or None,
                "created": a["created_date"] or None,
                "closed": a["closed_date"] or None,
                "owners": a["owners"] or None,
                "project": a["project"] or None,
                "team": a["team"] or None,
                "classification": a["classification"] or None,
            })

    def walk_counts(node: dict[str, Any], acc: list[int]) -> None:
        # entity counts over the tree; shared WIs are duplicated per ECR here
        # exactly like the mockup — the card layer dedupes by id (collectScoped)
        acc[0] += 1
        if not node["open"]:
            acc[1] += 1
        for c in node["children"]:
            walk_counts(c, acc)

    acc = [0, 0]
    for n in l0:
        walk_counts(n, acc)
    a_closed = sum(1 for a in actions if not a["open"])
    return {
        "id": it["id"],
        "summary": it["summary"],
        "state": it["state"],
        "open": _is_open(it["state"]),
        "created": it["created_date"],
        "closed": it["closed_date"] or None,
        "planned": num(it["rollup_planned_effort"]),
        "actual": num(it["rollup_actual_effort"]),
        "effort": num(it["rollup_planned_effort"]),
        "project": it["project"] or "",
        "owners": it["owners"] or "",
        "team": it["team"] or "",
        "classification": it["classification"] or "",
        "analysisTarget": it["analysis_target_date"] or None,
        "plannedCompletion": it["planned_completion_date"] or None,
        "wiTotal": acc[0], "wiClosed": acc[1],
        "actionTotal": len(actions), "actionClosed": a_closed,
        "rollupPlanned": num(it["rollup_planned_effort"]),
        "children": l0,
        "actions": actions,
    }


def _build_entry(it: dict[str, Any]) -> dict[str, Any]:
    """Builds feed the detail drawer only (decision #39): full display fields,
    plannedCompletion carries the build target date (same semantic mapping the
    actions use). No Home card/table consumer reads this list."""
    b = {
        "id": it["id"],
        "summary": it["summary"],
        "state": it["state"],
        "open": _is_open(it["state"]),
        "type": it["type"],
        "maturity": it["maturity_level"] or None,
        "plannedCompletion": it["target_date"] or None,
        "created": it["created_date"] or None,
        "closed": it["closed_date"] or None,
        "owners": it["owners"] or None,
        "project": it["project"] or None,
        "team": it["team"] or None,
    }
    if it["classification"]:
        b["classification"] = it["classification"]
    return b


def _ecr_subtree_wis(items: Items, children_of: Children, ecr_id: int) -> set[int]:
    """Work items reachable from an ECR via work_items edges, deduped by id
    (same scoping the Home cards' collectScoped uses)."""
    seen: set[int] = set()
    stack = [ecr_id]
    while stack:
        for c in children_of.get(stack.pop(), []):
            it = items.get(c)
            if it and it["kind"] == "work_item" and c not in seen:
                seen.add(c)
                stack.append(c)
    return seen


def _dist_rows(items: Items, children_of: Children, ecr_id: int,
               key_fn: Callable[[dict[str, Any]], Any]) -> list[dict[str, Any]]:
    """Per-ECR planned-effort shares by Team / Process Area (card wording #12:
    subtree WI OWN planned_effort, actions excluded, missing effort stays out
    of the sum, missing label folds into Other, Other sinks last). The
    denominator is the participating-effort sum — rollup would double-count
    CR-type children. Rows carry member WI ids so the graph's dimension view
    (#41) can expand a group card into real entity cards."""
    groups: dict[str, dict[str, Any]] = {}
    for wid in _ecr_subtree_wis(items, children_of, ecr_id):
        it = items[wid]
        k = (key_fn(it) or "Other").strip() or "Other"
        g = groups.setdefault(k, {"value": 0.0, "members": []})
        g["members"].append(wid)
        v = num(it["planned_effort"])
        if v is not None:
            g["value"] += v
    rows = [{"name": k, "value": round(g["value"]),
             "count": len(g["members"]), "members": g["members"]}
            for k, g in groups.items()]
    rows.sort(key=lambda r: (-r["value"], r["name"].lower()))
    return [r for r in rows if r["name"] != "Other"] + [r for r in rows if r["name"] == "Other"]


def _build_graph(items: Items, children_of: Children,
                 edge_rows: list[sqlite3.Row], generated_at: str) -> dict[str, Any]:
    """Graph view payload: flat nodes + the three edge relations so the graph
    can dedupe shared entities into single nodes with cross-column dashed
    edges (decision #35)."""
    nodes = []
    for it in items.values():
        n = {
            "id": it["id"], "kind": it["kind"], "type": it["type"],
            "state": it["state"], "open": _is_open(it["state"]),
            "summary": it["summary"], "created": it["created_date"] or None,
            # display effort per rule #27; on an ECR this IS the rollup total
            # the progress-ring denominators read (decision #40)
            "effort": display_effort(it),
        }
        if it["kind"] == "ecr":
            n["teamDist"] = _dist_rows(items, children_of, it["id"],
                                       lambda w: w["team"])
            n["paDist"] = _dist_rows(items, children_of, it["id"],
                                     lambda w: w["process_area"])
        if it["kind"] == "work_item" and it["level"] is not None:
            n["level"] = it["level"]
        nodes.append(n)
    edges: dict[str, list[list[int]]] = {rel: [] for rel in RELATIONS}
    for r in edge_rows:
        if r["relation"] in edges:
            edges[r["relation"]].append([r["parent_id"], r["child_id"]])
    return {"nodes": nodes, "edges": edges, "generatedAt": generated_at}


def summarize(payload: dict[str, Any]) -> dict[str, int]:
    """Counts for CLI printing and smoke checks."""
    return {
        "ecrs": len(payload["ecrs"]),
        "builds": len(payload["builds"]),
        "items": len(payload["items"]),
        "graph_nodes": len(payload["graph"]["nodes"]),
        **{f"edges.{rel}": len(v) for rel, v in payload["graph"]["edges"].items()},
    }


if __name__ == "__main__":
    # CLI self-check: python -m dashboard_generator.data_loader
    import json
    print(json.dumps(summarize(load_payload()), indent=2, ensure_ascii=False))
