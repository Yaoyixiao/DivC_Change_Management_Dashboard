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
python src/generate_dashboard.py --open   # 渲染 dashboard.html（对新库当前必报错，见状态）
python src/generate_dashboard.py --serve  # 渲染 + 启动 PTC opener 服务（127.0.0.1:8766）
python .zcode/mockup_build.py             # 从真实 DB 重建设计稿注入数据
python packaging/build.py --smoke         # 打包 4 exe 到 Release/
```

详细用法、打包说明与验证流程见 [workflow.md](workflow.md)。

## 2. 当前状态（2026-10-07）

| 模块 | 状态 | 位置 / 文档 |
|---|---|---|
| 取数链路（ECR 层级 → Excel / SQLite / 2 JSON） | ✅ 已验证 | [data-pipeline.md](data-pipeline.md)（唯一权威） |
| Dashboard 内容 spec（信息架构 / 卡片 / 表格 / 抽屉 / 搜索 / 图谱 / 聚合口径，决策 #1–33） | ✅ 锁定 | [dashboard-content.md](dashboard-content.md) |
| 首页视觉设计稿（Bento 五卡 + ECR 树形表格，内嵌真实快照） | ✅ | [design/homepage.html](../design/homepage.html)，数据由 [.zcode/mockup_build.py](../.zcode/mockup_build.py) 注入 |
| PTC opener 服务（`integrity://` 链接经 127.0.0.1:8766 → OS ShellExecute，绕过 Mimecast 重写；离线时前端英文 modal 兜底） | ✅ | [src/dashboard_opener.py](../src/dashboard_opener.py) + [src/opener_only.py](../src/opener_only.py)（独立 exe 入口）；`generate_dashboard.py --serve` 组合启动 |
| PyInstaller 打包（4 exe → Release/） | ✅ | [packaging/build.py](../packaging/build.py) + [packaging/使用说明.md](../packaging/使用说明.md)，见 [workflow.md §3](workflow.md) |
| **渲染链路适配新库**（data_loader / aggregations / template / app.js 重写） | ❌ **待做** | 依据 dashboard-content.md §9 实现备忘；现状代码仍是旧 RA-OP 版本 |

**渲染适配时的直接参照物**：`design/homepage.html` 里的 `collectScoped()`（结果集作用域聚合）、
`WI_INDEX / ACTION_INDEX / searchEntities()`（⌘K 扁平索引）、`display_effort()`（effort 展示口径）
均可移植。

## 3. 文档索引

| 文件 | 内容 | 状态 |
|---|---|---|
| [data-pipeline.md](data-pipeline.md) | 取数链路：数据流 / 配置契约 / DB schema / 遍历语义 / 自测与扩展点 | ✅ 权威 |
| [dashboard-content.md](dashboard-content.md) | 新 dashboard 内容架构：两视图 + 五卡 + 表格 + 抽屉 + 搜索 + 图谱 + 聚合口径 + 决策记录 | ✅ 权威 |
| [workflow.md](workflow.md) | 命令 / 打包 / opener / 验证流程 | ✅ 已更新（旧看板手测清单标注遗留） |
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

1. **已完成（`graph-view` 分支，cc0f873）**：Graph 视图原型——在 design/homepage.html 上点亮
   导航的 Graph 占位（视觉参照旧 ProjectTree + Relate token），mockup_build.py 扩展注入图数据
   （flat nodes + 三类 edges，补 Build 与共享多父信息）；grill 定稿见 dashboard-content.md
   §6 与 §10 #34–38，手测清单见 workflow.md §4.1。
2. **渲染链路适配新库**（原型定稿后另立分支）：按 dashboard-content.md §9 重写 data_loader /
   aggregations，从 design/homepage.html 移植 Home（五卡 + 表格）与 Graph。
3. 适配同步项：重写 workflow.md 的浏览器手测清单；更新 `packaging/build.py --smoke` 的
   payload 断言（现为旧 RA-OP 计数，对新库必失败）。
4. 收尾项（dashboard-content.md §8 明确本轮不做，勿顺手加）：卡片点击筛选、深色模式、
   i18n、分页；⌘K 与 Graph 的跳转让位规则（原型定稿后另议）。
