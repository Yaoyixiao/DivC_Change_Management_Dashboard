# DivC Change Management Dashboard — Handoff

> 单文件自包含 HTML dashboard，把 `src/output/dashboard.db`（PTC Integrity / Windchill RV&S
> 按 ECR 层级导出：ECR → Work Item 三级 / Action / Build）转成可视化检索工作台 + 关系图谱。

> **⚠️ 状态更新（2026-10-07）**：phase 1 取数链路已完成并用真实 PTC 客户端验证（权威文档
> [data-pipeline.md](data-pipeline.md)）。phase 2 dashboard **内容 spec 已锁定、视觉设计稿已完成、
> opener 与打包已交付，但 `src/dashboard_generator/` 渲染本体尚未适配新库**（对新库必报错
> `no such table: ra_op`，属预期）。内容唯一权威：[dashboard-content.md](dashboard-content.md)；
> 视觉/交互参照：[design/homepage.html](../design/homepage.html)。旧 RA-OP 看板文档已加横幅，
> 仅作模块与交互思路参考。

## 1. 一句话命令

```bash
cd D:\Users\yixiao\Documents\GitHub\DivC_Change_Management_Dashboard
python src/selftest_fetch.py              # 取数链路回归（离线假数据）
python src/generate_dashboard.py --open   # 渲染 dashboard.html 并用默认浏览器打开
python src/generate_dashboard.py --serve  # 渲染 + 启动 PTC opener 服务（127.0.0.1:8766）
python .zcode/mockup_build.py             # 从真实 DB 重建设计稿注入数据（仅维护设计参照）
python packaging/build.py --smoke         # 打包 4 exe 到 Release/ + 冒烟自检
```

详细用法、打包说明与验证流程见 [workflow.md](workflow.md)。

## 2. 当前状态（2026-10-09）

| 模块 | 状态 | 位置 / 文档 |
|---|---|---|
| 取数链路（ECR 层级 → Excel / SQLite / 2 JSON） | ✅ 已验证 | [data-pipeline.md](data-pipeline.md)（唯一权威） |
| Dashboard 内容 spec（信息架构 / 卡片 / 表格 / 抽屉 / 搜索 / 图谱 / 聚合口径，决策 #1–41） | ✅ 锁定 | [dashboard-content.md](dashboard-content.md) |
| 首页视觉设计稿（Bento 五卡 + ECR 树形表格 + Graph，内嵌真实快照） | ✅ 定稿 | [design/homepage.html](../design/homepage.html)，数据由 [.zcode/mockup_build.py](../.zcode/mockup_build.py) 注入（已退为视觉参照） |
| **渲染链路适配新库**（data_loader / aggregations / html_template / assets 重写 + 原型移植） | ✅ **已完成**（`render-pipeline` 分支） | 生产模板 [src/dashboard_generator/](../src/dashboard_generator/)；payload 信封 `{data, graph, aggregations, meta}`；overdue 前端自算；drawer 全字段 |
| PTC opener 服务（`integrity://` 链接经 127.0.0.1:8766 → OS ShellExecute，绕过 Mimecast 重写；离线时前端英文 modal 兜底） | ✅ | [src/dashboard_opener.py](../src/dashboard_opener.py) + [src/opener_only.py](../src/opener_only.py)（独立 exe 入口）；`generate_dashboard.py --serve` 组合启动 |
| PyInstaller 打包（4 exe → Release/） | ✅ | [packaging/build.py](../packaging/build.py) + [packaging/使用说明.md](../packaging/使用说明.md)，见 [workflow.md §3](workflow.md)；`--smoke` 断言动态对照 manifest |

**验证基线（2026-10-09）**：`node --check` + 生成 payload 与设计稿 DATA/GRAPH 逐值等价 +
自包含正则 + 浏览器自动化冒烟（Home/表格/抽屉/Graph/opener 兜底）+ `--smoke` 两层全过；
待用户执行：真实 PTC 取数、完整手测（workflow.md §4）、同事机器验证。

## 3. 文档索引

