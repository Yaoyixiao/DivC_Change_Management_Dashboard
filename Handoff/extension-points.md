# Extension Points

> **⚠️ 过时声明（2026-10-07）**：本文的扩展手法基于旧 RA-OP 看板模块。新 dashboard 的实现
> 起点与扩展备忘见 [dashboard-content.md](dashboard-content.md) §9；适配落地前本文仅作思路参考。

按"加新功能" 的工作量从小到大排序。

---

## 1. 调一个 KPI 数字 / 改一个文案

直接改 [template.html](../src/dashboard_generator/assets/template.html) 或 [app.js](../src/dashboard_generator/assets/app.js) 对应模块，重新 `python src/generate_dashboard.py`。

例：把 Summary 左上 "RA-OP" 改成 "Read-Across"
- 改 [template.html:55](../src/dashboard_generator/assets/template.html#L55) `<div class="metric-label">RA-OP</div>` → `Read-Across`

---

## 2. 加新 KPI 到 Summary

举例：加 "OWNERS" 总数。

1. **template.html**：在 summary-grid 里加第 5 个 `.metric` 块（注意 2x2 grid 满了，需要改成 3x2 或留一行）

2. **app.js — Summary.render()**：加一行
   ```js
   $('#m-owner').textContent = fmt.int(data.owners.length || uniqueOwners(data.change_requests));
   ```

3. **可选 — aggregations.py**：如果有复杂聚合逻辑（如 unique owner 计数）

不需要改 html_template 或 generate_dashboard.py。

---

## 3. 改关闭率口径

**位置**：[src/dashboard_generator/aggregations.py:46-55](../src/dashboard_generator/aggregations.py#L46-L55)

```python
OPEN_STATES: frozenset[str] = frozenset({
    "ALM_Initiated", "ALM_Defined", "ALM_Analysed", "ALM_Checked",
    "ALM_Started",   "ALM_Planned",
})
CLOSED_STATES: frozenset[str] = frozenset({
    "ALM_Closed",   "ALM_Realized", "ALM_Approved",
    "ALM_Rejected", "ALM_Cancelled",
})
```

改这两行的成员。`compute_opened_closed_rates` 自动用新口径。

如果还要让 Target 卡显示 **CHILD OP success rate**（仅 ALM_Closed + ALM_Realized）：
1. 加新聚合 `compute_success_rates(payload)` 返回类似 `opened_closed_rates` 的 dict
2. 在 `compute_all_aggregations` 里加 key
3. template.html 加 `pf-success` 元素
4. app.js `Target.render` 加一行

---

## 4. 让其他卡片级联日期过滤

**位置**：[app.js — 顶层 `refreshAll()`](../src/dashboard_generator/assets/app.js)

**现状**：日期区间变化时 **Summary / DetailsTable / ProjectTree** 已经级联重渲染（`refreshAll`）；**Hero chart 与 Target 仍展示全量数据**。

让 Target / Hero chart 也响应：

1. Target.render / ProjectStateChart.render 接受 range 参数（或内部调 `readDateRange()` + cascade）
2. 在 `refreshAll()` 里追加对应的 render 调用（照抄 DetailsTable 的 try/catch 写法）

UX 决定：Hero chart 级联会丢失"全表 portfolio 视角"。建议**保留全量**或加个 toggle（参考 extension-points §6 的 drawer 思路）。

参考实现（Projects 树的级联写法）：`ProjectTree.render()` 内部每次调 `readDateRange()` + `_roots()` 过滤根节点，无需外部传参。

---

## 4b. 复用 TopSearch / DetailsTable.locate（搜索与定位）

**位置**：[app.js — `TopSearch` 模块与 `DetailsTable.locate()`](../src/dashboard_generator/assets/app.js)

- **加新的可搜索字段**：在 `TopSearch.GROUP_DEFS` 对应分组的 `text(it)` 里加字段名即可（id 恒参与匹配）。
- **加新实体类型**：`GROUP_DEFS` 加分组（key/label/kind/colorKey/text，色值取 `aggregations.NODE_COLORS`），再在 `TopSearch._locateTarget()` 加该 kind → Details 可显示行的反查链；若新实体也要在 Details 表有行，给 `DetailsTable.render()` 加行模板 + `data-*-id` 属性 + `locate()` 分支。
- **跳转到自定义视图**：`TopSearch._go()` 目前固定 `Pages.show('details')` + `DetailsTable.locate(...)`；想改成抽屉/其他视图，只动 `_go()`。
- **`DetailsTable.locate(agg, data, kind, id)`** 是公开定位入口（kind ∈ ra/op/cr）：自动复位状态过滤、日期遮蔽时清空日期并触发全站联动、保证目标在分页内且祖先链展开，返回 `{found, raId, opId, clearedDate}`。任何需要"从别处直达某行"的功能（如通知跳转）都可直接复用。

---

## 5. 加新聚合函数

**位置**：[src/dashboard_generator/aggregations.py](../src/dashboard_generator/aggregations.py)

例：加 `compute_cr_by_owner_state`：

1. 写新函数
2. 在 `compute_all_aggregations` 加 key
3. 前端 `app.js` 加新模块消费
4. template.html 加 `<section class="card">`

聚合函数约定：
- 输入 `payload: dict`（来自 `load_payload()`）
- 输出 JSON-safe（只含 list / dict / str / int / float / None）
- 纯函数，不修改 payload

---

## 6. Hero chart 加第 3 级钻取

**位置**：[app.js — ProjectStateChart](../src/dashboard_generator/assets/app.js)

当前 `_view ∈ {top, open, closed}`。加第 3 级（比如点具体 state 显示该 state 在各项目的分布）：

1. `_view` 加新值 `'state:ALM_xxx'`
2. `render()` 加新分支：根据具体 state 在每根柱里只画该 state 的 segment（甚至画成单独细柱）
3. legend 区显示该 state 名 + count + back 按钮链

UX 决定：
- 第 3 级是**替换 view**还是**侧边详情面板**？
- 当前 drill-down 是"替换 view"，第 3 级如果也"替换"，会让用户迷失（连续 3 次 click 不知道回到哪）
- 建议第 3 级用 **popover / drawer** 不破坏 chart

本期未做，因为业务上"看到具体 state 分布"已是 Hero chart Level 2 的功能（每个项目柱子里能看到具体 state 占比）。

---

## 7. 加新卡片

**位置**：[template.html](../src/dashboard_generator/assets/template.html) + [app.js](../src/dashboard_generator/assets/app.js) + [styles.css](../src/dashboard_generator/assets/styles.css)

步骤：
1. template.html 在目标视图的 `.grid` 里加新 `<section class="card span-N">`
2. template.html 给宿主元素 `id="new-card-host"`（或其他合理 id）
3. app.js 写新 render 模块，DOMContentLoaded 调
4. styles.css 加新样式（如需要）

**span 选择**：grid 是 12 列。Overview 当前布局：
- span-8 + span-4 = row 1（Summary + Target）
- span-12 = row 2（Hero chart）

Details / Projects 是**独立的全宽 `.page-view`**（不在 grid 里）。加新卡可以：
- 插到 Overview 现有 row 之间
- 开新 row（span-12 全宽）
- 或照 Projects 的做法开一个新 `.page-view`（见 §8）

---

## 8. 加新导航页

**位置**：[template.html](../src/dashboard_generator/assets/template.html) `.sidebar-nav` + `#page-title` 附近 + [app.js](../src/dashboard_generator/assets/app.js) `Pages`

路由已经存在（`Pages` 模块），加新页三步：

1. template.html 侧栏加导航项（带 `data-page="newpage"`）+ 内容区加 `<div class="page-view" id="view-newpage" hidden>`
2. app.js `Pages.TITLES` 加 `newpage: 'New Page'`
3. app.js 写新 render 模块，在 DOMContentLoaded 挂载；要响应日期过滤就在 `onDateChange` 里追加调用

参考实现：Projects 页（`view-projects` + `ProjectTree`）。未接功能的占位项保持 `title="Coming soon"` 且**不带** `data-page`。

---

## 9. 改主题色

**位置**：[styles.css](../src/dashboard_generator/assets/styles.css) `:root`

主要令牌：
```
--accent:           #2563eb  →  改这里全套主色变
--accent-soft:      #eaf1ff  →  跟随
--green:            #16a34a  →  Closed 颜色
--green-soft:       #dcfce7  →  Closed pill 背景
--red:              #dc2626  →  Rejected 颜色
```

metric 图标的渐变色是 hardcoded（`.metric-icon.ra { background: linear-gradient(135deg, #7c3aed, #a855f7); }` 等），改这些要单独改。

Hero chart 默认颜色也是 hardcoded（Open #f59e0b / Closed #16a34a），见 [app.js](../src/dashboard_generator/assets/app.js) `ProjectStateChart.render()` 的 `segsDef`。

---

## 10. 输出其他格式（CSV / JSON）

本期只输出 HTML。如果要导出现在视图的 CSV：

1. 加 `assets/csv_export.js` 模块（前端 JS）
2. template.html 加导出按钮
3. 模块读 `window.__PAYLOAD__` 当前 filter / drill state，生成 CSV 字符串，触发 `download`

不需要 Python 端改动。

---

## 11. 加打包（exe）

`Plan/07` 提到但**未做**：

```bash
pyinstaller --onefile --name ReadAcrossDashboard src/generate_dashboard.py
```

会生成 `dist/ReadAcrossDashboard.exe`，双击生成 HTML 不需要 Python 环境。

PyInstaller 兼容性可能需要调整 `src/__init__.py`（当前 import 了 cli_client 会失败）。建议打包前清掉 src/__init__.py 的副作用，或加 hook。