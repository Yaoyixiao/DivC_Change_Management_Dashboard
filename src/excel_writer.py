"""生成人工核查用 Excel：Items / Edges / Metadata 三个 sheet。

Items 列 = [ID, Kind, Level] + 字段表别名（剥 ALM_ 前缀），
日期列（别名以 "Date" 结尾）写成真正的日期单元格并套用格式。
"""
from __future__ import annotations
import os
from datetime import date, datetime
from typing import Any, Iterable

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from data_utils import build_alias, parse_date

EXCEL_DATE_FORMAT = "yyyy-mm-dd"


def _write_sheet(ws, columns: list[str], rows: Iterable[dict[str, Any]], date_columns: set[str]) -> None:
    data = list(rows)
    ws.append(columns)
    header_fill = PatternFill("solid", fgColor="4472C4")
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="left", vertical="center")
        cell.border = border
    for row in data:
        values = [parse_date(row.get(c, "")) if c in date_columns else row.get(c, "") for c in columns]
        ws.append(values)
        for idx, cell in enumerate(ws[ws.max_row], start=1):
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if columns[idx - 1] in date_columns and isinstance(cell.value, (date, datetime)):
                cell.number_format = EXCEL_DATE_FORMAT
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for idx, column in enumerate(columns, start=1):
        samples = [column] + [str(row.get(column, "")) for row in data[:200]]
        ws.column_dimensions[get_column_letter(idx)].width = min(max(max(map(len, samples)) + 2, 12), 60)


def write_items_to_excel(output_path, fields, items, relationships) -> None:
    """items: [(kind, rows, levels)]，rows 的键是展示别名；relationships: {relation: edges}。"""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    aliases = [build_alias(field) for field in fields]
    item_columns = ["ID", "Kind", "Level"] + [alias for alias in aliases if alias != "ID"]
    item_rows: list[dict[str, Any]] = []
    for kind, rows, levels in items:
        level_map = levels or {}
        for row in rows:
            item_id = str(row.get("ID", "")).strip()
            level_value = level_map.get(int(item_id), "") if item_id.isdigit() else ""
            item_row: dict[str, Any] = {"ID": item_id, "Kind": kind, "Level": level_value}
            for alias in aliases:
                if alias != "ID":
                    item_row[alias] = row.get(alias, "")
            item_rows.append(item_row)

    edge_columns = ["Parent ID", "Child ID", "Relation"]
    edge_rows = [
        {"Parent ID": parent_id, "Child ID": child_id, "Relation": relation}
        for relation, edges in relationships.items()
        for parent_id, child_id in edges
    ]

    wb = openpyxl.Workbook()
    ws_items = wb.active
    ws_items.title = "Items"
    _write_sheet(ws_items, item_columns, item_rows, {c for c in item_columns if c.endswith("Date")})
    ws_edges = wb.create_sheet("Edges")
    _write_sheet(ws_edges, edge_columns, edge_rows, set())

    meta = wb.create_sheet("Metadata")
    meta.append(["Export Time", datetime.now()])
    meta["B1"].number_format = "yyyy-mm-dd hh:mm:ss"
    meta.append(["Item kind", "Count"])
    for kind, rows, _ in items:
        meta.append([kind, len(rows)])
    meta.append(["Relation", "Count"])
    for relation, edges in relationships.items():
        meta.append([relation, len(edges)])

    wb.save(output_path)
