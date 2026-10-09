/* ---------- payload ----------
   window.__PAYLOAD__ is injected by the generator (html_template.py):
     { data: { ecrs, builds, items}, graph, aggregations, meta }.
   The aliases below keep the prototype's DATA / GRAPH names so the ported
   code below reads unchanged; DATA.agg mirrors the mockup payload's agg key
   (the unfiltered card baseline), and ITEMS carries every raw config field
   per item for the full-field detail drawer. */
const PAY = window.__PAYLOAD__;
const DATA = {
  ecrs: PAY.data.ecrs,
  builds: PAY.data.builds || [],
  agg: PAY.aggregations,
};
const GRAPH = PAY.graph;
const ITEMS = PAY.data.items || {}; /* id -> full raw item row */
const META = PAY.meta || {};

/* Overdue is computed here on the frontend per the locked rule (content
   spec §7 rule 2): planned_completion_date < generated_at AND open — the
   DB overdue_* columns are ignored entirely. Actions and builds carry no
   such date and stay overdue-free. */
const TODAY = String(META.generated_at || "").slice(0, 10);
const markOverdue = (n) => {
  n.overdue = !!(n.open && n.plannedCompletion && n.plannedCompletion < TODAY);
  (n.children || []).forEach(markOverdue);
};
DATA.ecrs.forEach(markOverdue);

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
/* missing values render blank everywhere (decided 2026-10-06); a real 0 shows as 0 */
const fmt = (n) => (n == null ? "" : Math.round(n).toLocaleString("en-US"));
const monthFmt = (iso) => {
  const [y, m] = iso.split("-");
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1] + " " + y;
};

/* ---------- scoped aggregation helpers ----------
   The five bento cards recompute from the current search/status result set
   (one-way linkage: filters -> cards; cards stay non-clickable). Shared
   entities referenced by several ECRs are deduped per entity, mirroring the
   full-snapshot aggregates in DATA.agg when the scope is empty. */
function collectScoped(ecrs) {
  const wis = new Map(), actions = new Map();
  const walk = (n) => {
    if (wis.has(n.id)) return;
    wis.set(n.id, n);
    (n.children || []).forEach(walk);
  };
  ecrs.forEach((e) => {
    e.children.forEach(walk);
    e.actions.forEach((a) => actions.set(a.id, a));
  });
  return { wis, actions };
}

/* ---------- totals KPI card ---------- */
function renderTotals(ecrs) {
  const { wis, actions } = collectScoped(ecrs);
  const kpis = [
    { k: "ECRs", v: ecrs.length },
    { k: "Work Items", v: wis.size },
    { k: "Actions", v: actions.size },
  ];
  $("kpi-row").innerHTML = kpis.map((x) => `
    <div class="kpi"><div class="k">${x.k}</div><div class="v">${x.v.toLocaleString("en-US")}</div></div>`).join("");
}

/* ---------- effort card: planned vs actual ---------- */
function renderEffort(ecrs) {
  $("effort-kpis").innerHTML = [
    { k: "Planned", v: ecrs.reduce((s, e) => s + (e.planned || 0), 0) },
    { k: "Actual", v: ecrs.reduce((s, e) => s + (e.actual || 0), 0) },
  ].map((x) => `
    <div class="kpi"><div class="k">${x.k}</div><div class="v">${fmt(x.v)}</div></div>`).join("");
}

/* ---------- creation timeline card (horizontal) ---------- */
function renderTimeline(ecrs) {
  if (!ecrs.length) {
    $("timeline").innerHTML = `<li class="tl-empty">No ECRs match the current search</li>`;
    return;
  }
  const events = [...ecrs].sort((a, b) => a.created < b.created ? -1 : 1);
  $("timeline").innerHTML = events.map((e) => `
    <li title="#${e.id} · ${e.created} · ${e.summary}">
      <span class="tl-dot ${e.open ? "pending" : ""}"></span>
      <span class="tl-tag">
        <span class="tl-id">${e.id}</span>
        <time datetime="${e.created}">${monthFmt(e.created)}</time>
      </span>
    </li>`).join("");
}

/* ---------- process area card ---------- */
function renderProcess(ecrs) {
  const groups = {};
  collectScoped(ecrs).wis.forEach((n) => {
    if (n.planned == null) return; // WI rows without planned effort stay out of the chart
    const k = n.processArea || "Other";
    groups[k] = (groups[k] || 0) + n.planned;
  });
  let entries = Object.entries(groups)
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
  entries = entries.filter((r) => r.name !== "Other").concat(entries.filter((r) => r.name === "Other"));
  if (!entries.length) {
    $("pa-list").innerHTML = `<div class="pa-empty">No work-item planned effort in scope</div>`;
    return;
  }
  const max = Math.max(...entries.map((r) => r.value));
  $("pa-list").innerHTML = `<div class="pa-chart">` + entries.map((r) => {
    const pct = max ? Math.round(100 * r.value / max) : 0;
    const val = pct >= 20
      ? `<span class="pa-val in" style="bottom:calc(${pct}% - 18px)">${fmt(r.value)}</span>`
      : `<span class="pa-val" style="bottom:calc(${pct}% + 5px)">${fmt(r.value)}</span>`;
    return `<div class="pa-col${r.name === "Other" ? " other" : ""}" title="${r.name} — ${fmt(r.value)} planned effort">
      <div class="pa-slot">${val}<i class="pa-fill" style="height:${pct}%"></i></div>
      <div class="pa-name">${r.name}</div>
    </div>`;
  }).join("") + `</div>`;
}

