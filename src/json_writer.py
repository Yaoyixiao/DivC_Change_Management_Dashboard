"""生成 Dashboard 启动与字段发现所需 JSON（manifest 与 schema），结构由字段表动态生成。"""
from __future__ import annotations
import json
import os
from pathlib import Path

import config
from data_utils import build_alias, build_column_names


def _build_schema(schema_version: int, fields: list[str]) -> dict:
    process_area_column = config.ALIAS_PROCESS_AREA.lower().replace(" ", "_")
    columns = {"id": "integer", "kind": "text", "level": "integer",
               process_area_column: "text"}
    for alias in (build_alias(field) for field in fields):
        if alias == "ID":
            continue
        column = alias.lower().replace(" ", "_")
        columns[column] = "date" if column.endswith("_date") else "text"
    return {
        "schema_version": schema_version,
        "database": "dashboard.db",
        "date_storage": "ISO-8601 YYYY-MM-DD text（仅 *_date 列）",
        "tables": {
            "items": {
                "primary_key": "id",
                "description": "全部实体一张表，kind 区分类型；level 仅 work_item 有值（距 ECR 的 hop 数）",
                "columns": columns,
            },
            "edges": {
                "primary_key": ["parent_id", "child_id", "relation"],
                "description": "显式关系边；relation 取值见 relations",
                "columns": {"parent_id": "integer", "child_id": "integer", "relation": "text"},
            },
        },
        "kinds": list(config.KINDS),
        "relations": [config.REL_WORK_ITEMS, config.REL_ACTIONS, config.REL_WORK_ITEM_FOR],
    }


def _atomic_json(path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def write_dashboard_json(
    manifest_path, schema_path, generated_at, schema_version, config_file,
    fields, counts, relationship_counts,
) -> None:
    schema = _build_schema(schema_version, fields)
    schema["generated_at"] = generated_at
    _atomic_json(schema_path, schema)
    manifest = {
        "schema_version": schema_version,
        "generated_at": generated_at,
        "status": "ready",
        "config_file": config_file,
        "files": {
            "database": "dashboard.db",
            "excel": "data.xlsx",
            "schema": "dashboard_schema.json",
        },
        "counts": counts,
        "relationship_counts": relationship_counts,
    }
    _atomic_json(manifest_path, manifest)
