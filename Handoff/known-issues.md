# Known Issues

> **状态（2026-10-09 重写）**：按当前渲染链路（新 ECR 库 + 原型移植版前端）整理。
> 新库数据质量坑（`ALM_Completed` 状态、overdue 垃圾列、`Date Ref` 序列号）与处理口径见
> [dashboard-content.md](dashboard-content.md) §1.3/§7，不在本文重复。旧 RA-OP 时代的条目
> 已随重写消解（见文末核销记录）。

按修复优先级排序。

---

## 1. PTC 服务器地址硬编码在前端

**位置**：[src/dashboard_generator/assets/app.js](../src/dashboard_generator/assets/app.js) `INTEGRITY_HOST`
（opener 段，约 L2416）

`integrity://` 深链的 host（`skobde-mks-im.kobde.trw.com:7001`）写死在 app.js 里；换服务器要
改码 + 重新生成/打包，且 `packaging/使用说明.md` 的 hostname 描述要同步。单服务器内网场景下
可接受；多环境时再考虑挪进 payload（meta 段）由取数侧注入。

**优先级**：低（环境稳定时无感）。

---

## 2. Release/ 的 exe 二进制入Git 库，仓库随每次重打包持续变大

2026-10-09 按用户决定把 4 个 exe（约 58MB）随 `build(release)` 提交入库。每次重新打包都是
全新的 ~58MB blob（Git 对二进制无增量），十次就是 ~600MB。若只是分发给同事，建议后续改用
GitHub Release 附件承载、仓库只留代码；历史 blob 已推上去，需要瘦身时得走 history rewrite
（破坏性操作，先与用户确认）。

**优先级**：中（短期无碍，长期仓库膨胀）。

---

## 3. 浏览器兼容性未全测 + 依赖的 modern CSS

只在 Chromium 系手测过（ZCode 内嵌浏览器 / Edge；2026-10-09 的自动化冒烟同为 Chromium）。
未测：Firefox、Safari、移动端。

实际用到的 modern features（低于以下版本会缺功能/样式）：

- `:has()`（styles.css 5 处）—— Chrome 105+ / Safari 15.4+ / Firefox 121+
- `overflow: clip`（`#g-viewport` 防焦点滚动）—— Chrome 90+ / Safari 16+ / Firefox 81+
- `AbortController` + `fetch`（opener 超时）—— 现代浏览器均支持

SVG 用 `viewBox`，无兼容问题。**优先级**：低（公司内网通常是 Chrome/Edge）。

---

## 4. 无 DOM 级自动化测试

`node --check` 只查语法。2026-10-09 适配时做过**一次性**浏览器自动化冒烟（本地 HTTP 伺服
生成物，逐项检查五卡/行展开/⌘K/抽屉全字段/Graph 展开计数/维度分组/Build 变体/opener 兜底），
但没有沉淀成可重复运行的脚本（旧仓库的 `tests/mock_dom_test.js` 未迁移，目录已不存在）。
回归目前靠 workflow.md §4 手测清单 + payload 等价对比。

**修复思路**：把当日的冒烟步骤写成 Playwright 脚本入库，或至少把 payload 等价对比做成
`python tools/check_payload.py`。

**优先级**：中（改动频繁时价值上升）。

---

## 5. 设计稿与生产模板开始分叉

`design/homepage.html` 已退为视觉参照（生产模板在 `src/dashboard_generator/assets/`），
但 `.zcode/mockup_build.py` 仍在维护它。此后前端的真实改动只会发生在 assets/，设计稿会
**静默过期**——将来按设计稿排查问题时要先确认它是否还反映现状。

**修复思路**：设计定稿后归档设计稿（顶部加"已由生产模板取代"横幅），或让 mockup_build
直接消费生产模板。

**优先级**：低（知道即可）。

---

## 6. 仓库卫生：无 .gitignore + 遗留跟踪的 .pyc

`packaging/build/`、`packaging/dist/`、`packaging/*.spec`、`__pycache__/` 每次构建后都以
未跟踪噪音出现在 `git status`；`src/__pycache__/` 是历史遗留的**已跟踪** .pyc（AGENTS.md 已
提醒别再新增提交）。加 .gitignore 前先与用户确认（AGENTS.md 约定）。

**优先级**：低（纯卫生）。

---

## 7. 表格列拖拽重排无键盘可达性（2026-10-09，#43）

列重排目前只有 HTML5 DnD（鼠标/触摸）；键盘用户无法重排列。备选方案：Columns 菜单里给每列加
左右移按钮，或 th 上加 `Alt+←/→` 快捷键。公司内网桌面场景优先级低。

---

## 附：旧条目核销记录（2026-10-09 随渲染链路重写）

| 旧条目 | 结局 |
|---|---|
| #1 app.js CLOSED_STATES 旧口径 | 重写后 open/closed 由 payload 实体旗标 + `aggregations.closed_states`（含 `ALM_Completed`）决定，前端不再自持状态集 |
| #2 html_template `{{DATE_RANGE}}` 死代码 | 已删（重写后的 html_template 无占位符） |
| #3 Hero chart 孤岛 segment | 模块已不存在（旧 ProjectStateChart 未移植） |
| #4 date-range 年份 select | 交互已不存在（新看板无日期区间过滤） |
| #5 未实现功能表（Plan 时代） | 全部随新 IA 取代或仍明确不做（见 dashboard-content.md §8） |
| #6 数据/DB 限制（ra_op 时间、CR/build 孤岛、closure_rate 双口径） | 旧库特有；新库口径以 dashboard-content.md §1.3/§7 为准 |
| #7 Plan/ 目录与代码不同步 | `Plan/` 目录已不存在 |
| #9 Target 卡尾零显示 | 卡片已不存在 |
