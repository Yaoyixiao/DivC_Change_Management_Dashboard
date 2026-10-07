# UI Components

> **⚠️ 过时声明（2026-10-07）**：本文描述旧 RA-OP 看板的三个视图（Overview / Details / Projects）
> 与抽屉交互；新 dashboard 的内容与交互以 [dashboard-content.md](dashboard-content.md) 为唯一
> 权威、视觉以 [design/homepage.html](../design/homepage.html) 为准。本文的模块划分、键盘集、
> 空态等交互纪律仍可参考（`src/dashboard_generator/assets/` 现仍与之对应）。

页面是单文件 dashboard，**三个视图**（Overview / Details / Projects，由 `Pages` 模块切换）+ 详情抽屉 + 2 个外围（sidebar + topbar）。所有数字从 `aggregations.*` / `data.*` 取，0 硬编码。

## 视图切换（Pages 模块）

侧栏每个功能项带 `data-page`，点击后 `Pages.show(name)`：
- 切换 `.nav-item.active` 与 `aria-current`
- 显示对应 `.page-view#view-{name}`（其余加 `hidden`）
- 更新 `#page-title` 与 `document.title`

`Pages.TITLES = { overview: 'Overview', details: 'Details', projects: 'Projects' }`。

## 布局

```
Sidebar 240px │ Topbar 68px
              │ Page Head（h1 + 日期区间 pill，跨视图共享）
              │
              ├─ #view-overview（.grid 12 列）
              │   ┌──────────────────────┬─────────────┐
              │   │ Summary (span-8)     │ Target      │
              │   │ 4 KPI 2×2            │ (span-4)    │
              │   ├──────────────────────┴─────────────┤
              │   │ Child-OP × Project × State (span-12)│
              │   └────────────────────────────────────┘
              ├─ #view-details（全宽 .card.details-card）
              └─ #view-projects（全宽 .card.tree-card）
```

## Sidebar（240px 固定）

brand + 折叠按钮；6 个 nav item：Overview / Details / **Projects**（已接通，带 "New" 徽标）/ Timeline / Owners / States（后三个仍是 "Coming soon" 占位）；折叠的 Settings 组。

## Topbar（高 68px）

全局搜索框（`TopSearch` 模块，已接通）：

- 输入 `#top-search` → 下拉结果面板 `#search-panel`（分 RA-OP / Child OP / Child CR / Build / Delivery / Parent OP 六组，每组最多 5 条，ID 前缀命中排前）
- 覆盖全部 6 类实体；字段 = id + summary + project（CR 加 team/owners，Build 加 maturity）；大小写不敏感子串，**不受日期过滤影响**
- 键盘：`⌘K` / `Ctrl+K` 聚焦、↑↓ 选择、Enter 打开、Esc 关闭、点击外部关闭
- 命中文字 `<mark>` 高亮；无命中显示空状态
- 点击/回车结果 → 跳 Details 视图定位：ra/op/cr 直达自身行；build/delivery/parent_op 经 edges 反查最近关联行（build→CR、delivery→OP、parent_op→RA），自动展开祖先链 + 行闪烁 + toast 注明
- 定位遇到冲突过滤自动重置：Details 状态过滤复位 all；日期遮蔽目标时清空日期并 toast
- `toast#toast`：一次性轻提示（z-index 60，2.6s 自动消失）

Projects 视图在卡片内有自己的搜索框（见下）。

## Page Head（跨视图共享）

`h1#page-title`（随视图切换）+ 副标 `{{PAGE_META}}`（生成时间）+ 右侧日期区间 pill：

- `#date-from` / `#date-to`（`<input type="date">`，min/max 取自 `ra_op_time` 实际范围）
- 起点晚于终点自动交换（`readDateRange`）；`#date-clear` 清空
- 变化时 **Summary / DetailsTable / ProjectTree** 重渲染；Hero chart / Target 不级联

## Overview — Summary（span-8）

4 个 KPI，2x2 grid：

