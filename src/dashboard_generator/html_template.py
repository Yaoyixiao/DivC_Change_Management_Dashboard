"""把 data_loader + aggregations 的产物，渲染成单文件自包含 HTML dashboard。

设计要点
--------
- 零外部依赖（CDN / npm）
- CSS / JS 全部 `<style>` / `<script>` 内联
- `__PAYLOAD__` 在 `<script>` 末尾注入，前端模块直接 `window.__PAYLOAD__`
- 模板占位符：`{{PAGE_META}}` `{{DATE_RANGE}}`（其余 DOM 由 template.html 直接给出）
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

# 资产根目录：dashboard_generator/assets/
ASSETS_DIR = Path(__file__).parent / "assets"


# --------------------------------------------------------------------------
# 工具
# --------------------------------------------------------------------------

def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _dump_json(obj: Any) -> str:
    """最小化体积的 JSON 序列化（前端直接 eval / JSON.parse）。"""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


# --------------------------------------------------------------------------
# 占位符渲染
# --------------------------------------------------------------------------

def _render_placeholders(template: str, meta: dict[str, Any]) -> str:
    """替换模板里 {{PAGE_META}} 与 {{DATE_RANGE}}。

    PAGE_META   ← "Read-Across ALM data · generated 2026-09-20 22:00"
    DATE_RANGE  ← 时间线首末月 "2021-07 — 2029-04"（delivery_timeline 缺失则降级为 today）
    """
    generated_at = meta.get("generated_at") or datetime.now().isoformat(timespec="seconds")
    # sqlite 默认会带 "T" 分隔；显示更友好就替换
    pretty = generated_at.replace("T", " ")
    page_meta = f"Read-Across ALM data · generated {pretty}"

    first_month = last_month = None
    # 这里只读 meta（避免依赖 aggregations），由调用方在组装 payload 时再 patch
    date_range_placeholder = "{{DATE_RANGE}}"
    page_meta_placeholder = "{{PAGE_META}}"

    template = template.replace(page_meta_placeholder, page_meta)
    template = template.replace(date_range_placeholder, "{{__DATE_RANGE__}}")
    return template


def _patch_date_range(template: str, aggregations: dict[str, Any]) -> str:
    """根据 aggregations.delivery_timeline 计算并替换日期范围 pill。"""
    tl = aggregations.get("delivery_timeline") or []
    if tl:
        first = tl[0]["month"]
        last = tl[-1]["month"]
        text = f"{first} — {last}"
    else:
        today = datetime.now().strftime("%Y-%m")
        text = f"{today}"
    return template.replace("{{__DATE_RANGE__}}", text)


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------

def render_html(payload: dict[str, Any]) -> str:
    """payload = {"data": {...}, "aggregations": {...}, "meta": {...}}

    返回完整的 HTML 字符串。
    """
    template = _read(ASSETS_DIR / "template.html")
    css = _read(ASSETS_DIR / "styles.css")
    js = _read(ASSETS_DIR / "app.js")

    template = _render_placeholders(template, payload.get("meta") or {})
    template = _patch_date_range(template, payload.get("aggregations") or {})

    payload_json = _dump_json(payload)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1200, initial-scale=1">
<title>Read-Across Dashboard</title>
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
    # CLI 自检：python -m dashboard_generator.html_template
    from data_loader import load_payload
    from aggregations import compute_all_aggregations

    p = load_payload()
    aggs = compute_all_aggregations(p)
    payload = {"data": p, "aggregations": aggs, "meta": p.get("meta") or {}}
    write_html(payload, Path("dashboard.html"))
    print("OK → dashboard.html")