"""创建本地 Dashboard 使用的 SQLite 数据库（通用节点表结构）。

结构
----
- items: 全部实体一张表，kind 区分 ecr / work_item / action / build，
         level 仅 work_item 有值（距 ECR 的 hop 数 0/1/2），
         字段列由 ECR_Config.xlsx 的字段表动态生成（*_date 列存 ISO 文本）。
- edges: (parent_id, child_id, relation) 显式关系边。
- metadata: schema_version / generated_at / config_file / root_item_ids。

写入是原子的（先写 .tmp 再 os.replace），完成后做 integrity_check。

注意：传入的行 dict 的键是"展示别名"（如 "Planned Start Date"，见
data_utils.build_alias），与字段表一一对应。
"""
from __future__ import annotations
import json
import os
import sqlite3
from pathlib import Path

from data_utils import build_alias, build_column_names, date_to_iso

# [(kind, rows, levels)]，levels 仅 work_item 有值
ItemsSpec = list[tuple[str, list[dict[str, str]], dict[int, int] | None]]


def _field_mappings(fields: list[str]) -> list[tuple[str, str, str]]:
    """字段表 -> [(原字段名, 展示别名, 数据库列名)]，跳过 ID（单独作主键）。"""
    mappings = []
    for field in fields:
        alias = build_alias(field)
        column = alias.lower().replace(" ", "_")
        if column == "id":
            continue
        mappings.append((field, alias, column))
    build_column_names(fields)  # 借用其唯一性校验
    return mappings


def _build_schema_sql(field_columns: list[str]) -> str:
    item_defs = ",\n  ".join(f"{column} TEXT" for column in field_columns)
    return f"""
PRAGMA foreign_keys = ON;
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  level INTEGER,
  {item_defs}
);
CREATE TABLE edges (
  parent_id INTEGER NOT NULL,
  child_id INTEGER NOT NULL,
  relation TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_id, relation)
);
CREATE INDEX idx_items_kind ON items(kind);
CREATE INDEX idx_edges_child ON edges(child_id);
CREATE INDEX idx_edges_relation ON edges(relation);
"""


def write_dashboard_database(
    database_path, generated_at, schema_version, fields, root_ids, config_file,
    items: ItemsSpec, relationships,
) -> None:
    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    if temp.exists():
        temp.unlink()
    con = sqlite3.connect(temp)
    try:
        mappings = _field_mappings(fields)
        con.executescript(_build_schema_sql([column for _, _, column in mappings]))

        con.executemany("INSERT INTO metadata(key,value) VALUES(?,?)", [
            ("schema_version", str(schema_version)),
            ("generated_at", generated_at),
            ("config_file", config_file),
            ("root_item_ids", json.dumps(root_ids, ensure_ascii=False)),
        ])

        placeholders = ", ".join("?" for _ in range(3 + len(mappings)))
        insert_sql = f"INSERT INTO items VALUES({placeholders})"
        for kind, rows, levels in items:
            level_map = levels or {}
            data = []
            for row in rows:
                item_id = int(str(row["ID"]).strip())
                values = [item_id, kind, level_map.get(item_id)]
                for _, alias, column in mappings:
                    value = row.get(alias, "")
                    if column.endswith("_date"):
                        value = date_to_iso(value)
                    values.append(value)
                data.append(values)
            con.executemany(insert_sql, data)

        for relation, edges in relationships.items():
            con.executemany(
                "INSERT INTO edges(parent_id, child_id, relation) VALUES(?,?,?)",
                [(parent_id, child_id, relation) for parent_id, child_id in edges],
            )

        con.commit()
        check = con.execute("PRAGMA integrity_check").fetchone()[0]
        if check != "ok":
            raise RuntimeError(f"SQLite integrity_check 失败: {check}")
    finally:
        con.close()
    os.replace(temp, path)
