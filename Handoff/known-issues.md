# Known Issues

按修复优先级排序。

---

## 1. ~~app.js 内置 CLOSED_STATES 旧口径，与 aggregations 不一致~~（已修复，2026-09-27）

**状态**：✅ 已修复。app.js 的 `CLOSED_STATES` 改为 `let`，boot 时以 `agg.closed_states`（聚合端唯一口径）覆盖，默认值仅聚合缺失时兜底。DetailsTable / ProjectTree / DetailsDrawer / TopSearch 的 Open/Closed 判定随之统一。回归覆盖：`tests/mock_dom_test.js` 的 "CLOSED_STATES 修复" 断言。

---

## 2. html_template.py 残留死代码

**位置**：[src/dashboard_generator/html_template.py:38-69](../src/dashboard_generator/html_template.py#L38-L69)

`{{DATE_RANGE}}` 占位符已不再用 —— template.html 里日期 pill 被改成 `<select>` 后，这个字符串再也不会出现。

`_render_placeholders()` 和 `_patch_date_range()` 这两个函数现在都是 noop，但还在跑。

**修复**：删 `_patch_date_range` 调用 + 函数体，简化 `_render_placeholders`。

**优先级**：极低（清理性工作）。

---

## 3. Hero chart 的孤岛 state segment 不显示

**位置**：[src/dashboard_generator/assets/app.js](../src/dashboard_generator/assets/app.js) `ProjectStateChart.render`

钻取时（比如 Open 子状态：Initiated/Defined/Analysed/Checked/Started/Planned），如果某个 state 在所有项目里都计数为 0，segment 不会画。这没问题。

但如果一个项目的某 state 计数 = 0，那个项目柱子里**该 state 不会留下空白**（其他 state 紧贴堆叠）。这是 SVG stacking 的天然行为，**不是 bug**。

但视觉上可能在某段堆叠处有"突变"，特别是 Closed 子状态里某些项目 Closed=0 时。

**修复**：可加白色 hairline 分隔每段；本期未做。

**优先级**：低。

---

## 4. ~~date-range-select 的年份选项是动态生成~~（已废弃）

日期过滤已从年份 `<select>` 改为**日期区间双 input**（`#date-from` / `#date-to`），min/max 取自 `agg.ra_op_time` 实际范围（`Summary._initDateInputs`）。旧 select 相关的问题不再存在。潜在的小限制：日期 input 的 min/max 只覆盖有 RA-OP 时间的范围，想选范围外的日期需手输。

---

## 5. 未实现的功能（来自原 Plan 但本期跳过）

| 功能 | 计划位置 | 状态 |
|---|---|---|
| 分层树（dendrogram） | Plan/04 | **已实现**（Projects 页 `ProjectTree` 横向节点树，2026-09） |
| 原地展开下钻（drilldown 子看板） | Plan/05 | **不做**（Hero chart 已用 legend pill 钻取替代） |
| Child OP × Project × State 大堆叠柱状图作为独立模块 | Plan/06 | **合并进 Hero chart**，现作为其默认视图的子状态 |
| 深色模式 | Plan 03 §"Key decisions" | **不做**（用户明确"只浅色"） |
| README 章节（HTML dashboard 用法） | Plan/07 | **未做**（如果要给同事用，先补这个） |
| E2E 自检脚本（test_dashboard.py） | Plan/07 | **未做**（用 workflow.md 里的 inline 命令替代） |

---

## 6. 数据 / DB 限制

### ra_op 已有 created_date
`compute_ra_op_time` 优先取 created_date，缺失（旧库）时回退子树最早 target_date。当前 DB 全部 106 条都有时间（0 null）。若未来出现无日期的 RA-OP：日期过滤激活时被排除（`Summary._cascade` / `DetailsTable._filtered` / `ProjectTree._roots` 同一语义）。

### CR / build 有孤岛
约 180 CR + 99 build 不挂在任何 RA-OP 子树下，**永远不进 Summary**（不论选哪个时间窗）。如果用户希望这些孤岛被算进 "All time"，需要改 `Summary._cascade` 的初始 raIds 包含所有 RA-OP 不管时间。Projects 树同样只显示从 RA-OP 可达的节点（533/713 CR）。

### closed_rate 用旧 CLOSED_STATES 在 aggregations.compute_kpis
`kpis.closure_rate_percent` 还是用旧的 `{ALM_Closed, ALM_Realized, ALM_Checked, ALM_Approved}` 计算（Parent-OP 的关闭率）。`opened_closed_rates` 是用新口径。

实际差别：Parent-OP 新口径会多算 Rejected/Cancelled（旧的不算）。如果想统一：
- 改 `compute_kpis` 用新 CLOSED_STATES
- 或弃用 `closure_rate_percent`，统一用 `opened_closed_rates`

**当前不影响任何 UI**，因为没有 card 显示 Parent 关闭率（Target 卡只显示 child_op / change_request）。

---

## 7. Plan/ 文件与代码状态不同步

`Plan/00_overview.md` 顶部有指向 `08_redesign_jajanken_style.md` 的指针，但 Plan/01..07 仍描述了**未实现**的原始设计（树、drilldown、堆叠柱状图独立卡）。

接手会话如果读 Plan/01..07 会被误导。**优先读 `Handoff/README.md` + `architecture.md`**。

如果想让 Plan/ 跟实际代码同步，建议：
- 删 Plan/01..07（或标 [DEPRECATED]）
- Plan/00_overview.md 顶部指针改成 → `Handoff/README.md`

---

## 8. 浏览器兼容性未全测

只在 Chromium 系手测过（ZCode 内嵌浏览器 / Edge）。

未测：Firefox、Safari、移动端。

**实际用到的 modern features**（低于以下版本会缺功能/样式）：
- `:has()`（Hero chart hover 聚光）—— Chrome 105+ / Safari 15.4+ / Firefox 121+
- CSS `translate` 独立属性（Projects 树展开动效）—— Chrome 104+ / Safari 14.1+ / Firefox 72+
- `overflow: clip`（树视口防焦点滚动）—— Chrome 90+ / Safari 16+ / Firefox 81+
- `<input type="date">`、CSS Grid、`gap` —— 广泛支持

SVG 用 `viewBox`，无兼容问题。**优先级**：低（公司内网通常是 Chrome/Edge）。

---

## 9. Target 卡 CHILD CR closure 显示 "99%" 而非 "99.0%"（轻微）

**位置**：[src/dashboard_generator/assets/app.js](../src/dashboard_generator/assets/app.js) `Target.render`

```js
const num = Number(Number(pct).toFixed(1));
$(`#p-${id}`).textContent = `${num}%`;
```

`Number(...)` 把 `toFixed(1)` 的尾零丢了：99.0 → "99%"（64.4 不受影响）。workflow.md §4 的期望值写的是 99.0%。

**修复**：显示原始 toFixed 字符串即可：

```js
$(`#p-${id}`).textContent = `${Number(pct).toFixed(1)}%`;
```

**优先级**：极低（纯显示）。