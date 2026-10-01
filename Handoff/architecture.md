# Architecture

## 数据流

```
┌──────────────────────────┐
│ src/output/dashboard.db  │   sqlite, 6 表 + 5 类边（不可写）
│ (PTC Integrity 导出)     │
└────────────┬─────────────┘
             │ load_payload()
             ▼
┌──────────────────────────┐
│ data_loader.py           │   → 内存 dict，纯 JSON-safe
│                          │
└────────────┬─────────────┘
             │ {"ra_ops": [...], "edges": {...}, "meta": {...}}
             ▼
┌──────────────────────────┐
│ aggregations.py          │   → 13 个聚合函数，注入到 __PAYLOAD__.aggregations
│                          │   kpis / state_distributions / project_distributions /
│                          │   build_maturity / delivery_timeline /
│                          │   build_target_timeline / owner_rank / team_rank /
│                          │   child_op_by_project_state / ra_op_time /
│                          │   opened_closed_rates / state_colors /
│                          │   node_colors / maturity_colors /
│                          │   open_states / closed_states
└────────────┬─────────────┘
             │ {"data": ..., "aggregations": ..., "meta": ...}
             ▼
┌──────────────────────────┐
│ html_template.py         │   → 拼装 dashboard.html
│                          │
│  读 template.html        │
│  读 styles.css → <style> │
│  读 app.js      → <script> │
│  注入 __PAYLOAD__ → <script> │
│  替换 {{PAGE_META}} 等占位符 │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ dashboard.html           │   离线可用，零外部依赖
│                          │
│  ┌────────────────────┐  │
│  │ <style>...</style> │  │
│  │ <body>             │  │
│  │   sidebar / topbar │  │
│  │   page-head (date) │  │
│  │   view-overview    │  │
│  │   view-details     │  │
│  │   view-projects    │  │
│  │   drawer           │  │
│  │ </body>            │  │
│  │ <script>__PAYLOAD__</script> │
│  │ <script>app.js</script> │
│  └────────────────────┘  │
└──────────────────────────┘
```

## 模块依赖

```
generate_dashboard.py  (CLI)
  └→ data_loader.load_payload
  └→ aggregations.compute_all_aggregations
  └→ html_template.write_html
        └→ 读 template.html / styles.css / app.js
        └→ 渲染字符串

app.js (浏览器侧)
  └→ window.__PAYLOAD__.aggregations   (从 <script> 注入)
  └→ window.__PAYLOAD__.data
  └→ 模块：
       Pages              ← 侧边栏路由（.page-view 切换）
       Summary            ← 4 KPI 级联 RA-OP 日期
       Target             ← 2 关闭率
       ProjectStateChart  ← 2 级钻取柱图
       DetailsTable       ← Details 页三层展开表（RA-OP → Child OP → Child CR）
       DetailsDrawer      ← 右侧详情抽屉（ra / op / cr）
       ProjectTree        ← Projects 页横向节点树（筛选/搜索/缩放/动效）
```

## 关键设计决策

### 1. 单文件自包含
**Why**: 用户可能要把 HTML 发给同事 / 归档 / 双击打开。任何 `<link>` 或 `<script src=...>` 都会破坏离线可用性。
**How**: CSS / JS / `__PAYLOAD__` 全部内联到 `dashboard.html`。
**校验**: 自检脚本扫 `src="http` / `href="http` 必须为 0。

### 2. 零前端依赖
**Why**: 减少 npm 维护成本、加快生成速度、避免版本冲突。
**How**: 不用任何库。SVG 手写（~120 行）、事件用原生 DOM API、日期/数字格式化自己写（见 app.js `fmt` 对象）。
**约束**: 图表用手写 SVG 不上 D3/Chart.js；若以后图表复杂度爆炸再考虑加库。

### 3. 浅色主题硬编码
**Why**: 用户明确"只浅色"。原 plan 提到的 dark 模式不再做。
**How**: styles.css `:root` 直接给浅色 token，没有任何 `[data-theme="dark"]` 分支。
**校验**: `grep -i 'dark\|prefers-color-scheme' src/dashboard_generator/` 必须为 0。

### 4. RA-OP 时间：created_date 优先，子树代理回退
**Why**: 早期 DB 没有 `created_date`，但 Summary/Details/Projects 树都要按时间过滤 RA-OP。
**How**: `aggregations.compute_ra_op_time()` **优先取 ra_op.created_date**（当前 DB 已有该列），缺失（旧库）时对每个 ra_op 遍历 5 层子树（child_op → delivery / change_request → build）收集所有 `target_date`，取最小值作为"effective start"。
**限制**: 当前 106/106 全有时间（0 个 null）；旧库场景下无任何日期的 RA-OP 会被 `null` 化，日期过滤激活时不包含。

