"""从导出数据构建 ECR 层级关系：Work Item 广度优先遍历 + Action / Build 关联边。

遍历语义
--------
- level = 距任一 ECR 沿 ALM_Work Items 边的最小 hop 数（0/1/2），首次发现即定
  （BFS 首现即最短），最多 WORK_ITEM_MAX_LEVEL 层，之后不再下钻。
- 边只记录"父 -> 本层新发现的子"，已见节点不再重复导出也不产生边，
  因此天然无环，且边集严格等于遍历范围。
- 同一个 Work Item 被多个 ECR / 多个父级引用时只导出一次，但每条引用各自成边。
- 关联目标在 PTC 不存在（导出结果里没有该 ID）时，对应的边被丢弃。
"""
from __future__ import annotations

from typing import Callable

import config
from parser import parse_id_list

ExportFn = Callable[[list[int]], list[dict[str, str]]]


def _id_of(row: dict[str, str]) -> int | None:
    try:
        return int(str(row["ID"]).strip())
    except (KeyError, TypeError, ValueError):
        return None


def _by_id(rows: list[dict[str, str]]) -> dict[int, dict[str, str]]:
    result: dict[int, dict[str, str]] = {}
    for row in rows:
        item_id = _id_of(row)
        if item_id is not None:
            result[item_id] = row
    return result


def traverse_work_items(
    ecr_items: list[dict[str, str]], export_fn: ExportFn
) -> tuple[list[dict[str, str]], list[tuple[int, int]], dict[int, int]]:
    """从 ECR 沿 ALM_Work Items 字段广度优先导出 Work Item。

    export_fn(ids) 负责批量导出（见 fetcher.export_ids_in_batches 的包装），
    返回实际导出成功的行（不存在的 ID 会被 PTC 静默跳过）。

    Returns
    -------
    (work_items, edges, levels)
    - work_items: 去重后的行列表，按发现顺序
    - edges:      [(parent_id, child_id), ...]，只含指向本层新发现节点的边
    - levels:     {work_item_id: level}
    """
    work_items: list[dict[str, str]] = []
    edge_set: set[tuple[int, int]] = set()
    levels: dict[int, int] = {}
    seen: set[int] = set()
    frontier = [row for row in ecr_items if _id_of(row) is not None]

    for level in range(config.WORK_ITEM_MAX_LEVEL + 1):
        if not frontier:
            break
        new_ids: list[int] = []
        new_seen: set[int] = set()
        for row in frontier:
            for candidate in parse_id_list(row.get(config.ALIAS_WORK_ITEMS, "")):
                if candidate not in seen and candidate not in new_seen:
                    new_seen.add(candidate)
                    new_ids.append(candidate)

        new_rows = _by_id(export_fn(new_ids)) if new_ids else {}

        for row in frontier:
            parent_id = _id_of(row)
            for child_id in parse_id_list(row.get(config.ALIAS_WORK_ITEMS, "")):
                if child_id in new_rows:
                    edge_set.add((parent_id, child_id))

        for item_id, row in new_rows.items():
            seen.add(item_id)
            levels[item_id] = level
            work_items.append(row)
        frontier = list(new_rows.values())

    return work_items, sorted(edge_set), levels


def build_relationships(
    ecr_items: list[dict[str, str]],
    action_items: list[dict[str, str]],
    build_items: list[dict[str, str]],
) -> dict[str, list[tuple[int, int]]]:
    """ECR -> Action（ALM_Actions）与 ECR -> Build（ALM_Work Item For）两组边。

    只保留实际导出成功的关联目标，返回 {relation: [(ecr_id, target_id), ...]}。
    """
    action_ids = _by_id(action_items)
    build_ids = _by_id(build_items)
    ecr_action: set[tuple[int, int]] = set()
    ecr_build: set[tuple[int, int]] = set()

    for row in ecr_items:
        ecr_id = _id_of(row)
        if ecr_id is None:
            continue
        for target_id in parse_id_list(row.get(config.ALIAS_ACTIONS, "")):
            if target_id in action_ids:
                ecr_action.add((ecr_id, target_id))
        for target_id in parse_id_list(row.get(config.ALIAS_WORK_ITEM_FOR, "")):
            if target_id in build_ids:
                ecr_build.add((ecr_id, target_id))

    return {
        config.REL_ACTIONS: sorted(ecr_action),
        config.REL_WORK_ITEM_FOR: sorted(ecr_build),
    }