/* ---------- team donut card ---------- */
function renderTeam(ecrs) {
  const groups = {};
  collectScoped(ecrs).wis.forEach((n) => {
    if (n.planned == null) return;
    const k = n.team || "Other";
    groups[k] = (groups[k] || 0) + n.planned;
  });
  const ranked = Object.entries(groups)
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
  const top = ranked.slice(0, 5);
  if (ranked.length > 5) { // fold teams beyond the top 5 into "Other"
    const rest = ranked.slice(5).reduce((s, r) => s + r.value, 0);
    const other = top.find((r) => r.name === "Other");
    if (other) other.value += rest; else top.push({ name: "Other", value: rest });
  }
  const RAMP = ["#3b82f6", "#6ea3f8", "#9ec2fa", "#cedffc", "#e5effd"];
  const total = top.reduce((s, r) => s + r.value, 0);
  const donut = $("donut");
  if (total) {
    let from = 0;
    donut.style.background = "conic-gradient(" + top.map((r, i) => {
      const to = from + 100 * r.value / total;
      const color = r.name === "Other" ? "#cbd5e1" : RAMP[Math.min(i, RAMP.length - 1)];
      const seg = `${color} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
      from = to;
      return seg;
    }).join(",") + ")";
  } else {
    donut.style.background = "#eef1f8"; // neutral ring when nothing is in scope
  }
  $("donut-total").textContent = fmt(total);
  $("team-legend").innerHTML = top.map((r, i) => `
    <li>
      <span class="ldot" style="background:${r.name === "Other" ? "#cbd5e1" : RAMP[Math.min(i, RAMP.length - 1)]}"></span>
      <span class="lname" title="${r.name}">${r.name}</span>
      <span class="lval">${fmt(r.value)} (${total ? Math.round(100 * r.value / total) : 0}%)</span>
    </li>`).join("");
}

function renderCards(ecrs) {
  renderTotals(ecrs);
  renderEffort(ecrs);
  renderTimeline(ecrs);
  renderProcess(ecrs);
  renderTeam(ecrs);
}

/* ---------- table ----------
   def marks the default-visible columns; every data column (chevron excepted)
   is toggleable in the Columns menu, so "default" is just the checked set */
const COLS = [
  { key: "chev",    label: "" },
  { key: "id",      label: "ID", sort: true, def: true },
  { key: "type",    label: "Type", sort: true },
  { key: "summary", label: "Summary", sort: true, def: true },
  { key: "state",   label: "State", sort: true, def: true },
  { key: "processArea", label: "Process Area", sort: true, def: true },
  { key: "created", label: "Created", sort: true },
  { key: "children",label: "Children", sort: true },
  { key: "planned", label: "Planned Effort", sort: true, num: true, cls: "r", def: true },
  { key: "rollupPlanned", label: "Rollup Planned Effort", sort: true, num: true, cls: "r" },
  { key: "actual",  label: "Actual Effort", sort: true, num: true, cls: "r" },
  { key: "project", label: "Project" },
  { key: "closed",  label: "Closed Date", sort: true },
  { key: "owners",  label: "Owners" },
  { key: "team",    label: "Team" },
  { key: "plannedCompletion", label: "Planned Completion", sort: true },
  { key: "analysisTarget",    label: "Analysis Target" },
  { key: "classification",    label: "Classification" },
  { key: "overdue", label: "Overdue" },
  { key: "detail", label: "" },
];
const state = {
  seg: "all", q: "", sortKey: "created", sortDir: "descending",
  // detail is an affordance column like chev: never hidden, never in the menu
  hidden: new Set(COLS.filter((c) => !c.def && c.key !== "chev" && c.key !== "detail").map((c) => c.key)),
  expanded: new Set(),   // manually expanded rows; persists across re-renders
  suppressed: new Set(), // auto-expanded rows the user collapsed while a filter is active
  filters: new Map(),    // column key -> Set of selected display values ("" = blanks); Excel-style
};

/* column order: session-scoped, data columns only — the chevron affordance
   stays first and the detail button last; header drag-reordering moves the
   rest (renderers below all read orderedCols(), never COLS directly) */
let colOrder = COLS.map((c) => c.key);
const orderedCols = () => {
  const byKey = Object.fromEntries(COLS.map((c) => [c.key, c]));
  const data = colOrder.filter((k) => k !== "chev" && k !== "detail" && byKey[k]);
  return [byKey.chev, ...data.map((k) => byKey[k]), byKey.detail];
};

/* entity-type monogram shown before the ID (mini rhyme of the brand mark).
   Cool hues only — warm orange/green stay reserved for state badges. */
const TYPE_META = {
  "ALM_Change Request": { tag: "CR", name: "Change Request", cls: "t-cr" },
  "ALM_Task":           { tag: "T",  name: "Task",          cls: "t-tk" },
  "ALM_Work Package":   { tag: "WP", name: "Work Package",  cls: "t-wp" },
  "ALM_Action":         { tag: "A",  name: "Action",        cls: "t-ac" },
  "ALM_Build":          { tag: "B",  name: "Build",         cls: "t-bd" },
};
const typeBadge = (r) => {
  const m = TYPE_META[r.type];
  return m ? `<span class="type-badge ${m.cls}" title="${m.name}">${m.tag}</span>` : "";
};

const cell = {
  chev: (r) => r.expandable ? `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 6 6 6-6 6"/></svg></span>` : "",
  id: (r) => `<span class="t-id" data-id="${r.id}"${r.depth ? ` style="margin-left:${r.depth * GUIDE_PITCH}px"` : ""} title="Open in PTC (dispatched via the local opener)">${typeBadge(r)}${r.id}</span>`,
  // same badge as the ID column wears, plus the human-readable type name;
  // unknown types fall back to the raw PTC type with the ALM_ prefix stripped
  type: (r) => {
    const m = TYPE_META[r.type];
    return m
      ? `${typeBadge(r)}<span class="t-muted">${m.name}</span>`
      : `<span class="t-muted">${escHTML((r.type || "").replace(/^ALM_/, ""))}</span>`;
  },
  summary: (r) => `<span class="t-sum" title="${escHTML(r.summary)}">${escHTML(r.summary)}</span>`,
  created: (r) => `<span class="t-muted">${r.created ?? ""}</span>`,
  children: (r) => r.chips.map(([n, t]) => `<span class="chip">${n} ${t}</span>`).join(""),
  planned: (r) => `<span class="t-num">${fmt(r.effort)}</span>`,
  // raw subtree rollup; unlike Planned Effort the display rule does not
  // substitute it for CR-type rows — every row shows its own rollup value
  rollupPlanned: (r) => `<span class="t-num">${fmt(r.rollupPlanned)}</span>`,
  actual: (r) => `<span class="t-num">${fmt(r.actual)}</span>`,
  state: (r) => {
    if (!r.state) return "";
    // actual PTC state, ALM_ namespace prefix stripped; badge color still
    // encodes the open/closed grouping the seg filter uses
    return `<span class="badge ${r.open ? "open" : "closed"}" title="${escHTML(r.state)}">${escHTML(r.state.replace(/^ALM_/, ""))}</span>`;
  },
  // process area lives on work items only; ECR and Action rows stay blank
  processArea: (r) => r.processArea ? `<span class="t-muted">${escHTML(r.processArea)}</span>` : "",
  project: (r) => r.project ? `<span class="t-muted" title="${escHTML(r.project)}">${r.project.length > 34 ? escHTML(r.project.slice(0, 34)) + "…" : escHTML(r.project)}</span>` : "",
  closed: (r) => `<span class="t-muted">${r.closed ?? ""}</span>`,
  owners: (r) => r.owners ? `<span class="t-muted" title="${escHTML(r.owners)}">${escHTML(r.owners)}</span>` : "",
  team: (r) => `<span class="t-muted">${r.team ?? ""}</span>`,
  plannedCompletion: (r) => `<span class="t-muted">${r.plannedCompletion ?? ""}</span>`,
  analysisTarget: (r) => `<span class="t-muted">${r.analysisTarget ?? ""}</span>`,
  classification: (r) => `<span class="t-muted">${r.classification ?? ""}</span>`,
  overdue: (r) => r.overdue ? `<span class="badge late">Overdue</span>` : "",
  // opens the row's detail drawer; not a data cell — no sort, no filter,
  // no column toggle (same treatment as the chev affordance column)
  detail: (r) => `<button type="button" class="row-detail" data-kind="${r.kind}" data-id="${r.id}" aria-label="Open details" title="Open details"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>`,
};

/* ---------- row model ----------
   ECRs, work items and actions all render as rows of the same table sharing
   one column set; hierarchy reads through a small ID-column indent only
   (ECR depth 0 · Action and WI L0 depth 1 · L1 depth 2 · L2 depth 3). */
const normEcr = (e, depth) => {
  const kids = [
    ...(e.children || []).map((n) => normWi(n, depth + 1)),
    ...(e.actions || []).map((a) => normAction(a, depth + 1)),
  ];
  return {
    kind: "ecr", id: e.id, depth, summary: e.summary, open: e.open, state: e.state,
    type: e.type || "ALM_Change Request",
    created: e.created || null, closed: e.closed || null, owners: e.owners || null,
    team: e.team || null, project: e.project || null, classification: e.classification || null,
    plannedCompletion: e.plannedCompletion || null, analysisTarget: e.analysisTarget || null,
    processArea: null,
    overdue: !!e.overdue, effort: e.effort ?? e.planned ?? null, actual: e.actual ?? null,
    rollupPlanned: e.rollupPlanned ?? null,
    childCount: (e.wiTotal + e.actionTotal) || null,
    chips: [[e.wiTotal, "WI"], [e.actionTotal, "A"]].filter(([n]) => n > 0),
    kids, expandable: kids.length > 0,
  };
};
const normWi = (n, depth) => {
  const kids = (n.children || []).map((c) => normWi(c, depth + 1));
  return {
    kind: "wi", id: n.id, depth, summary: n.summary, open: n.open, state: n.state,
    type: n.type,
    created: n.created || null, closed: n.closed || null, owners: n.owners || null,
    team: n.team || null, project: n.project || null, classification: n.classification || null,
    plannedCompletion: n.plannedCompletion || null, analysisTarget: null,
    processArea: n.processArea || null,
    overdue: !!n.overdue, effort: n.effort ?? n.planned ?? null, actual: null,
    rollupPlanned: n.rollupPlanned ?? null,
    childCount: kids.length || null,
    chips: kids.length ? [[kids.length, "WI"]] : [],
    kids, expandable: kids.length > 0,
  };
};
const normAction = (a, depth) => ({
  kind: "action", id: a.id, depth, summary: a.summary, open: a.open, state: a.state,
  type: a.type,
  created: a.created || null, closed: a.closed || null, owners: a.owners || null,
  team: a.team || null, project: a.project || null, classification: a.classification || null,
  plannedCompletion: a.plannedCompletion || null, analysisTarget: null,
  processArea: null,
  overdue: false, effort: a.effort ?? a.planned ?? null, actual: null,
  rollupPlanned: a.rollupPlanned ?? null,
  childCount: null, chips: [], kids: [], expandable: false,
});

const sortVal = (r) => ({
  id: r.id,
  type: colVal.type(r).toLowerCase(),
  summary: r.summary.toLowerCase(),
  created: r.created,
  closed: r.closed,
  children: r.childCount,
  planned: r.effort,
  rollupPlanned: r.rollupPlanned,
  actual: r.actual,
  state: (r.state || "").replace(/^ALM_/, ""),
  processArea: r.processArea,
  plannedCompletion: r.plannedCompletion,
})[state.sortKey];

/* hierarchical sort: parents rank among themselves, each expanded parent's
   direct children (WI + Action mixed) rank by the same column and direction;
   missing values sink to the bottom in both directions */
function makeCmp(dir) {
  return (a, b) => {
    const x = sortVal(a), y = sortVal(b);
    if (x == null && y == null) return 0; // stable sort keeps payload order
    if (x == null) return 1;
    if (y == null) return -1;
    return x < y ? -dir : x > y ? dir : 0;
  };
}

/* ids of the ancestor chain of every filter hit; an ECR that matches by its
   own id/summary stays collapsed (only child hits force their chain open) */
function hitAncestors(ecrs, q) {
  const needle = q.toLowerCase();
  const hit = (n) => String(n.id).includes(needle) || n.summary.toLowerCase().includes(needle);
  const out = new Set();
  const walk = (nodes, chain) => {
    for (const n of nodes) {
      if (hit(n)) chain.forEach((id) => out.add(id));
      walk(n.children || [], [...chain, n.id]);
    }
  };
  for (const e of ecrs) {
    walk(e.children, [e.id]);
    e.actions.forEach((a) => { if (hit(a)) out.add(e.id); });
  }
  return out;
}

/* expansion in effect: manual toggles persist across re-renders; while a text
   filter is active the hit ancestor chains auto-expand as an overlay, and
   clearing the filter reverts to the manual state */
function effExpandedSet(ecrRows) {
  const set = new Set(state.expanded);
  if (state.q) hitAncestors(ecrRows, state.q).forEach((id) => set.add(id));
  state.suppressed.forEach((id) => set.delete(id));
  return set;
}

let effExpanded = new Set(); // expansion set actually rendered, for click handling

/* ---------- column filters (Excel-style per-column dropdowns) ----------
   Filter values are the DISPLAY strings of each cell (missing renders as ""
   and is offered as "(Blanks)", pinned last). Within one column the checked
   values form an OR; across columns they AND. Tree semantics: a row survives
   when its own value is selected OR any descendant survives; kept ancestors
   auto-expand so matches stay reachable. Candidate value lists are faceted —
   they only count rows passing every OTHER active filter. Scope is the table
   only: the bento cards stay driven by seg + text filter (Handoff §3.1). */
const colVal = {
  id: (r) => String(r.id),
  type: (r) => {
    const m = TYPE_META[r.type];
    return m ? m.name : (r.type || "").replace(/^ALM_/, "");
  },
  summary: (r) => r.summary,
  created: (r) => r.created || "",
  children: (r) => (r.childCount == null ? "" : String(r.childCount)),
  planned: (r) => fmt(r.effort),
  rollupPlanned: (r) => fmt(r.rollupPlanned),
  actual: (r) => fmt(r.actual),
  state: (r) => (r.state || "").replace(/^ALM_/, ""),
  processArea: (r) => r.processArea || "",
  project: (r) => r.project || "",
  closed: (r) => r.closed || "",
  owners: (r) => r.owners || "",
  team: (r) => r.team || "",
  plannedCompletion: (r) => r.plannedCompletion || "",
  analysisTarget: (r) => r.analysisTarget || "",
  classification: (r) => r.classification || "",
  overdue: (r) => (r.overdue ? "Overdue" : ""),
};
const colFiltersActive = () => state.filters.size > 0;

/* own-value pass; skipKey lets the dropdown list values facet-style */
function passesFilters(r, skipKey) {
  for (const [key, sel] of state.filters) {
    if (key === skipKey) continue;
    if (!sel.has(colVal[key](r))) return false;
  }
  return true;
}

/* every distinct row (deduped — shared entities appear under several ECRs)
   of the seg/text-filtered ECR set, expanded regardless of UI expansion */
function scopedRows() {
  const out = [], seen = new Set();
  const walk = (n) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    n.kids.forEach(walk);
  };
  filteredRows().forEach((e) => walk(normEcr(e, 0)));
  return out;
}

/* which rows survive the column filters: { keep, expand } where keep holds
   ids to render (own match or kept descendant) and expand holds kept rows
   that must reveal a kept descendant. keep === null when nothing is filtered. */
function colFilterSets(ecrRows) {
  if (!colFiltersActive()) return { keep: null, expand: new Set() };
  const keep = new Set(), expand = new Set();
  const walk = (n) => {
    let kid = false;
    for (const k of n.kids) kid = walk(k) || kid;
    if (passesFilters(n) || kid) {
      keep.add(n.id);
      if (kid) expand.add(n.id);
      return true;
    }
    return false;
  };
  ecrRows.forEach((e) => walk(normEcr(e, 0)));
  return { keep, expand };
}

function syncFunnelIcons() {
  $("t-thead").querySelectorAll(".col-fbtn").forEach((b) => {
    b.classList.toggle("is-active", state.filters.has(b.dataset.fkey));
  });
}

function flattenRows(ecrRows, expandSet, keep) {
  const cmp = makeCmp(state.sortDir === "ascending" ? 1 : -1);
  const rows = [];
  const vis = (kids) => (keep ? kids.filter((k) => keep.has(k.id)) : kids);
  // tag each kid with its sorted-position lastness (drives guide-line
  // termination): a level's line ends at its LAST VISIBLE child's elbow
  const walkKids = (parent) => {
    const kids = vis([...parent.kids].sort(cmp));
    kids.forEach((k, i) => {
      k.isLast = i === kids.length - 1;
      k.lastChain = [...parent.lastChain, k.isLast];
      // stable sort-morph key: the root->self id chain (a shared WI under
      // two ECRs gets two distinct keys, so every visible row is unique)
      k.rowKey = `${parent.rowKey}-${k.id}`;
    });
    for (const k of kids) {
      rows.push(k);
      if (expandSet.has(k.id)) walkKids(k);
    }
  };
  for (const e of [...ecrRows].map((x) => normEcr(x, 0)).sort(cmp)) {
    if (keep && !keep.has(e.id)) continue;
    e.lastChain = [];
    e.rowKey = `trow-${e.id}`;
    rows.push(e);
    if (expandSet.has(e.id)) walkKids(e);
  }
  return rows;
}

/* table row renderer (the search panel's result rowHTML lives further below) */
const GUIDE_PITCH = 23; // 11px gap + 1px line + 11px gap, per the tree reference

function trHTML(r, isOpen, isHit) {
  const cells = orderedCols().map((c) => {
    const cls = c.cls ? ` class="${c.cls}"` : "";
    // hierarchy guides live in the ID column only
    const guides = c.key === "id" && r.depth ? idGuides(r) : "";
    return `<td${cls} data-col="${c.key}">${guides}${cell[c.key](r)}</td>`;
  }).join("");
  const cls = `row ${r.kind}${r.expandable ? " expandable" : ""}${isOpen ? " is-open" : ""}${isHit ? " hit" : ""}`;
  const aria = r.expandable ? ` aria-expanded="${isOpen}"` : "";
  // the inline view-transition-name lets the sort morph track this exact row
  return `<tr class="${cls}" data-id="${r.id}" data-row-key="${r.rowKey}"${aria} style="view-transition-name:${r.rowKey}">${cells}</tr>`;
}

/* guide lines per Reference/Table_structure_UI_CSS.txt with classic tree
   termination: a level's vertical line stops at its LAST child's elbow
   (rounded corner) instead of running to the row bottom, and deeper rows of
   that subtree carry no line for that level anymore. lastChain[l-1] records
   whether the row's ancestor at level l is the last child of its group. */
function idGuides(r) {
  const d = r.depth;
  if (!d) return "";
  let out = `<span class="t-guides" aria-hidden="true">`;
  for (let l = 1; l < d; l++) {
    if (!r.lastChain[l - 1]) out += `<i class="vline" style="left:${11 + GUIDE_PITCH * (l - 1)}px"></i>`;
  }
  const x = 11 + GUIDE_PITCH * (d - 1);
  out += r.lastChain[d - 1]
    ? `<i class="elbow end" style="left:${x}px"></i>`
    : `<i class="vline" style="left:${x}px"></i><i class="elbow" style="left:${x}px"></i>`;
  return out + `</span>`;
}

const FUNNEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M22 3 2 3l8 9.46V19l4 2v-8.54L22 3z"/></svg>`;
const EXPAND_ALL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 5 5 5 5-5"/><path d="m7 13 5 5 5-5"/></svg>`;
const COLLAPSE_ALL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 11 5-5 5 5"/><path d="m7 19 5-5 5 5"/></svg>`;

/* row morph for sorts and expansion changes (Reference/Sort Morph_CSS.txt):
   View Transitions where available, FLIP translateY fallback otherwise;
   rows entering/leaving just appear/disappear, surviving rows glide.
   Reduced-motion users get the plain synchronous re-render. */
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)");
function morphRender(fn) {
  if (REDUCED_MOTION.matches) { fn(); return; }
  if (!document.startViewTransition) {
    // FLIP fallback (no View Transitions): measure, re-render, glide each
    // surviving row from its old position (Reference/Sort Morph_CSS.txt)
    const before = new Map();
    document.querySelectorAll("#t-tbody tr.row").forEach((tr) =>
      before.set(tr.dataset.rowKey, tr.getBoundingClientRect().top));
    fn();
    document.querySelectorAll("#t-tbody tr.row").forEach((tr) => {
      const y0 = before.get(tr.dataset.rowKey);
      if (y0 === undefined) return;
      const dy = y0 - tr.getBoundingClientRect().top;
      if (dy) tr.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
        { duration: 420, easing: "cubic-bezier(.22,.61,.36,1)" });
    });
    return;
  }
  let ran = false;
  const t = document.startViewTransition(() => { ran = true; fn(); });
  // safety net: a throttled renderer (background pane) never fires the VT
  // callback; apply the (idempotent) render synchronously instead and let a
  // late callback just re-render the same state
  setTimeout(() => {
    if (!ran) { fn(); try { t.skipTransition(); } catch { /* already done */ } }
  }, 120);
}

/* ids of every expandable row in the current filtered scope — when column
   filters are active the keep set bounds the walk (graph parity: the control
   acts on what is visible) */
function allExpandableIds(ecrRows, keep) {
  const ids = new Set();
  const walk = (n) => {
    if (keep && !keep.has(n.id)) return;
    if (n.expandable) ids.add(n.id);
    n.kids.forEach(walk);
  };
  ecrRows.forEach((e) => walk(normEcr(e, 0)));
  return ids;
}

/* the chevron header cell hosts the expand/collapse-all toggle; its icon and
   labels always present the NEXT action over the visible scope */
function syncExpandAll(ecrRows, expansion, keep) {
  const btn = $("t-expand-all");
  if (!btn) return;
  const ids = allExpandableIds(ecrRows, keep);
  const expandNext = ids.size > 0 && [...ids].some((id) => !expansion.has(id));
  btn.disabled = ids.size === 0;
  btn.innerHTML = expandNext ? EXPAND_ALL_SVG : COLLAPSE_ALL_SVG;
  const label = expandNext ? "Expand all rows" : "Collapse all rows";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.dataset.next = expandNext ? "expand" : "collapse";
}