| 位置 | 标签 | 大数字（All time） | 副标 | trend pill |
|---|---|---|---|---|
| 左上 | **RA-OP** | 当前时间窗内 RA-OP 数（106） | "in selected range" | 有过滤时 `N / 106` |
| 右上 | **CHILD OP** | 级联到 RA-OP 的 child_op 数（657） | "linked to N RA-OPs" | `N / 657` |
| 左下 | **CHILD CR** | 级联到 child_op 的 change_request 数（533） | "under N child-OPs" | `N / 533` |
| 右下 | **BUILD** | 级联到 CR 的 build 数（271） | "under N CRs" | `N / 271` |

每个 metric：38px 渐变彩色图标块 + 11px uppercase label + 28px value + 11px sub。

**级联公式**（`Summary._cascade`，ISO 字符串比较）：
```
ra_ids    = { ra.id : ra_op_time[id] ∈ [from, to] }   (from/to 均空 = 全量；有过滤时无日期的排除)
child_ids = union(edges.ra_to_child[rid] for rid in ra_ids)
cr_ids    = union(edges.related_to_cr[cid] for cid in child_ids)
build_ids = union(edges.cr_to_build[crid] for crid in cr_ids)
```

## Overview — Target（span-4）

2 个关闭率：

| 标签 | 值 | 进度条 |
|---|---|---|
| **CHILD OP closure** | 64.4% | 浅蓝底 + 蓝色填充 |
| **CHILD CR closure** | 99%（口径 99.0%，尾零被 `Number(toFixed(1))` 丢掉，见 known-issues） | 同上 |

数据源：`aggregations.opened_closed_rates.{child_op, change_request}.closed_percent`

口径：已 dispositioned = Closed（含 Rejected/Cancelled）。

## Overview — Hero chart（span-12）

标题 "Child-OP × Project × State"。SVG 高 420，宽度随项目数增长（当前 **37 根柱**，全部项目各自成柱，容器横向滚动）。

- Level 1：每柱 2 段（Open 琥珀 #f59e0b + Closed 绿 #16a34a），legend 2 个可点 pill，柱顶 total 数，柱底项目名（自动旋转/截断）
- 钻取：点 Open / Closed pill → 该段分裂成子状态（STATE_COLORS），legend 出现 `← Open / Closed` back 按钮 + static pills
- Y 轴永远按 total 缩放，钻取不改变柱高

数据源：`aggregations.child_op_by_project_state` + `open_states` / `closed_states`

## Details 视图（#view-details）

全宽卡片 "RA-OPs"，RA-OP → Child OP → Child CR 三层可展开表：

| 列 | 内容 |
|---|---|
| ID | 展开箭头（有子级时）+ id |
| Summary | 截断 60 字符 |
| Project | RA 行 = 关联 parent OP 的 project；OP 行 = 自身；CR 行 = team（去掉 "(数字)" 前缀） |
| Child State | RA 行 = `open / total` 计数；OP/CR 行 = 状态徽章 |
| （动作） | `>` 按钮打开右侧抽屉 |

- 分页：PAGE_SIZE=15，`Show more` 递增；计数 pill "15 of 106 RA-OPs"
- 状态筛选 `#rt-status`（All / Open / Closed）：open = 有未闭环 child OP；closed = 有子级且全部闭环；只作用于 RA-OP 层，语义与 aggregations 的口径**有出入**（known-issues §1）
- `Expand all` / `Collapse all`：作用于当前已显示的行
- 空态：筛选后无行时显示提示

数据源：`data.ra_ops` + `edges.ra_to_child` + `edges.related_to_cr` + `data.child_ops` / `data.change_requests`（`DetailsTable._buildChildIndex` / `_buildCrIndex`）+ 日期过滤（`ra_op_time`）

## Projects 视图（#view-projects）

全宽卡片 "Project graph"，**横向三层节点树**（RA-OP 紫 → Child OP 青 → Child CR 绿，`node_colors`）：

