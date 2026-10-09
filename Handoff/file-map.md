# File Map

> **状态（2026-10-09 重写）**：按当前渲染链路（新 ECR 库 + 原型移植版前端）记录文件职责。
> 取数链路文件（fetcher / relationship_builder / *_writer / ecr_config / parser / selftest_fetch，
> 见 [data-pipeline.md](data-pipeline.md)）不在本文范围。旧 RA-OP 版本可在 git 历史中查。

## Python 端

### [src/generate_dashboard.py](../src/generate_dashboard.py) — 125 行

CLI 入口：`load_payload` → `compute_all_aggregations` → `write_html`，打印 counts / generated_at
/ 文件大小。

```bash
python src/generate_dashboard.py [--db PATH] [--out PATH] [--open] [--serve]
```

- `--db` 默认 `src/output/dashboard.db`（frozen：exe 目录 `output\`）
- `--out` 默认 `./dashboard.html`（frozen：exe 目录）
- `--open` 生成后用默认浏览器打开；`--serve` 渲染后启动 opener（阻塞至 Ctrl+C）
- frozen 双击 exe（零参数）自动等效 `--serve`；`ROOT` 以 exe 目录为基准（onefile 的 `__file__`
  在临时解压目录）
- 组装 payload 信封 `{data: {ecrs, builds, items}, graph, aggregations, meta}` 交给 `write_html`

### [src/dashboard_generator/data_loader.py](../src/dashboard_generator/data_loader.py) — 329 行

唯一读 DB 的地方。模块级常量：

| 常量 | 内容 |
|---|---|
| `CLOSED_STATES` | `{ALM_Closed, ALM_Realized, ALM_Rejected, ALM_Cancelled, ALM_Completed}`（决策 #14） |
| `CR_TYPE` | `"ALM_Change Request"`（effort 展示规则 #27 的分型依据） |
| `REQUIRED_COLUMNS` | 生成 payload 自身依赖的 20 列（校验用；全 schema 仍由 ECR_Config 动态决定） |
| `DROPPED_COLUMNS` | 两个 `overdue_*` 垃圾列，永不进 payload（§7 规则 2） |
| `RELATIONS` | `work_items / actions / work_item_for` |

主要函数：

| 函数 | 职责 |
|---|---|
| `num(v)` | TEXT 数值列 → float/None（effort、时长） |
| `display_effort(it)` | #27 展示规则：CR 型 → rollup；其余 → 自身 `planned_effort`，空回退 rollup |
| `_validate_columns` | items 表必需列校验，指向旧库/错库报明确英文错误 |
| `load_payload(db_path)` | 读三表 → `{meta, ecrs, builds, items, graph}`（见模块 docstring 的形状图） |
| `_wi_node` / `_ecr_entry` / `_build_entry` | 树构造：WI 递归子树 / ECR 条目（counts 实体口径）/ Build 抽屉条目 |
| `_ecr_subtree_wis` / `_dist_rows` | ECR 子树 WI 集合 / Team·Process Area 工时份额（#12、#41，含 members） |
| `_build_graph` | flat nodes（含 `effort`/`teamDist`/`paDist`/`level`）+ 三类 edges |
| `summarize(payload)` | CLI 打印与冒烟用的计数 |

**注意**：`overdue` 刻意不进 payload——前端按 `meta.generated_at` 自算（§7 规则 2）。

### [src/dashboard_generator/aggregations.py](../src/dashboard_generator/aggregations.py) — 104 行

五卡**无过滤基线**（前端按结果集重算，二者必须逐值相等——workflow.md §4 不变项 3）：

| 函数 | 输出 |
|---|---|
| `compute_counts(items)` | 实体去重 kind 计数（Totals 卡） |
| `compute_effort_totals(ecrs)` | ECR rollup planned/actual 总和（Effort 卡） |
| `compute_by_process_area(items)` | WI 自身 `planned_effort` 按 process_area，降序 Other 沉底 |
| `compute_by_team(items)` | 同口径，Top 5（`TOP_TEAMS`）+ 折叠 Other |
| `compute_all_aggregations(payload)` | 入口：以上全部 + `closed_states` / `open_states` |

### [src/dashboard_generator/html_template.py](../src/dashboard_generator/html_template.py) — 85 行

拼装单文件自包含 HTML：`fonts.css`（base64 Inter）→ `styles.css` → `template.html`（body）→
`window.__PAYLOAD__ = <json>` → `app.js`。`_dump_json` 做 compact 序列化 + `</` → `<\/`
转义（防 summary 里的 `</script>` 截断标签）。`render_html(payload) → str` /
`write_html(payload, path)`。标题 `ECR Workbench — Home`（常量 `TITLE`）。

## 前端资产（src/dashboard_generator/assets/）

### [template.html](../src/dashboard_generator/assets/template.html) — 172 行

body 标记（head 由 html_template 组装）。**所有 id 必须与 app.js 的 `$()` 一一对应**：

- 左侧 rail：`global-search`（⌘K 输入）+ Home 项（首个 `a.rail-item`，无 data-view）+
  Graph 项（`[data-view="graph"]`）+ `rail-print`
- Bento 五卡：`bento-scope`（范围提示）/ `card-totals` + `kpi-row` / `effort-kpis` /
  `timeline` / `pa-list` / `donut` + `team-legend`
- 表格卡：`seg`（状态分段）/ `t-filter` / `t-clear` / `t-export` / `t-cols-btn` /
  `t-cols-pop` / `t-tbl`（`t-thead`/`t-tbody`）/ `col-pop`（列筛选单例弹层）/
  `t-foot-count` / `t-sum-p` / `t-sum-a`
- Graph 视图：`g-viewport` > `g-canvas` + `g-links`（SVG）；浮动件 `g-seg` / `g-filter` /
  `g-expand` / `g-collapse` / `g-caption` / `g-zoom-in` / `g-zoom-out` / `g-zoom-reset`
- 全局：`search-panel`（⌘K 下拉）/ `drawer-scrim` / 抽屉 `drawer`（`drawer-handle` /
  `drawer-close` / `drawer-idrow` / `drawer-title` / `drawer-body` / **`drawer-open-ptc`**——
  opener 接线钩子）

### [styles.css](../src/dashboard_generator/assets/styles.css) — 745 行

`:root` 设计令牌（--accent `#3b82f6` 等）+ 全部样式，浅色单主题。段落顺序：shell/rail →
Bento 卡 → 表格卡 → 抽屉 → print → Graph 视图 → opener 离线 modal（`.opener-overlay` 等）
+ `#t-tbl .t-id{cursor:pointer}`。字体由 fonts.css 提供，本文件不含 @font-face。