function renderHead() {
  $("t-thead").innerHTML = orderedCols().map((c) => {
    const cls = [c.sort && "sortable", c.cls].filter(Boolean).join(" ");
    const attrs = `${cls ? ` class="${cls}"` : ""}${c.sort ? ` data-key="${c.key}" role="columnheader"` : ""}${state.sortKey === c.key ? ` aria-sort="${state.sortDir}"` : ""} data-col="${c.key}"`;
    if (c.key === "chev") {
      // expand/collapse-all lives in the chevron affordance cell (54px)
      return `<th${attrs}><button type="button" class="t-expand-all" id="t-expand-all" aria-label="Expand all rows" title="Expand all rows">${EXPAND_ALL_SVG}</button></th>`;
    }
    // every data column carries a filter trigger; the chevron affordance column does not
    const fbtn = colVal[c.key]
      ? `<button type="button" class="col-fbtn${state.filters.has(c.key) ? " is-active" : ""}" data-fkey="${c.key}" aria-haspopup="true" aria-expanded="false" title="Filter ${escHTML(c.label || "column")}">${FUNNEL_SVG}</button>`
      : "";
    // data columns are drag-reorderable; the trailing detail affordance stays pinned
    const drag = c.key === "detail" ? "" : ` draggable="true"`;
    return `<th${attrs}${drag}>${c.label}${fbtn}</th>`;
  }).join("");
  $("t-thead").querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      state.sortDir = state.sortKey === k && state.sortDir === "descending" ? "ascending" : "descending";
      state.sortKey = k;
      // sorting reshapes the table only — rows morph to their new positions
      morphRender(() => { renderHead(); renderBody(filteredRows()); });
    });
  });
  $("t-thead").querySelectorAll(".col-fbtn").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation(); // a trigger click must not sort the column
      toggleColPop(btn.dataset.fkey, btn);
    });
  });
  const xbtn = $("t-expand-all");
  xbtn.addEventListener("click", () => {
    const ecrRows = filteredRows();
    // decide from live state, never from the (possibly stale) rendered
    // button — a pending view transition can lag the DOM by a frame
    const { keep, expand } = colFilterSets(ecrRows);
    const ids = allExpandableIds(ecrRows, keep);
    const eff = effExpandedSet(ecrRows);
    expand.forEach((id) => eff.add(id));
    const anyCollapsed = [...ids].some((id) => !eff.has(id));
    if (anyCollapsed) {
      ids.forEach((id) => state.expanded.add(id));
      state.suppressed.clear();
    } else {
      state.expanded.clear();
      state.suppressed.clear();
      // a text filter's hit chains re-expand as the #29 overlay demands
    }
    morphRender(() => renderBody(ecrRows));
  });
  bindHeadDrag();
}

/* drag-to-reorder for data-column headers (HTML5 DnD): an accent edge marks
   the insertion side; dropping on the pinned chev/detail cells clamps to the
   first/last data position. renderHead re-runs the binder with fresh nodes */
function bindHeadDrag() {
  const head = $("t-thead");
  let dragKey = null;
  const clearHints = () => head.querySelectorAll(".drop-before,.drop-after")
    .forEach((t) => t.classList.remove("drop-before", "drop-after"));
  head.querySelectorAll("th[data-col]:not([data-col='chev']):not([data-col='detail'])").forEach((th) => {
    th.addEventListener("dragstart", (ev) => {
      dragKey = th.dataset.col;
      th.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", dragKey);
    });
    th.addEventListener("dragend", () => {
      dragKey = null;
      clearHints();
      head.querySelectorAll(".dragging").forEach((t) => t.classList.remove("dragging"));
    });
  });
  head.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("dragover", (ev) => {
      if (!dragKey) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      const rect = th.getBoundingClientRect();
      const after = th.dataset.col === "detail" || ev.clientX > rect.left + rect.width / 2;
      clearHints();
      th.classList.add(after ? "drop-after" : "drop-before");
    });
    th.addEventListener("dragleave", (ev) => {
      if (!th.contains(ev.relatedTarget)) th.classList.remove("drop-before", "drop-after");
    });
    th.addEventListener("drop", (ev) => {
      if (!dragKey) return;
      ev.preventDefault();
      const after = th.classList.contains("drop-after");
      clearHints();
      reorderColumn(dragKey, th.dataset.col, after);
      dragKey = null;
    });
  });
}

function reorderColumn(dragKey, targetKey, after) {
  if (dragKey === targetKey) return;
  const data = colOrder.filter((k) => k !== "chev" && k !== "detail" && k !== dragKey);
  let to;
  if (targetKey === "chev") to = 0;
  else if (targetKey === "detail") to = data.length;
  else to = data.indexOf(targetKey) + (after ? 1 : 0);
  data.splice(to, 0, dragKey);
  colOrder = ["chev", ...data, "detail"];
  renderHead();
  renderBody(filteredRows());
  buildColsMenu();
}

/* t-filter scope: ECR id/summary hit, or any nested WI/Action id/summary hit */
function ecrContentMatch(e, q) {
  const hit = (n) => n.id.toString().includes(q) || n.summary.toLowerCase().includes(q);
  const treeHit = (n) => hit(n) || (n.children || []).some(treeHit);
  return e.id.toString().includes(q) || e.summary.toLowerCase().includes(q) ||
    e.children.some(treeHit) || e.actions.some(hit);
}

function filteredRows() {
  const q = state.q.toLowerCase();
  return DATA.ecrs.filter((e) =>
    (state.seg === "all" || (state.seg === "open" ? e.open : !e.open)) &&
    (!q || ecrContentMatch(e, q)));
}

function renderBody(ecrRows) {
  if (!state.q && state.suppressed.size) state.suppressed.clear();
  const needle = state.q.toLowerCase();
  const hit = (r) => needle && (String(r.id).includes(needle) || r.summary.toLowerCase().includes(needle));

  // column filters prune the tree and force kept ancestor chains open
  const { keep, expand: colExpand } = colFilterSets(ecrRows);
  const expansion = effExpandedSet(ecrRows);
  colExpand.forEach((id) => expansion.add(id));
  effExpanded = expansion;

  const rows = flattenRows(ecrRows, expansion, keep);
  $("t-tbody").innerHTML = rows.length
    ? rows.map((r) => trHTML(r, r.expandable && expansion.has(r.id), hit(r))).join("")
    : `<tr class="t-empty"><td colspan="${orderedCols().length}">${
        colFiltersActive() ? "No rows match the active column filters" : "No ECRs match the current filter"}</td></tr>`;

  // footer counts reflect what column filters leave visible (ECR rows only,
  // inline child rows must not double count)
  const visEcrs = rows.filter((r) => r.kind === "ecr");
  $("t-visible").textContent = visEcrs.length;
  $("t-foot-count").textContent = `${visEcrs.length} of ${DATA.ecrs.length} ECRs`;
  $("t-sum-p").textContent = fmt(visEcrs.reduce((s, e) => s + (e.effort || 0), 0));
  $("t-sum-a").textContent = fmt(visEcrs.reduce((s, e) => s + (e.actual || 0), 0));
  applyCols();
  syncExpandAll(ecrRows, expansion, keep);
  syncClearBtn();
}

/* row click toggles expansion (expandable rows only); drawer access moves to
   a dedicated detail button later, so leaf rows are inert for now */
$("t-tbody").addEventListener("click", (ev) => {
  // the detail button opens the drawer and must not toggle row expansion
  const dbtn = ev.target.closest(".row-detail");
  if (dbtn) { openDrawer(Number(dbtn.dataset.id), dbtn); return; }
  const tr = ev.target.closest("tr.row");
  if (!tr || !tr.classList.contains("expandable")) return;
  const id = Number(tr.dataset.id);
  if (state.q) {
    // visible state = manual ∪ filter overlay; collapsing only suppresses the
    // overlay for this filter session, clearing the filter reverts it
    if (effExpanded.has(id)) state.suppressed.add(id);
    else { state.expanded.add(id); state.suppressed.delete(id); }
  } else {
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
  }
  morphRender(() => renderBody(filteredRows()));
});

function applyCols() {
  // the last visible data column carries the right edge rail (DOM order =
  // orderedCols order, so it follows drag-reordering too)
  const visKeys = orderedCols().filter((c) => c.key !== "chev" && c.key !== "detail" && !state.hidden.has(c.key)).map((c) => c.key);
  const lastKey = visKeys[visKeys.length - 1];
  document.querySelectorAll("#t-tbl [data-col]").forEach((el) => {
    el.style.display = state.hidden.has(el.dataset.col) ? "none" : "";
    el.classList.toggle("edge", el.dataset.col === lastKey);
  });
}

/* columns dropdown: every data column is toggleable; unchecked = hidden.
   Rebuilt (in the current drag order) whenever columns get reordered. */
function buildColsMenu() {
  const pop = $("t-cols-pop");
  pop.innerHTML = orderedCols().filter((c) => c.key !== "chev" && c.key !== "detail").map((c) => `
    <label><input type="checkbox" data-col="${c.key}" ${state.hidden.has(c.key) ? "" : "checked"}> ${c.label}</label>`).join("");
  pop.querySelectorAll("input").forEach((cb) => {
    cb.addEventListener("change", () => {
      cb.checked ? state.hidden.delete(cb.dataset.col) : state.hidden.add(cb.dataset.col);
      applyCols();
    });
  });
}
(function initCols() {
  buildColsMenu();
  const pop = $("t-cols-pop");
  const btn = $("t-cols-btn");
  pop.addEventListener("click", (ev) => ev.stopPropagation());
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = pop.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", open);
  });
  document.addEventListener("click", () => pop.classList.remove("is-open"));
})();

/* ---------- column filter dropdown (Excel-style) ---------- */
const colPop = $("col-pop");
let colPopKey = null;  // column whose dropdown is open
let colPopBtn = null;  // anchor trigger, for re-anchoring on scroll/resize
let colPopVals = [];   // candidate values behind the checkbox list (index -> value)

function toggleColPop(key, btn) {
  colPopKey === key ? closeColPop() : openColPop(key, btn);
}

function openColPop(key, btn) {
  colPopKey = key;
  colPopBtn = btn;
  const col = COLS.find((c) => c.key === key);
  const counts = new Map();
  scopedRows().filter((r) => passesFilters(r, key)).forEach((r) => {
    const v = colVal[key](r);
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  // ascending, numeric-aware when every value is numeric; (Blanks) pinned last
  const vals = [...counts.keys()].filter((v) => v !== "");
  const numeric = vals.length > 0 && vals.every((v) => /^[\d,.]+$/.test(v));
  vals.sort(numeric
    ? (a, b) => parseFloat(a.replace(/,/g, "")) - parseFloat(b.replace(/,/g, ""))
    : (a, b) => a.localeCompare(b));
  if (counts.has("")) vals.push("");
  colPopVals = vals;

  const sel = state.filters.get(key);
  const checkedOf = (v) => (sel ? sel.has(v) : true);
  const item = (v, i) => {
    const disp = v === "" ? "(Blanks)" : v;
    return `<label class="col-pop-item" data-i="${i}" title="${escHTML(disp)}">
      <input type="checkbox"${checkedOf(v) ? " checked" : ""}>
      <span class="v${v === "" ? " blank" : ""}">${escHTML(disp)}</span>
      <span class="n">${counts.get(v)}</span>
    </label>`;
  };
  colPop.innerHTML = `
    <div class="col-pop-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="search" placeholder="Search values" aria-label="Search values in ${escHTML(col.label || "column")}">
    </div>
    <label class="col-pop-item col-pop-all">
      <input type="checkbox" id="col-pop-all">
      <span class="v">(Select All)</span>
      <span class="n" id="col-pop-cnt"></span>
    </label>
    <div class="col-pop-list">${vals.map(item).join("") || `<div class="col-pop-none">No values</div>`}</div>
    <div class="col-pop-foot">
      <button type="button" id="col-pop-clear"${sel ? "" : " disabled"}>Clear filter</button>
    </div>`;

  const list = colPop.querySelector(".col-pop-list");
  const visibleItems = () => [...list.querySelectorAll(".col-pop-item[data-i]")]
    .filter((l) => l.style.display !== "none");
  const syncAll = () => {
    const boxes = visibleItems().map((l) => l.querySelector("input"));
    const on = boxes.filter((b) => b.checked).length;
    const all = $("col-pop-all");
    all.checked = boxes.length > 0 && on === boxes.length;
    all.indeterminate = on > 0 && on < boxes.length;
    $("col-pop-cnt").textContent = `${on}/${boxes.length}`;
  };
  // selection -> state -> re-render the table behind the open panel
  const applyColSel = () => {
    const checked = new Set();
    list.querySelectorAll(".col-pop-item[data-i]").forEach((lab) => {
      if (lab.querySelector("input").checked) checked.add(colPopVals[Number(lab.dataset.i)]);
    });
    const sel = state.filters.get(key);
    // values picked earlier but currently absent from the candidate list keep their state
    if (sel) [...sel].forEach((v) => { if (!colPopVals.includes(v)) checked.add(v); });
    if (checked.size === colPopVals.length) state.filters.delete(key); // everything selected = unfiltered
    else state.filters.set(key, checked);
    renderBody(filteredRows());
    syncFunnelIcons();
    $("col-pop-clear").disabled = !state.filters.has(key);
    syncAll();
  };

  list.addEventListener("change", (ev) => {
    if (ev.target.matches("input")) applyColSel();
  });
  $("col-pop-all").addEventListener("change", (ev) => {
    visibleItems().forEach((l) => { l.querySelector("input").checked = ev.target.checked; });
    applyColSel();
  });
  $("col-pop-clear").addEventListener("click", () => {
    state.filters.delete(key);
    list.querySelectorAll(".col-pop-item[data-i] input").forEach((b) => { b.checked = true; });
    renderBody(filteredRows());
    syncFunnelIcons();
    $("col-pop-clear").disabled = true;
    syncAll();
  });
  const sInput = colPop.querySelector(".col-pop-search input");
  sInput.addEventListener("input", () => {
    const q = sInput.value.trim().toLowerCase();
    list.querySelectorAll(".col-pop-item[data-i]").forEach((lab) => {
      const v = colPopVals[Number(lab.dataset.i)];
      const disp = (v === "" ? "(blanks)" : v).toLowerCase();
      lab.style.display = !q || disp.includes(q) ? "" : "none";
    });
    syncAll();
  });

  positionColPop(btn);
  syncAll();
  btn.setAttribute("aria-expanded", "true");
}

function positionColPop(btn) {
  const card = document.querySelector(".table-card").getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  colPop.hidden = false; // commit content for measuring
  colPop.style.visibility = "hidden";
  colPop.style.left = "0px";
  colPop.style.top = "0px";
  // fit the panel in the viewport: shrink the value list first (96px floor),
  // then open toward whichever side has more room
  const list = colPop.querySelector(".col-pop-list");
  const below = window.innerHeight - br.bottom - 10;
  const above = br.top - 10;
  if (list) {
    const chrome = colPop.offsetHeight - list.offsetHeight; // search + select-all + footer + padding
    if (chrome + 264 > Math.max(below, above)) {
      list.style.maxHeight = Math.max(96, Math.min(264, Math.max(below, above) - chrome)) + "px";
    }
  }
  const w = colPop.offsetWidth, h = colPop.offsetHeight;
  let left = Math.max(4, br.left - card.left);
  if (left + w > card.width - 8) left = Math.max(4, br.right - card.left - w);
  const fitsBelow = br.bottom + 6 + h <= window.innerHeight;
  const fitsAbove = br.top - 6 - h >= 0;
  const topVp = fitsBelow || !fitsAbove ? br.bottom + 6 : br.top - 6 - h;
  colPop.style.left = left + "px";
  colPop.style.top = topVp - card.top + "px";
  colPop.style.visibility = "";
}

function closeColPop() {
  if (colPopKey == null) return;
  colPopKey = null;
  colPopBtn = null;
  colPop.hidden = true;
  $("t-thead").querySelectorAll(".col-fbtn").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

/* scroll/resize keeps the panel anchored under its trigger; it only closes
   when the trigger leaves the viewport or the thead re-renders (sort) */
function reanchorColPop() {
  if (colPopKey == null) return;
  if (!colPopBtn || !colPopBtn.isConnected) { closeColPop(); return; }
  const r = colPopBtn.getBoundingClientRect();
  if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) { closeColPop(); return; }
  positionColPop(colPopBtn);
}

/* outside click dismisses; trigger clicks stopPropagation before this fires */
document.addEventListener("click", (ev) => {
  if (!colPop.hidden && !ev.target.closest("#col-pop")) closeColPop();
});

/* inner scrolling of the value list must not re-anchor; anything else does */
document.addEventListener("scroll", (ev) => {
  if (colPopKey == null) return;
  if (ev.target instanceof Element && ev.target.closest("#col-pop")) return;
  reanchorColPop();
}, true);
window.addEventListener("resize", reanchorColPop);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !colPop.hidden) closeColPop();
});

