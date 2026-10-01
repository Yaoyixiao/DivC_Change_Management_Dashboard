"""Excel 与数据库共用的数据类型转换与字段名推导。"""
from __future__ import annotations
import re
from datetime import date, datetime, time
from typing import Any, Iterable
from openpyxl.utils.datetime import from_excel


def build_alias(field: str) -> str:
    """导出字段名 -> 展示列名：剥掉 ALM_ 前缀（"ALM_Target Date" -> "Target Date"）。"""
    f = str(field).strip()
    return f[4:] if f.startswith("ALM_") else f


def build_aliases(fields: Iterable[str]) -> dict[str, str]:
    """整张字段表 -> {原字段名: 展示列名}，供 normalize_columns 使用。"""
    return {field: build_alias(field) for field in fields}


def build_column_names(fields: Iterable[str]) -> list[str]:
    """整张字段表 -> 数据库列名（剥 ALM_ 前缀、小写、空格转下划线）。

    "ALM_Planned Start Date" -> "planned_start_date"。列名必须唯一，冲突时报错。
    """
    names = [build_alias(field).lower().replace(" ", "_") for field in fields]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        raise ValueError(f"字段列名冲突: {duplicates}")
    return names

_TEXT_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y",
    "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y", "%d %b %Y",
)


def parse_date(value: Any) -> Any:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    text = str(value).strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        serial = float(text)
        if 1 <= serial <= 2958465:
            try:
                converted = from_excel(serial)
                if isinstance(converted, time):
                    return value
                if isinstance(converted, date) and not isinstance(converted, datetime):
                    return datetime.combine(converted, time.min)
                return converted
            except (TypeError, ValueError, OverflowError):
                pass
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        pass
    for fmt in _TEXT_DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return value


def date_to_iso(value: Any) -> str | None:
    parsed = parse_date(value)
    if parsed == "" or parsed is None:
        return None
    if isinstance(parsed, datetime):
        return parsed.date().isoformat()
    if isinstance(parsed, date):
        return parsed.isoformat()
    return str(parsed)
