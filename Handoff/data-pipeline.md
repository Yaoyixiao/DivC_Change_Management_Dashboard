# 数据链路 Handoff —— ECR 层级导出（fetch chain）

> 本文描述 **取数链路**：从 PTC Integrity / Windchill RV&S 按 `ECR_Config.xlsx` 配置导出 ECR 层级数据，
> 生成 Excel、SQLite 与两个 JSON。与 dashboard 渲染链路通过 `src/output/dashboard.db` 解耦。
>
> **当前状态（2026-10-01）**：已用真实 PTC 客户端验证通过并产出全量数据。
> 本文由 2026-10-01 的取数改造（RA-OP → ECR 层级）沉淀而来，取数部分与旧文档
> （architecture.md / file-map.md 等）不一致时**以本文为准**。

## 1. 一句话命令

```bash
cd <仓库根>
python src/fetcher.py          # 真实取数（需 PTC 客户端 im 在 PATH + 内网 + 已缓存凭据）
python src/selftest_fetch.py   # 离线回归（假数据全链路，无需 PTC，改动后必跑）
```

真实运行输出四件套到 `src/output/`（frozen 运行时输出到 exe 同目录的 `output/`）：

| 文件 | 用途 |
|---|---|
| `data.xlsx` | 人工核查（Items / Edges / Metadata 三个 sheet） |
| `dashboard.db` | SQLite 数据源，dashboard 阶段的唯一输入 |
| `dashboard_manifest.json` | 生成时间、配置文件名、各 kind 与关系计数 |
| `dashboard_schema.json` | 机器可读的数据契约（表/列/类型） |

## 2. 数据流

```
ECR_Config.xlsx（配置）                 PTC Integrity CLI (im)
  'ECR' sheet: 根 ID 列                 im connect → im exportissues
  'Data_Field' sheet: 字段列     ──►    （--queryDefinition=(field[ID]=..) or ..,
        │                                --fields=<42字段>, 输出 .xls, 每批 100 个 ID）
        ▼                                        │
   ecr_config.py                                 ▼
   load_ecr_config()                     parser.py
        │                                read_exported_excel / normalize_columns
        │                                （剥 ALM_ 前缀 → 别名键）
        ▼                                        │
   fetcher.py  ──────────────────────────────────┘
   ├─ export_ids_in_batches()    批量导出 + 去重合并
   ├─ relationship_builder.traverse_work_items()   Work Item BFS 三级递归
   ├─ relationship_builder.build_relationships()   ECR→Action / ECR→Build 边
   ▼
   四个 writer（互相独立，可单独调用）
   ├─ excel_writer.write_items_to_excel      → data.xlsx
   ├─ database_writer.write_dashboard_database → dashboard.db（原子写 + integrity_check）
   └─ json_writer.write_dashboard_json        → manifest + schema JSON
```

层级结构（严格按需求 `Requirement/Change_Request.md`）：

```
ECR（根，ID 来自配置）
├── Work Item (L0)      经上一级 ALM_Work Items 关联导出
│   └── Sub Work Item L1     同上（递归）
│       └── Sub Work Item L2 同上（L2 不再下钻）
├── Action              仅经 ECR 的 ALM_Actions 关联导出
└── Build               仅经 ECR 的 ALM_Work Item For 关联导出
```

## 3. 文件清单（src/）

| 文件 | 职责 | 关键入口 |
|---|---|---|
| `ecr_config.py` | 读配置 xlsx | `load_ecr_config(path) -> EcrConfig(root_ids, fields)` |
| `config.py` | 全部常量：CLI 地址、kind/relation、关系字段名、批量大小、路径（frozen 感知） | `KIND_*` / `REL_*` / `FIELD_*` / `ALIAS_*` / `WORK_ITEM_MAX_LEVEL` |
| `fetcher.py` | 取数入口与编排 | `main()` / `export_ids_in_batches()` |
| `cli_client.py` | `im connect` + `im exportissues` 封装（未改动） | `export_issues(query_definition, fields, output_file)` |
| `parser.py` | 解析导出文件与关系字段（未改动，仅拆分读取函数） | `read_exported_excel` / `normalize_columns` / `parse_id_list` / `collect_related_ids` / `build_id_query_definition` / `batched` / `deduplicate_by_id` |
| `relationship_builder.py` | BFS 遍历 + 建边（纯逻辑，导出经 `export_fn` 回调注入） | `traverse_work_items(ecr_items, export_fn)` / `build_relationships(...)` |
| `data_utils.py` | 日期解析 + 字段名推导 + 导出数据清洗与派生 | `build_alias` / `build_aliases` / `build_column_names` / `clean_team` / `extract_process_area` / `parse_date` / `date_to_iso` |
| `database_writer.py` | SQLite（通用节点表） | `write_dashboard_database(...)` |
| `excel_writer.py` | Excel 三 sheet | `write_items_to_excel(...)` |
| `json_writer.py` | manifest + schema JSON | `write_dashboard_json(...)` |
| `selftest_fetch.py` | 离线冒烟测试（唯一回归手段，无 pytest） | `python src/selftest_fetch.py` → PASS |
| `update_all.py` | 一键 = fetcher.main + generate_dashboard.main（未改动） | **注意：dashboard 步骤当前会失败**，见 §8 |

