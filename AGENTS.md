# AGENTS.md

给 AI 编码代理的项目工作规则。回复用户使用**中文**；代码注释、日志与错误消息使用**英文**。
新增或修改的代码一律英文注释/日志；存量中文注释与日志暂不强制迁移，重写所触达的段落时顺带转换。

## 项目是什么

DivC Change Management Dashboard —— 从 PTC Integrity / Windchill RV&S 按 `src/ECR_Config.xlsx`
配置导出 ECR 层级数据（ECR → Work Item 三级 / Action / Build），生成 Excel、SQLite 与两个 JSON；
再基于 SQLite 渲染单文件自包含 HTML dashboard（Home 检索工作台 + Graph 关系图谱）。

- **阶段状态（2026-10-09）**：
  - **取数链路（phase 1）**：已完成，2026-10-01 用真实 PTC 客户端验证通过，此后无改动。
  - **dashboard 渲染链路（phase 2）**：**已适配落地**（`render-pipeline` 分支，自
    `graph-view` 分出）。`src/dashboard_generator/`（data_loader / aggregations /
    html_template / assets 三件套）已重写为新库三表（items/edges/metadata）+ 新设计：
    - 内容 spec：`Handoff/dashboard-content.md`（信息架构/卡片/表格/搜索/图谱/聚合口径，
      决策记录 #1–41 已锁定）；
    - 生产模板：`src/dashboard_generator/assets/`（template.html / styles.css / app.js，
      由 `design/homepage.html` 原型移植；此后改前端直接改这里，原型退为视觉参照）；
    - payload 信封：`window.__PAYLOAD__ = {data: {ecrs, builds, items}, graph,
      aggregations, meta}`；overdue 前端自算（不进 payload）；drawer 为全字段分组；
    - PTC opener 服务：`src/dashboard_opener.py`（127.0.0.1:8766，把 ID 链接交给 OS
      ShellExecute 派发，绕过浏览器侧 Mimecast URL 重写）；`src/opener_only.py` 为独立入口；
    - 打包：`packaging/build.py` 构建 4 个 exe（UpdateDatabase / GenerateDashboard /
      IntegrityOpener / UpdateAll）到 `Release/`；`--smoke` 断言动态对照
      `src/output/dashboard_manifest.json`（重取数后无需改断言）。
  - 验证基线（2026-10-09）：`node --check` + 生成 HTML 与原型 DATA/GRAPH 逐值等价 +
    自包含正则 + 浏览器自动化冒烟 + `packaging/build.py --smoke` 全过；真实 PTC 取数与
    同事机器验证由用户执行（手测清单见 Handoff/workflow.md §4）。

## 必读文档（改代码前）

| 任务 | 先读 |
|---|---|
| 改取数链路任何文件 | [Handoff/data-pipeline.md](Handoff/data-pipeline.md)（唯一权威：数据流/schema/遍历语义/扩展点） |
| 做 dashboard 渲染适配 / 改前端 | [Handoff/dashboard-content.md](Handoff/dashboard-content.md)（内容唯一权威）+ [design/homepage.html](design/homepage.html)（视觉/交互参照）+ [Handoff/workflow.md](Handoff/workflow.md)（命令/打包/验证） |
| 视觉语言与设计 token | [Reference/Relate_DESIGN.md](Reference/Relate_DESIGN.md)；组件级 CSS 摘录见 `Reference/` 其余文件 |
| 理解需求出处 | [Requirement/Change_Request.md](Requirement/Change_Request.md) |

其余 Handoff 文档（architecture / ui-components / data-contract / file-map / known-issues /
extension-points）描述旧 RA-OP 看板，顶部有横幅标注：模块划分与交互思路仍可参考，schema、
数据规模与口径一律以上表两个权威文档为准。

## 常用命令

```bash
python src/selftest_fetch.py             # 取数链路唯一回归手段（离线假数据，无 pytest / CI）
python src/fetcher.py                    # 真实取数——需要内网 + PTC 客户端 im，开发机不可跑，交给用户
python src/generate_dashboard.py --open  # 渲染 dashboard.html 并用默认浏览器打开
python src/generate_dashboard.py --serve # 渲染后启动 PTC opener 服务（127.0.0.1:8766，Ctrl+C 退出）
python .zcode/mockup_build.py            # 从真实 DB 重建 design/homepage.html 的注入数据（仅维护设计参照，可重复跑）
python packaging/build.py --smoke        # PyInstaller 打包 4 exe 到 Release/ + 冒烟自检（断言动态对照 manifest）
```

- 环境是 **Windows + Git Bash**，Python 3.13（anaconda）。跑脚本建议加 `PYTHONUTF8=1`：
  存量代码仍有中文日志/报错，GBK 或 cp1252 控制台下可能触发 `UnicodeEncodeError`（frozen exe 场景
  由 `exe_utils.make_streams_tolerant()` 兜底）；新代码的英文日志无此问题，CLI 输出一律 ASCII-only。
- 依赖刻意最小（`openpyxl` / `xlrd`），**不要引入新依赖**；前端零框架零构建（无 Node 构建、
  无测试框架），语法检查只有 `node --check`。
