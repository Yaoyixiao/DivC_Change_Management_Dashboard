# Dashboard 内容结构骨架（phase 2 内容 spec）

> **本文档是什么**：2026-10-03 经逐项访谈确认的 **dashboard 内容架构**（信息架构 / 卡片 / 表格 / 抽屉 / 搜索 / 图谱 / 聚合口径）。
> 它是后续 UI 设计会话的**唯一内容依据**：内容清单与口径已锁定，UI 会话只做视觉与布局，不再重新讨论"放什么"。
>
> **状态（2026-10-07 更新）**：phase 2 渲染链路**尚未开始适配**——`src/dashboard_generator/`
> （data_loader / aggregations / template / app.js）仍是旧 RA-OP 版本，对新库必报错，属预期。
> 已交付：本文档（内容锁定）、首页视觉设计稿 [design/homepage.html](../design/homepage.html)
> （由 `.zcode/mockup_build.py` 注入真实快照）、PTC opener 服务（`src/dashboard_opener.py`）与
> 4 exe 打包（`packaging/build.py`）。**进行中**：Graph 视图原型——`graph-view` 分支上已实现
> （2026-10-07 grill 定稿 #34–38；默认全折叠 / 主父挂靠多父 / 表格徽章色板 / 节点点击仅高亮；
> 实测 168 节点 / 164 边 = 158 实线 + 6 虚线跨列边，手测清单见 workflow.md §4.1）。
> 取数侧事实以 [data-pipeline.md](data-pipeline.md) 为唯一
> 权威；旧 dashboard 的模块/交互参考 [ui-components.md](ui-components.md)（schema 部分已过时）。

---

## 1. 数据事实摘要（2026-10-01 真实取数快照）

> 以下数字随每次重新取数变化，**设计不得依赖具体数字**，只依赖结构。

### 1.1 规模与层级

| kind | 数量 | 说明 |
|---|---|---|
| `ecr` | 10 | 树根；状态：7 Closed / 1 Realized / 1 Started / 1 Analysed → **活跃 2 条** |
| `work_item` | 129 | 三级：L0=99、L1=18、L2=12（`level` = 距 ECR 的 hop 数） |
| `action` | 24 | 全部直接挂 ECR（`actions` 边） |
| `build` | 5 | 经 `work_item_for` 边挂 ECR，共 8 条边 → **部分 Build 被多个 ECR 共享** |

- `edges` 共 164 条：`work_items` 132（含 3 处共享 WI 引用）、`actions` 24、`work_item_for` 8。
- 全库状态分布：`ALM_Completed` 99、`ALM_Closed` 41、`ALM_Planned` 19、`ALM_Cancelled` 6、`ALM_Started` 1、`ALM_Realized` 1、`ALM_Analysed` 1。
- `classification`（ECR/Action/部分 L2 WI）：Analysis 23 / Requirements 14 / Test 8 / Documentation 2。
- 日期跨度 2022-06 ~ 2026-12；`created_date` 全量填充。

### 1.2 关键字段填充率（决定内容取舍）

- **ECR（最完整）**：state / summary / owners / created_date / team / project / **rollup_planned_effort / rollup_actual_effort** / classification 100%；analysis_target_date 90%；closed_date 70%。
- **work_item**：核心字段 100%；planned_completion_date 90%；closed_date 87%；**planned_effort 74%**；**process_area 93%**（pipeline 从 Summary 派生，含关键词回退）；review 系列字段 47–88%。
- **action**：核心 + target_date 100%；closed_date 88%；**planned_effort 仅 4%**（不用于统计）。
- **build**：核心 + maturity_level + target_date 100%。

### 1.3 数据质量坑（渲染层必须处理）

| 问题 | 处理 |
|---|---|
| `review_planned_start_date_ref` / `review_planned_completion_date_ref` 存的是 **Excel 序列号**（字段名以 `Ref` 结尾，不走日期转换） | 展示时按 epoch **1899-12-30** 转换 |
| `overdue_planned_completion_date` 含 1900–1902 垃圾值（15 行，上游日期运算 bug） | **整列忽略**；逾期一律前端自算（见 §7） |
| effort / state_duration 列是 **TEXT 型数值** | 聚合时 CAST float |
| owners / analysers / affected_objects 等是**逗号分隔文本** | 按需拆分（当前内容清单未用到人名统计） |

---

## 2. 信息架构

**两个视图 + 三个全局件**（导航形态——侧栏还是顶栏——留 UI 会话）：

| 视图 | 内容 | 使命 |
|---|---|---|
| **Home** | 页头 + Bento 卡片区 + ECR 数据表格（§3–§4） | **检索工作台**：快速定位与跟进 ECR |
| **Graph** | ECR 关系树（§6） | 层级与关系浏览 |

全局件：
- **⌘K 全局搜索**（topbar，§5）
- **详情抽屉**（右侧滑出，§5）
- **PTC `integrity://` 链接** + 本地 opener 服务（`127.0.0.1:8766`）照旧，含 opener 离线时的英文 modal 兜底。