### 关键设计：两套字段名常量

- `config.FIELD_*` = 向 im 请求的**原始字段名**（`ALM_Work Items`），也是 Data_Field sheet 里的写法；
- `config.ALIAS_*` = `normalize_columns` 之后**行 dict 的键**（`Work Items`，剥 `ALM_` 前缀）。
- 遍历/建边从行里读关系字段时**一律用 ALIAS_*，用错会静默取到空值**（selftest 覆盖了这条）。

## 4. 配置契约：ECR_Config.xlsx（与脚本同目录；frozen 时与 exe 同目录）

| Sheet | 结构 | 说明 |
|---|---|---|
| `ECR` | 单列，首行表头 `ID` | 所有第一级要导出的 ECR Item（当前 10 个） |
| `Data_Field` | 单列，首行表头 `Field` | 所有 item 统一导出的字段（当前 42 个） |
| `Pivot`（可选） | 单列，首行表头 `Field` | Excel 透视树（ECR Tree）要 sum 的字段（当前 4 个 Effort 字段）；**缺 sheet 时缺省 `ALM_Planned Effort`**；列出的字段必须在 Data_Field 字段表里，否则报错；空 sheet（只有表头）= 显式不汇总 |

校验（`load_ecr_config`，失败即抛错、不进入导出）：

- `ECR` / `Data_Field` 必须存在且非空；`Data_Field` 必须包含 `ID`、`ALM_Work Items`、`ALM_Actions`、`ALM_Work Item For`；
- ID / Field / Pivot 自动去空、去重、保序；ID 必须是数字；
- `Pivot` 里的每个字段必须 ∈ Data_Field 字段表。

改字段**只改这个 xlsx**，DB/Excel 列名自动跟随（schema 全动态），代码零改动。

## 5. 数据契约

### 5.1 SQLite（dashboard.db）——通用节点表

```sql
items(
  id INTEGER PRIMARY KEY,      -- PTC Item ID（四类实体共用一张表）
  kind TEXT NOT NULL,          -- 'ecr' | 'work_item' | 'action' | 'build'（config.KINDS）
  level INTEGER,               -- work_item：距 ECR 的 hop 数 0/1/2；其余 kind 为 NULL
  process_area TEXT,           -- work_item：Summary 抽取的 ASPICE 流程域（§5.5）；action：固定 Initial IA；ecr/build 为空
  ... 41 个字段列 TEXT         -- 由 Data_Field 动态生成：剥 ALM_ 前缀、小写、空格转下划线
)
edges(                          -- 显式关系边
  parent_id INTEGER NOT NULL,
  child_id INTEGER NOT NULL,
  relation TEXT NOT NULL,       -- 'work_items' | 'actions' | 'work_item_for'（config.REL_*）
  PRIMARY KEY (parent_id, child_id, relation)
)
metadata(key, value)            -- schema_version / generated_at / config_file / root_item_ids(JSON)

-- 索引：items(kind)、edges(child_id)、edges(relation)
```

- 日期列判定：**列名以 `_date` 结尾**才做 ISO 转换（`YYYY-MM-DD` 文本）。注意
  `review_planned_start_date_ref` 这类 "...Date Ref" 字段**不**按日期处理，原样存文本。
- 派生列 `process_area` 不在 Data_Field 字段表里，schema 固定生成（与 `level` 同理）。
- 其余列全部 TEXT（含工时/时长等数值列）——phase 2 聚合时需要时再 CAST。
- 写入原子（`.tmp` + `os.replace`），完成后 `PRAGMA integrity_check`。

### 5.2 Excel（data.xlsx）

| Sheet | 内容 |
|---|---|
| `Items` | `ID, Kind, Level, Process Area` + 42 个字段的展示别名（剥 ALM_ 前缀）；别名以 `Date` 结尾的列写成真日期单元格；Process Area 规则见 §5.5 |
| `ECR Tree` | **透视树**（2026-10-01 新增，见下方口径） |
| `Edges` | `Parent ID, Child ID, Relation` |
| `Metadata` | Export Time + 各 kind 计数 + 各 relation 计数 |

