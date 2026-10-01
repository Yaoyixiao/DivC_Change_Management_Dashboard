# DivC Change Management 数据流水线（ECR 层级）

## 运行

```powershell
python -m pip install -r requirements.txt
python fetcher.py            # 真实取数（需要 PTC 客户端 im 在 PATH 上）
python selftest_fetch.py     # 离线冒烟测试（假数据全链路，无需 PTC）
```

## 配置：ECR_Config.xlsx（与脚本同目录）

| Sheet | 内容 |
|---|---|
| `ECR` | `ID` 列 = 所有第一级要导出的 ECR Item |
| `Data_Field` | `Field` 列 = 所有 item 统一要导出的字段（必须包含 `ID`、`ALM_Work Items`、`ALM_Actions`、`ALM_Work Item For`） |
| `Pivot`（可选） | `Field` 列 = 透视树（ECR Tree）要 sum 的字段；缺 sheet 时缺省 `ALM_Planned Effort` |

导出层级：

```
ECR（配置的根 ID）
├── Work Item        经上一级 ALM_Work Items 关联导出，递归三级（L0/L1/L2）
│   └── Sub Work Item L1 / L2   同上，L2 不再下钻
├── Action           经 ECR 的 ALM_Actions 关联导出
└── Build            经 ECR 的 ALM_Work Item For 关联导出
```

## 输出

- `output/data.xlsx`：人工核查（Items / ECR Tree / Edges / Metadata 四个 sheet；ECR Tree 为按层级 +/- 折叠的透视树，对 Pivot 配置的列做子树 sum）
- `output/dashboard.db`：SQLite 数据源
- `output/dashboard_manifest.json`：本次生成时间、配置文件名、各 kind 与关系计数
- `output/dashboard_schema.json`：前端/后端可读取的数据契约

数据库为通用节点表结构（列名由字段表动态生成，`*_date` 列统一存 ISO `YYYY-MM-DD` 文本）：

- `items`：全部实体一张表。`kind` ∈ ecr / work_item / action / build；`level` 仅 work_item 有值（距 ECR 的 hop 数 0/1/2）；`process_area` 为 work_item（Summary 抽取）与 action（Initial IA）的 ASPICE 流程域分类；其余列为 Data_Field 的字段（剥 `ALM_` 前缀、小写、空格转下划线）
- `edges`：`(parent_id, child_id, relation)`，relation ∈ work_items / actions / work_item_for
- `metadata`：schema_version / generated_at / config_file / root_item_ids

## 语义约定

- **level** = 距任一 ECR 沿 `work_items` 边的最小 hop 数（BFS 首次发现即定）。
- **边只记录遍历方向的边**（父 → 本层新发现的子）：已见节点不重复导出也不产生边，天然无环。
- 同一 Work Item 被多个父级引用时只导出一次，但每条引用各自成边。
- 关联目标在 PTC 不存在时对应边被丢弃；根 ID 不存在时导出数少于配置数并记 warning。
- **透视树（ECR Tree）**：Subtotal = 自身 + 全部后代；同一 ECR 子树内节点去重（多父级挂首条路径）；TOTAL = 各 ECR Subtotal 之和，共享节点会被计多次（列内一致性优先）。
- **Team 清洗**：导出时对 `Team` 列统一清洗——去掉开头的 `(数字id)` 与结尾的 `PR+数字` 项目号，只保留团队名（如 `(12345) Software Integration PR24680` → `Software Integration`）。
- **Process Area 派生列**：`work_item` 从 `Summary` 抽取 ASPICE 流程域（白名单大小写归一，`Sys.4-5` 区间取首数字，`SWE.2_` 下划线视为边界，`SWE. 3` 带空格归一化）；未命中缩写时按关键词回退：含 `System requirement`/`Sys Req` → `SYS.2`，含独立词 `TSC` → `TSC`，含 `impact analysis` → `Detail IA`；`action` 一律为 `Initial IA`；`ecr`/`build` 为空。
- CLI 日志仅用 ASCII 字符（Windows 控制台代码页兼容）。
- 日期列判定：数据库列名以 `_date` 结尾（如 planned_start_date；`...Date Ref` 类字段不作日期处理）。