页头：**仅一个全局搜索栏**（无标题、无副标题、无 generated_at/计数小字——2026-10-03 设计轮简化决策，极简呼吸感）。
界面文案**英文为主**（延续旧版）；数据值（Summary / Project / 人名等 PTC 字段值）一律保持原文。

---

## 3. Bento 卡片区（Home）

**定位**：检索辅助概览。**卡片不可点击**（否决卡片作为筛选入口）；但卡片数据**随搜索/筛选结果联动重算**（2026-10-06 需求调整，联动口径见 §3.1）。

内容清单锁定为 **5 项**（卡片数量/网格排布/大小配比是 UI 会话的自由度）：

1. **Totals（KPI 卡）**
   内容：三个总数 KPI——ECR 总数、Work Item 总数、Action 总数；**按实体去重计数**（共享 WI 只算一次，与 manifest counts 一致），不做逐 ECR 树求和。
   形式：一行三格，大写微标签 + 大数值（tabular）底对齐，格间 hairline 分隔。（2026-10-03 设计轮改版：原"Active ECRs 列表 + 进度条"方案作废；活跃 ECR 的跟进定位由表格 Open 筛选承担。）

2. **Effort（工作量卡）**
   内容：全部 ECR 的 `rollup_planned_effort` vs `rollup_actual_effort` 求和对比。
   口径：ECR 级 rollup 字段（100% 填充），不含未 rollup 的明细。
   形式：**对比卡**——Planned 与 Actual 两格**等权** KPI（同 Totals 卡解剖：大写微标签 + 32px/700 tabular 大数值 + hairline 分隔 + 底对齐）；不设占比条、不设脚注（2026-10-03 设计轮）。

3. **Creation Timeline 卡（横向创建故事线）**
   内容：横轴按 `created_date` 时序排列全部 ECR（一对一事件点）。
   语义：**实心点** = 已终结 ECR（Closed/Realized），**AntD loading 脉冲点** = 仍开放 ECR；连接线止于最后一个点不拖尾。
   标签：**ECR ID 为主**（12px/600 正文色）、日期为次（`<time>` 9.5px 浅灰），上下交替摆放在轨道两侧；悬停显示 Summary。（参考 Timeline.txt 纵向语义的横向化；原"季度 created vs closed 双序列柱"方案作废。）
   形式：**无卡片标题**——轨道在卡内垂直居中（显式高度 128px，防单列布局塌缩），上下标签对称呼吸（2026-10-03 设计轮）。

4. **Effort by Process Area（纵向宽柱柱状图）**
   口径：**work_item L0–L2** 的 `planned_effort` 按 `process_area` 求和。
   形式：**纵轴 = 柱高，横轴 = process area 分类**（参考格局图柱状样式：宽柱、圆角顶、大写字距横轴标签，**无槽底阴影**，降序排列）；一排放不下时**卡片内横向滚动**。
   - 缺 `planned_effort` 的行不进图（26%）；
   - `process_area` 缺失（7%）归入 `Other`；
   - **Action 不混入**（`Initial IA` 是固定派生值 + effort 仅 4% 填充，混入会失真）。

5. **Effort by Team（迷你饼图）**
   口径：与 #4 完全一致（work_item L0–L2 的 `planned_effort`），按 `team` 求和。team 100% 填充。

**明确不设状态分布卡**（用户排除）：状态概览由表格状态筛选承担。

### 3.1 筛选 → 卡片联动（2026-10-06 设计轮收窄驱动源 + 深化 matcher）

**驱动源（仅两个）**：表格文本过滤 t-filter 与状态分段（All/Open/Closed），共同构成**当前结果集**；任一变化，五张卡即时重算。**⌘K 全局搜索不是驱动源**（决策 #25）：它是纯预览导航，只在选中命中、且目标行被结果集藏住时，先复位冲突筛选（间接触发重算）。

**t-filter matcher（2026-10-06 深化）**：ECR 的 ID/Summary 命中，**或其下任一 WI/Action 的 ID/Summary 命中**（内容命中，递归整棵 WI 树）→ 该 ECR 留在结果集。搜任何词，包含它的 ECR 都在页面上；下拉选中的 WI/Action 其父 ECR 必然在结果集内。

**命中展开与高亮（2026-10-06 表格改版新增）**：t-filter 命中子项时**自动展开其整条父链**，并给所有**命中行**（ECR 或子行，按 ID/Summary 匹配）加临时 accent 淡底高亮；ECR 自身命中不强制展开。自动展开是**过滤期间的叠加层**：过滤期间点击折叠只抑制本次叠加（清空过滤前保持折叠），**清空过滤即回退**到过滤前的手动展开态；过滤中新手动展开的行会保留进手动集合。

**重算口径**（无过滤时必须与全量聚合逐值一致，作为自检基线）：

