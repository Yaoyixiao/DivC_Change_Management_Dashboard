# 首页屏前端设计计划（Home · 检索工作台）

## 交付物
- **`design/homepage.html`**：单文件自包含设计稿——内联 CSS + 内联示例数据 + 原生 JS 交互（展开/筛选/排序/列配置），无外部依赖无构建。
- 示例数据用 **2026-10-01 真实快照**（执行时只读查询 `dashboard.db` 提取聚合值），设计稿里看到的是真数字。
- **不改动** `dashboard_generator/` 与取数链路；抽屉与 Graph 视图属下一轮（本稿行点击=展开，不做抽屉）。
- 内容与口径沿用 `Handoff/dashboard-content.md`；**本次页头简化（仅搜索栏）为用户覆盖决策，执行时同步把该文档 §2 的"页头 meta"改为"仅搜索栏"**。
- 构建后用浏览器截图自审（布局/密度/对比度），迭代后交付。

## 参考的吸收方式
- **格局参考（webp，浅色紫罗兰）**：整页骨架——侧栏 + 白卡片网格 + 表格卡；但其页头标题区**不采纳**（用户简化决策）。
- **State Bento Grid CSS（深色 periwinkle）**：只借 bento 结构语言（大数值 + 大写小字标签 + 迷你渐变条图 + conic 圆环 + 卡片跨度），皮肤浅色化。
- **Table_CSS.txt（深色 periwinkle，同一设计家族）**：借表格结构与交互模式（可排序表头/徽标解剖/底栏合计/卡头搜索框），皮肤浅色化。
- **Timeline.txt（MUI/AntD 纵向时间线语义）**：改为**横向**时间线放入 Bento 卡（用户指定）：`<ol>` 时序 + Dot + Connector + `<time>` 标签 + 实心点/加载态点 + 线止于最后一点。
- txt 参考为深色系，**已确认整页浅色 + 唯一 accent `#145aff`（Relate 蓝）**。

## 设计令牌
- **色彩**：页面底 `#f5f7fc`；卡片 `#ffffff` + hairline `#e6eaf2`；Ink `#020520` / Body `#14141e` / Secondary `#374151` / Helper `#6b7280`；accent `#145aff`，focus ring `#0099ff`；状态双色 OPEN=琥珀 `#ffa64d`、CLOSED=绿 `#16ca2e`（徽标=前置 6px 圆点 + 12% 同色淡底 + 深化文字保证浅底对比）；图表渐变 `#145aff → #b9ccff` 双 stop（全页唯一渐变）。
- **字体**：仅 Inter（400/500/600，本地栈 fallback system-ui）；数值 `tabular-nums`、大数值 600/-0.02em；微标签 11px 大写 +0.06~0.08em（表头与卡 label 共用词汇）。
- **圆角双层**：卡 14–16px / 内元素 8–9px / 药丸 999px / 输入 9–12px。阴影极轻 + hairline。
- **密度**：卡内边距 18–20px、网格 gap 12px、表格行高 ~46px；页头上下留白加大（呼吸感）。

## 布局（页头极简：仅搜索栏）
```
┌────────┬──────────────────────────────────────────────────────────────┐
│ ◆ DivC │                                      [ 🔍 ⌘K Search… ]      │
│ ▐Home  │──────────────────────────────────────────────────────────────│
│  Graph │ ┌Active ECRs(4)┐ ┌Effort(3)─┐ ┌Creation Timeline(5)────────┐ │
│        │ │#106 ▐██ 12/15│ │Plnd 3,410│ │ ●──●──●──○──·∘∘ (横轴线)   │ │
│        │ │#107 ▐░░  0/9 │ │Actl 1,02X│ │ Jun'22… 实心/脉冲点交替标签 │ │
│        │ └──────────────┘ └──────────┘ └─────────────────────────────┘ │
│        │ ┌Effort by Process Area (span7)┐ ┌Effort by Team (span5)───┐ │
│        │ │ SYS.5 █████ 1,240            │ │ ◔ donut + legend        │ │
│        │ │ SWE ███ 830 …  Other ░ 96    │ │ AP-EPM 46% …            │ │
│        │ └──────────────────────────────┘ └─────────────────────────┘ │
│        │──────────────────────────────────────────────────────────────│
│        │ ECRs   [All|Open|Closed] [🔍 filter…] [Columns ⌄]            │
│        │ ▸|ID|Summary|Created|Children|Planned Effort|Actual Effort   │
│        │ ▾|#8555340|[NIO NPD] New ve…|2023-12-20|5 WI·3 A|410|100     │
│        │    └ WI 三级缩进树 + Actions 小节（Build 不出现）              │
│        │ 10 ECRs                           Σ Planned 3,410 · Σ Actual…│
└────────┴──────────────────────────────────────────────────────────────┘
```
- **页头 = 仅一个搜索药丸**（右对齐，~280px，内嵌放大镜 + ⌘K 提示），无页面标题、无副标题、无 generated_at/计数小字；侧栏底部同样不放 generated 小字。
- 侧栏 240px：品牌块 + Home（active=accent 填充圆角块白字）/ Graph 两项，无其他。
- Bento 带：12 列网格 gap 12px；行一 Active ECRs(4)/Effort(3)/Creation Timeline(5)，行二 Process Area(7)/Team(5)。
- 表格带：全宽表格卡（Table_CSS 骨架）。