**ECR Tree 口径**（实现在 `excel_writer._write_tree_sheet`）：

- 行序：按 ECR（Items 顺序）逐棵深度优先——ECR 行 → Work Item 子树（L0→L1→L2，子节点按发现序）→ Action 组 → Build 组。
- 列：`ID, Kind, Summary, State, Subtree Items` + 每个汇总指标两列：`{别名}`（自身值）与 `{别名} Subtotal`（自身+全部后代的 sum；叶子行两者相等）。汇总列由 `Pivot` sheet 配置（见 §4）。
- **折叠**：Excel 大纲分组实现原生 +/− 按层级展开（`outlineLevel` = 树深度：ECR=0、L0=1、L1=2、L2=3、Action/Build=1；`outlinePr.summaryBelow=False` 使按钮出现在父行）。openpyxl 无法创建真正的 PivotTable 对象，大纲分组是"类似透视表"的既定实现。
- **去重**：同一 ECR 子树内节点只出现一次（多父级挂首条路径=最短路径，与 level 语义一致），Subtotal 不重复计数。
- **TOTAL**：第 2 行加粗 TOTAL = 各 ECR Subtotal 之和。同一节点被不同 ECR 引用时在各子树各计一次，**因此共享节点在 TOTAL 中被计多次**（列内一致性优先；当前数据 work_items 有 3 条共享引用边）。
- 数值解析：纯数字字符串（含小数）→ float，容忍千分位逗号；空串/非数字按 0 计入 Subtotal，自身列原样保留。
- **与 PTC rollup 的差异（实测，非 bug）**：自算 `Planned Effort Subtotal` 与 PTC 自带 `rollup_planned_effort` 在 10 个 ECR 中 7 个一致；4 个不一致（如 10436107 自算 212 vs PTC 468）——PTC rollup 的汇总范围与 ALM_Work Items 子树不必相同（可能包含其他子项或不同状态集）。两列并排展示正好用于口径对照。

### 5.3 manifest / schema JSON

- `dashboard_manifest.json`：`{schema_version, generated_at, status:"ready", config_file, files{database,excel,schema}, counts{ecr,work_item,action,build}, relationship_counts{work_items,actions,work_item_for}}`
- `dashboard_schema.json`：items/edges 的列与类型（`*_date` → "date"）、`kinds`、`relations`——机器可读契约，phase 2 的 data_loader 可直接消费。

### 5.4 真实数据规模（2026-10-01 运行）

```
ecr 10 → work_item 129（L0=99, L1=18, L2=12）
       → action 24
       → build 5
边：work_items 132（3 条共享引用）、actions 24、work_item_for 8（build 有共享）
items 表 44 列（id + kind + level + 41 字段列），其中 10 个 *_date 列
```

注意：**build 仅 5 个但边有 8 条**——同一 Build 被多个 ECR 引用时各成一条边（共享实体只导出一次）。
Dashboard 聚合时按边计数与按实体计数会不同，口径要想清楚。

### 5.5 导出时数据清洗与派生数据段（2026-10-01）

两类动作都在 `fetcher` 出口处统一执行，Excel / DB / 下游消费的值全部是处理后的。

**清洗**（`fetcher._clean_rows`，在 `export_ids_in_batches` 出口、normalize/去重之后执行，
`data_utils.clean_team`，作用于所有 kind 的 `Team` 列）：

- 去掉开头的 `(数字id)`：`(12345) Software Integration` → `Software Integration`
- 去掉结尾的 `PR+数字` 项目号（PR 忽略大小写），实测两种形态都兼容：裸 `PR65978` 与方括号 `[PR60806]`：
  `Hardware Team PR1001` → `Hardware Team`；`APSW-CPP-VehicleCommunication [PR60806]` → `APSW-CPP-VehicleCommunication`
- 两段都可选，同时存在时都剥；整串被剥掉（如 `(777) PR888`）时留空；无前后缀的值原样保留
- 已用真实运行的全部 25 个 Team 唯一值逐一验证清洗结果（2026-10-01）

**派生数据段 Process Area**（`fetcher._tag_process_areas`，在 items 组装后、writer 之前执行，
`data_utils.extract_process_area`）：