- Totals：ECR 数 = 结果集大小；WI / Action = 结果集内各 ECR 树的**实体去重**计数（共享 WI 只算一次）；
- Effort：结果集 ECR 的 rollup planned / actual 求和；
- Timeline：结果集 ECR 的创建事件点；
- Process Area / Team：从结果集的 WI 树**重新聚合**（口径同 §3 #4/#5：缺 planned_effort 不进图、缺失归 Other、Other 置底 / Top5+Other），共享 WI 去重。

**空结果集**：KPI 显 0；Timeline / Process Area 显示英文空态文案；圆环转中性灰环、中心 0。

**Scope 提示**：结果集收窄（有查询词或状态分段 ≠ All）时，bento 上方出现细提示行 "Cards reflect N of M ECRs" + "Clear filters" 一键复位（清空两个搜索框并恢复 All 分段）；无过滤时提示行隐藏。
**一键清除（2026-10-07）**：表头控制区（搜索框与 Columns 之间）新增 "Clear filters" 按钮，仅当任一表格筛选激活（seg ≠ All / 有查询词 / 有列筛选）时出现；**与 scope 提示的 Clear filters 同一动作**——复位 seg + 文本过滤 + 全部列筛选（排序不属于筛选，不动）。可见性由 renderBody 统一同步，任何筛选路径都会刷新。

---

## 4. ECR 数据表格（Home 主体）

- **一行 = 一条 ECR**（当前 10 行）。不做分页；保留旧版"Show more"式渐进加载备数据增长。
- **表格自带筛选**（筛选能力全部归属表格，无全局筛选）：
  - 文本过滤（ID / Summary，含子项内容命中，见 §3.1）；
  - 状态分段筛选 All / Open / Closed（口径见 §7）；
  - **列筛选下拉（2026-10-07 新增，Excel 式）**：每个数据列（chevron 占位列除外）的表头带漏斗触发钮——静止半透明常显、hover 加深、该列筛选生效时高亮为 accent；点开下拉 = 值搜索框 + (Select All)（含 n/m 计数与半选态）+ 值复选列表（含每值行数、缺失值以 **(Blanks)** 沉底）+ Clear filter。取值口径 = 单元格**显示字符串**；候选值列表**分面**——只统计通过"其余所有激活筛选 + seg + 文本过滤"的行（本列自身筛选除外）。勾选即实时应用：列内 OR、列间 AND。**树形语义**：行自身值命中**或任一后代命中**则保留，被保留的祖先自动展开让命中链可见（匹配行必须可达）；"最后可见子行"决定 guide 线终止。筛选只作用于**表格**（底栏计数/Σ 随可见 ECR 重算），**五卡与 scope 提示仍只由 seg + 文本过滤驱动**（§3.1 驱动源不变）。滚动/缩放时弹层跟随漏斗重新锚定，漏斗滚出视口、Esc、外点、排序（thead 重建）时关闭；⌘K 选中目标若被列筛选藏住，按"选中优先"先清空全部列筛选再定位（与 seg/文本冲突复位同语义）。
  - 列排序——**嵌套排序**（2026-10-06 表格改版）：ECR 之间按排序列排序；父级展开后，其直接子行（WI 与 Action **同级混排**）按**同一列、同一方向**在父级内排序，L1/L2 递归同理；父行位置只由父级自身值决定，收起的子树不参与；**缺失值升降序均沉底**（稳定排序，等值保持原序）。

### 默认列（2026-10-07 调整为 5 列，ECR / WI / Action 全部行共用同一套列）

| 列 | 内容 |
|---|---|
| ID | 行首**类型圆底徽章**（2026-10-07 新增，样式取 Reference/Table_CSS.txt 的 `.tx-avatar` 圆底 + 其 token 色板）：24px 实心圆 + 深色缩写（`#0a0b10`），**高度与同行 STATE 徽章对齐**；配色 CR=绿 `#46d6a0` / Task=黄 `#ffc24a` / WP=蓝 `#6d8cff` / Action=橙 `#ff8f6d`。ECR 恒为 CR（数据无 `type` 字段），WI / Action 取 `type` 原值，悬停显示全名，未知类型不渲染徽章。后接 `integrity://` PTC 链接；**层级缩进只落在本列**（见行展开） |
| Summary | 截断显示 |
| State | 徽标显示**实际 PTC 状态**（2026-10-07：剥 `ALM_` 前缀，如 Closed / Completed / Realized / Started / Analysed；悬停见原值），颜色仍按 open/closed 语义双色——进行中=橙、已关闭族=绿（口径同 §7 分段筛选）；列筛选按实际状态字符串取值。原为可开列，2026-10-07 升为默认列 |
| Process Area | **2026-10-07 新增**：WI 行显示 `process_area`（仅 WI 有该派生字段）；**ECR / Action 行恒留白**，WI 自身缺失也留白（空值留白惯例）。列筛选/排序可用，父行排序位置只由父级自身值决定——PA 全空的 ECR 层在两种方向下都保持稳定序，排序实际作用于展开后的子行 |
| Planned Effort | **逐行口径**（2026-10-06 表格改版，见下方 Effort 注；2026-10-07 升为默认列，右对齐） |

