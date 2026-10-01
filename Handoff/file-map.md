# File Map

## Python 端

### [src/generate_dashboard.py](../src/generate_dashboard.py) — 77 行

CLI 入口。**每次执行的工作流第一步**。

```bash
python src/generate_dashboard.py [--db PATH] [--out PATH] [--open]
```

- `--db` 默认 `src/output/dashboard.db`
- `--out` 默认 `./dashboard.html`
- `--open` 生成后用系统默认浏览器打开

做的事：调 `load_payload` → `compute_all_aggregations` → `write_html`，打印 counts 与文件大小。

### [src/dashboard_generator/data_loader.py](../src/dashboard_generator/data_loader.py) — 99 行

唯一读 DB 的地方。返回：

```python
{
  "meta": {"schema_version", "generated_at", "root_query_definition"},
  "ra_ops":          [{id, summary, project, created_date}],
  "parent_ops":      [{id, state, summary, project}],
  "child_ops":       [{id, state, summary, project}],
  "deliveries":      [{id, summary, project, target_date}],
  "change_requests": [{id, state, summary, project, team, owners}],
  "builds":          [{id, summary, project, target_date,
                       planned_completion_date, maturity_level}],
  "edges": {
    "ra_to_parent":        [{ra_op_id, parent_op_id}],
    "ra_to_child":         [{ra_op_id, child_op_id}],
    "related_to_delivery": [{related_id, delivery_id}],
    "related_to_cr":       [{related_id, change_request_id}],
    "cr_to_build":         [{change_request_id, build_id}],
  },
}
```

注意 `related_id` 字段是 polymorphic —— 对 `related_to_delivery` 是 child_op_id，对 `related_to_cr` 大多数也是 child_op_id（用统计确认，详见 `compute_ra_op_time`）。

### [src/dashboard_generator/aggregations.py](../src/dashboard_generator/aggregations.py) — 353 行

13 个聚合函数 + 3 个颜色字典 + 入口 `compute_all_aggregations`。

| 类别 | 常量 / 函数 | 输出 |
|---|---|---|
| 颜色 | `STATE_COLORS` / `NODE_COLORS` / `MATURITY_COLORS` | dict |
| 分类 | `OPEN_STATES` / `CLOSED_STATES` | frozenset |
| KPI | `compute_kpis` | counts + closure_rate + closed + in_progress + avg_links |
| 分类计数 | `compute_opened_closed_rates` | child_op/change_request 的 total/open/closed/percent |
| 分布 | `compute_state_distributions` | parent/child/cr 三类的 state 分布 |
| 分布 | `compute_project_distributions` | 5 类按 project Top-N + Other |
| 成熟度 | `compute_build_maturity` | CAT 2-5 / Not Applicable 计数 |
| 时间线 | `compute_delivery_timeline` | deliveries 按 YYYY-MM 聚合 |
| 时间线 | `compute_build_target_timeline` | builds 按 YYYY-MM 聚合 |
| 排行 | `compute_owner_rank` | Top 20 owner |
| 排行 | `compute_team_rank` | team |
| 矩阵 | `compute_child_op_by_project_state` | 全部项目（37）× 6 state 矩阵，无 Other 归并、无 top_n |
| 时间 | `compute_ra_op_time` | ra_op_id → created_date 优先，缺失回退 min(target_date in subtree) |
| 入口 | `compute_all_aggregations` | dict 装上面所有 |

**改这里立刻影响前端**：所有数字 / 颜色 / 矩阵都从这里取。

### [src/dashboard_generator/html_template.py](../src/dashboard_generator/html_template.py) — 126 行

把 `template.html` + `styles.css` + `app.js` + `__PAYLOAD__` 拼成一个完整 HTML 文档。

```python
render_html(payload) → str   # 完整 HTML
write_html(payload, path)    # 渲染 + 写盘
```

