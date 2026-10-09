"""Assemble the single-file self-contained dashboard HTML.

The generated document has zero external requests (AGENTS.md rule 8): the
embedded Inter fonts (fonts.css), the stylesheet, the body markup
(template.html) and the app (app.js) are all inlined, and the payload is
injected as `window.__PAYLOAD__` before the app script runs:

    __PAYLOAD__ = { data: {ecrs, builds, items},
                    graph: {nodes, edges, generatedAt},
                    aggregations: {...card baselines + state sets...},
                    meta: {...metadata rows...} }
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# assets root: dashboard_generator/assets/
ASSETS_DIR = Path(__file__).parent / "assets"
TITLE = "ECR Workbench — Home"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _dump_json(obj: Any) -> str:
    """Compact JSON; `</` is escaped so a stray `</script>` inside a summary
    can never terminate the payload tag early (same trick as the mockup
    builder)."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def render_html(payload: dict[str, Any]) -> str:
    """payload = {data, graph, aggregations, meta} -> full HTML string."""
    template = _read(ASSETS_DIR / "template.html")
    # fonts.css (base64 Inter) first; fall back to the system stack if missing
    fonts_css_path = ASSETS_DIR / "fonts.css"
    css = (_read(fonts_css_path) + "\n" if fonts_css_path.exists() else "") + _read(ASSETS_DIR / "styles.css")
    js = _read(ASSETS_DIR / "app.js")
    payload_json = _dump_json(payload)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TITLE}</title>
<style>
{css}
</style>
</head>
<body>
{template}
<script>
window.__PAYLOAD__ = {payload_json};
</script>
<script>
{js}
</script>
</body>
</html>
"""


def write_html(payload: dict[str, Any], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_html(payload), encoding="utf-8")


if __name__ == "__main__":
    # CLI self-check: python -m dashboard_generator.html_template
    from .aggregations import compute_all_aggregations
    from .data_loader import load_payload

    p = load_payload()
    payload = {
        "data": {"ecrs": p["ecrs"], "builds": p["builds"], "items": p["items"]},
        "graph": p["graph"],
        "aggregations": compute_all_aggregations(p),
        "meta": p.get("meta") or {},
    }
    write_html(payload, Path("dashboard.html"))
    print("OK -> dashboard.html")