- 任何对 `fetcher / relationship_builder / *_writer / ecr_config / parser` 的改动，
  提交前必须 `python src/selftest_fetch.py` 通过；真实 PTC 验证只能由用户执行。

## 改代码的硬规则

1. **schema 全动态**：DB/Excel/JSON 的列全部由 `ECR_Config.xlsx` 的字段表推导
   （`data_utils.build_alias` / `build_column_names`）。禁止在 writer 里硬编码字段名或列清单。
2. **两套字段名常量别混用**：`config.FIELD_*` 是向 im 请求的原始名（`ALM_Work Items`），
   `config.ALIAS_*` 是 `normalize_columns` 后行 dict 的键（`Work Items`）。
   从导出行读关系字段**必须用 ALIAS_***，用错会静默取到空值。
3. **遍历语义是需求锁定的**（data-pipeline.md §6）：BFS 最多三级（`WORK_ITEM_MAX_LEVEL = 2`）、
   边只指向本层新发现节点（无环）、共享实体只导出一次但每条引用各成边、
   不存在的 ID 静默容错。改这些语义前先与用户确认。
4. **日期列规则**：列名以 `_date` 结尾才做 ISO 转换；`...Date Ref` 类字段存原始文本
   （review 两个 `Date Ref` 字段是 Excel 序列号，展示时按 epoch 1899-12-30 转换）。
   SQLite 中除 id/kind/level 外全是 TEXT（effort 等数值也是 TEXT，聚合时 CAST）。
5. **配置文件位置契约**：`ECR_Config.xlsx` 与脚本同目录（frozen 时与 exe 同目录），
   由 `config.ECR_CONFIG_PATH` 决定，别写死其他路径。
6. **打包路径**：`config.BASE_DIR` 与 `generate_dashboard.ROOT` 的 frozen 分支以 exe 目录为基准，
   改动路径常量时保持该逻辑（onefile 的 `__file__` 在临时解压目录）。
7. **dashboard 内容口径已锁定**（dashboard-content.md §10 决策 #1–33，防反复）：内容结构、
   交互语义、聚合口径不在实现会话里重新讨论；要改先与用户确认。易踩的硬点：
   - `ALM_Completed` 属 **CLOSED** 集（99/129 WI 是该状态；旧 aggregations.py 的 CLOSED 集没有它，
     适配时必须加入）；
   - 逾期一律**前端自算**（`planned_completion_date < generated_at` 且 OPEN），库内 overdue 列整列忽略；
   - Children / Totals 计数按**实体数**（共享 WI 只算一次），不用边数；
   - Planned Effort 展示口径：CR 型（ECR + 嵌套 CR 型 WI）显示 `rollup_planned_effort`，其余显示
     自身 `planned_effort`、空则回退 rollup；payload 里 `planned`（原值，卡片聚合用）与 `effort`
     （展示值）两个字段勿混用（参照 design/homepage.html 的 `display_effort()`）；
   - 表格空值一律**留白**，不用 "—"；真实 `0` 显示 `0`。
8. **单文件自包含硬约束**：dashboard.html 零外部请求——Inter 字体内嵌（assets/fonts.css）、
   手写 SVG、无 CDN；浅色主题、界面文案英文为主、数据值保持 PTC 原文。
9. **opener 契约**：页面 ID 链接 → fetch `http://127.0.0.1:8766/open?url=<integrity://...>`，
   由 OS ShellExecute 派发（绕过 Mimecast）；opener 离线时前端英文 modal 兜底。
   改端口/端点时 `dashboard_opener.py` 与前端调用两侧同步。

## 数据与仓库纪律

- `src/output/` 四件套（data.xlsx / dashboard.db / dashboard_manifest.json / dashboard_schema.json）
  是**运行产物且被 git 跟踪**：真实取数后随代码一起提交，或按用户指示处理；不要手工编辑它们。
- `design/homepage.html` 内嵌真实快照数据（`const DATA = …` 单行）：数据更新用
  `.zcode/mockup_build.py` 重建注入，手工编辑设计时别动该行。
- `packaging/dist/`、`Release/` 是构建产物；仓库**当前没有 .gitignore**，提交前留意别把
  构建产物或 `.pyc` 带进去（`src/__pycache__/` 是历史遗留的跟踪文件——不要新增提交 `.pyc`，
  有机会时建议加入 .gitignore，先问用户）。
- `Reference/` 是设计参考资料（设计语言、CSS 摘录、格局图 webp），勿删改。
- `.zcode/` 下的计划文件与 `mockup_build.py` 是 ZCode 会话产物，不要改动或提交讨论之外的内容。

## 验证标准

- 取数改动：`selftest_fetch.py` PASS（断言覆盖共享实体/三级递归/容错/日期/四件套一致性），
  再让用户跑一次真实 `fetcher.py` 确认。
- dashboard / 前端改动：`node --check src/dashboard_generator/assets/app.js` + 重新生成
  HTML + 浏览器验证（清单见 Handoff/workflow.md §4：不变项 + Home/Graph 手测）+
  `packaging/build.py --smoke`。改 data_loader 后建议补 payload 等价对比（生成
  `__PAYLOAD__` vs 设计稿 DATA/GRAPH 逐值，见 workflow.md §4 不变项 4）。真实取数与
  同事机器验证由用户执行。
