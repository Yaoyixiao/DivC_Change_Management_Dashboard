"""解析 im exportissues 输出及关系字段。"""
from __future__ import annotations
import re
from pathlib import Path
from typing import Any, Iterable, Iterator


def _clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_columns(rows: list[dict[str, str]], aliases: dict[str, str]) -> list[dict[str, str]]:
    normalized = []
    for row in rows:
        target_row: dict[str, str] = {}
        for key, value in row.items():
            target = aliases.get(key.strip(), key.strip())
            if target not in target_row or (not target_row[target] and value):
                target_row[target] = value
        normalized.append(target_row)
    return normalized


def read_xls_rows(path: str | Path) -> list[dict[str, str]]:
    """读取真正的 BIFF .xls（xlrd 2.x 只支持旧格式）。"""
    try:
        import xlrd
    except ImportError as exc:
        raise RuntimeError("缺少 xlrd，请执行: pip install -r requirements.txt") from exc
    rows: list[dict[str, str]] = []
    book = xlrd.open_workbook(str(path))
    for sheet in book.sheets():
        if sheet.nrows == 0:
            continue
        headers = [_clean(sheet.cell_value(0, c)) for c in range(sheet.ncols)]
        for r in range(1, sheet.nrows):
            values = [_clean(sheet.cell_value(r, c)) for c in range(sheet.ncols)]
            if any(values):
                rows.append({headers[c]: values[c] for c in range(len(headers)) if headers[c]})
    return rows


def read_xlsx_rows(path: str | Path) -> list[dict[str, str]]:
    """读取 .xlsx（openpyxl）。"""
    import openpyxl
    rows: list[dict[str, str]] = []
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for ws in wb.worksheets:
            iterator = ws.iter_rows(values_only=True)
            try:
                headers = [_clean(v) for v in next(iterator)]
            except StopIteration:
                continue
            for values in iterator:
                cleaned = [_clean(v) for v in values]
                if any(cleaned):
                    rows.append({headers[c]: cleaned[c] for c in range(min(len(headers), len(cleaned))) if headers[c]})
    finally:
        wb.close()  # read_only 模式下不 close 会在 Windows 上一直占用文件句柄
    return rows


def read_exported_excel(path: str | Path) -> list[dict[str, str]]:
    """按扩展名分发读取 im exportissues 导出文件。"""
    path = Path(path)
    if path.suffix.lower() == ".xls":
        return read_xls_rows(path)
    if path.suffix.lower() == ".xlsx":
        return read_xlsx_rows(path)
    raise ValueError(f"不支持的导出文件格式: {path.suffix}")


def parse_id_list(value: str) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    for token in re.findall(r"(?<!\d)\d+(?!\d)", value or ""):
        item_id = int(token)
        if item_id not in seen:
            seen.add(item_id)
            result.append(item_id)
    return result


def collect_related_ids(items: Iterable[dict[str, str]], fields: Iterable[str]) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    for item in items:
        for field in fields:
            for item_id in parse_id_list(item.get(field, "")):
                if item_id not in seen:
                    seen.add(item_id)
                    result.append(item_id)
    return result


def build_id_query_definition(item_ids: Iterable[int]) -> str:
    ids = list(dict.fromkeys(int(v) for v in item_ids))
    if not ids:
        return ""
    if len(ids) == 1:
        return f"(field[ID]={ids[0]})"
    return "(" + " or ".join(f"(field[ID]={v})" for v in ids) + ")"


def batched(values: list[int], size: int) -> Iterator[list[int]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def deduplicate_by_id(rows: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    positions: dict[str, int] = {}
    for row in rows:
        item_id = str(row.get("ID", "")).strip()
        if not item_id or item_id not in positions:
            if item_id:
                positions[item_id] = len(result)
            result.append(row)
        else:
            current = result[positions[item_id]]
            for key, value in row.items():
                if not current.get(key) and value:
                    current[key] = value
    return result