## Bento 五卡（内容=content spec §3；形式=参考结构语言浅色化）
1. **Active ECRs**(span4)：label+count；每行 ID 链接 + 截断 Summary + OPEN 状态点 + 下级进度（WI 已关/总、Action 已关/总）+ 迷你双色进度条；空态 "No active ECRs"。
2. **Effort**(span3)：Planned 34px 大数值叠 Actual 次级数值 + actual/planned 占比条；脚注 "Rollup across 10 ECRs"。
3. **Creation Timeline**(span5，横向化 Timeline 参考)：横向 rail 按时序排列 10 个 ECR 的 `created_date`；**实心点**=已终结 ECR（Closed/Realized），**AntD loading 脉冲点**=仍开放 ECR（2 条）；连接线止于最后一个点不拖尾；标签 = `<time>`（如 "Jun 2022"）上下交替 + 10px muted ECR ID；悬停 title 显示 Summary。
4. **Effort by Process Area**(span7)：横向条降序 + 数值；缺失归 Other 灰色置底。
5. **Effort by Team**(span5)：conic 圆环 + 图例（点+team+值+%），Top5 + Other。

## 表格（Table_CSS.txt 骨架 + 浅色化）
- **卡头**：标题+计数 左；右侧 = All|Open|Closed 分段筛选 + 参考样式搜索框（9px 圆角边框 + 内嵌放大镜）+ Columns 下拉（可开列=content spec §4）。
- **表头**：11px/600 大写 +0.06em、可点击排序、`aria-sort` + accent 色 ↑/↓ 指示。
- **默认列**：展开箭头 | ID（muted tabular）| Summary（截断）| Created Date（muted）| Children 计数 chips "5 WI · 3 A" | Planned Effort 右对齐 600 tabular | Actual Effort 右对齐 600 tabular。
- **行**：~46px、hairline 分隔、末行无分隔、hover 浅洗；点击行切展开；展开区 = WI L0→L1→L2 缩进树（引导线）+ Actions 平铺小节，子行含 ID/Summary/状态点/effort。
- **徽标**（State 可开列启用时）：药丸 + 前置 6px 圆点 + 12% 同色淡底。
- **底栏**：左 = 过滤后计数；右 = **随筛选实时重算的 Σ Planned / Σ Actual**。
- 不采纳：头像圆片（无语义）、深色皮肤。

## 设计原则
1. **极简呼吸感**（本轮新增的最高原则）：页头无标题无元数据，信息密度留给卡片与表格本身；留白是页头唯一的装饰。
2. **数字先行、零假修饰**：库里没有环比数据，不造 delta；趋势表达只属于 Creation Timeline。
3. **颜色只表义**：蓝=品牌/链接/active/排序指示，琥珀/绿=OPEN/CLOSED，脉冲点=进行中；无装饰色块。
4. 大写微标签只存在于 11px 一档，标题绝不 all-caps（页头已无标题）。
5. **动效只回答操作与状态**：展开/收起 ~160ms；唯一常驻动效 = Timeline 脉冲点，尊重 `prefers-reduced-motion`。
6. **大胆花在一处**：Bento 带的大数值墙（tabular、紧排）是签名，表格保持安静。

## 反模板自审
无 cream+serif、无暗底酸绿、无报纸细线风；卡片非同质瓷砖（跨度 4/3/5、7/5，五卡解剖各异）；无中点 meta 串、无 em-dash 标签、数据不用等宽字体、链接不加 "→"；uppercase 微标签被参考 pin 住（11px 专属档），属跟随 brief；渐变仅图表一处双 stop。

## 明确不做（本轮）
详情抽屉、Graph 视图、深色模式、i18n、移动端精调（≥1280 桌面优先、窄屏单列降级即可）；不改 dashboard_generator/、不做数据管线集成；页头标题/元数据（后续迭代由用户决定是否加回）。

## 验证
浏览器打开设计稿截图自审：页头仅搜索栏且留白舒适、首屏完整无横向滚动、展开/筛选/排序/列开关可用、底栏合计随筛选变化、Timeline 横轴 10 点不重叠、对比度达标；你过目后再决定下一步。