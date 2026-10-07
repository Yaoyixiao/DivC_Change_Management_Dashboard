# homepage.html 详情抽屉面板 — 深化实施计划（frontend-design 深化版）

## 已确认决策（grilling 两轮）
仅改 `design/homepage.html` · 遮罩浮层 · 专属右缘列 · 现有字段分组展示 · Relations 可点击导航 · 宽度会话内记忆。
不动 `src/dashboard_generator/*`、`.zcode/mockup_build.py`、`const DATA` 行。

## 设计方针（从房屋系统推导，零新颜色/零新字体）

**抽屉的定位**：检查面（inspection surface）——不丢表格上下文地读全一条记录。表格负责扫读（截断、密集），抽屉负责读全（Summary 完整换行、字段全量），这个刻意的反转就是它的性格。

**Token 映射**（全部复用 `:root` 现值）：
- 表面：`--card` 白底 + 1px `--line` 边；左侧圆角 `--r-card` 16px（右侧贴边不留角，docked sheet）；投影取 rail 的量级反向：`-24px 0 60px -24px rgba(2,5,32,.25)`；scrim 用系统影墨 `rgba(2,5,32,.32)`，z 序在 col-pop / search-panel 之上。
- 排版：节标题 = `.card-label` 原样（600 11px 大写 .08em `--mut`）；kv 行 = 标签 12.5px `--mut`（固定 108px 列）/ 值 13px `--body` + tabular-nums；Summary 500 15px/1.45 `--ink` 可换行；节间 20px + `--line-soft` 分隔线，kv 行内不加线。
- 分组名沿用锁定规格 §5：**Core / Dates / Effort / Relations**（mockup→production 映射保持字面一致）；组内字段标签逐字复用表格列词汇（"Closed Date" 不是 "Closed"）。

**一个记忆点**：身份头部——24px `.type-badge` 圆徽 + ID（600 15px `--ink`）+ Open/Closed `.badge` + Overdue `.badge.late`，下方 Summary 大字完整展示。其余全部安静；唯一装饰性手势：左缘拖拽线平时 `--line`、hover/拖拽中亮 `--accent`。

**动效预算（一次性编排）**：scrim 淡入 .2s + 抽屉滑入 .28s `cubic-bezier(.22,.61,.36,1)`（搜索胶囊同曲线），无逐节 stagger； Relations 行 hover `--wash`（search-row 语言）。新增 `@media (prefers-reduced-motion: reduce)` 只关抽屉自身过渡（不追溯全文件）。

**文案**（主动语态、句首大写、与表格同词汇）：关闭钮 aria-label "Close details"；PTC 底部占位钮 "Open in PTC" + `title="Open in PTC (integrity:// link in production)"`（逐字复用 ID 单元格的既有占位文案）；Relations 节头右侧复用 `.chip` 计数（"12 WI" / "3 A"，同 Children 列格式）；空值显示 "—"（仅"字段存在但为空"；不属于该 kind 的字段整行不渲染）。

## 变更明细（全部在 design/homepage.html 内）

### 1. 详情列
- `COLS` 末尾加 `{ key:"detail", label:"" }`；`cell.detail` 输出 `<button class="row-detail" data-kind data-id aria-label="Open details">`（panel-right 线性图标）。
- 按钮样式对齐 `.chev`：22px、6px 圆角、默认 `--faint`，行 hover 转 `--sec`，自身 hover / 该行抽屉打开时 `--accent` 底 `--accent-soft`。
- `chev` 同款待遇三处排除：`state.hidden` 初始化、`initCols` 菜单、`applyCols` edge-rail 计算（84px 留白保持在最后数据列）。
- `t-tbody` click 委托最顶部先判 `closest(".row-detail")` → 打开抽屉并 return（不触发行展开）。

### 2. DOM（body 级，置于 `#search-panel` 后）
```
#drawer-scrim (fixed inset 0, hidden)
#drawer (role=dialog aria-modal=true aria-labelledby=drawer-title, hidden)
  ├ .drawer-head：身份行 + Summary + ✕（.exs-clear 同款 30px 圆钮）
  ├ .drawer-body（滚动区）
  │   ├ 节 Core：Type / State(原文) / Classification / Process Area / Owners / Team / Project
  │   ├ 节 Dates：Created / Closed Date / Planned Completion / Analysis Target(仅ECR)
  │   ├ 节 Effort：Planned Effort / Actual Effort
  │   └ 节 Relations：条目= id(600) + summary 省略号，可点击（WI→父ECR+子WI；ECR→子WI+Action；Action→父ECR）
  └ .drawer-foot：Open in PTC 占位钮
```

### 3. JS Drawer 模块（~150 行，英文注释）
- 索引：遍历 `DATA.ecrs` 建 `Map<id,{kind,node,parentId,rootId}>`（含 WI 递归 + actions）。
- `open(kind,id,trigger)`：渲染分组 HTML → hidden→强制 reflow→加 `.open`（search-panel 同技巧）；`body.drawer-open` 锁背景滚动；触发行加 `.detail-open`（scrim 挡表格，重渲染不可能，高亮稳定）；聚焦 ✕；Tab 圈定；Esc / scrim / ✕ 关闭，焦点归还触发按钮（`isConnected` 判断）。
- 导航：点 Relations 条目 → 抽屉内容原地切换；沿 parent 链把祖先加进 `state.expanded` → `renderBody(filteredRows())` → 复用 `flash()` 闪烁对应行；`.detail-open` 迁移到新行。
- 宽度：默认 440px（inline style），左缘 8px 命中区 + 4px 视觉线；pointerdown + setPointerCapture，`width = 右缘 - clientX`，钳制 `[320px, min(92vw,960px)]`；双击重置 440；会话变量跨开合沿用；窗口 resize 越界收敛；拖拽期间 `user-select:none`、宽度不参与过渡。键盘可达：手柄 `role="separator"` `aria-orientation="vertical"`，←/→ 步进 24px。

### 4. 冲突与边界
- 详情钮点击属 outside-click，col-pop / search-panel 必先关，无 Esc 抢占。
- 横向滚动极端场景详情列可滚出视野（Q3 已接受）。

## 验证
- 实现中用浏览器自动化截图自查（skill 要求的 critique loop）：入场编排、hover 态、拖拽线性、空值、长 summary 换行。
- 手测清单：三种行开抽屉、按钮不触发展开、拖拽/钳制/双击重置/键盘步进、宽度跨开合沿用、Esc/scrim/✕ 与焦点归还、Tab 圈定、Relations 导航 + flash 同步、Columns 菜单无 Detail 项、列开关后 edge 留白正确、reduced-motion 降级、浮于既有浮层之上。
- 无新依赖；`mockup_build.py` 只重写 DATA 行，手写改动天然保留。

## 交付后（默认不做，另说即可）
把交互沉淀进 Handoff/dashboard-content.md §5 的触发器条目。