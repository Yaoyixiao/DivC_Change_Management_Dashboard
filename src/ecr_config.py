"""从 ECR_Config.xlsx 读取导出配置：根 ECR ID（'ECR' sheet）与字段表（'Data_Field' sheet）。

两个 sheet 均为单列、首行表头（"ID" / "Field"）。字段表必须包含遍历所需的
全部关系字段，否则取数链路无法工作，加载时即报错。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import openpyxl

import config

ECR_SHEET = "ECR"
FIELD_SHEET = "Data_Field"
ID_HEADER = "ID"
FIELD_HEADER = "Field"

# 遍历与建边必需的字段：ID 用于标识，三个关系字段用于层级展开
REQUIRED_FIELDS = (
    "ID",
    config.FIELD_WORK_ITEMS,
    config.FIELD_ACTIONS,
    config.FIELD_WORK_ITEM_FOR,
)


@dataclass(frozen=True)
class EcrConfig:
    root_ids: list[int]
    fields: list[str]


def load_ecr_config(path: str | Path = config.ECR_CONFIG_PATH) -> EcrConfig:
    """读取配置文件。sheet 缺失、列表为空或缺少必需字段时抛 ValueError。"""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"未找到配置文件: {path}\n"
            "ECR_Config.xlsx 应与脚本位于同一目录（frozen 运行时与 exe 同目录）。"
        )
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        root_ids = _read_single_column(workbook, ECR_SHEET, ID_HEADER, _to_int)
        fields = _read_single_column(workbook, FIELD_SHEET, FIELD_HEADER, str)
    finally:
        workbook.close()

    if not root_ids:
        raise ValueError(f"配置文件 {path.name} 的 '{ECR_SHEET}' sheet 没有任何 ID")
    if not fields:
        raise ValueError(f"配置文件 {path.name} 的 '{FIELD_SHEET}' sheet 没有任何字段")

    missing = [name for name in REQUIRED_FIELDS if name not in fields]
    if missing:
        raise ValueError(
            f"配置文件 {path.name} 的 '{FIELD_SHEET}' sheet 缺少必需字段: {missing}"
        )
    return EcrConfig(root_ids=root_ids, fields=fields)


def _read_single_column(
    workbook: openpyxl.Workbook, sheet_name: str, header: str, convert: Callable[[Any], Any]
) -> list[Any]:
    """读取指定 sheet 中表头为 <header> 的那一列，去空、去重、保序。"""
    if sheet_name not in workbook.sheetnames:
        raise ValueError(f"配置文件缺少 sheet '{sheet_name}'（现有: {workbook.sheetnames}）")
    sheet = workbook[sheet_name]
    rows = sheet.iter_rows(values_only=True)
    try:
        headers = next(rows)
    except StopIteration:
        raise ValueError(f"sheet '{sheet_name}' 是空的") from None

    column_index = None
    for index, value in enumerate(headers):
        if value is not None and str(value).strip() == header:
            column_index = index
            break
    if column_index is None:
        raise ValueError(f"sheet '{sheet_name}' 首行没有表头 '{header}'（现有: {headers}）")

    result: list[Any] = []
    seen: set[Any] = set()
    for row in rows:
        if column_index >= len(row):
            continue
        value = convert(row[column_index])
        if value is None or value == "":
            continue
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _to_int(value: Any) -> int | None:
    """把单元格值转成整数 ID；空值/非数字返回 None。"""
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        raise ValueError(f"'{ECR_SHEET}' sheet 里存在非数字 ID: {value!r}") from None