列显隐机制（2026-10-07）：Columns 菜单列出**除 chevron 占位外的全部数据列**，默认勾选 = 默认列（`def` 标记）；默认列不再是"不可隐藏"的硬编码，菜单即开关。

**表格边轨（2026-10-07）**：`.t-scroll` 左右 `margin:0 18px`——滚动视口从卡片边缘内缩，形成**固定画布留白**，横向滚动到任意位置（包括列被视口裁切时）两侧都保持 18px 空白，与表头/底栏的 18px 节奏一致；最后一个**可见**列的 `th`/`td` 由 `applyCols` 动态挂 `.edge` 类、加 `padding-right:84px`——与左侧 ID 前的静区视觉对称（未滚动时的左右轨实测 ~99/103px）；列增删开关时 `.edge` 随之迁移，滚动到最右时右缘留空 = 18 + 84px。

> **Planned Effort 逐行口径（2026-10-06）**：`type == "ALM_Change Request"` 的项（ECR 与嵌套 CR 型 WI）在 PTC 中自身无 planned effort（自身值恒 0），显示 **`rollup_planned_effort`**；其余项显示**自身 `planned_effort`**，自身为空但存在 rollup 时回退显示 rollup（当前 6 条 Work Package 属此情况），两者皆空留白。真实 `0` 显示 `0`；**空值一律留白，全表不使用 "—" 占位**。
> **ECR 两列 rollup 口径不变**：ECR 行的 Planned/Actual 仍取 rollup 字段、不前端自算（理由同前：WI `planned_effort` 仅 74% 填充，沿边求和系统性偏小且与 Actual 不对称），与 Effort 卡（§3 #2）口径一致。

### 可开关列（Columns 菜单，默认隐藏；内容口径不变）

Created Date（ISO 日期，ECR / WI / Action 均有该字段）、Children（计数徽标：ECR = 整树计数（WI L0/L1/L2 + Action，**按实体数**，每 WI 只计一次）；有下级的 WI = **直接下级**计数；叶子 WI / Action 留白）、Actual Effort（ECR = `rollup_actual_effort`；子行无 actual 字段，**恒留白**）、
Project、Closed Date、Owners、Team、Planned Completion（WI 取 `planned_completion_date`；**Action 取 `target_date`**，即该实体的计划完成语义）、Analysis Target Date、Classification、
Overdue（**前端自算**：`planned_completion_date < generated_at` 且 `state ∈ OPEN`，公式实体无关——ECR 与 WI 行均自算，Action 无该日期恒空；库内 overdue 列整列忽略）。

（State、Planned Effort 于 2026-10-07 升为默认列，移出本清单。）

### 行展开（2026-10-06 表格改版：内联子行，原分组面板作废）

- **行展开 = 内联子行**：子项不再是展开面板里的"WORK ITEMS / ACTIONS 两组列表"，而是主表里的**真实表格行**——Work Item 三级树（L0→L1→L2）与 Action 与 ECR **共用同一套列**（默认列 + 可开列），一屏同构呈现。
- **层级表达 = ID 列内的树形参考线**（2026-10-06 二次调整，视觉依据 [Reference/Table_structure_UI_CSS.txt](../Reference/Table_structure_UI_CSS.txt) + 用户提供的结构树截图）：每级祖先一条 1px 垂直参考线（`#e4e4e7`）贯穿子树各行 + 该行自身一条**圆角弧线肘线**接入；节距 11px 间隙 + 1px 线 + 11px 间隙 = 23px/级（ECR 0 级、Action 与 WI L0 同为 1 级、L1 2 级、L2 3 级，ID 内容随级偏移）。**末行终止规则**：同级**最后一个**子行处，该级纵线止于其肘线（圆角收头，不延伸到行底），其更深层子树也不再携带该级线——即经典 `├ / └` 树形；**不加类型 chip / Type 列**。
- **可展开行** = ECR、有下级的 WI（显示 chevron）；叶子 WI 与 Action 行无 chevron。
- **行点击 = 展开/收起**（仅可展开行）；叶子行点击无动作。**行点击与抽屉解耦**（2026-10-06）：详情按钮后续单独实现，在此之前 Home 表格无抽屉入口（⌘K 选中按 #25 只定位展开，不进抽屉）。
- **展开态 keyed 持久**：跨排序 / 过滤 / 重渲染保持（旧版 keyed 展开 state 模式）。
- **Build 不进表格**（只在抽屉与图谱出现）。

---

## 5. 详情抽屉 与 ⌘K 全局搜索

### 抽屉（复用旧版 DetailsDrawer 模式）