/* status segmented filter */
function setSeg(s) {
  state.seg = s;
  $("seg").querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x.dataset.s === s));
}
$("seg").querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => { setSeg(b.dataset.s); refresh(); });
});
$("t-filter").addEventListener("input", (ev) => { state.q = ev.target.value.trim(); refresh(); });

/* clear-all button: one action resets seg + text + every column filter;
   visibility is synced from renderBody so every filter path updates it */
function anyTableFilterActive() {
  return state.seg !== "all" || state.q !== "" || colFiltersActive();
}
function syncClearBtn() {
  $("t-clear").hidden = !anyTableFilterActive();
}
function clearAllTableFilters() {
  state.filters.clear();
  syncFunnelIcons();
  setSeg("all");
  state.q = "";
  $("t-filter").value = "";
  refresh();
}
$("t-clear").addEventListener("click", clearAllTableFilters);

/* ---------- global search (⌘K) ----------
   Preview-only: typing never touches the table or the bento cards.
   Picking a result navigates — reset conflicting table filters first,
   then locate, expand and flash; the query itself stays in the box. */
const gsearch = $("global-search");
const gpanel = $("search-panel");
document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    gsearch.focus();
    gsearch.select();
  }
});

/* searchable index: every WI/Action entity once, mapped to its root ECR
   (+ parent links so picking a child can expand its full ancestor chain) */
const WI_INDEX = [], WI_ROOT = new Map(), WI_PARENT = new Map(),
      ACTION_INDEX = [], ACTION_ROOT = new Map();
(() => {
  const seen = new Set();
  const walk = (n, root, parent) => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      WI_INDEX.push({ id: n.id, summary: n.summary, open: n.open });
      WI_ROOT.set(n.id, root);
      WI_PARENT.set(n.id, parent);
    }
    (n.children || []).forEach((c) => walk(c, root, n.id));
  };
  DATA.ecrs.forEach((e) => {
    e.children.forEach((c) => walk(c, e.id, e.id));
    e.actions.forEach((a) => {
      if (!ACTION_ROOT.has(a.id)) {
        ACTION_INDEX.push({ id: a.id, summary: a.summary, open: a.open });
        ACTION_ROOT.set(a.id, e.id);
      }
    });
  });
})();

const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* escape, then wrap needle matches in <mark> */
const hl = (text, needle) => {
  if (!needle) return escHTML(text);
  const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text).split(new RegExp(`(${safe})`, "ig"))
    .map((part, i) => (i % 2 ? `<mark>${escHTML(part)}</mark>` : escHTML(part))).join("");
};

const Search = { q: "", results: [], totals: null, active: -1, open: false, timer: null };

function searchEntities(q) {
  const needle = q.toLowerCase();
  const digits = /^\d+$/.test(q) ? q : null;
  const group = (items, name, rootOf, byCreated) => {
    const hits = items.filter((it) =>
      String(it.id).toLowerCase().includes(needle) || it.summary.toLowerCase().includes(needle));
    hits.sort((a, b) => {
      if (digits) {
        const pa = String(a.id).startsWith(digits) ? 0 : 1;
        const pb = String(b.id).startsWith(digits) ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return byCreated ? (a.created < b.created ? 1 : -1) : Number(b.id) - Number(a.id);
    });
    return { name, hits, shown: hits.slice(0, 5).map((it) => ({ group: name, item: it, rootId: rootOf(it) })) };
  };
  const groups = [
    group(DATA.ecrs, "ecr", (it) => it.id, true),
    group(WI_INDEX, "wi", (it) => WI_ROOT.get(it.id), false),
    group(ACTION_INDEX, "action", (it) => ACTION_ROOT.get(it.id), false),
  ];
  return { flat: groups.flatMap((g) => g.shown), totals: new Map(groups.map((g) => [g.name, g.hits.length])) };
}

const GROUP_LABEL = { ecr: "ECRs", wi: "Work Items", action: "Actions" };

function rowHTML(r, i) {
  const meta = r.group === "ecr" ? r.item.created : `∈ ${r.rootId}`;
  return `<div class="search-row" role="option" id="search-opt-${i}" data-idx="${i}" aria-selected="false">
    <span class="dot ${r.item.open ? "open" : "closed"}"></span>
    <span class="s-id">${hl(r.item.id, Search.q)}</span>
    <span class="s-sum" title="${escHTML(r.item.summary)}">${hl(r.item.summary, Search.q)}</span>
    <span class="s-meta">${meta}</span>
  </div>`;
}

function syncActiveAria() {
  gsearch.setAttribute("aria-activedescendant", Search.active < 0 ? "" : `search-opt-${Search.active}`);
}

function syncActive(scroll) {
  gpanel.querySelectorAll(".search-row.active").forEach((el) => {
    el.classList.remove("active");
    el.setAttribute("aria-selected", "false");
  });
  if (Search.active < 0 || !Search.results.length) { syncActiveAria(); return; }
  const el = gpanel.querySelector(`[data-idx="${Search.active}"]`);
  if (!el) return;
  el.classList.add("active");
  el.setAttribute("aria-selected", "true");
  syncActiveAria();
  if (scroll) el.scrollIntoView({ block: "nearest" });
}

function renderPanel() {
  if (!Search.results.length) {
    gpanel.innerHTML = `<div class="search-empty">No results for &ldquo;${escHTML(Search.q)}&rdquo;</div>`;
    syncActiveAria();
    return;
  }
  let html = "", last = null;
  Search.results.forEach((r, i) => {
    if (r.group !== last) {
      last = r.group;
      html += `<div class="search-ghead"><span>${GROUP_LABEL[last]}</span><span class="cnt">${Search.totals.get(last)}</span></div>`;
    }
    html += rowHTML(r, i);
  });
  html += `<div class="search-foot"><span>↑↓ navigate</span><span>Enter open</span><span>Esc close</span></div>`;
  gpanel.innerHTML = html;
  syncActive(false);
}

function openPanel() {
  if (Search.timer) { clearTimeout(Search.timer); Search.timer = null; }
  gpanel.hidden = false;
  gpanel.getBoundingClientRect(); // commit pre-open styles so the transition runs
  gpanel.classList.add("open");
  Search.open = true;
  gsearch.setAttribute("aria-expanded", "true");
}

function closePanel() {
  gpanel.classList.remove("open");
  Search.timer = setTimeout(() => { gpanel.hidden = true; }, 160);
  Search.open = false;
  gsearch.setAttribute("aria-expanded", "false");
}

/* brief accent wash on the located row / expanded child item */
function flash(el) {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation on repeat selections
  el.classList.add("flash");
  el.addEventListener("animationend", () => el.classList.remove("flash"), { once: true });
}

/* graph twin of flash(): the transformed canvas has no scroll container, so
   panning carries the card into view instead of scrollIntoView */
function flashGraphNode(key) {
  const el = Graph._nodeEls.get(key);
  if (!el) return; // target hidden by the current graph filter — nothing to flash
  Graph._revealCard(key);
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  el.addEventListener("animationend", () => el.classList.remove("flash"), { once: true });
}

function selectResult(r) {
  closePanel();
  let changed = false;
  if (state.seg !== "all") { setSeg("all"); changed = true; }
  if (state.q !== "") { state.q = ""; $("t-filter").value = ""; changed = true; }
  if (changed) refresh(); // restore the full table before locating
  const rootId = r.group === "ecr" ? r.item.id : r.rootId;
  // expand the full ancestor chain, then flash the picked row (child rows are
  // inline now, so the target itself is always a table row)
  state.expanded.add(rootId);
  if (r.group === "wi") {
    let cur = WI_PARENT.get(r.item.id);
    while (cur != null && cur !== rootId) { state.expanded.add(cur); cur = WI_PARENT.get(cur); }
  }
  renderBody(filteredRows());
  let tr = document.querySelector(`#t-tbody tr.row[data-id="${r.item.id}"]`);
  if (!tr && colFiltersActive()) {
    // column filters can hide the target row too; selection wins, so drop them
    state.filters.clear();
    syncFunnelIcons();
    renderBody(filteredRows());
    tr = document.querySelector(`#t-tbody tr.row[data-id="${r.item.id}"]`);
  }
  if (tr) flash(tr);
  gsearch.blur();
}

gsearch.addEventListener("input", () => {
  Search.q = gsearch.value.trim();
  if (!Search.q) { closePanel(); return; }
  const res = searchEntities(Search.q);
  Search.results = res.flat;
  Search.totals = res.totals;
  Search.active = Search.results.length ? 0 : -1;
  renderPanel();
  openPanel();
});
gsearch.addEventListener("focus", () => {
  if (Search.q) { renderPanel(); openPanel(); }
});
gsearch.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (!Search.open || !Search.results.length) return;
    ev.preventDefault();
    const dir = ev.key === "ArrowDown" ? 1 : -1;
    Search.active = (Search.active + dir + Search.results.length) % Search.results.length;
    syncActive(true);
  } else if (ev.key === "Enter") {
    if (!Search.open || !Search.results.length) return;
    ev.preventDefault();
    selectResult(Search.results[Search.active]);
  } else if (ev.key === "Escape") {
    ev.preventDefault(); // first Esc keeps the query; native search-input clear is manual
    if (Search.open) { ev.stopPropagation(); closePanel(); }
    else if (gsearch.value) { gsearch.value = ""; Search.q = ""; }
  }
});
/* tabbing away must not leave an orphan flyout next to a collapsed rail
   (result rows are mousedown-prevented, so selecting never triggers this) */
gsearch.addEventListener("blur", () => { if (Search.open) closePanel(); });
/* pressing a result row must not move focus off the input */
gpanel.addEventListener("mousedown", (ev) => {
  if (ev.target.closest(".search-row")) ev.preventDefault();
});
gpanel.addEventListener("mouseover", (ev) => {
  const row = ev.target.closest(".search-row");
  if (!row) return;
  const idx = Number(row.dataset.idx);
  if (idx !== Search.active) { Search.active = idx; syncActive(false); }
});
gpanel.addEventListener("click", (ev) => {
  const row = ev.target.closest(".search-row");
  if (!row) return;
  selectResult(Search.results[Number(row.dataset.idx)]);
});
document.addEventListener("mousedown", (ev) => {
  // the panel is no longer inside the search pill, so it must count as "inside"
  if (Search.open && !ev.target.closest(".exs, #search-panel")) closePanel();
});

/* ✕ clears the query; the synthetic input event reuses the normal
   empty-query path (closes the panel), and focus stays in the pill */
$("exs-clear").addEventListener("mousedown", (ev) => ev.preventDefault());
$("exs-clear").addEventListener("click", () => {
  gsearch.value = "";
  gsearch.dispatchEvent(new Event("input"));
  gsearch.focus();
});

/* print: hand the whole page to the browser's print dialog; the @media print
   stylesheet strips the floating chrome and lets the table run full length */
$("rail-print").addEventListener("click", () => window.print());

/* one refresh re-scopes cards, scope cue and table from the same result set */
function refresh() {
  const rows = filteredRows();
  renderCards(rows);
  const scoped = state.q !== "" || state.seg !== "all";
  $("bento-scope").hidden = !scoped;
  if (scoped) {
    $("scope-text").innerHTML = `Cards reflect <b>${rows.length}</b> of ${DATA.ecrs.length} ECRs`;
  }
  renderBody(rows);
}
$("scope-clear").addEventListener("click", clearAllTableFilters);

/* ---------- detail drawer ----------
   Docked inspection sheet opened by the table's row-detail buttons. Renders
   the full record grouped Core / Dates / Effort / Relations (locked content
   spec §5, mockup field subset); relations navigate in place and keep the
   table behind in sync: expand the ancestor chain, re-render, flash. */
