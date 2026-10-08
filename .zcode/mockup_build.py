"""Mockup data builder (session tooling, not part of the pipeline).

Reads the real snapshot in src/output/dashboard.db, assembles the JSON payload
consumed by design/homepage.html and (re-)injects it into the single
`const DATA = ...;` line. Fonts (Inter) are embedded once on first build via
the /*__FONTS__*/ placeholder. Re-runnable: the previous payload is replaced
in place, so design edits survive a rebuild.
"""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "src" / "output" / "dashboard.db"
PAGE = ROOT / "design" / "homepage.html"
FONTS = ROOT / "src" / "dashboard_generator" / "assets" / "fonts.css"

CLOSED = {"ALM_Closed", "ALM_Realized", "ALM_Rejected", "ALM_Cancelled", "ALM_Completed"}
CR_TYPE = "ALM_Change Request"

def is_open(state):
    return state not in CLOSED

def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def display_effort(it):
    """Planned-effort display rule (table column, decided 2026-10-06): Change
    Request items carry no own effort in PTC (their own value is always 0), so
    they show the rollup; every other item shows its own planned effort and
    falls back to the rollup when that is empty. `planned_effort` itself keeps
    the raw own value for the card/scope aggregations."""
    own, rollup = num(it["planned_effort"]), num(it["rollup_planned_effort"])
    if it["type"] == CR_TYPE:
        return rollup
    return own if own is not None else rollup

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

items = {r["id"]: dict(r) for r in con.execute("SELECT * FROM items")}
children_of = {}
for r in con.execute("SELECT parent_id, child_id, relation FROM edges"):
    children_of.setdefault(r["parent_id"], []).append(r["child_id"])

generated_at = con.execute("SELECT value FROM metadata WHERE key='generated_at'").fetchone()[0]
today = generated_at[:10]

def wi_node(node_id):
    it = items[node_id]
    kids = [c for c in children_of.get(node_id, [])
            if c in items and items[c]["kind"] == "work_item"]
    op = is_open(it["state"])
    pc = it["planned_completion_date"] or None
    return {
        "id": node_id,
        "summary": it["summary"],
        "state": it["state"],
        "open": op,
        "type": it["type"],
        "planned": num(it["planned_effort"]),
        "rollupPlanned": num(it["rollup_planned_effort"]),
        "effort": display_effort(it),
        "plannedCompletion": pc,
        "created": it["created_date"] or None,
        "closed": it["closed_date"] or None,
        "owners": it["owners"] or None,
        "project": it["project"] or None,
        "team": it["team"] or None,
        "processArea": it["process_area"] or None,
        "overdue": bool(op and pc and pc < today),
        "children": [wi_node(k) for k in kids],
    }

def walk_counts(node, acc):
    acc[0] += 1
    if not node["open"]:
        acc[1] += 1
    for c in node["children"]:
        walk_counts(c, acc)