- 四种变体：`ecr` / `work_item` / `action` / `build`。
- 内容：**全字段分组**（Core / Dates / Effort & Durations / Review / Relations；42 字段中表格放不下的 review、state durations、affected_objects、analysers 等都落在这里）+ **关系区**（父 / 子 / 共享，来自 `edges`）+ PTC 链接。
- 触发：~~表格行点击~~（2026-10-06 表格改版移除，**详情按钮后续单独实现**，当前 Home 表格无抽屉入口）、图谱节点点击、搜索命中。
- 交互：Esc / 遮罩 / 焦点返还（旧版已实现）。

### ⌘K 全局搜索（复用旧版 TopSearch 模式；交互规格于 2026-10-06 设计轮细化）

**定性：纯预览的全局导航**——打字只更新下拉面板，不触碰表格与卡片（决策 #25，覆盖 #24 的"逐键联动"）；只有**选中**产生动作，动作 = 复位冲突筛选 + 定位 + 展开 + 闪烁。

- 范围：全 4 kind 的 **ID + Summary**，大小写不敏感子串；纯数字查询 ID 前缀命中排前。分组下拉：ECR → Work Item → Action → Build（Build 生产数据就绪后入组，设计稿暂无数据）；组头显示该组命中总数，**每组上限 5 条**，不做 "Show all"（收窄查询即可）。
- 排序：ECR 组按 created 降序（与表格默认一致），WI / Action 组按 ID 降序（新者优先，旧版行为）。
- 行：状态点 + ID + 截断 Summary +（ECR 行 created 日期 / WI·Action 行 "∈ ECR xxxxx" 归属徽标）；命中子串 accent 淡底 `<mark>` 高亮；Summary 先 HTML 转义再高亮。索引按实体去重（共享 WI 只出现一次）。
- 空态 "No results for …"；无 debounce（数百~千级实体直接全扫，旧版同先例）。
- 键盘/鼠标：输入后**第一条自动预选**；↑↓ 全部结果中线性跨组循环移动；hover 同步预选；Enter 激活；Esc 先关面板（保留查询词）、面板已关再按才清空查询；点击面板外关闭；有词聚焦即重开面板；⌘K / Ctrl+K 聚焦并全选。ARIA combobox / listbox / aria-activedescendant。
- **命中行为（Home 阶段）**：ECR → 定位该行并展开，行闪烁；WI / Action → **展开其整条父链**（父 ECR + 中间层 WI），闪烁**该子项的内联表格行**（2026-10-06 表格改版：原"闪烁展开区内子项"随面板作废调整；Graph 就绪后 WI/Action/Build 的跳 Graph 让位规则另议）；选中后查询词保留、面板关闭、输入框失焦；**目标行被表格筛选藏住时，先复位冲突筛选（分段回 All、清空 t-filter）再定位**——选中优先，交互无死路。
- 与 t-filter 解耦：两个输入框互不镜像、互不影响；全局搜索纯导航，无任何数据作用域。

---

## 6. Graph 视图（2026-10-07 grill 定稿，见 §10 #34–38）

- **节点**：全 4 kind（当前 168 节点）；**边**：`work_items` 三级链 + `actions` + `work_item_for`。
- **默认展开**：~~ECR + L0~~ → **默认全折叠**（#34）：首屏仅 10 张 ECR 卡，右缘徽标显直接下级数，
  点击逐层展开；展开态 keyed 持久沿用旧机制。
- **共享实体**：去重为**单节点多父**（5 Build / 8 边、3 处共享 WI 引用）——这是图谱区别于表格的核心
  价值。布局采用**主父挂靠 + 跨列连线**（#35）：共享节点只出现一次、挂在首个引用父的子树里，其余父
  画跨列长边接入（虚线 / 共享标记区分）。
- **kind 配色**：沿用 Home 表格 ID 徽章色板（#36）——ECR=CR 绿 `#46d6a0`、CR 型 WI=黄 `#ffc24a`、
  WP=蓝 `#6d8cff`、Action=橙 `#ff8f6d`；Task 型 WI 与 Build 的色实现时补定（不与已锁四色冲突）。
- **节点点击**：**打开详情抽屉**（2026-10-08 #39，覆盖 #37 的"无动作"）：卡片正文点击开抽屉
  （± 钮仍展开）；选中高亮转为**抽屉锚点环**——抽屉开着时源节点带蓝环、关系导航时跟随移动、
  关抽屉即消。**Build 抽屉变体**：Core（Type/State/**Maturity**/Owners/Team/Project）+ Dates +
  Relations，无 Effort 段；**多父实体（共享 WI + 共享 Build）Relations 显示全部父引用**（新者在
  前），Build 附 "shared · N ECRs" 芯片。**关系行随视图就近导航**：Graph 内 = 展开主父链 +
  定位闪烁 + 抽屉原地换内容（不回写表格）；Home 内行为不变。数据侧 `DATA.builds` 注入
  （mockup_build.py，Home 卡片/表格不消费）。