- **画布**：`.tree-viewport`（660px 高、点阵底纹、`overflow: clip`）内 `.tree-canvas`（平移缩放）+ `.tree-links` SVG 肘形连线 + 绝对定位的 `.tnode` 卡片
- **卡片**：kind 标签（类型色）+ 日期（RA）/ 状态徽章（OP/CR）+ ID + 子级数量徽标（仅展开后显示）+ 一行截断摘要；右缘圆形按钮**收起时显示下一级数量**、悬停换 `+`、展开为 `−`
- **默认态**：106 个 RA-OP 根节点全部折叠
- **布局**：叶子纵向堆叠、父节点与第一个子级顶对齐（展开时父节点不动）
- **动效**：新节点自父级方向淡入 / 退场节点淡出 / 连线同步淡入淡出 / 画布高度过渡；`prefers-reduced-motion` 全禁用
- **筛选**：状态分段 `#pt-status`（语义同 Details）作用于根节点；页内搜索 `#pt-search`（ID/摘要）——命中节点整棵子树展开显示，未命中节点仅保留通向命中的路径，命中卡片蓝框；全局日期区间过滤根节点
- **交互**：点卡片正文 → 详情抽屉；点圆形按钮 → 展开/收起（keyed 复用，快速切换不产生重复元素）；Expand all / Collapse all
- **缩放平移**：拖拽平移、滚轮朝光标缩放（0.35x–2x）、右下 −/100%/+ 控件（点 100% 复位）；平移范围钳制
- **空态**：筛选后无节点时居中提示

## 详情抽屉（DetailsDrawer）

右侧 400px 滑出（遮罩 + Esc 可关，焦点圈闭）。三种实体由 `data-kind` 区分：

- **RA-OP**：ID + summary + Details（project/created/子级计数）+ Parent OP 列表 + Child OPs 列表
- **Child OP**：ID + 状态徽章 + summary + Details + 关联 RA-OP + Deliveries + Child CRs
- **Child CR**：ID + 状态徽章 + summary + Details（project/team/owners）+ 关联 Child OP + Builds（含 maturity 徽章）

打开入口：Details 表的 `.row-detail` 按钮、Projects 树的卡片正文。关闭后焦点归还触发元素。

## 颜色语义

```
STATE_COLORS（状态徽章 / Hero 钻取）          NODE_COLORS（Projects 树 / 备用）
  ALM_Closed:     #16a34a 绿                   ra_op:           #7c3aed 紫
  ALM_Realized:   #0891b2 青                   parent_op:       #2563eb 蓝
  ALM_Initiated:  #d97706 琥珀                 child_op:        #06b6d4 青
  ALM_Defined:    #64748b 灰                   delivery:        #f97316 橙
  ALM_Analysed:   #8b5cf6 紫                   change_request:  #22c55e 绿
  ALM_Started:    #2563eb 蓝                   build:           #ec4899 粉
  ALM_Checked:    #65a30d 橄榄
  ALM_Rejected:   #dc2626 红                 MATURITY_COLORS（抽屉 Build）
  ALM_Cancelled:  #991b1b 暗红                 CAT 2 绿 / CAT 3 黄绿 / CAT 4 琥珀
  ALM_Approved:   #0d9488 翠绿                 CAT 5 红 / Not Applicable 灰
  ALM_Planned:    #a16207 棕
```

不要乱改 —— 整套 dashboard 的颜色一致性靠它。

## 交互清单

| 元素 | 触发 | 效果 |
|---|---|---|
| `.nav-item[data-page]` | click | Pages.show 切换视图 + 标题 |
| `#top-search` | input / focus | TopSearch 下拉结果面板（6 组、高亮、空状态） |
| `#top-search` | ⌘K / Ctrl+K | 全局聚焦搜索框 |
| `#top-search` | ↑↓ / Enter / Esc | 面板键盘选择 / 跳 Details 定位 / 关闭 |
| `.search-row` | click | 跳 Details 视图定位（关联行反查 + 祖先展开 + 闪烁 + toast） |
| `#date-from` / `#date-to` / `#date-clear` | change / click | Summary + DetailsTable + ProjectTree 重渲染 |
| `#rt-status` / `#pt-status` 分段 | click | 对应视图状态筛选（仅本视图） |
| `.tx-expand` / `.tnode-toggle` | click | 三层表展开 / 树节点展开（带动效） |
| `.row-detail` / `.tnode-body` | click | 打开详情抽屉（对应实体） |
| `#pt-search` | input | 树按 ID/摘要过滤（命中全子树展开） |
| `#pt-zoom-*` / 拖拽 / 滚轮 | click / drag / wheel | 树画布缩放平移 |
| `.legend-pill[data-cat]` / `.legend-back` | click | Hero chart 钻取 / 返回 |
| `.bar-seg` | hover | native tooltip（项目 + state + count） |