ecrs = []
for it in items.values():
    if it["kind"] != "ecr":
        continue
    kids = children_of.get(it["id"], [])
    l0 = [wi_node(c) for c in kids if c in items and items[c]["kind"] == "work_item"]
    actions = []
    for c in kids:
        a = items.get(c)
        if a and a["kind"] == "action":
            actions.append({
                "id": c, "summary": a["summary"], "state": a["state"],
                "open": is_open(a["state"]),
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
    acc = [0, 0]
    for n in l0:
        walk_counts(n, acc)
    a_closed = sum(1 for a in actions if not a["open"])
    planned_completion = it["planned_completion_date"] or None
    open_now = is_open(it["state"])
    ecrs.append({
        "id": it["id"],
        "summary": it["summary"],
        "state": it["state"],
        "open": open_now,
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
        "plannedCompletion": planned_completion,
        "overdue": bool(open_now and planned_completion and planned_completion < today),
        "wiTotal": acc[0], "wiClosed": acc[1],
        "actionTotal": len(actions), "actionClosed": a_closed,
        "rollupPlanned": num(it["rollup_planned_effort"]),
        "children": l0,
        "actions": actions,
    })

# aggregations: work_item L0-L2 planned effort, by derived process_area and by team
wi_all = [it for it in items.values() if it["kind"] == "work_item"]
efforted = [it for it in wi_all if num(it["planned_effort"]) is not None]

def top_groups(key_fn, top_n=5):
    groups = {}
    for it in efforted:
        k = key_fn(it) or "Other"
        groups[k] = groups.get(k, 0.0) + num(it["planned_effort"])
    ranked = sorted(groups.items(), key=lambda kv: -kv[1])
    head = [{"name": k, "value": round(v)} for k, v in ranked[:top_n]]
    rest = sum(v for _, v in ranked[top_n:])
    if ranked[top_n:]:
        head.append({"name": "Other", "value": round(rest)})
    return head

by_process_area = sorted(
    ({"name": (it["process_area"] or "Other"), "value": round(num(it["planned_effort"]))} for it in efforted),
    key=lambda r: r["name"].lower(),
)
pa_groups = {}
for r in by_process_area:
    pa_groups[r["name"]] = pa_groups.get(r["name"], 0) + r["value"]
by_process_area = [{"name": k, "value": v} for k, v in
                   sorted(pa_groups.items(), key=lambda kv: -kv[1])]
if "Other" in pa_groups:
    by_process_area = [r for r in by_process_area if r["name"] != "Other"] + \
                      [r for r in by_process_area if r["name"] == "Other"]

# builds feed the detail drawer only (decision #39): full display fields,
# plannedCompletion carries the build target date (same semantic mapping the
# actions use). No Home card/table consumer reads this key.
builds = []
for it in items.values():
    if it["kind"] != "build":
        continue
    b = {
        "id": it["id"],
        "summary": it["summary"],
        "state": it["state"],
        "open": is_open(it["state"]),
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
    builds.append(b)

payload = {
    "ecrs": ecrs,
    "builds": builds,
    "agg": {
        "plannedTotal": round(sum(e["planned"] or 0 for e in ecrs)),
        "actualTotal": round(sum(e["actual"] or 0 for e in ecrs)),
        "byProcessArea": by_process_area,
        "byTeam": top_groups(lambda it: it["team"]),
    },
}

# Graph view payload: flat nodes + the three edge relations, so the graph can
# dedupe shared entities into single nodes with multi-parent cross edges
# (decision #35). The tree-embedded DATA above duplicates shared WIs per ECR
# and carries no builds — the graph must read from here, not from DATA.
def ecr_subtree_wis(ecr_id):
    """Work items reachable from an ECR via work_items edges, deduped by id.
    A shared WI counts under every ECR that references it (same scoping as
    the Home cards' collectScoped)."""
    seen, stack = set(), [ecr_id]
    while stack:
        for c in children_of.get(stack.pop(), []):
            it = items.get(c)
            if it and it["kind"] == "work_item" and c not in seen:
                seen.add(c)
                stack.append(c)
    return seen


def dist_rows(ecr_id, key_fn):
    """Per-ECR planned-effort shares (Home-card wording #12: subtree WI own
    planned_effort, actions excluded, missing effort stays out, missing
    label folds into Other, Other sinks last). Denominator is the sum of
    participating effort — rollup would double-count CR-type children.
    Each row also carries its member WI ids so the graph's dimension view
    (#41) can expand a group card into the real entity cards."""
    groups = {}
    for wid in ecr_subtree_wis(ecr_id):
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


graph_nodes = []
for it in items.values():
    n = {
        "id": it["id"], "kind": it["kind"], "type": it["type"],
        "state": it["state"], "open": is_open(it["state"]),
        "summary": it["summary"], "created": it["created_date"] or None,
        # display effort per rule #27 (CR-type -> rollup, others own with
        # rollup fallback); on an ECR this IS the rollup total that the
        # progress-ring denominators read (decision #40)
        "effort": display_effort(it),
    }
    if it["kind"] == "ecr":
        n["teamDist"] = dist_rows(it["id"], lambda w: w["team"])
        n["paDist"] = dist_rows(it["id"], lambda w: w["process_area"])
    if it["kind"] == "work_item" and it["level"] is not None:
        n["level"] = it["level"]
    graph_nodes.append(n)
graph_nodes.sort(key=lambda n: n["id"])
graph_edges = {rel: [] for rel in ("work_items", "actions", "work_item_for")}
for r in con.execute("SELECT relation, parent_id, child_id FROM edges ORDER BY parent_id, child_id"):
    if r["relation"] in graph_edges:
        graph_edges[r["relation"]].append([r["parent_id"], r["child_id"]])
graph = {"nodes": graph_nodes, "edges": graph_edges, "generatedAt": generated_at}

data_js = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
graph_js = json.dumps(graph, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
fonts_css = FONTS.read_text(encoding="utf-8") if FONTS.exists() else ""

html = PAGE.read_text(encoding="utf-8")
lines = html.split("\n")
hits = [i for i, l in enumerate(lines) if l.startswith("const DATA = ")]
assert len(hits) == 1, f"expected exactly one DATA line, found {len(hits)}"
lines[hits[0]] = "const DATA = " + data_js + ";"
# GRAPH line sits right after DATA; replaced in place on rebuilds, inserted
# after DATA on first build (design edits elsewhere survive either way)
ghits = [i for i, l in enumerate(lines) if l.startswith("const GRAPH = ")]
graph_line = "const GRAPH = " + graph_js + ";"
if ghits:
    lines[ghits[0]] = graph_line
else:
    lines.insert(hits[0] + 1, graph_line)
html = "\n".join(lines)
if "/*__FONTS__*/" in html:
    html = html.replace("/*__FONTS__*/", fonts_css)
PAGE.write_text(html, encoding="utf-8")

fallback = sum(1 for it in wi_all
               if it["type"] != CR_TYPE
               and num(it["planned_effort"]) is None
               and num(it["rollup_planned_effort"]) is not None)
print("ECRs:", len(ecrs), "| open:", sum(1 for e in ecrs if e["open"]),
      "| builds:", len(builds))
print("WI:", len(wi_all), "| with effort:", len(efforted),
      "| effort via rollup fallback:", fallback,
      "| CR-type WI:", sum(1 for it in wi_all if it["type"] == CR_TYPE))
print("plannedTotal:", payload["agg"]["plannedTotal"], "actualTotal:", payload["agg"]["actualTotal"])
print("GRAPH nodes:", len(graph_nodes), "| edges:",
      {k: len(v) for k, v in graph["edges"].items()})
print("size:", PAGE.stat().st_size, "bytes")