- **卡片右上角迷你进度环**（2026-10-08 #40，取代原创建月份；同日用户修正：**ECR 根卡不画环**，
  右上角改显 rollup 总量数字，tooltip 同）：**子卡** display effort（#27 口径）占**当前挂靠
  ECR** rollup 总量的百分比；**分母随挂靠父变**；缺 effort 留白不渲染（Build 全部 /
  Action 大部分 / 26% WI），真实 `0` 画空环不与缺失混淆；环内数字 10–99 显整数、<10 只看弧；
  tooltip 显精确值（"28 of 73 planned · 38%"）。GRAPH 节点新增 `effort` 字段。
- **视觉参照**：旧 ReadAcross 图谱（`Reference/dashboard.html` 的 ProjectTree：横向树 / 240px 节点卡 /
  右缘 ± 压线展开钮 / enter-leave 动效 / pan-zoom），token 换 Relate（Inter / 画布色 / 圆角，
  与 design/homepage.html 一致）。
- 复用旧版能力：pan / wheel zoom / 节点内搜索（命中子树强制展开 + accent 描边）/ 状态筛选
  （新口径，`ALM_Completed` 属 Closed）/ 全部展开收起。
- ⌘K 与 Graph 的跳转让位规则（§5 遗留"另议"）**本轮不做**，原型定稿后另议。

---

## 7. 聚合口径（锁定）

1. **状态二分**：`CLOSED = {ALM_Closed, ALM_Realized, ALM_Rejected, ALM_Cancelled, **ALM_Completed**}`；其余（Planned / Started / Analysed 及未来可能出现的 Initiated / Defined / Checked / Approved）= OPEN。
   - ⚠️ `ALM_Completed` 是**新库新增状态**（99/129 WI），旧 `aggregations.py` 的 OPEN/CLOSED 集没有它——重写聚合时必须加入 CLOSED 集（2026-10-03 已确认口径）。
2. **逾期**：一律前端自算（`planned_completion_date < generated_at` 且 OPEN）；库内 `overdue_*` 列忽略。
3. **Children 计数**：用实体数（每 WI 只计一次），不用边数（边含共享引用）。
4. **review `...Date Ref` 字段**：Excel 序列号，展示时按 epoch 1899-12-30 转换。
5. **effort / duration**：TEXT 数值，聚合时 CAST。

---

## 8. 明确不做（本轮范围外，勿"顺手加"）

- 卡片点击筛选 / 卡片→筛选反向联动（卡片仍不可点击；联动保持单向：**表格筛选 → 卡片**，见 §3.1；⌘K 全局搜索不参与联动）
- 全局筛选器（日期区间 / 项目多选）联动卡片
- 深色模式、多主题、i18n
- 分页
- UI 视觉（主题 / 布局 / 字体排印）——**下个会话基于 `Reference/Relate_DESIGN.md` 单独做**

## 9. 实现备忘（后续会话）

- **首页屏视觉设计稿已完成**：`design/homepage.html`（单文件自包含、内嵌 Inter、内嵌 2026-10-01 真实快照数据；含 Bento 五卡 + 表格交互原型，可作 phase 2 渲染实现的直接参照）。
- `data_loader` 重写：`items` / `edges` / `metadata` → `__PAYLOAD__ {data, aggregations, meta}`（契约形状沿用旧版，见 [data-contract.md](data-contract.md)）；建议直接消费 `dashboard_schema.json` 校验列。
- Home 五卡是**结果集作用域**聚合（§3.1）：渲染层需支持按过滤结果前端重算（共享实体去重）；payload 里的全量聚合仅作无过滤基线与自检对照。设计稿 `design/homepage.html` 的 `collectScoped()` 可直接参照。
- ⌘K 搜索需要**扁平实体索引**（WI/Action 按实体去重 + 各自映射父 ECR id），设计稿 `design/homepage.html` 的 `WI_INDEX / ACTION_INDEX` 与 `searchEntities()` 可直接参照；选中定位需要表格行与展开区子项可寻址（`data-id` / `data-kind`）。
- 需新写的聚合：kind 计数（Totals 卡，实体去重）、rollup effort 汇总、ECR 创建故事线、process_area 分布、team 分布、children 计数、OPEN/CLOSED 分类（含 `ALM_Completed`）。
- **Planned Effort 展示口径在渲染层解析**（设计稿 `design/homepage.html` + `.zcode/mockup_build.py` 可直接参照）：payload 里 `planned` 保留**自身原值**（卡片/范围聚合用），`effort` 为按 §4 逐行口径解析后的**展示值**（CR 型 → rollup；其余 → 自身值，空则回退 rollup）；表格列读 `effort`，卡片聚合读 `planned`，两字段勿混用。
- **Graph 原型数据**：现 DATA 仅 Home 形状（`{ecrs, agg}`，ECR 内嵌 children/actions），缺 Build
  与共享多父边信息——mockup_build.py 需扩展注入图结构（flat nodes + 三类 edges），Home 消费不变。
- 硬约束不变：单文件自包含 HTML、零前端依赖、手写 SVG、内嵌 Inter、浅色主题、CLI 输出 ASCII-only、4 exe 打包（见 [workflow.md](workflow.md)）。
- 验证：渲染链路适配后按 [workflow.md §4](workflow.md) 浏览器手测 + `node --check` + inline self-check；取数链路无改动，`selftest_fetch.py` 不受影响。