- `work_item`：从 `Summary` 抽取，规则优先级：
  1. **流程域缩写**：白名单（SYS/SWE/HWE/MAN/SUP/ACQ/PIM/SPL/ENG/SOO/VAL）+ 点号 + 1-2 位数字，
     大小写不敏感并归一化为大写；容忍 `SWE. 3` 带空格；容忍 `Sys.4-5` 区间写法（取首数字 → `SYS.4`）；
     数字后的 `_` 视为边界（`SWE.2_Software_Arch` → `SWE.2`），但排除后随数字/点（`SWE.123` 不截断匹配）；
     长单词中部不误抽（`EEPROM.2` 不产生 `ROM.2`）；多命中取第一个
  2. **关键词回退**（仅当未命中缩写，按需求顺序）：含 `System requirement` 或 `Sys Req` → `SYS.2`；
     含独立词 `TSC` → `TSC`（需求原文写 'TCS'，按源词缩写处理，`config.PROCESS_AREA_TSC` 一处可改）；
     含 `impact analysis` → `Detail IA`
  3. 都不命中留空
- `action`：**一律固定为 `Initial IA`**（不管 Summary 内容）
- `ecr` / `build`：为空（ECR Summary 含 `SYS.5` 也不算）

真实数据效果（2026-10-01）：129 条 work_item 可分类 120 条（93%）；24 条 action 全部 Initial IA；
剩余 9 条无任何规则命中（STKHReq / SW domain task / S310 Release Report 等）。

## 6. 遍历与建边语义（改动前必读）

实现集中在 `relationship_builder.py`，语义由需求文档严格限定：

1. **level** = 距任一 ECR 沿 `work_items` 边的最小 hop 数（0/1/2）。BFS 首次发现即定，首现即最短，不回填。
2. **最多三级**：`WORK_ITEM_MAX_LEVEL = 2`，处理完 L2 层即停，L2 的 `ALM_Work Items` 不再解析（即使指向已导出节点也不建边）。
3. **边只记录"父 → 本层新发现的子"**：已见节点（含上层节点）不重复导出、不产生边 → 图天然无环。
4. **去重**：同一 item 只导出一次（`export_fn` 返回的行按 ID 合并，首见非空值保留）；同一父级字段值里的重复 ID 被 `parse_id_list` 去重。
5. **共享引用**：多个父级指向同一子级时，每条引用各自成边（父子对去重）。
6. **容错**：关联目标或根 ID 在 PTC 不存在时，`im exportissues` 静默少返回 → 对应边被丢弃、根数少于配置数时记 warning（不报错）；边只会指向实际导出成功的 ID。
7. Action / Build **只从 ECR 收集**（不遍历 Sub Work Item 的 Action/Build 关系）——需求文档 1.2/1.3 挂在 ECR 一级之下，用户已确认。

## 7. 工作流

### 真实取数（已验证）

```bash
python src/fetcher.py
```

前提：PTC 客户端 `im` 在 PATH、内网可达、凭据已缓存（首次手动 `im connect` 一次）。
单批 ID 查询为 `(field[ID]=a) or (field[ID]=b) ...`，批大小 `QUERY_BATCH_SIZE = 100`；
每批写临时 `.xls` 到 `output/.tmp_exportissues/`，结束（含异常）整体删除。

### 离线回归（改代码后必跑）

```bash
python src/selftest_fetch.py
```

原理：monkeypatch `fetcher.export_issues`（写 xlsx 假导出）与 `fetcher.read_exported_excel`
（经 BytesIO 按内容读——openpyxl 按扩展名拒读 `.xls` 命名的文件），并把 config 路径全部指到临时目录，
然后跑真实 `fetcher.main()`。断言覆盖：共享 Work Item、三级递归与深度截断、不存在 ID 容错、
回指不成环、ISO/Excel 序列数两种日期、Team 清洗（含整串剥空的边界）、Process Area 全规则
（缩写形态 / 区间 / 下划线边界 / 防误抽 / 关键词回退及优先级 / action 固定 Initial IA）、
四件套内容一致性、临时目录清理。

**改遍历语义、schema 或 writer 后，先跑它再上真实环境。**

### 一键

`python src/update_all.py` = fetcher → generate_dashboard。**第二步当前会失败**（见 §8）。

## 8. 已知限制与注意点

1. ~~**dashboard 链路尚未适配**~~（已于 2026-10-09 完成）：`dashboard_generator/` 与
   `generate_dashboard.py` 已重写为直接消费本文 §5 的 items/edges/metadata 三表（payload 信封
   `{data: {ecrs, builds, items}, graph, aggregations, meta}`），`update_all.py` 全链路可用。
   data_loader 侧带必需列校验，指向旧库/错库会报明确的英文错误。
