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


# ---------- 导出数据清洗 ----------

_TEAM_LEADING_ID_RE = re.compile(r"^\s*\(\d+\)\s*")
# 结尾项目号两种实测形态：裸 "PR65978" 与方括号 "[PR60806]"
_TEAM_TRAILING_PROJECT_RE = re.compile(r"\s*(?:\[\s*PR\d+\s*\]|PR\d+)\s*$", re.IGNORECASE)


def clean_team(value: Any) -> str:
    """清洗 Team 文本：去掉开头的 "(数字id)" 与结尾的 "PR+数字" 项目号，只保留团队名。

    例："(12345) Software Integration PR24680" -> "Software Integration"，
        "(10128928) APSW-CPP-DiagnosticSerivce[PR60806]" -> "APSW-CPP-DiagnosticSerivce"。
    两个部分都可选；整串都被剥掉时返回空串。
    """
    text = str(value or "").strip()
    text = _TEAM_LEADING_ID_RE.sub("", text)
    text = _TEAM_TRAILING_PROJECT_RE.sub("", text)
    return text.strip()


# ---------- 派生数据段：Process Area（ASPICE 流程域） ----------

# ASPICE 流程域缩写：2-4 个大写字母 + 点号 + 1-2 位数字（如 MAN.3 / SWE.3 / SYS.1 / SUP.8）。
# 缩写与点号/数字之间允许有空格（实测 Summary 里有 "SWE. 3" 写法），输出前归一化掉。
# 词边界限定：避免从长单词中部误抽（如 "EEPROM.2" 不会抽出 "ROM.2"）。
_PROCESS_AREA_RE = re.compile(r"\b([A-Z]{2,4})\s*\.\s*(\d{1,2})\b")


def extract_process_area(value: Any) -> str:
    """从 Summary 文本抽取 ASPICE 流程域缩写，如 "MAN.3" / "SWE.3" / "SYS.1"。

    - 容忍 "SWE. 3" 这类带空格的写法，输出统一为无空格的 "SWE.3"
    - 多个命中取第一个；无命中返回空串
    """
    match = _PROCESS_AREA_RE.search(str(value or ""))
    if match is None:
        return ""
    return f"{match.group(1)}.{match.group(2)}"

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