### 5. 4 KPI 级联 vs 单 RA-OP 数
**Why**: "对应CHILD OP/CHILD CR/BUILD"语义要清晰——选了时间窗，这 4 个数都得跟着变。
**How**: `Summary._cascade()` 三跳链路：ra_op → child_op → change_request → build。链路在 app.js 里用 `Map<id, id[]>` 建索引，O(n) 一次扫。
**级联范围**: 日期变化时 Summary / DetailsTable / ProjectTree 重渲染（DOMContentLoaded 的 `onDateChange`）；**Hero chart 与 Target 不级联**（保留全量视角，见 [extension-points.md §4](extension-points.md#4-让其他卡片级联日期过滤)）。

### 6. Hero chart 两级钻取
**Why**: 6 个 state 全堆一根柱看不清，"先看 Open/Closed 比例 → 再看 Open 里哪个 state 多"是用户的实际心智路径。
**How**: `ProjectStateChart._view ∈ {top, open, closed}`：
- `top`：2 段（Open #f59e0b 琥珀 + Closed #16a34a 绿）
- `open`：Open 段的子状态（Initiated/Defined/Analysed/Checked/Started/Planned），用 `state_colors`
- `closed`：Closed 段的子状态（Closed/Realized/Approved/Rejected/Cancelled）
- Y 轴永远按 total 缩放，柱高不抖动

### 7. UI 风格不堆模板感
- ❌ 不用 ALL CAPS eyebrow（`RA-OP` 已是天然大写）
- ❌ 不用 `→` 按钮后缀
- ❌ 不用 SaaS 彩虹配色
- ✅ KPI 数字大、label 小、副文灰色 —— 信息层级明确
- ✅ 唯一的色彩语义：STATE_COLORS 本身就是 ALM 业务术语的颜色（绿=Closed、红=Rejected、青=Started）

### 8. Projects 节点树的实现取舍
**Why**: Details 的表格展开是"读清单"，但看结构关系需要图。
**How**:
- 横向三层（RA-OP → Child OP → Child CR），卡片绝对定位 + 底层 SVG 肘形连线，不用任何图库
- 紧凑树布局：叶子纵向堆叠、**父节点与第一个子级顶对齐**（展开时父节点不动，子级向下推开）
- keyed DOM 复用（卡片与连线两张 Map）：展开/收起时存留节点位移过渡、新节点淡入、退场节点淡出后移除，快速切换不产生重复元素
- 搜索语义：**命中节点整棵子树强制展开**（上下游链路不裁剪），未命中节点仅保留通向命中的路径
- 收起态的展开按钮直接显示下一级数量（悬停换 +，展开换 −），卡片内数量徽标仅展开后显示，避免重复
- 视口 `overflow: clip`（不是 hidden）——hidden 容器仍可被焦点滚动，会与平移坐标系打架
- 详情复用 `DetailsDrawer`，`prefers-reduced-motion` 下全部动效禁用

## 文件总览

```
src/
├── output/                       既有（只读）
│   └── dashboard.db              唯一数据源
├── config.py                     既有，路径常量
├── generate_dashboard.py         CLI 入口
└── dashboard_generator/
    ├── __init__.py
    ├── data_loader.py            load_payload()
    ├── aggregations.py           compute_all_aggregations()
    ├── html_template.py          render_html() / write_html()
    └── assets/
        ├── template.html         DOM 骨架（含 sidebar/topbar/5 cards）
        ├── styles.css            设计令牌 + 全部样式
        └── app.js                5 render 模块

dashboard.html                    生成产物（git ignore）
Plan/                             设计笔记，部分已 superseded
Handoff/                          本文件夹
```

## 数据契约

详见 [data-contract.md](data-contract.md)。

## 怎么改一行就能看到效果

| 想改什么 | 改哪里 | 触发 |
|---|---|---|
| 颜色 | `assets/styles.css` `:root` 变量 | `python src/generate_dashboard.py` |
| 布局（卡片顺序 / 跨度） | `assets/template.html` `.card.span-N` | 同上 |
| KPI 数字 | `assets/app.js` `Summary.render` | 同上 |
| 钻取逻辑 | `assets/app.js` `ProjectStateChart.render` | 同上 |
| 关闭率口径 | `aggregations.py` `OPEN_STATES` / `CLOSED_STATES` + `compute_opened_closed_rates` | 同上 |
| 新加聚合 | `aggregations.py` 新函数 + `compute_all_aggregations` 加 key | 同上 |
| 新加卡片 | `template.html` 加 `<section class="card">` + `app.js` 加 render 模块 + DOMContentLoaded 调一下 | 同上 |

## 不在架构里

- 没有 build step / watcher / HMR
- 没有测试框架（用 Node 一把梭做单元测试，详见 [workflow.md](workflow.md)）
- 没有 CI / lint / format
- 没有版本化（数据每次全量重生成）