const DRAWER_DEFAULT_W = 440, DRAWER_MIN_W = 320, DRAWER_MAX_W = 960;
let drawerW = DRAWER_DEFAULT_W; // session-persistent width, survives open/close
let drawerSeq = 0;              // guards the hide-after-transition timer
const drawerState = { open: false, kind: null, id: null, trigger: null };
const drawerEl = $("drawer"), drawerScrim = $("drawer-scrim"),
      drawerBody = $("drawer-body"), drawerHandle = $("drawer-handle");

/* entity index: every ECR / WI / Action / Build once (shared entities are
   unique in the payload), with parent + root ids so relations can navigate.
   `parents` lists EVERY referencing parent from the graph edges (shared
   entities carry several — decision #39); `parent`/`root` keep the tree
   position the Home-table sync uses. Parents sort newest-first. */
const DRAWER_INDEX = new Map();
(() => {
  const parentsOf = new Map();
  for (const rel of ["work_items", "actions", "work_item_for"]) {
    for (const [p, c] of GRAPH.edges[rel] || []) {
      if (!parentsOf.has(c)) parentsOf.set(c, []);
      parentsOf.get(c).push(p);
    }
  }
  for (const list of parentsOf.values()) list.sort((a, b) => Number(b) - Number(a));
  const parentsOfId = (id, fallback) => {
    const list = parentsOf.get(id);
    return list && list.length ? list : (fallback != null ? [fallback] : []);
  };
  const addWi = (n, parent, root) => {
    if (!DRAWER_INDEX.has(n.id))
      DRAWER_INDEX.set(n.id, { kind: "wi", node: n, parent, root, parents: parentsOfId(n.id, parent) });
    (n.children || []).forEach((c) => addWi(c, n.id, root));
  };
  DATA.ecrs.forEach((e) => {
    DRAWER_INDEX.set(e.id, { kind: "ecr", node: e, parent: null, root: e.id, parents: [] });
    e.children.forEach((c) => addWi(c, e.id, e.id));
    e.actions.forEach((a) => {
      if (!DRAWER_INDEX.has(a.id))
        DRAWER_INDEX.set(a.id, { kind: "action", node: a, parent: e.id, root: e.id, parents: [e.id] });
    });
  });
  // builds live outside the DATA tree; parents come from the graph edges
  (DATA.builds || []).forEach((b) => {
    const parents = parentsOf.get(b.id) || [];
    DRAWER_INDEX.set(b.id, { kind: "build", node: b, parent: parents[0] ?? null,
                             root: parents[0] ?? null, parents });
  });
})();

/* "—" marks a present-but-empty field; fields that don't exist on a kind are
   omitted entirely (dt/dd pairs are built per kind) */
const kv = (label, v) => (v == null || v === ""
  ? `<dt>${label}</dt><dd class="empty">—</dd>`
  : `<dt>${label}</dt><dd>${escHTML(String(v))}</dd>`);
const typeOf = (n) => n.type || "ALM_Change Request"; // ecr nodes carry no type
const badgeOf = (n, small) => {
  const m = TYPE_META[typeOf(n)];
  return m ? `<span class="type-badge${small ? " sm" : ""} ${m.cls}" title="${m.name}">${m.tag}</span>` : "";
};

/* full-field sheet (decision #9): the payload carries every config field per
   item in ITEMS; known fields map into semantic groups per kind, and columns
   the config may add later land in a trailing "More" group so no field
   silently disappears from the sheet. Builds carry no effort/review fields
   in PTC — their variant is Core + Dates + Relations (decision #39). */
const FIELD_LABELS = {
  type: "Type", state: "State", process_area: "Process Area",
  classification: "Classification", owners: "Owners", analysers: "Analysers",
  team: "Team", project: "Project", maturity_level: "Maturity",
  affected_objects: "Affected Objects",
  created_date: "Created", planned_start_date: "Planned Start",
  planned_prepared_date: "Planned Prepared",
  planned_completion_date: "Planned Completion", target_date: "Target Date",
  analysis_target_date: "Analysis Target", first_build_date: "First Build",
  closed_date: "Closed",
  planned_effort: "Planned Effort",
  rollup_planned_effort: "Rollup Planned Effort",
  rollup_actual_effort: "Rollup Actual Effort",
  remaining_effort: "Remaining Effort",
  rough_effort_estimation: "Rough Estimation",
  defined_state_duration: "Defined Duration",
  planned_state_duration: "Planned Duration",
  started_state_duration: "Started Duration",
  implemented_state_duration: "Implemented Duration",
  prepared_state_duration: "Prepared Duration",
  review_owners_ref: "Review Owners", review_cycle_count: "Review Cycles",
  review_planned_start_date_ref: "Review Planned Start",
  review_planned_completion_date_ref: "Review Planned Completion",
  work_items: "Work Items", actions: "Actions",
  work_item_for: "Work Item For", change_request_for: "Change Request For",
  action_for: "Action For", spawns: "Spawns", spawned_by: "Spawned By",
};
/* review "Date Ref" columns store raw Excel serial numbers — convert for
   display with the 1899-12-30 epoch (content spec §7 rule 4) */
const EXCEL_SERIAL_FIELDS = new Set([
  "review_planned_start_date_ref", "review_planned_completion_date_ref",
]);
const excelDate = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return v; // not a serial — show the raw text
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
    .toISOString().slice(0, 10);
};
const STRUCTURAL_FIELDS = new Set(["id", "kind", "level", "summary"]); // header / tree concerns, not sheet rows

const drawerValue = (f, v) => {
  if (v == null || v === "") return v;
  if (f === "type") { const m = TYPE_META[v]; return m ? m.name : v; }
  return EXCEL_SERIAL_FIELDS.has(f) ? excelDate(v) : v;
};
const drawerFieldRows = (raw, fields) =>
  fields.map((f) => kv(FIELD_LABELS[f] || f, drawerValue(f, raw[f])));

function drawerSections(entry) {
  const raw = ITEMS[entry.node.id] || {};
  const kind = entry.kind;
  const sec = (label, rows) => `<section class="drawer-sec"><h3 class="drawer-label">${label}</h3><dl class="kv">${rows.join("")}</dl></section>`;
  const core = ["type", "state", "classification", "owners", "analysers",
                "team", "project", "affected_objects"];
  if (kind === "wi") core.splice(2, 0, "process_area");
  if (kind === "build") core.splice(2, 0, "maturity_level");
  const dates = ["created_date", "planned_start_date", "planned_prepared_date",
                 "planned_completion_date"];
  if (kind === "action" || kind === "build") dates.push("target_date");
  if (kind === "ecr") dates.push("analysis_target_date");
  dates.push("first_build_date", "closed_date");
  let html = sec("Core", drawerFieldRows(raw, core)) +
             sec("Dates", drawerFieldRows(raw, dates));
  if (kind !== "build") {
    html += sec("Effort & Durations", drawerFieldRows(raw, [
      "planned_effort", "rollup_planned_effort", "rollup_actual_effort",
      "remaining_effort", "rough_effort_estimation",
      "defined_state_duration", "planned_state_duration",
      "started_state_duration", "implemented_state_duration",
      "prepared_state_duration",
    ]));
    html += sec("Review", drawerFieldRows(raw, [
      "review_owners_ref", "review_cycle_count",
      "review_planned_start_date_ref", "review_planned_completion_date_ref",
    ]));
    html += sec("Links", drawerFieldRows(raw, [
      "work_items", "actions", "work_item_for", "change_request_for",
      "action_for", "spawns", "spawned_by",
    ]));
  }
  // columns added to ECR_Config.xlsx later: unmapped keys still get a row
  const more = Object.keys(raw)
    .filter((k) => !STRUCTURAL_FIELDS.has(k) && !(k in FIELD_LABELS))
    .sort();
  if (more.length) {
    html += sec("More", more.map((k) =>
      kv(k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), raw[k])));
  }
  return html;
}

function relRow(e) {
  return `<button type="button" class="rel-row" data-rel-id="${e.node.id}">${badgeOf(e.node, true)}<span class="r-id">${escHTML(String(e.node.id))}</span>${e.node.summary ? `<span class="r-sum">${escHTML(e.node.summary)}</span>` : ""}</button>`;
}

function relationsHTML(entry) {
  const n = entry.node;
  const rows = [];
  // every referencing parent (shared entities list them all — #39);
  // parents are already newest-first from the index build
  for (const p of entry.parents || []) rows.push(relRow(DRAWER_INDEX.get(p)));
  if (entry.kind === "ecr") {
    n.children.forEach((c) => rows.push(relRow(DRAWER_INDEX.get(c.id))));
    n.actions.forEach((a) => rows.push(relRow(DRAWER_INDEX.get(a.id))));
  } else if (entry.kind === "wi") {
    (n.children || []).forEach((c) => rows.push(relRow(DRAWER_INDEX.get(c.id))));
  }
  const chips = [];
  if (entry.kind === "ecr") {
    if (n.wiTotal) chips.push(`<span class="chip">${n.wiTotal} WI</span>`);
    if (n.actionTotal) chips.push(`<span class="chip">${n.actionTotal} A</span>`);
  } else if (entry.kind === "wi" && (n.children || []).length) {
    chips.push(`<span class="chip">${n.children.length} WI</span>`);
  } else if (entry.kind === "build" && entry.parents.length > 1) {
    chips.push(`<span class="chip">shared · ${entry.parents.length} ECRs</span>`);
  }
  const body = rows.length ? rows.join("") : `<p class="rel-empty">No related items</p>`;
  return `<section class="drawer-sec"><h3 class="drawer-label">Relations${
    chips.length ? `<span class="rel-chips">${chips.join("")}</span>` : ""}</h3>${body}</section>`;
}

function renderDrawer() {
  const entry = DRAWER_INDEX.get(drawerState.id);
  const n = entry.node;
  $("drawer-idrow").innerHTML = `${badgeOf(n)}<span class="drawer-ent-id">${escHTML(String(n.id))}</span>` +
    `<span class="badge ${n.open ? "open" : "closed"}">${n.open ? "Open" : "Closed"}</span>` +
    (n.overdue ? `<span class="badge late">Overdue</span>` : "");
  $("drawer-title").textContent = n.summary || "";
  drawerBody.innerHTML = drawerSections(entry) + relationsHTML(entry);
  drawerBody.scrollTop = 0; // a new entity always starts reading from the top
}

/* anchor highlight follows the drawer across relation navigation: in Home
   it marks the table row, in Graph the node card carries the selection ring
   (#39). Passing null clears every anchor (close path). The scrim keeps the
   view static while open, so no re-render can drop the class. */
function markDetailRow(id) {
  document.querySelectorAll("#t-tbody tr.detail-open").forEach((tr) => tr.classList.remove("detail-open"));
  document.querySelectorAll("#g-canvas .gn.selected").forEach((gn) => gn.classList.remove("selected"));
  if (id == null) return;
  if (document.body.dataset.view === "graph") {
    const gn = document.querySelector(`#g-canvas .gn[data-key="${id}"]`);
    if (gn) gn.classList.add("selected");
  } else {
    const tr = document.querySelector(`#t-tbody tr.row[data-id="${id}"]`);
    if (tr) tr.classList.add("detail-open");
  }
}

function setDrawerWidth(w) {
  const max = Math.min(window.innerWidth * 0.92, DRAWER_MAX_W);
  drawerW = Math.round(Math.min(max, Math.max(DRAWER_MIN_W, w)));
  drawerEl.style.width = drawerW + "px";
  drawerHandle.setAttribute("aria-valuenow", String(drawerW));
}

function openDrawer(id, trigger) {
  const entry = DRAWER_INDEX.get(id);
  if (!entry) return;
  drawerSeq++;
  drawerState.open = true;
  drawerState.kind = entry.kind;
  drawerState.id = id;
  if (trigger && trigger.isConnected) drawerState.trigger = trigger;
  setDrawerWidth(drawerW); // re-clamp: the window may have shrunk while closed
  renderDrawer();
  markDetailRow(id);
  drawerEl.hidden = false;
  drawerScrim.hidden = false;
  void drawerEl.offsetWidth; // restart the enter transition (search-panel trick)
  drawerEl.classList.add("open");
  drawerScrim.classList.add("open");
  document.body.classList.add("drawer-open");
  $("drawer-close").focus();
}

function closeDrawer() {
  if (!drawerState.open) return;
  drawerState.open = false;
  markDetailRow(null); // the anchor ring dies with the sheet
  drawerEl.classList.remove("open");
  drawerScrim.classList.remove("open");
  document.body.classList.remove("drawer-open");
  const seq = ++drawerSeq;
  setTimeout(() => {
    if (seq !== drawerSeq) return; // reopened before the exit finished
    drawerEl.hidden = true;
    drawerScrim.hidden = true;
  }, 300);
  const t = drawerState.trigger;
  if (t && t.isConnected) t.focus();
}

function navigateDrawer(id) {
  const entry = DRAWER_INDEX.get(id);
  if (!entry) return;
  drawerState.kind = entry.kind;
  drawerState.id = id;
  if (document.body.dataset.view === "graph") {
    // reveal in-graph (#39): expand the primary (newest) parent chain, then
    // pan the card into view and flash it; the Home table stays untouched
    const chain = [];
    let cur = entry.parents[0] ?? entry.parent ?? null;
    while (cur != null && !chain.includes(cur)) {
      chain.push(cur);
      const pe = DRAWER_INDEX.get(cur);
      cur = pe ? (pe.parents[0] ?? pe.parent ?? null) : null;
    }
    chain.forEach((pid) => Graph._expanded.add(String(pid)));
    Graph.render();
    markDetailRow(id);
    flashGraphNode(String(id));
  } else {
    // the table behind follows: expand the ancestor chain, re-render, flash
    state.expanded.add(entry.root);
    let cur = entry.parent;
    while (cur != null && cur !== entry.root) { state.expanded.add(cur); cur = DRAWER_INDEX.get(cur).parent; }
    renderBody(filteredRows());
    markDetailRow(id);
    const tr = document.querySelector(`#t-tbody tr.row[data-id="${id}"]`);
    if (tr) flash(tr);
  }
  renderDrawer(); // swap content in place; the sheet is already on screen
  $("drawer-title").focus(); // the clicked row left the DOM; anchor focus in the new content
}