## 10. 决策记录（访谈留痕，防反复）

| # | 决策 |
|---|---|
| 1 | 首屏使命 = **检索工作台**（非汇报看板） |
| 2 | 图谱树 = **独立视图**，导航切换；Home 不放图谱 |
| 3 | 筛选能力全部收在表格；卡片为静态汇总 |
| 4 | 表格一行 = 一条 ECR |
| 5 | 卡片**纯静态不可点击**（否决点击预填筛选） |
| 6 | 卡片 5 项内容（§3）；状态分布卡被否决 |
| 7 | 表格精简默认列 + 列显隐配置 |
| 8 | 行展开 = WI 三级树 + Action 平铺；Build 不进表格 |
| 9 | 保留全字段详情抽屉 |
| 10 | 保留全局 ⌘K 搜索 + 表格内文本过滤 |
| 11 | 图谱全 kind，默认折到 ECR+L0，共享去重 |
| 12 | effort 迷你图 = WI 三级求和（Action 不混入） |
| 13 | 界面文案英文为主，数据值保持原文 |
| 14 | `ALM_Completed` = CLOSED（执行阶段新增事实触发确认） |
| 15 | 默认列改为 ID / Summary / Created Date / Children / Planned Effort / Actual Effort（2026-10-03 二次修改）；State / Project / Closed Date 降为可开列；Effort 两列取 ECR rollup 字段（WI 层无 actual 字段，自算偏小且不对称） |
| 16 | 页头**仅保留搜索栏**（无标题/副标题/generated 小字），极简呼吸感（2026-10-03 设计轮） |
| 17 | Timeline 卡改为**横向创建故事线**（每 ECR 一个事件点，实心=已终结、脉冲=开放），原季度柱方案作废（2026-10-03 设计轮） |
| 18 | 首页视觉方向：全页浅色（webp 格局）+ 唯一 accent = Relate 蓝 `#145aff`；设计稿 `design/homepage.html`（2026-10-03） |
| 19 | 主色试换 `#3b82f6`（token/渐变/圆环色阶同步，待用户定夺是否保留）；Process Area 卡改**纵向宽柱 + 横轴分类 + 卡内横向滚动**（参考格局图柱状样式）（2026-10-03 设计轮） |
| 20 | 第一卡改为 **Totals KPI**（ECR / Work Item / Action 总数，实体去重），不再展示活跃 ECR 列表与进度（2026-10-03 设计轮） |
| 21 | Effort 卡改**等权对比卡**：Planned / Actual 两格同尺寸大数值并排（同 Totals 解剖），弃"一大一小"层级（2026-10-03 设计轮） |
| 22 | Timeline 卡**去掉卡片标题**，轨道垂直居中（显式高度 128px），上下标签对称呼吸（2026-10-03 设计轮） |
| 23 | Timeline 节点标签层级反转：**ID 为主**（12px/600）、日期为次（9.5px 浅灰）（2026-10-03 设计轮） |
| 24 | **搜索结果联动卡片**（2026-10-06 需求调整，部分覆盖 #3/#5 的"纯静态"）：⌘K 搜索、表格文本过滤、状态分段共用同一结果集，五卡按结果集重算（实体去重，口径同 §3.1），新增 scope 提示行 + Clear filters；卡片仍**不可点击**，联动保持单向（筛选→卡片） |
| 25 | **全局搜索改为纯预览导航**（2026-10-06 grill 访谈轮，覆盖 #24 的"⌘K 逐键联动"部分）：打字只更新分组下拉（每组 ≤5、命中高亮、首条预选、↑↓/Enter/Esc/hover/Ctrl+K 全键盘集），页面不动；选中 = 复位冲突筛选 → 定位行 → 展开 → 闪烁（WI/Action 闪烁父 ECR 内子项），查询词保留；卡片实时联动驱动源收窄为 **t-filter（matcher 深化为内容命中：嵌套 WI/Action 命中留父 ECR）+ 状态分段**；⌘K 与 t-filter 完全解耦、互不镜像 |
| 26 | **行展开改内联子行**（2026-10-06 grill 访谈轮，覆盖 #8 的面板形态）：WI 三级树 + Action 全部成为主表真实行，与 ECR 共用同一套列；原"WORK ITEMS / ACTIONS"分组面板作废。层级 = **纯缩进、只缩进 ID 列**（步幅 10px/级，ECR 0 / Action·L0 1 / L1 2 / L2 3），不加类型 chip 或 Type 列；ECR Children 徽标的"点击展开"取消（行点击已覆盖） |
| 27 | **空值一律留白**（2026-10-06 grill 访谈轮，全表统一，含原 ECR 行 "—" 占位一并取消）；真实 `0` 显示 `0`（19 条 WI 的 planned=0 是 PTC 显式填 0，非缺失）。**Planned Effort 逐行口径**：`type == ALM_Change Request`（ECR + 嵌套 CR 型 WI）→ `rollup_planned_effort`；其余 → 自身 `planned_effort`，空则回退 rollup（6 条 WP），皆空留白；Actual 子行无字段恒留白 |
| 28 | **行点击 = 展开/收起**（2026-10-06 grill 访谈轮，仅可展开行；叶子行无动作），行点击与抽屉解耦——**详情按钮后续单独实现**，在此之前 Home 表格无抽屉入口；子行 Overdue 可开列按同公式自算（Action 无 planned_completion 恒空），Action 的 Planned Completion 列取 `target_date` |
| 29 | **t-filter 命中自动展开父链 + 命中行高亮**（2026-10-06 grill 访谈轮，增强 §3.1）：自动展开是过滤期间的**叠加层**，过滤中点击折叠仅抑制本次叠加，**清空过滤回退**到过滤前的手动展开态；命中 = 行 ID/Summary 匹配，ECR 自身命中不强制展开 |
| 30 | **嵌套排序**（2026-10-06 grill 访谈轮）：ECR 间按列排序；父级内直接子行 WI+Action **同级混排**、按同列同方向递归排序；**缺失值升降序均沉底**；父行位置只由父级值决定；展开态 keyed 持久跨排序/过滤/重渲染 |
| 31 | **⌘K 选中 WI/Action = 展开整条父链并闪烁该子项的内联行**（2026-10-06，随 #26 的内联行形态调整 #25 的闪烁对象） |
| 32 | **层级视觉改树形参考线**（2026-10-06 二次调整，细化 #26 的"纯缩进"）：ID 列内每级祖先 1px 垂直参考线（`#e4e4e7`，贯穿子树各行）+ 行自身 11px 肘线，节距 23px/级，视觉依据 `Reference/Table_structure_UI_CSS.txt`（shadcn 式文件树）；仍不加类型标识 |
| 33 | **参考线末行终止**（2026-10-06 三次调整，细化 #32）：同级**最后一个**子行处该级纵线以圆角弧线肘线收头、不延伸到行底（经典 `├ / └` 树形，依据用户提供的结构树截图）；末行的更深层子树不再携带已终止层级的线；isLast 按排序后的视觉顺序在 flatten 时标记，随排序联动 |
| 34 | **图谱默认全折叠**（2026-10-07 graph-view grill 轮，覆盖 §6 原文"默认展开 ECR+L0"）：首屏仅 10 张 ECR 卡，右缘徽标显直接下级数，点击逐层展开；展开态 keyed 持久 |
| 35 | **共享实体布局 = 主父挂靠 + 跨列连线**（2026-10-07）：单节点挂首个引用父的子树，其余父画跨列长边（虚线/共享标记），布局仍按树算 |
| 36 | **图谱 kind 配色沿用表格徽章色板**（2026-10-07）：ECR=CR 绿 / CR 型 WI=黄 / WP=蓝 / Action=橙；Task 型 WI 与 Build 色实现时补定 |
| 37 | **图谱节点点击本轮无动作**（2026-10-07）：仅选中高亮，详情入口完全后置 |
| 38 | **Graph 实现路径 = 原型先行**（2026-10-07，细化 #2/§9）：`graph-view` 分支在 design/homepage.html 上开发 Graph 视图（含 mockup_build.py 注入图数据），原型定稿可先合回 main；渲染链适配（data_loader 重写 + 移植）另立分支。视觉参照旧 ProjectTree（Reference/dashboard.html）+ Relate token；验证以手测清单为主 |
| 39 | **Graph 节点点击开抽屉**（2026-10-08 grill 轮，覆盖 #37 的"无动作"）：卡片正文 = 开抽屉（± 钮仍展开），选中高亮转为**抽屉锚点环**（随抽屉开关与关系导航跟随/清除）；**Build 抽屉变体** = Core（含 Maturity）/Dates/Relations、无 Effort 段，`DATA.builds` 注入全字段；**多父实体 Relations 全父显示**（3 共享 WI + 共享 Build，新者在前 + shared 芯片）；**关系行随视图就近导航**（Graph 内展开主父链+定位闪烁+抽屉原地切换，Home 表格同步行为不变）；⌘K 的 Build 组仍按 #25 另议，本轮不做 |
| 40 | **Graph 卡片右上角迷你进度环**（2026-10-08 grill 轮，取代原创建月份；同日用户修正：**ECR 根卡不画环改显 rollup 总量数字**）：子卡 display effort（#27 口径）占当前挂靠 ECR rollup 总量的百分比；**分母随挂靠父变**（非固定主 ECR，过滤改挂后百分比即变）；缺 effort **留白不渲染**（Build 全部/Action 大部分/26% WI，不与真实 0 混淆——真实 0 画空环）；环内数字 10–99 显整数、<10 无数字；tooltip 显精确值；GRAPH 节点新增 `effort` 字段 |
