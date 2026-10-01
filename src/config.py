"""PTC Integrity / Windchill RV&S ECR 层级导出配置。

导出内容（根 ID 与字段表）不写死在这里，而是运行时从
ECR_Config.xlsx 读取（见 ecr_config.py）。本文件只保留
连接参数、层级结构常量与输出路径。
"""
import sys
from pathlib import Path

from data_utils import build_alias

CLI_HOSTNAME = "skobde-mks-im.kobde.trw.com"
CLI_PORT = 7001

QUERY_BATCH_SIZE = 100
SCHEMA_VERSION = 1

# ---------- ECR 层级：实体类型 ----------
KIND_ECR = "ecr"
KIND_WORK_ITEM = "work_item"
KIND_ACTION = "action"
KIND_BUILD = "build"
KINDS = (KIND_ECR, KIND_WORK_ITEM, KIND_ACTION, KIND_BUILD)

# ---------- ECR 层级：关联关系（edges.relation 取值） ----------
REL_WORK_ITEMS = "work_items"        # ECR/Work Item -> 下一级 Work Item
REL_ACTIONS = "actions"              # ECR -> Action
REL_WORK_ITEM_FOR = "work_item_for"  # ECR -> Build

# 用于遍历的关系字段名（必须包含在 ECR_Config.xlsx 的 Data_Field 里，即向 im 请求的原始名）
FIELD_WORK_ITEMS = "ALM_Work Items"
FIELD_ACTIONS = "ALM_Actions"
FIELD_WORK_ITEM_FOR = "ALM_Work Item For"

# 关系字段在"标准化后的行 dict"里的键（剥 ALM_ 前缀，见 data_utils.build_alias）。
# 导出行都会先经 normalize_columns 转成别名键，遍历/建边一律用别名常量读取。
ALIAS_WORK_ITEMS = build_alias(FIELD_WORK_ITEMS)        # "Work Items"
ALIAS_ACTIONS = build_alias(FIELD_ACTIONS)              # "Actions"
ALIAS_WORK_ITEM_FOR = build_alias(FIELD_WORK_ITEM_FOR)  # "Work Item For"
ALIAS_TEAM = build_alias("ALM_Team")                    # "Team"（导出时清洗，见 data_utils.clean_team）

# 派生数据段（不在 Data_Field 字段表里，导出时计算）：ASPICE 流程域，
# 仅 work_item 有值，从 Summary 抽取（见 data_utils.extract_process_area）
ALIAS_PROCESS_AREA = "Process Area"   # 行 dict 键 / Excel 列名；DB 列名 process_area

# Work Item 递归深度：ECR 下最多 L0/L1/L2 三级（hop 数 0/1/2），L2 不再下钻
WORK_ITEM_MAX_LEVEL = 2

# Excel 透视树（ECR Tree sheet）的缺省汇总字段；
# 可在 ECR_Config.xlsx 的 'Pivot' sheet 里覆盖为任意 Data_Field 已有字段
DEFAULT_PIVOT_FIELD = "ALM_Planned Effort"

# PyInstaller onefile 下 __file__ 指向临时解压目录（退出即删），frozen 时以 exe 所在目录为基准
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent

ECR_CONFIG_PATH = str(BASE_DIR / "ECR_Config.xlsx")
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_PATH = str(OUTPUT_DIR / "data.xlsx")
DATABASE_PATH = str(OUTPUT_DIR / "dashboard.db")
MANIFEST_PATH = str(OUTPUT_DIR / "dashboard_manifest.json")
SCHEMA_PATH = str(OUTPUT_DIR / "dashboard_schema.json")
TEMP_DIR = str(OUTPUT_DIR / ".tmp_exportissues")