### [app.js](../src/dashboard_generator/assets/app.js) — 2,489 行

顶层脚本（非模块），段落与行号（改前先 `grep -n "^/\* ----------"` 对准最新行号）：

| 段 | 行 | 职责 |
|---|---|---|
| payload | 1 | `PAY/DATA/GRAPH/ITEMS/META` 别名（`__PAYLOAD__` 注入）+ **overdue 前端自算 pass** |
| helpers | 29 | `$` / `fmt`（空值留白、真实 0 显 0）/ `monthFmt` / `escHTML` 等 |
| scoped aggregation | 38 | `collectScoped()`——五卡按过滤结果集重算（共享实体按 id 去重） |
| 五张卡 | 57–172 | Totals / Effort / Timeline / Process Area / Team donut 渲染 |
| table | 173–370 | `COLS`（19 列，`def`=默认可见）/ `cell.*` 渲染器（ID 单元格带 `data-id`）/ 表头排序 |
| row model | 261 | `normEcr/normWi/normAction`（行扁平化）+ `makeCmp`（嵌套排序 #30） |
| column filters | 371–837 | Excel 式列筛选（facet 语义、(Blanks) 沉底、树存活） |
| global search | 838 | ⌘K：`WI_INDEX/ACTION_INDEX/searchEntities/selectResult`（纯预览导航 #25） |
| detail drawer | 1107 | `DRAWER_INDEX`（含全父引用 #39）/ **`FIELD_LABELS` + `drawerSections` 全字段分组**
（#9；review Date Ref 按 1899-12-30 epoch 转 ISO；未知列落 More 组）/ 关系行就地导航 / 宽度拖拽 |
| export to Excel | 1454 | 零依赖 .xlsx（手写 ZIP/CRC32），范围随表格 |
| Graph view | 1672 | `Graph` 对象：主父挂靠布局（#35）/ 默认全折叠（#34）/ 进度环（#40）/
维度组卡（#41）/ pan-zoom / 节点抽屉入口 |
| view switching | 2379 | rail 往返 / print 回退 Home / boot `renderHead(); refresh()` |
| PTC opener | 2407 | `OPENER_ENDPOINT`(127.0.0.1:8766) / `INTEGRITY_HOST`（**硬编码**，换服务器要改码）/
`dispatchViaOpener`（1500ms 超时）/ 离线英文 modal / 表格 ID + 抽屉按钮接线（capture 拦截） |

### fonts.css — 13 行

内嵌 Inter variable（latin 子集，base64 woff2），单文件自包含的字体来源。

## 相关外围

| 文件 | 职责 |
|---|---|
| [src/dashboard_opener.py](../src/dashboard_opener.py) | opener 服务本体：`GET /health` / `GET /open?url=` → `cmd /c start`（ShellExecute），CORS 头 |
| [src/opener_only.py](../src/opener_only.py) | 独立 opener 入口（IntegrityOpener.exe） |
| [src/update_all.py](../src/update_all.py) | 一键链：`fetcher.main()` → 改写 argv 传 `--open` → `generate_dashboard.main()` |
| [packaging/build.py](../packaging/build.py) | 4 exe（UpdateDatabase / GenerateDashboard / IntegrityOpener / UpdateAll）→ `Release/`；`--smoke` 断言动态对照 `dashboard_manifest.json` + `src/selftest_fetch.py` |
| [packaging/使用说明.md](../packaging/使用说明.md) | 同事机器使用说明（随 exe 拷贝） |
| [design/homepage.html](../../design/homepage.html) | 设计原型（**参照，非生产模板**），数据由 `.zcode/mockup_build.py` 注入维护 |
| `.zcode/mockup_build.py` | 会话工具：读真实 DB → 重组 DATA/GRAPH → 注入设计稿单行（可重复跑） |

## 改动提醒

- 改 template.html 的 id 要同步 app.js 的 `$()`；改 app.js 后跑
  `node --check src/dashboard_generator/assets/app.js`
- 改 data_loader / aggregations 后：重新生成 HTML + payload 等价对比（workflow.md §4 不变项 4）
  + `packaging/build.py --smoke`
- 换 PTC 服务器地址：改 app.js 的 `INTEGRITY_HOST` 与使用说明.md 的 hostname 描述