drawerBody.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".rel-row");
  if (btn) navigateDrawer(Number(btn.dataset.relId));
});
drawerScrim.addEventListener("click", closeDrawer);
$("drawer-close").addEventListener("click", closeDrawer);

/* Esc closes (other overlays are already dismissed by the opening click);
   Tab is trapped inside the sheet while it is open */
document.addEventListener("keydown", (ev) => {
  if (!drawerState.open) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    closeDrawer();
  } else if (ev.key === "Tab") {
    const focusables = drawerEl.querySelectorAll("button, [href], [tabindex=\"0\"]");
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (!drawerEl.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
});

/* width: drag the left edge, double-click resets, arrow keys step 24px
   (edge out = wider); the value survives close/reopen within the session */
drawerHandle.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  drawerHandle.setPointerCapture(ev.pointerId);
  drawerHandle.classList.add("dragging");
  document.body.classList.add("drawer-resizing");
});
drawerHandle.addEventListener("pointermove", (ev) => {
  if (!drawerHandle.classList.contains("dragging")) return;
  setDrawerWidth(window.innerWidth - ev.clientX);
});
const endDrawerDrag = () => {
  drawerHandle.classList.remove("dragging");
  document.body.classList.remove("drawer-resizing");
};
drawerHandle.addEventListener("pointerup", endDrawerDrag);
drawerHandle.addEventListener("pointercancel", endDrawerDrag);
drawerHandle.addEventListener("dblclick", () => setDrawerWidth(DRAWER_DEFAULT_W));
drawerHandle.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowLeft") setDrawerWidth(drawerW + 24);
  else if (ev.key === "ArrowRight") setDrawerWidth(drawerW - 24);
  else return;
  ev.preventDefault();
});
window.addEventListener("resize", () => { if (drawerState.open) setDrawerWidth(drawerW); });
setDrawerWidth(drawerW); // apply the session width before the first open

/* ---------- export to Excel (.xlsx) ----------
   Scope mirrors the table: status + text + per-column filters and the active
   hierarchical sort all apply, and columns are exactly the visible ones (the
   structural chevron/detail columns drop). Unlike the canvas the export is
   always fully expanded — the collapsed-by-default table would otherwise
   export 10 bare ECR rows.
   Hierarchy reads twice, like on the web: the ID cell keeps its depth indent,
   and rows carry Excel outline levels (summary above, ECR groups pre-collapsed)
   so the left +/- gutter walks the tree like the chevrons do.
   The package is assembled by a minimal stored-entry ZIP writer (no
   compression, CRC32 only) — a real .xlsx with zero dependencies. */
const XlsxExport = (() => {
  const ESC = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const colLetter = (i) => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

  /* ---- minimal ZIP (stored entries) ---- */
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >>> 1);
    const dDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data);
      const lh = new Uint8Array(30 + name.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); lv.setUint16(10, dTime, true);
      lv.setUint16(12, dDate, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, f.data.length, true); lv.setUint32(22, f.data.length, true);
      lv.setUint16(26, name.length, true);
      lh.set(name, 30);
      parts.push(lh, f.data);
      const ch = new Uint8Array(46 + name.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(12, dTime, true); cv.setUint16(14, dDate, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true);
      cv.setUint32(24, f.data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + f.data.length;
    }
    const cenLen = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true); ev.setUint32(12, cenLen, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, eocd],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---- style catalog (cellXfs indices) ----
     0 default · 1 header · 2 number · 3..5 ID indent 1..3 ·
     6 open state · 7 closed state · 8 overdue · 9 ID level 0.
     ID styles force horizontal="left" — without it Excel right-aligns the
     numeric IDs and pushes the indent in from the right edge. */
  const S = { def: 0, head: 1, num: 2, id0: 9, id1: 3, id2: 4, id3: 5, open: 6, closed: 7, late: 8 };
  const STYLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><color rgb="FF020520"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF374151"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF8A4D00"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF0C7A24"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FFB4232F"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2E4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE1F8E4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDEAE9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" indent="2"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" indent="3"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /* value + style per column, mirroring the web cell semantics: state/overdue
     keep their badge colors, numbers stay numeric, other text uses the same
     display strings the column filters see */
  function exportCell(col, r) {
    switch (col.key) {
      case "id": return { v: Number(r.id), s: r.depth ? S["id" + Math.min(r.depth, 3)] : S.id0 };
      case "planned": return r.effort == null ? null : { v: r.effort, s: S.num };
      case "rollupPlanned": return r.rollupPlanned == null ? null : { v: r.rollupPlanned, s: S.num };
      case "actual": return r.actual == null ? null : { v: r.actual, s: S.num };
      case "children": return r.chips.length ? { v: r.chips.map(([n, t]) => `${n} ${t}`).join(" · ") } : null;
      case "state": return r.state ? { v: colVal.state(r), s: r.open ? S.open : S.closed } : null;
      case "overdue": return r.overdue ? { v: "Overdue", s: S.late } : null;
      default: {
        const v = colVal[col.key](r);
        return v === "" ? null : { v };
      }
    }
  }

  function sheetXml(cols, rows) {
    const widths = cols.map((c, i) => {
      let w = c.label.length + 4;
      for (const r of rows) {
        const v = r.cells[i];
        if (v) w = Math.max(w, String(v.v).length + (c.key === "id" ? r.depth * 2 : 0) + 3);
      }
      return Math.min(52, Math.max(9, Math.round(w)));
    });
    const head = `<row r="1" ht="20" customHeight="1">` + cols.map((c, i) =>
      `<c r="${colLetter(i)}1" s="${S.head}" t="inlineStr"><is><t xml:space="preserve">${ESC(c.label)}</t></is></c>`).join("") + `</row>`;
    const body = rows.map((r, ri) => {
      const rn = ri + 2;
      const attrs = (r.depth ? ` outlineLevel="${Math.min(r.depth, 3)}" hidden="1"` : "") +
        (r.expandable ? ` collapsed="1"` : "");
      const cells = cols.map((c, i) => {
        const v = r.cells[i];
        if (!v || v.v === "" || v.v == null) return "";
        const ref = colLetter(i) + rn;
        return typeof v.v === "number" && isFinite(v.v)
          ? `<c r="${ref}" s="${v.s ?? S.num}"><v>${v.v}</v></c>`
          : `<c r="${ref}" s="${v.s ?? S.def}" t="inlineStr"><is><t xml:space="preserve">${ESC(v.v)}</t></is></c>`;
      }).join("");
      return `<row r="${rn}"${attrs}>${cells}</row>`;
    }).join("");
    const colXml = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[i]}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16" outlineLevelRow="3" summaryBelow="0"/>
<cols>${colXml}</cols>
<sheetData>${head}${body}</sheetData>
<autoFilter ref="A1:${colLetter(cols.length - 1)}1"/>
</worksheet>`;
  }

  function export_() {
    const ecrRows = filteredRows();
    const { keep } = colFilterSets(ecrRows);
    // expand-everything set: the flattening walks the full tree
    const expandAll = new Set();
    const markAll = (n) => { if (n.expandable) expandAll.add(n.id); n.kids.forEach(markAll); };
    ecrRows.forEach((e) => markAll(normEcr(e, 0)));
    const flat = flattenRows(ecrRows, expandAll, keep);
    const cols = orderedCols().filter((c) => c.key !== "chev" && c.key !== "detail" && !state.hidden.has(c.key));
    const rows = flat.map((r) => ({
      depth: r.depth, expandable: r.expandable,
      cells: cols.map((c) => exportCell(c, r)),
    }));
    const enc = new TextEncoder();
    const blob = zipStore([
      { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`) },
      { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) },
      { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="ECRs" sheetId="1" r:id="rId1"/></sheets>
</workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`) },
      { name: "xl/styles.xml", data: enc.encode(STYLE_XML) },
      { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(cols, rows)) },
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ECRs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  return { export: export_ };
})();

/* the button hands the built package straight to the browser's downloader */
$("t-export").addEventListener("click", () => XlsxExport.export());

/* ---------- Graph view ----------
   Horizontal relationship tree — ECR → Work Item L0-L2 / Action / Build —
   ported from the ReadAcross ProjectTree skeleton, re-skinned in this page's
   language. Locked decisions (dashboard-content.md §6, #34-38): all-collapsed
   by default, the right-edge toggle carries the direct-child count (hover
   swaps it for +, expanded shows −); shared entities render once under their
   first referencing parent (newest ECR wins the claim), further parents draw
   dashed cross edges to the claimed position; node click only selects — the
   detail drawer stays table-only for now. Status seg and in-graph search use
   tree semantics: a node survives when its own state matches (or it hits the
   needle) or any descendant does, so paths to matches stay visible. */
const GRAPH_COLOR = {
  "ALM_Change Request": "#46d6a0", "ALM_Task": "#ffc24a",
  "ALM_Work Package": "#6d8cff", "ALM_Action": "#ff8f6d", "ALM_Build": "#7c6cf6",
};
const KIND_LABEL = { ecr: "ECR", work_item: "Work Item", action: "Action", build: "Build" };

/* horizontal S-curve with rounded corners (ported treeLinkPath) */
function gLinkPath(x1, y1, x2, y2) {
  if (Math.abs(y2 - y1) < 1) return `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;
  const mx = (x1 + x2) / 2, dir = y2 > y1 ? 1 : -1;
  const r = Math.min(10, Math.abs(y2 - y1) / 2);
  return `M${x1.toFixed(1)},${y1.toFixed(1)}` +
    ` L${(mx - r).toFixed(1)},${y1.toFixed(1)}` +
    ` Q${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${(y1 + dir * r).toFixed(1)}` +
    ` L${mx.toFixed(1)},${(y2 - dir * r).toFixed(1)}` +
    ` Q${mx.toFixed(1)},${y2.toFixed(1)} ${(mx + r).toFixed(1)},${y2.toFixed(1)}` +
    ` L${x2.toFixed(1)},${y2.toFixed(1)}`;
}

