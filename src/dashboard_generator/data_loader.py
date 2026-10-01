"""从 dashboard.db 一次性读取所有表，构造可直接 JSON 序列化的内存图。

返回的 dict 全部由 list / dict / str / int / float / None 组成，
不包含 sqlite3.Row / set / tuple 等不可 JSON 化的对象。
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from typing import Any

SRC = Path(__file__).resolve().parent.parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from config import DATABASE_PATH  # noqa: E402

ENTITY_TABLES = [
    "ra_op",
    "parent_op",
    "child_op",
    "deliveries",
    "change_requests",
    "builds",
]

EDGE_TABLES: dict[str, str] = {
    "ra_to_parent":          "ra_op_parent_op",
    "ra_to_child":           "ra_op_child_op",
    "related_to_delivery":   "related_delivery",
    "related_to_cr":         "related_change_request",
    "cr_to_build":           "change_request_build",
}


def _rows(cur: sqlite3.Cursor, table: str) -> list[dict[str, Any]]:
    """SELECT * FROM <table>，把每一行转成 dict。"""
    cur.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def load_payload(db_path: str | Path = DATABASE_PATH) -> dict[str, Any]:
    """读 DB → 内存图。全部 JSON-serializable。

    Returns
    -------
    {
      "meta": {"schema_version": "1", "generated_at": ..., "root_query_definition": ...},
      "ra_ops":          [{"id", "summary", "project", "created_date"}, ...],
      "parent_ops":      [{"id", "state", "summary", "project"}, ...],
      "child_ops":       [{"id", "state", "summary", "project"}, ...],
      "deliveries":      [{"id", "summary", "project", "target_date"}, ...],
      "change_requests": [{"id", "state", "summary", "project", "team", "owners"}, ...],
      "builds":          [{"id", "summary", "project", "target_date",
                           "planned_completion_date", "maturity_level"}, ...],
      "edges": {
        "ra_to_parent":        [{"ra_op_id", "parent_op_id"}, ...],
        "ra_to_child":         [{"ra_op_id", "child_op_id"}, ...],
        "related_to_delivery": [{"related_id", "delivery_id"}, ...],
        "related_to_cr":       [{"related_id", "change_request_id"}, ...],
        "cr_to_build":         [{"change_request_id", "build_id"}, ...],
      },
    }
    """
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        meta = dict(cur.execute("SELECT key, value FROM metadata").fetchall())
        payload: dict[str, Any] = {
            "meta": meta,
            "ra_ops":          _rows(cur, "ra_op"),
            "parent_ops":      _rows(cur, "parent_op"),
            "child_ops":       _rows(cur, "child_op"),
            "deliveries":      _rows(cur, "deliveries"),
            "change_requests": _rows(cur, "change_requests"),
            "builds":          _rows(cur, "builds"),
            "edges": {key: _rows(cur, tbl) for key, tbl in EDGE_TABLES.items()},
        }
        return payload
    finally:
        con.close()


def summarize(payload: dict[str, Any]) -> dict[str, int]:
    """汇总各表与边数量，便于打印与自检。"""
    counts = {k: len(payload[k]) for k in [
        "ra_ops", "parent_ops", "child_ops",
        "deliveries", "change_requests", "builds",
    ]}
    edges = {f"edges.{k}": len(v) for k, v in payload["edges"].items()}
    return {**counts, **edges}


if __name__ == "__main__":
    # CLI 自检：python -m dashboard_generator.data_loader
    p = load_payload()
    import json
    print(json.dumps(summarize(p), indent=2, ensure_ascii=False))