2. **字段有效性耦合**：一次 `im exportissues` 对所有 item 类型请求同一份 42 字段清单；
   新增字段必须对 ecr/work_item/action/build 四类都合法，否则整个导出报错
   （`cli_client` 的 RuntimeError 会带出 im 的 stdout/stderr）。届时再按 kind 拆分字段清单（见 §9）。
3. **数值列全是 TEXT**：SQLite 侧排序/聚合需要 CAST；"Ref" 类字段不做日期解析。
4. **level 有上限**：L2 的下级关系被有意忽略；若未来要更深层，调 `WORK_ITEM_MAX_LEVEL` 即可，
   schema 无需改动（level 列是 int）。
5. **无 pytest / CI**：`selftest_fetch.py` 是唯一回归手段；`parser.read_exported_excel` 按扩展名分发，
   真实导出固定 `.xls`（xlrd 读），不要顺手改成 `.xlsx` 除非确认 im 支持。
6. **Windows 控制台**：源码运行日志为中文（GBK 控制台可显示）；打包 exe 场景沿用
   `exe_utils.make_streams_tolerant()` 兜底，CLI 输出避免非常用 Unicode 符号。
7. **打包**：`BASE_DIR`/`ECR_CONFIG_PATH` 已 frozen 感知（exe 目录为基准）；PyInstaller 打包见
   `packaging/build.py`（4 exe → `Release/`，`--smoke` 两层自检），已常态化。

## 9. 扩展点

| 想做什么 | 改哪里 | 说明 |
|---|---|---|
| 增/删导出字段 | 只改 `ECR_Config.xlsx` 的 Data_Field | 四件套 schema 全部自动跟随；删除关系字段前确认不再是必需字段 |
| 换根 ECR | 只改 `ECR` sheet | |
| 调整透视树汇总列 | 只改 `Pivot` sheet | 列出 Data_Field 里的任意字段名即可（含 Duration 类数值列）；删掉 Pivot sheet 恢复缺省 `ALM_Planned Effort` |
| 调 Work Item 层数 | `config.WORK_ITEM_MAX_LEVEL` | BFS 与 level 列自动适应 |
| 加新关联类型（如 Sub Work Item 下的 Action） | `config` 加 `FIELD_/ALIAS_/REL_` 常量 → `relationship_builder` 加遍历/建边 → `fetcher.main` 接线 → `json_writer` 的 `relations` 列表加一项 | selftest 加对应假数据断言 |
| 按 kind 拆分字段清单 | `ecr_config` 扩展配置结构 + `fetcher` 每类实体用各自字段表 | 仅当 PTC 拒绝跨类型字段时才需要 |
| 加新的导出清洗规则 | `data_utils` 加纯函数 + `fetcher._clean_rows` 接线 + `selftest_fetch` 加假数据断言 | 清洗统一在 normalize/去重之后、写四件套之前执行（现规则见 §5.5） |
| 加新的派生数据段（如从 Summary 抽取） | `data_utils` 加纯函数 + `config` 加 `ALIAS_*` 常量 + 三个 writer 加固定列 + `fetcher` 加 `_tag_*` 接线 + `selftest_fetch` 加断言 | 参考 Process Area 的实现（§5.5）；schema 变更后旧 dashboard.db 需重跑取数才会带上新列 |
| ~~phase 2：dashboard 适配~~（已完成 2026-10-09） | `data_loader` 读 items/edges/metadata → `{data: {ecrs, builds, items}, graph, aggregations, meta}`；聚合含 `ALM_Completed` 的 CLOSED 集；前端为原型移植（详见 [file-map.md](file-map.md) 与 [workflow.md](workflow.md) §4） | 换字段/换口径时的前端落点：`data_loader.display_effort`（effort 展示规则）、`aggregations.compute_*`（卡片基线）、`assets/app.js`（overdue 前端自算与 drawer 字段分组） |

## 10. 与其他 Handoff 文档的关系

| 文档 | 状态 |
|---|---|
| 本文（data-pipeline.md） | ✅ 取数链路的唯一权威描述 |
| dashboard-content.md / workflow.md / file-map.md / known-issues.md | ✅ 已按新渲染链路更新（2026-10-09）：内容口径 / 命令与验证 / 文件职责 / 已知问题 |
| architecture.md / ui-components.md / data-contract.md / extension-points.md | 描述旧 RA-OP 看板，横幅已标注；模块思路可参考，schema/payload 一律以本文 §5 与 `data_loader.py` 为准 |
| `Requirement/Change_Request.md` | 本次改造的需求原文（层级结构与配置 sheet 的出处） |