const Graph = {
  W: 240, COL_GAP: 76, ROW_GAP: 18, PAD: 28,
  _byId: new Map(), _kids: new Map(), _parents: new Map(), _roots: [],
  _status: "all", _q: "",
  _expanded: new Set(),        // manual expansion, keyed by id; persists across re-renders
  _searchCollapsed: new Set(), // nodes manually collapsed during a search
  _mode: new Map(),            // ECR id -> "team" | "pa" dimension mode (#41)
  _scale: 1, _tx: 0, _ty: 0, _W: 0, _H: 0,
  _nodeEls: new Map(), _leaving: new Map(),
  _linkEls: new Map(), _linksLeaving: new Map(),
  _nodeH: 0, _inited: false,

  show() {
    if (!this._inited) {
      this._index();
      this._bindChrome();
      this._bindPanZoom();
      this._inited = true;
      this.render();
      this._centerOnce();
    } else {
      this.render();
    }
  },

  /* first paint: a canvas smaller than the viewport reads composed centered,
     not pinned to the top-left corner */
  _centerOnce() {
    const vp = $("g-viewport");
    if (!vp) return;
    const free = vp.clientHeight - this._H * this._scale;
    if (free > 80) this._ty = Math.round(free / 2);
    this._applyTransform();
  },

  /* ---- index (built once): flat nodes + the three relations ---- */
  _index() {
    if (this._byId.size) return;
    for (const n of GRAPH.nodes) this._byId.set(n.id, n);
    for (const rel of ["work_items", "actions", "work_item_for"]) {
      for (const [p, c] of GRAPH.edges[rel] || []) {
        if (!this._byId.has(p) || !this._byId.has(c)) continue;
        if (!this._kids.has(p)) this._kids.set(p, []);
        this._kids.get(p).push(c);
        if (!this._parents.has(c)) this._parents.set(c, []);
        this._parents.get(c).push(p);
      }
    }
    for (const list of this._kids.values()) list.sort((a, b) => Number(b) - Number(a));
    // roots: ECRs newest-first, the same default order as the Home table
    this._roots = [...this._byId.values()].filter((n) => n.kind === "ecr")
      .sort((a, b) => a.created < b.created ? 1 : a.created > b.created ? -1 : Number(b.id) - Number(a.id));
  },

  /* ---- per-render memoized filters ----
     match: own id/summary needle hit; hasHit: self or any structural
     descendant hits; survives: status seg with tree semantics. */
  _memos() {
    const q = this._q.toLowerCase(), seg = this._status;
    const mM = new Map(), hM = new Map(), sM = new Map();
    const match = (id) => {
      if (!q) return false;
      let r = mM.get(id);
      if (r !== undefined) return r;
      const n = this._byId.get(id);
      r = String(id).includes(q) || (n.summary || "").toLowerCase().includes(q);
      mM.set(id, r);
      return r;
    };
    const hasHit = (id) => {
      if (!q) return false;
      let r = hM.get(id);
      if (r !== undefined) return r;
      r = match(id);
      if (!r) for (const k of this._kids.get(id) || []) { if (hasHit(k)) { r = true; break; } }
      hM.set(id, r);
      return r;
    };
    const survives = (id) => {
      if (seg === "all") return true;
      let r = sM.get(id);
      if (r !== undefined) return r;
      const n = this._byId.get(id);
      r = seg === "open" ? n.open : !n.open;
      if (!r) for (const k of this._kids.get(id) || []) { if (survives(k)) { r = true; break; } }
      sM.set(id, r);
      return r;
    };
    return { match, hasHit, survives };
  },

  /* ---- layout ----
     Leaves stack vertically, a parent tops-aligns with its first child
     (expansion pushes descendants down, parent stays put). The first walk to
     reach a node claims it into the tree; later references become cross
     pairs drawn as dashed edges to the claimed position. */
  _layout() {
    const m = this._memos(), q = this._q;
    const NH = this._nodeH, RH = this.ROW_GAP, CW = this.W, CG = this.COL_GAP;
    const nodes = [], crossPairs = [];
    const claimed = new Set();
    let cursor = this.PAD, maxRight = 0;

    // shared tail: walk each kid (walkKid returns null for a kid that turned
    // out claimed mid-walk — it becomes a cross pair instead), then a leaf
    // takes the next cursor slot while a parent tops-aligns with its first
    // child (expansion pushes descendants down, not itself)
    const place = (node, kidList, walkKid) => {
      let minY = Infinity;
      for (const kid of kidList) {
        const kn = walkKid(kid);
        if (!kn) continue;
        node.kids.push(kn);
        if (kn.y < minY) minY = kn.y;
      }
      if (!node.kids.length) {
        node.y = cursor;
        cursor += NH + RH;
      } else {
        node.y = minY;
      }
      node.exp = node.kids.length > 0;
      maxRight = Math.max(maxRight, node.x + CW);
      nodes.push(node);
      return node;
    };

    const walk = (id, depth, inMatch, rootId) => {
      const base = (this._kids.get(id) || []).filter((k) => m.survives(k));
      // what expanding reveals under the current filter — drives the toggle
      // count even while collapsed (kidCount from the gated list would
      // collapse to 0 and leave no way to expand)
      let reveal;
      if (q) {
        const force = inMatch || m.match(id);
        reveal = force ? base : base.filter((k) => m.hasHit(k));
      } else reveal = base;
      let kids;
      if (q) kids = this._searchCollapsed.has(String(id)) ? [] : reveal;
      else kids = this._expanded.has(String(id)) ? reveal : [];
      const node = { id, depth, rootId, kids: [], kidCount: reveal.length,
                     x: this.PAD + depth * (CW + CG), y: 0, exp: false };
      claimed.add(id);
      // claims resolve AT WALK TIME: an earlier sibling's subtree may claim a
      // later sibling mid-walk (a dimension group's members can nest — a
      // member's children can be members of the same group). Checking while
      // collecting would walk the entity twice and the deeper column would
      // never render its card.
      return place(node, kids, (k) => {
        if (claimed.has(k)) { crossPairs.push([id, k]); return null; }
        return walk(k, depth + 1, q && (inMatch || m.match(id)), rootId);
      });
    };

    // dimension group card (#41): children are the group's member WIs; the
    // cards themselves stay unpruned by seg, the needle may match the group
    // name and force the members open (unless manually collapsed)
    const walkGroup = (spec, depth, rootId) => {
      const key = spec.vkey;
      const gHit = q && spec.name.toLowerCase().includes(q);
      let members = spec.members;
      if (q && !gHit) members = members.filter((id) => m.hasHit(id));
      const suppressed = q && this._searchCollapsed.has(key);
      const open = (this._expanded.has(key) || gHit) && !suppressed;
      const kids = open ? members : [];
      const node = { id: key, virtual: true, spec, depth, rootId, kids: [],
                     kidCount: spec.count, x: this.PAD + depth * (CW + CG), y: 0,
                     exp: false };
      claimed.add(key);
      // members resolve claims at walk time too — see walk()
      return place(node, kids, (mid) => {
        if (claimed.has(mid)) { crossPairs.push([node, mid]); return null; }
        return walk(mid, depth + 1, true, rootId);
      });
    };

    // ECR root: an active dimension mode REPLACES the structural children
    // (structure / Team / Process Area are mutually exclusive, #41); the
    // structural toggle hides (kidCount 0) while the mode is on
    const walkRoot = (r) => {
      const mode = this._mode.get(r.id);
      if (!mode) return walk(r.id, 0, false, r.id);
      const node = { id: r.id, depth: 0, rootId: r.id, kids: [], kidCount: 0,
                     dim: mode, x: this.PAD, y: 0, exp: false };
      claimed.add(r.id);
      return place(node, this._groupSpecs(r.id, mode),
        (spec) => walkGroup(spec, 1, r.id));
    };
    for (const r of this._roots) walkRoot(r);

    const pos = new Map(nodes.map((n) => [n.id, n]));
    const treeLinks = [], crossLinks = [];
    for (const n of nodes) for (const kn of n.kids) treeLinks.push({ a: n, b: kn });
    for (const [p, c] of crossPairs) {
      const a = typeof p === "object" ? p : pos.get(p); // group pairs carry the node
      const b = pos.get(c);
      if (a && b) crossLinks.push({ a, b });
    }
    return { nodes, treeLinks, crossLinks,
             W: maxRight + this.PAD, H: Math.max(cursor - RH, NH) + this.PAD };
  },

  /* dimension mode group specs from the injected distributions (#12 wording:
  subtree WI own planned effort, Other sinks last); share = group effort over
  the ECR's participating total */
  _groupSpecs(ecrId, mode) {
    const data = this._byId.get(ecrId);
    const dist = mode === "team" ? data.teamDist : data.paDist;
    if (!dist || !dist.length) return [];
    const total = dist.reduce((s, r) => s + r.value, 0);
    return dist.map((g) => ({
      vkey: (mode === "team" ? "t:" : "p:") + g.name,
      name: g.name, value: g.value, count: g.count, members: g.members,
      dim: mode, share: total ? Math.max(0, Math.round(100 * g.value / total)) : 0,
    }));
  },

  _ensureNodeH(canvas) {
    if (this._nodeH) return;
    // the probe must carry real content (empty state/summary rows collapse
    // to 0px) AND measure the TALLEST closed card shape — an ECR carrying
    // dimension chips; work-item cards run ~10px shorter
    const probe = this._buildNode(
      { id: 0, kind: "ecr", type: "ALM_Change Request", state: "ALM_Closed",
        open: false, summary: "probe", effort: 1,
        teamDist: [{ name: "p", value: 1, count: 1 }], paDist: [] }, 0, 0);
    probe.style.visibility = "hidden";
    // the shell ships with the ring hidden (render syncs it for layout
    // nodes only) — the probe must opt in or the 24px ring row goes unmeasured
    probe.querySelector(".gn-ring").hidden = false;
    canvas.appendChild(probe);
    this._nodeH = probe.offsetHeight || 84;
    probe.remove();
  },

  _toggleHTML(kidCount, id) {
    return `<button type="button" class="gn-toggle" aria-expanded="false" aria-label="Expand ${kidCount} children of ${id}">
        <span class="tt-num" aria-hidden="true">${kidCount}</span>
        <svg class="tt-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
        <svg class="tt-minus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>`;
  },

  _buildNode(n, kidCount, sharedN) {
    const el = document.createElement("div");
    el.className = "gn";
    el.dataset.key = String(n.id);
    const m = TYPE_META[n.type];
    const badge = m ? `<span class="type-badge ${m.cls}" title="${m.name}">${m.tag}</span>` : "";
    const stateBadge = n.state
      ? `<span class="badge ${n.open ? "open" : "closed"}" title="${escHTML(n.state)}">${escHTML(n.state.replace(/^ALM_/, ""))}</span>`
      : "";
    const share = sharedN > 1
      ? `<span class="gn-share" title="Shared — referenced by ${sharedN} parents">${sharedN}&times;</span>`
      : "";
    // top-right corner: effort ring on child cards, plain rollup total on
    // ECR roots (#40) — static shells here, values synced per render (the
    // claiming root can change between layouts)
    const ring = `<span class="gn-ring" hidden aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle class="tr" cx="12" cy="12" r="9.5"/><circle class="vl" cx="12" cy="12" r="9.5"/></svg>
        <b></b>
      </span>`;
    const eff = `<span class="gn-eff" hidden></span>`;
    // dimension chips (#41) sit OUTSIDE the body button (buttons can't
    // nest); shown only on ECRs that carry distribution data
    const chips = n.kind === "ecr" && ((n.teamDist || []).length || (n.paDist || []).length)
      ? `<span class="gn-chips">
          <button type="button" class="gn-chip" data-mode="team"${(n.teamDist || []).length ? "" : " hidden"}>Team</button>
          <button type="button" class="gn-chip" data-mode="pa"${(n.paDist || []).length ? "" : " hidden"}>Process Area</button>
        </span>`
      : "";
    const toggle = kidCount > 0 ? this._toggleHTML(kidCount, n.id) : "";
    el.innerHTML = `
      <button type="button" class="gn-body" aria-haspopup="dialog" aria-label="View details of ${n.id}">
        <span class="gn-top">
          <span class="gn-kind"><i class="kdot" aria-hidden="true"></i>${KIND_LABEL[n.kind] || n.kind}</span>
          ${ring}${eff}
        </span>
        <span class="gn-idrow">${badge}<span class="gn-id">${n.id}</span>${stateBadge}${share}</span>
        <span class="gn-sum" title="${escHTML(n.summary || "")}">${escHTML(n.summary || "")}</span>
      </button>
      ${chips}${toggle}`;
    return el;
  },

  /* dimension group card (#41): neutral anatomy — dimension label + group
  effort total, group name, share bar, member count + share %. The body
  click expands the members (table row semantics #28), not a drawer. */
  _buildGroup(spec) {
    const el = document.createElement("div");
    el.className = "gn gn-group" + (spec.name === "Other" ? " is-other" : "");
    el.dataset.key = spec.vkey;
    el.innerHTML = `
      <button type="button" class="gn-body" data-virtual="1" aria-expanded="false"
              aria-label="Expand ${spec.count} work items in ${escHTML(spec.name)}">
        <span class="gn-top">
          <span class="gn-kind"><i class="kdot" aria-hidden="true"></i>${spec.dim === "team" ? "Team" : "Process Area"}</span>
          <span class="gn-eff" title="${fmt(spec.value)} planned effort in this group">${fmt(spec.value)}</span>
        </span>
        <span class="gn-gname" title="${escHTML(spec.name)} — ${fmt(spec.value)} planned · ${spec.share}%">${escHTML(spec.name)}</span>
        <span class="gn-gbar" aria-hidden="true"><i style="width:${spec.share}%"></i></span>
        <span class="gn-gmeta">
          <span class="gn-gcount">${spec.count} WI</span>
          <span class="gn-gpct">${spec.share}%</span>
        </span>
      </button>
      ${this._toggleHTML(spec.count, spec.name)}`;
    return el;
  },

  render() {
    if (!this._inited || typeof GRAPH === "undefined") return;
    const canvas = $("g-canvas");
    this._ensureNodeH(canvas);
    const { nodes, treeLinks, crossLinks, W, H } = this._layout();
    const memo = this._memos();
    this._W = W;
    this._H = H;
    canvas.style.width = Math.round(W) + "px";
    canvas.style.height = Math.round(H) + "px";

    // edges: keyed reuse, enter/leave fades synced with the cards
    const svg = $("g-links");
    svg.setAttribute("width", String(Math.round(W)));
    svg.setAttribute("height", String(Math.round(H)));
    const seenLinks = new Set();
    const drawLink = (l, cross) => {
      const key = (cross ? "x" : "t") + l.a.id + "->" + l.b.id;
      seenLinks.add(key);
      let p = this._linkEls.get(key);
      if (!p && this._linksLeaving.has(key)) {
        clearTimeout(this._linksLeaving.get(key).timer);
        p = this._linksLeaving.get(key).el;
        p.classList.remove("link-leave");
        this._linksLeaving.delete(key);
        this._linkEls.set(key, p);
      }
      if (!p) {
        p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("class", "g-link");
        this._linkEls.set(key, p);
        svg.appendChild(p);
        p.classList.add("link-enter");
        requestAnimationFrame(() => requestAnimationFrame(() => p.classList.remove("link-enter")));
      }
      p.setAttribute("d", gLinkPath(l.a.x + this.W, l.a.y + this._nodeH / 2, l.b.x, l.b.y + this._nodeH / 2));
      p.classList.toggle("x", !!cross);
    };
    for (const l of treeLinks) drawLink(l, false);
    for (const l of crossLinks) drawLink(l, true);
    for (const [key, p] of this._linkEls) {
      if (seenLinks.has(key)) continue;
      this._linkEls.delete(key);
      p.classList.add("link-leave");
      const timer = setTimeout(() => { p.remove(); this._linksLeaving.delete(key); }, 240);
      this._linksLeaving.set(key, { el: p, timer });
    }

    // cards: keyed reuse — siblings slide smoothly, new cards fade in from
    // the parent direction, collapsed cards fade out before removal
    const seen = new Set();
    for (const n of nodes) {
      const key = String(n.id);
      seen.add(key);
      let el = this._nodeEls.get(key);
      if (!el && this._leaving.has(key)) {
        clearTimeout(this._leaving.get(key).timer);
        el = this._leaving.get(key).el;
        el.classList.remove("gn-leave");
        this._leaving.delete(key);
        this._nodeEls.set(key, el);
      }
      if (!el) {
        el = n.virtual ? this._buildGroup(n.spec)
          : this._buildNode(this._byId.get(n.id), n.kidCount,
                            (this._parents.get(n.id) || []).length);
        this._nodeEls.set(key, el);
        canvas.appendChild(el);
        el.classList.add("gn-enter");
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("gn-enter")));
      }
      el.style.transform = `translate(${n.x.toFixed(1)}px, ${n.y.toFixed(1)}px)`;
      const data = n.virtual ? null : this._byId.get(n.id);
      el.style.setProperty("--gn-accent",
        n.virtual ? "#8a94a8" : (GRAPH_COLOR[data.type] || "#9aa1b2"));
      el.classList.toggle("hit", !!this._q && (
        n.virtual ? n.spec.name.toLowerCase().includes(this._q) : memo.match(n.id)));
      // drawer anchor ring survives re-renders (relation navigation expands
      // the tree while the sheet is open)
      el.classList.toggle("selected",
        drawerState.open && drawerState.id === n.id && document.body.dataset.view === "graph");
      // exp comes from the layout (visible kids exist) — dimension roots and
      // group cards derive it there too
      const exp = n.exp;
      el.classList.toggle("expanded", exp);
      // toggle presence and count are filter-dependent — sync them on every
      // render (keyed reuse would otherwise show stale pre-search toggles)
      let tgl = el.querySelector(".gn-toggle");
      if (n.kidCount > 0) {
        const label = n.virtual ? n.spec.name : n.id;
        if (!tgl) {
          const tpl = document.createElement("template");
          tpl.innerHTML = this._toggleHTML(n.kidCount, label);
          tgl = tpl.content.firstElementChild;
          el.appendChild(tgl);
        } else {
          tgl.querySelector(".tt-num").textContent = n.kidCount;
        }
        tgl.setAttribute("aria-expanded", String(exp));
        tgl.setAttribute("aria-label",
          n.virtual
            ? `${exp ? "Collapse" : "Expand"} ${n.kidCount} work items in ${label}`
            : `${exp ? "Collapse" : "Expand"} ${n.kidCount} children of ${label}`);
      } else if (tgl) tgl.remove();
      // dimension chips (#41): reflect the ECR's active mode
      if (!n.virtual && data.kind === "ecr" && el.querySelector(".gn-chips")) {
        const mode = this._mode.get(n.id);
        el.querySelectorAll(".gn-chip").forEach((ch) => {
          const on = mode === ch.dataset.mode;
          ch.classList.toggle("is-on", on);
          ch.setAttribute("aria-pressed", String(on));
        });
      }
      // top-right corner (#40) — virtual group cards carry a static total in
      // their markup; ECR roots carry their rollup total as a plain number
      // (a root ring would always read 100%); child cards carry the effort
      // ring — own display effort over the claiming ECR's rollup total,
      // denominator follows the claiming root, so re-sync every render;
      // no effort data keeps the corner blank (missing stays blank)
      if (n.virtual) continue;
      const ring = el.querySelector(".gn-ring");
      const effEl = el.querySelector(".gn-eff");
      const own = data.effort;
      if (data.kind === "ecr") {
        ring.hidden = true;
        ring.removeAttribute("title");
        if (own == null) {
          effEl.hidden = true;
          effEl.removeAttribute("title");
        } else {
          effEl.hidden = false;
          effEl.textContent = fmt(own);
          effEl.title = `${fmt(own)} planned effort (ECR total)`;
        }
      } else {
        effEl.hidden = true;
        const denom = this._byId.get(n.rootId)?.effort ?? null;
        if (own == null || !denom) {
          ring.hidden = true;
          ring.removeAttribute("title");
        } else {
          const pct = Math.max(0, Math.round(100 * own / denom));
          const C = 59.69; // 2πr, r = 9.5
          const arc = pct <= 0 ? 0.01 : C * pct / 100; // 0-length dash + round cap renders a dot
          ring.hidden = false;
          ring.querySelector(".vl").style.strokeDasharray = `${arc.toFixed(2)} ${C}`;
          // the inner number only fits two digits: 10–99 shows, <10 reads the
          // thin arc alone, a full ring is self-evident
          ring.querySelector("b").textContent = pct >= 10 && pct < 100 ? String(pct) : "";
          ring.title = `${fmt(own)} of ${fmt(denom)} planned · ${pct}%`;
        }
      }
    }
    for (const [key, el] of this._nodeEls) {
      if (seen.has(key)) continue;
      this._nodeEls.delete(key);
      el.classList.add("gn-leave");
      const timer = setTimeout(() => { el.remove(); this._leaving.delete(key); }, 240);
      this._leaving.set(key, { el, timer });
    }

    const filtered = this._status !== "all" || !!this._q;
    $("g-caption").textContent = filtered
      ? `${nodes.length} of ${GRAPH.nodes.length} entities`
      : `${GRAPH.nodes.length} entities · ${this._roots.length} ECRs`;
    $("g-empty").hidden = nodes.length > 0;
    this._applyTransform();
  },

  _bindChrome() {
    $("g-seg").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      this._status = b.dataset.s || "all";
      $("g-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
      this.render();
    });
    $("g-filter").addEventListener("input", (ev) => {
      const v = ev.target.value.trim().toLowerCase();
      if (!v || !this._q) this._searchCollapsed.clear();
      this._q = v;
      this.render();
    });
    // expand/collapse all work on the visible set (status + search branches)
    $("g-expand").addEventListener("click", () => {
      const m = this._memos();
      for (const id of this._allNodes(m)) {
        if ((this._kids.get(id) || []).length) this._expanded.add(String(id));
      }
      this._searchCollapsed.clear();
      this.render();
    });
    $("g-collapse").addEventListener("click", () => {
      this._expanded.clear();
      if (this._q) {
        const m = this._memos();
        for (const id of this._allNodes(m)) {
          if ((this._kids.get(id) || []).length) this._searchCollapsed.add(String(id));
        }
      }
      this.render();
    });
    // card interactions (delegated): toggle expands, body selects (#37)
    $("g-canvas").addEventListener("click", (ev) => {
      // dimension chips switch the ECR's expansion mode (#41); clicking the
      // active chip reverts to the structural view
      const chip = ev.target.closest(".gn-chip");
      if (chip) {
        const key = chip.closest(".gn")?.dataset.key;
        const mode = chip.dataset.mode;
        if (!key) return;
        const id = Number(key);
        if (this._mode.get(id) === mode) this._mode.delete(id);
        else this._mode.set(id, mode);
        this.render();
        chip.focus();
        return;
      }
      const tgl = ev.target.closest(".gn-toggle");
      if (tgl) {
        const key = tgl.closest(".gn")?.dataset.key;
        if (!key) return;
        this._toggleExpand(key);
        const again = this._nodeEls.get(key)?.querySelector(".gn-toggle");
        if (again) { again.focus(); this._revealCard(key); }
        return;
      }
      const body = ev.target.closest(".gn-body");
      // card body opens the detail drawer (#39); the node keeps a selection
      // ring as the drawer anchor while the sheet is open. Dimension group
      // cards have no drawer — their body expands the members (#28 row
      // semantics instead)
      if (body) {
        const key = body.closest(".gn")?.dataset.key;
        if (!key) return;
        if (body.dataset.virtual) {
          this._toggleExpand(key);
          const again = this._nodeEls.get(key)?.querySelector(".gn-body");
          if (again) this._revealCard(key);
        } else {
          openDrawer(Number(key), body);
        }
      }
    });
  },

  _toggleExpand(key) {
    if (this._q) {
      if (this._searchCollapsed.has(key)) this._searchCollapsed.delete(key);
      else this._searchCollapsed.add(key);
    } else if (this._expanded.has(key)) this._expanded.delete(key);
    else this._expanded.add(key);
    this.render();
  },

  /* every node reachable under the current status/search filter, expansion
     ignored (expand/collapse-all operate on what is visible); dimension
     roots contribute their group keys + members (#41) */
  _allNodes(m) {
    const out = [];
    const visit = (id, inMatch) => {
      out.push(id);
      const base = (this._kids.get(id) || []).filter((k) => m.survives(k));
      let kids;
      if (this._q) {
        const force = inMatch || m.match(id);
        kids = force ? base : base.filter((k) => m.hasHit(k));
      } else kids = base;
      for (const k of kids) visit(k, this._q ? (inMatch || m.match(id)) : false);
    };
    for (const r of this._roots) {
      const mode = this._mode.get(r.id);
      if (mode) {
        out.push(r.id);
        for (const spec of this._groupSpecs(r.id, mode)) {
          out.push(spec.vkey);
          for (const mid of spec.members) visit(mid, true);
        }
      } else visit(r.id, false);
    }
    return out;
  },

  /* ---- pan & zoom (ported) ---- */
  _bindPanZoom() {
    const vp = $("g-viewport");
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    vp.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      // cards and chrome have click semantics; the drawer's scrim intercepts
      // the canvas while the sheet is open, so no selection clearing is needed
      if (ev.target.closest(".gn, .g-chrome")) return;
      dragging = true;
      sx = ev.clientX; sy = ev.clientY;
      ox = this._tx; oy = this._ty;
      vp.classList.add("dragging");
      vp.setPointerCapture(ev.pointerId);
    });
    vp.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      this._tx = ox + (ev.clientX - sx);
      this._ty = oy + (ev.clientY - sy);
      this._applyTransform();
    });
    const stop = () => { dragging = false; vp.classList.remove("dragging"); };
    vp.addEventListener("pointerup", stop);
    vp.addEventListener("pointercancel", stop);
    vp.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const rect = vp.getBoundingClientRect();
      this._zoomAt(this._scale * Math.exp(-ev.deltaY * 0.0016),
                   ev.clientX - rect.left, ev.clientY - rect.top);
    }, { passive: false });
    const zoomCenter = (factor) => {
      const r = vp.getBoundingClientRect();
      this._zoomAt(this._scale * factor, r.width / 2, r.height / 2);
    };
    $("g-zoom-in").addEventListener("click", () => zoomCenter(1.25));
    $("g-zoom-out").addEventListener("click", () => zoomCenter(1 / 1.25));
    $("g-zoom-reset").addEventListener("click", () => {
      this._scale = 1; this._tx = 0; this._ty = 0;
      this._applyTransform();
    });
    window.addEventListener("resize", () => this._applyTransform());
  },

  _zoomAt(scale, mx, my) {
    const s0 = this._scale;
    const s1 = Math.max(0.35, Math.min(2, scale));
    if (s1 === s0) return;
    this._tx = mx - (mx - this._tx) * (s1 / s0);
    this._ty = my - (my - this._ty) * (s1 / s0);
    this._scale = s1;
    this._applyTransform();
  },

  /* keep a focused card inside the viewport (overflow:clip never scrolls) */
  _revealCard(key) {
    const vp = $("g-viewport");
    const el = this._nodeEls.get(key);
    if (!vp || !el) return;
    const r = el.getBoundingClientRect();
    const vr = vp.getBoundingClientRect();
    const margin = 24;
    if (r.top < vr.top + margin) this._ty += vr.top + margin - r.top;
    else if (r.bottom > vr.bottom - margin) this._ty -= r.bottom - (vr.bottom - margin);
    if (r.left < vr.left + margin) this._tx += vr.left + margin - r.left;
    else if (r.right > vr.right - margin) this._tx -= r.right - (vr.right - margin);
    this._applyTransform();
  },

  _applyTransform() {
    const canvas = $("g-canvas"), vp = $("g-viewport");
    if (!canvas || !vp) return;
    // clamp panning: hang out at most 40px; a canvas smaller than the
    // viewport may also be pushed fully into view (keeps _centerOnce legal)
    const minX = Math.min(0, vp.clientWidth - this._W * this._scale) - 40;
    const minY = Math.min(0, vp.clientHeight - this._H * this._scale) - 40;
    const maxY = Math.max(40, vp.clientHeight - this._H * this._scale);
    this._tx = Math.max(minX, Math.min(40, this._tx));
    this._ty = Math.max(minY, Math.min(maxY, this._ty));
    canvas.style.transform =
      `translate(${this._tx.toFixed(1)}px, ${this._ty.toFixed(1)}px) scale(${this._scale})`;
    $("g-zoom-reset").textContent = `${Math.round(this._scale * 100)}%`;
  },
};