占位符：
- `{{PAGE_META}}` ← `"Read-Across ALM data · generated YYYY-MM-DD HH:MM:SS"`
- `{{DATE_RANGE}}` ← **dead code**（详见 [known-issues.md §2](known-issues.md#2-html_templatepy-残留死代码)）

## 前端资产

### [src/dashboard_generator/assets/template.html](../src/dashboard_generator/assets/template.html) — 282 行

DOM 骨架。所有 id 必须与 `app.js` 里的 querySelector 一一对应。

**关键 id**：
- Topbar 全局搜索：`top-search` + 下拉结果面板 `search-panel`（`.search-panel`，TopSearch 渲染）
- 页头（跨视图共享）：`page-title` + 日期区间 `date-from` / `date-to` / `date-clear`（`.pill-range`）
- Summary 4 KPI：`m-ra-op` / `m-child-op` / `m-child-cr` / `m-build` + 4 trend pill（`t-ra-op` 等）+ 3 副标（`m-child-sub` / `m-cr-sub` / `m-build-sub`）
- Target 2 关闭率：`p-child` / `p-cr` + 对应 `pf-*` 进度条
- Hero chart：`lg-legend-host` / `lg-chart-host`
- Details 视图（`#view-details`）：`rt-h` / `rt-count` / `rt-expand-all` / `rt-collapse-all` / `rt-status` / `recent-tx-host` / `rt-empty` / `rt-more-wrap`（行带 `data-ra-id` / `data-op-id` / `data-cr-id`，供搜索定位）
- Projects 视图（`#view-projects`）：`pt-h` / `pt-count` / `pt-search` / `pt-expand-all` / `pt-collapse-all` / `pt-status` / `pt-viewport` / `pt-canvas` / `pt-links` / `pt-zoom-in` / `pt-zoom-out` / `pt-zoom-reset` / `pt-empty`
- 详情抽屉：`drawer` / `drawer-scrim` / `drawer-kind` / `drawer-close` / `drawer-body`
- 轻提示：`toast`（TopSearch 定位反馈）

**改这里要小心**：改了 id 要同步改 `app.js` 里的 `$('#xxx')`。

### [src/dashboard_generator/assets/styles.css](../src/dashboard_generator/assets/styles.css) — 1351 行

设计令牌 + 全部样式。**浅色单主题，0 dark 关键字**。

结构：
1. `:root` 设计令牌（surface / text / brand / shape / spacing / type）
2. Reset
3. App shell (`.app` grid)
4. Sidebar（240px，brand + nav + nav-group）
5. Main column + Topbar
6. Content + page-head + pills（含 `.pill-range` 日期区间）
7. Grid + cards
8. Summary card（`.summary-grid` 2x2 + `.metric` + trend）
9. Target card（`.progress-row` + `.progress-fill`）
10. Hero chart（`.lg-card` + `.lg-legend` + `.legend-pill*` + `.legend-back` + `.bar-seg`）
11. Page views（`.page-view[hidden]`）
12. Details card（`.details-head` + `.seg` + `.tx-table` 三层行 + `.row-detail` + `.row-flash` 定位闪烁）
13. 顶部搜索下拉（`.search-panel` + `.search-group-head` + `.search-row` + `mark`）
14. 详情抽屉（`.drawer` + `.drawer-scrim` + `.drawer-*`）
15. Projects 树卡片（`.tree-card` + `.tree-viewport` 点阵画布 + `.tnode` 卡片 + `.tree-links` SVG 连线 + `.tree-zoom` + `.tnode-enter/-leave` 动效）
16. Toast（`.toast`）
17. 空态 / `.status-badge` / Responsive guard（1100px 断点）

### [src/dashboard_generator/assets/app.js](../src/dashboard_generator/assets/app.js) — IIFE 包裹，8 个模块挂在 `window`

```js
const AGG  = () => window.__PAYLOAD__.aggregations;
const DATA = () => window.__PAYLOAD__.data;
```

| 模块 | 职责 | 关键方法 |
|---|---|---|
| `Summary` | 4 KPI 级联 RA-OP 日期过滤 | `_cascade()` / `_initDateInputs()` / `_renderTrend()` / `render()` |
| `Target` | 2 关闭率（child_op / change_request） | `render()` |
| `ProjectStateChart` | Hero chart 2 级钻取（手写 SVG） | `render()`（状态由 `_view` 决定） |
| `DetailsTable` | Details 页 RA-OP 三层展开表（分页 15/页 + 状态筛选） | `init()` / `_buildChildIndex()` / `_buildCrIndex()` / `_filtered()` / `render()` / `locate()`（搜索定位入口） |
| `DetailsDrawer` | 右侧详情抽屉（ra / op / cr 三种实体） | `init()` / `_ensureRelations()` / `open()` / `close()` / `_raHtml()` / `_opHtml()` / `_crHtml()` |
| `ProjectTree` | Projects 页横向三层节点树（筛选/搜索/布局/动效/平移缩放） | `init()` / `_index()` / `_roots()` / `_layout()` / `render()` / `_bindPanZoom()` / `_revealCard()` |
| `TopSearch` | Topbar 全局搜索（6 类实体下拉面板 + 键盘导航 + Details 定位） | `init()` / `_search()` / `render()` / `_go()` / `_buildChain()`（edges 反查） / `_locateTarget()` / `toast()` |
| `Pages` | 侧边栏路由（`.page-view` 切换 + 标题更新） | `TITLES` / `init()` / `show()` |

模块顶部定义了 3 个常量集（`CLOSED_STATES` / `ACTIVE_STATES` / `FAILED_STATES`）。**`CLOSED_STATES` 在 boot 时以 `agg.closed_states` 覆盖**（known-issues §1 已修复），默认值仅在聚合缺失时兜底。

`DOMContentLoaded` 时依次调 `Summary/Target/ProjectStateChart/DetailsTable/DetailsDrawer/ProjectTree/TopSearch` 的 init+render、`Pages.init()`，并在 `#date-from` / `#date-to` / `#date-clear` 上挂监听（`refreshAll()` 重渲染 Summary + DetailsTable + ProjectTree；`clearDateFilter()` 供定位时清空日期共用）。

## 杂项

- `tests/mock_dom_test.js`：Node 模拟 DOM 单测（workflow.md §3），`node tests/mock_dom_test.js` 运行，覆盖 render 模块回归 + TopSearch 全部交互路径
- `.gitignore`：包含 `dashboard.html`、`__pycache__/`、`*.pyc`、输出 tmp、编辑器临时文件。注意 `dashboard.html` 虽在 .gitignore 里但**已被 git 跟踪**（ignore 对已跟踪文件无效），每次重新生成后应随代码一起提交
- `Plan/`：早期规划文档，**部分已 superseded**（00_overview.md 顶部有提示）
- `Reference/`：设计参考图（Jajanken Ltd.）