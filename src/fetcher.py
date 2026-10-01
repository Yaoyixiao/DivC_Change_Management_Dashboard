"""按 ECR_Config.xlsx 配置从 PTC Integrity 导出 ECR 层级数据。

一次获取并同时生成 Excel（data.xlsx）、SQLite（dashboard.db）与
manifest / schema JSON。层级：ECR -> Work Item（递归三级）/ Action / Build。

配置（根 ID 与字段表）来自与脚本同目录的 ECR_Config.xlsx，见 ecr_config.py。
"""
from __future__ import annotations
import logging
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config
from cli_client import export_issues
from data_utils import build_aliases, clean_team, extract_process_area
from database_writer import write_dashboard_database
from ecr_config import load_ecr_config
from excel_writer import write_items_to_excel
from json_writer import write_dashboard_json
from parser import (
    batched,
    build_id_query_definition,
    collect_related_ids,
    deduplicate_by_id,
    normalize_columns,
    read_exported_excel,
)
from relationship_builder import build_relationships, traverse_work_items

logger = logging.getLogger(__name__)


def export_ids_in_batches(item_ids, fields, prefix, temp_dir):
    """按 QUERY_BATCH_SIZE 分批导出并合并去重（列名标准化为展示别名）。"""
    all_rows = []
    batches = list(batched(list(item_ids), config.QUERY_BATCH_SIZE))
    for index, batch in enumerate(batches, 1):
        logger.info("%s: 导出批次 %d/%d，共 %d 个 ID。", prefix, index, len(batches), len(batch))
        path = temp_dir / f"{prefix}_{index:03d}.xls"
        export_issues(build_id_query_definition(batch), fields, str(path))
        all_rows.extend(normalize_columns(read_exported_excel(path), build_aliases(fields)))
    return _clean_rows(deduplicate_by_id(all_rows))


def _clean_rows(rows):
    """导出数据清洗（normalize/去重之后、进遍历与四个 writer 之前统一执行）。

    - Team：去掉开头的 "(数字id)" 与结尾的 "PR+数字" 项目号，只保留团队名。
    """
    for row in rows:
        value = row.get(config.ALIAS_TEAM, "")
        if value:
            row[config.ALIAS_TEAM] = clean_team(value)
    return rows


def _tag_process_areas(items):
    """为 work_item / action 行补派生数据段 Process Area。

    - work_item：从 Summary 抽取 ASPICE 流程域（缩写优先，关键词回退，
      见 data_utils.extract_process_area）
    - action：按需求一律归类为 Initial IA
    - 其余 kind（ecr / build）不赋值，保持为空
    """
    for kind, rows, _ in items:
        if kind == config.KIND_WORK_ITEM:
            for row in rows:
                row[config.ALIAS_PROCESS_AREA] = extract_process_area(row.get("Summary", ""))
        elif kind == config.KIND_ACTION:
            for row in rows:
                row[config.ALIAS_PROCESS_AREA] = config.PROCESS_AREA_INITIAL_IA
    return items


def _batch_exporter(fields, prefix, temp_dir):
    """包装成 relationship_builder 需要的 export_fn(ids) -> rows；空列表直接返回空。"""
    def export_fn(ids):
        return export_ids_in_batches(ids, fields, prefix, temp_dir) if ids else []
    return export_fn


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    ecr_config = load_ecr_config(config.ECR_CONFIG_PATH)
    fields = ecr_config.fields
    logger.info(
        "配置: %s —— %d 个根 ECR，%d 个字段。",
        Path(config.ECR_CONFIG_PATH).name, len(ecr_config.root_ids), len(fields),
    )

    temp_dir = Path(config.TEMP_DIR)
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        logger.info("批量导出第一级 ECR...")
        ecr_items = export_ids_in_batches(ecr_config.root_ids, fields, "ecr", temp_dir)
        if len(ecr_items) < len(ecr_config.root_ids):
            logger.warning(
                "根 ECR 实际导出 %d/%d（部分 ID 在 PTC 不存在）。",
                len(ecr_items), len(ecr_config.root_ids),
            )

        logger.info("沿 ALM_Work Items 递归导出 Work Item（最多 %d 级）...",
                    config.WORK_ITEM_MAX_LEVEL + 1)
        work_items, wi_edges, levels = traverse_work_items(
            ecr_items, _batch_exporter(fields, "work_item", temp_dir),
        )

        logger.info("批量导出 Action / Build...")
        action_ids = collect_related_ids(ecr_items, (config.ALIAS_ACTIONS,))
        action_items = export_ids_in_batches(action_ids, fields, "action", temp_dir) if action_ids else []
        build_ids = collect_related_ids(ecr_items, (config.ALIAS_WORK_ITEM_FOR,))
        build_items = export_ids_in_batches(build_ids, fields, "build", temp_dir) if build_ids else []

        relationships = {config.REL_WORK_ITEMS: wi_edges}
        relationships.update(build_relationships(ecr_items, action_items, build_items))
        generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

        items = [
            (config.KIND_ECR, ecr_items, None),
            (config.KIND_WORK_ITEM, work_items, levels),
            (config.KIND_ACTION, action_items, None),
            (config.KIND_BUILD, build_items, None),
        ]
        _tag_process_areas(items)
        counts = {kind: len(rows) for kind, rows, _ in items}
        relationship_counts = {relation: len(edges) for relation, edges in relationships.items()}
        logger.info("计数: %s", counts)
        logger.info("关系: %s", relationship_counts)

        write_items_to_excel(
            config.OUTPUT_PATH, fields, items, relationships, ecr_config.pivot_fields,
        )
        write_dashboard_database(
            config.DATABASE_PATH, generated_at, config.SCHEMA_VERSION, fields,
            ecr_config.root_ids, Path(config.ECR_CONFIG_PATH).name, items, relationships,
        )
        write_dashboard_json(
            config.MANIFEST_PATH, config.SCHEMA_PATH, generated_at, config.SCHEMA_VERSION,
            Path(config.ECR_CONFIG_PATH).name, fields, counts, relationship_counts,
        )
        logger.info("完成: %s", config.OUTPUT_PATH)
        logger.info("完成: %s", config.DATABASE_PATH)
        logger.info("完成: %s", config.MANIFEST_PATH)
        logger.info("完成: %s", config.SCHEMA_PATH)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    from exe_utils import make_streams_tolerant, pause_if_frozen
    make_streams_tolerant()
    exit_code = 0
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        exit_code = 1
    pause_if_frozen()
    sys.exit(exit_code)