/* ---------- view switching (rail) ---------- */
const railLinks = document.querySelectorAll(".rail a.rail-item");
const setView = (v) => {
  document.body.dataset.view = v;
  railLinks.forEach((a, i) => {
    const on = (i === 0) === (v === "home");
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (v === "graph") Graph.show();
};
railLinks.forEach((a, i) => {
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    setView(i === 0 ? "home" : "graph");
  });
});
document.body.dataset.view = "home";
/* printing the graph canvas would come out blank (home content is hidden),
   so printing always falls back to the Home view */
window.addEventListener("beforeprint", () => {
  if (document.body.dataset.view === "graph") setView("home");
});

renderHead();
refresh();

/* ---------- PTC Integrity opener ----------
   Table ID cells and the drawer's "Open in PTC" button dispatch an
   integrity:// deep link through the local opener service on
   127.0.0.1:8766, which hands the URL to the OS (ShellExecute) outside the
   browser process — out of reach of the Mimecast URL rewriting that blocks
   the custom protocol inside the browser. Opener offline -> English modal
   telling the user which exe to launch. */
const OPENER_ENDPOINT = "http://127.0.0.1:8766/open";
const OPENER_TIMEOUT_MS = 1500;
const INTEGRITY_HOST = "skobde-mks-im.kobde.trw.com:7001";
const integrityUrl = (id) =>
  `integrity://${INTEGRITY_HOST}/im/viewissue?selection=${encodeURIComponent(String(id))}`;

const dispatchViaOpener = (url) => {
  // timed fetch: when the opener is down the click must not hang
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), OPENER_TIMEOUT_MS);
  return fetch(`${OPENER_ENDPOINT}?url=${encodeURIComponent(url)}`,
               { signal: ctrl.signal, mode: "cors" })
    .then((r) => {
      clearTimeout(tid);
      if (!r.ok) throw new Error(`opener returned ${r.status}`);
      return true;
    })
    .catch(() => {
      clearTimeout(tid);
      return false;
    });
};

const showOpenerOfflineModal = (idText) => {
  document.getElementById("opener-offline-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "opener-offline-overlay";
  overlay.className = "opener-overlay";
  const close = () => overlay.remove();
  const modal = document.createElement("div");
  modal.className = "opener-modal";
  modal.innerHTML = `
    <div class="opener-modal-title">PTC Integrity Opener is not running</div>
    <div class="opener-modal-body">
      To open item <strong>${escHTML(String(idText))}</strong> directly in the
      PTC RV&amp;S client, the local opener service must be running.
      <br><br>
      Please launch one of the following, then click the ID again:
      <ul>
        <li><code>GenerateDashboard.exe</code> — renders the dashboard and starts the opener.</li>
        <li><code>IntegrityOpener.exe</code> — starts the opener only.</li>
      </ul>
      <br>
      The opener listens on <code>127.0.0.1:8766</code>.
      Once it is running, this dialog will not appear.
    </div>
    <div class="opener-modal-foot">
      <button type="button" id="opener-offline-close" class="opener-modal-close">Close</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  document.getElementById("opener-offline-close").addEventListener("click", close);
};

const openInPtc = (id) => {
  dispatchViaOpener(integrityUrl(id)).then((ok) => {
    if (!ok) showOpenerOfflineModal(id);
  });
};

// capture phase, so an ID click never reaches the row's expand/collapse handler
document.addEventListener("click", (ev) => {
  const idCell = ev.target.closest && ev.target.closest("#t-tbl .t-id");
  if (idCell) {
    ev.preventDefault();
    ev.stopPropagation();
    openInPtc(idCell.dataset.id);
    return;
  }
  const ptcBtn = ev.target.closest && ev.target.closest("#drawer-open-ptc");
  if (ptcBtn && drawerState.open && drawerState.id != null) {
    ev.preventDefault();
    openInPtc(drawerState.id);
  }
}, true);