| 文件 | 内容 | 状态 |
|---|---|---|
| [data-pipeline.md](data-pipeline.md) | 取数链路：数据流 / 配置契约 / DB schema / 遍历语义 / 自测与扩展点 | ✅ 权威 |
| [dashboard-content.md](dashboard-content.md) | 新 dashboard 内容架构：两视图 + 五卡 + 表格 + 抽屉 + 搜索 + 图谱 + 聚合口径 + 决策记录 | ✅ 权威 |
| [workflow.md](workflow.md) | 命令 / 打包 / opener / 验证流程（含新看板 Home/Graph 手测清单） | ✅ 权威 |
| [architecture.md](architecture.md) | 旧看板数据流 / 模块依赖 / 设计决策 | ⚠️ RA-OP 遗留 |
| [ui-components.md](ui-components.md) | 旧看板三视图 + 抽屉的语义、数据源、交互 | ⚠️ RA-OP 遗留 |
| [data-contract.md](data-contract.md) | `__PAYLOAD__` 结构（信封形状 `{data, aggregations, meta}` 仍沿用，实体字段是旧口径） | ⚠️ RA-OP 遗留 |
| [file-map.md](file-map.md) | 旧看板每文件职责 + 函数清单 | ⚠️ RA-OP 遗留 |
| [known-issues.md](known-issues.md) | 旧看板已知 bug / 口径差异 | ⚠️ RA-OP 遗留 |
| [extension-points.md](extension-points.md) | 旧看板扩展手法 | ⚠️ RA-OP 遗留 |

## 4. 设计一句话

参考 [Reference/Relate_DESIGN.md](../Reference/Relate_DESIGN.md)（Relate 设计语言）+ `Reference/`
下的 CSS 摘录与格局图：全页浅色画布 + 白卡 16px 圆角、Inter 字体（base64 内嵌）、accent 蓝
（`#3b82f6` 试换中，见 dashboard-content.md 决策 #18/#19）。Home = 极简页头（仅搜索栏）+
Bento 五卡（Totals / Effort / Creation Timeline / Process Area / Team）+ ECR 树形表格
（内联子行、树形参考线、列筛选、嵌套排序）；Graph 为独立视图。设计稿全貌见
[design/homepage.html](../design/homepage.html)。

## 5. 数据规模（2026-10-01 真实快照，随取数变化）

```
items 168 = ecr 10 + work_item 129 (L0 99 / L1 18 / L2 12) + action 24 + build 5
edges 164 = work_items 132（含 3 处共享 WI 引用）+ actions 24 + work_item_for 8（5 Build 部分被多 ECR 共享）
```

## 6. 关键口径

统一见 [dashboard-content.md §7](dashboard-content.md#7-聚合口径锁定)（锁定）：状态二分
（**`ALM_Completed` 属 Closed**）、逾期前端自算、Children 按实体数、`...Date Ref` 是 Excel
序列号（epoch 1899-12-30）、effort 为 TEXT 需 CAST、Planned Effort 逐行展示口径与空值留白。

## 7. 接下来的工作

1. **已完成（`graph-view` 分支，cc0f873…12b04e9）**：Graph 视图原型 + #39–41
   （节点抽屉 / 进度环 / Team·Process Area 维度展开），grill 定稿见 dashboard-content.md
   §6 与 §10 #34–41，手测清单见 workflow.md §4.2。
2. **已完成（`render-pipeline` 分支，2026-10-09）**：渲染链路适配新库——重写 data_loader /
   aggregations / html_template，原型移植为 `src/dashboard_generator/assets/` 生产模板；
   workflow.md §4 手测清单已重写；`packaging/build.py --smoke` 断言改为动态对照 manifest。
3. **待用户执行**：真实 PTC 取数刷新快照（`python src/fetcher.py`）后重新生成/打包验证；
   完整浏览器手测（workflow.md §4）；同事机器分发验证；`render-pipeline` / `graph-view`
   分支合并回 main。
4. 收尾项（dashboard-content.md §8 明确本轮不做，勿顺手加）：卡片点击筛选、深色模式、
   i18n、分页；⌘K 与 Graph 的跳转让位规则（另议）。
