# Workflow

> **状态（2026-10-09）**：渲染链路（`src/dashboard_generator/`）已适配新 ECR 库并在
> `render-pipeline` 分支落地——`generate_dashboard.py` 对 `src/output/dashboard.db`
> 正常出网页，`packaging/build.py --smoke` 两层冒烟全过。
> 设计原型（`design/homepage.html`）已完成历史使命，此后生产模板以
> `src/dashboard_generator/assets/` 为准；数据/口径依据见 [dashboard-content.md](dashboard-content.md)。

## 1. 现在就能跑的命令

```bash
cd D:\Users\yixiao\Documents\GitHub\DivC_Change_Management_Dashboard

python src/selftest_fetch.py             # 取数链路回归（离线假数据，改 fetch 链后必跑）
python src/generate_dashboard.py --open  # 渲染 dashboard.html 并用默认浏览器打开
python src/generate_dashboard.py --serve # 渲染后启动 PTC opener 服务（见 §2）
python .zcode/mockup_build.py            # 重建设计稿数据（见 §2.3，仅维护设计参照用）
python packaging/build.py --smoke        # 打包 4 exe + 两层冒烟（见 §3）
```

### 1.1 generate_dashboard.py 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--db PATH` | `src/output/dashboard.db` | sqlite 路径 |
| `--out PATH` | `./dashboard.html`（frozen：exe 目录） | 输出路径 |
| `--open` | False | 生成后用默认浏览器打开 |
| `--serve` | False（frozen 双击 exe 时自动等效于 True） | 渲染后启动 opener 服务，阻塞至 Ctrl+C |

输出单文件自包含 HTML（约 590KB：内嵌 Inter + 全字段 items 映射 + graph payload），
payload 信封：`window.__PAYLOAD__ = {data: {ecrs, builds, items}, graph, aggregations, meta}`。
data_loader 会校验 items 表必需列，指向旧库/错库时报明确的英文错误。

### 1.2 设计稿数据重建（.zcode/mockup_build.py）

会话工具，不属于流水线：读 `src/output/dashboard.db` 真实快照 → 组装 payload → 原地替换
`design/homepage.html` 的 `const DATA = …;` 单行（设计稿上的手工编辑保留，可重复跑）；
首次运行会把 `src/dashboard_generator/assets/fonts.css` 的 Inter base64 注入 `/*__FONTS__*/`
占位。真实取数后重跑一次即可让设计稿数据保鲜。

## 2. PTC opener 服务

dashboard 里的 ID 链接不直接用 `integrity://`——浏览器层会被 Mimecast URL 重写拦截。
页面改为 fetch 本地服务 `http://127.0.0.1:8766`，由它调 `cmd /c start`（Windows ShellExecute）
派发协议，OS 层不受浏览器扩展影响。

| 入口 | 用法 |
|---|---|
| `python src/generate_dashboard.py --serve` | 渲染 + 启动 opener（组合） |
| `python src/opener_only.py` | 只启动 opener（dashboard 已生成的场景） |
| `GenerateDashboard.exe`（frozen） | 双击即渲染 + 启动 opener（`__main__` 默认追加 `--serve`） |
| `IntegrityOpener.exe`（frozen） | 独立 opener，给"网页已有、opener 不在线"场景 |

端点：`GET /health` → 200 "opener ok"；`GET /open?url=<URL>` → ShellExecute，200/400/500。
带 CORS 头（dashboard.html 通常在另一 origin）。opener 离线时前端弹英文 modal 兜底。
改端口/端点时 `dashboard_opener.py` 与前端调用两侧同步。

## 3. 打包 exe（PyInstaller）

```bash
python packaging/build.py --smoke
```

产物在 `Release/`（构建产物，不入库；本机构建后拷给同事）：

| exe | 入口 | 作用 |
|---|---|---|
| `UpdateDatabase.exe` | src/fetcher.py | PTC `im` 取数 → `output\` 四件套（需 PTC 客户端 + 内网） |
| `GenerateDashboard.exe` | src/generate_dashboard.py | 读 `output\dashboard.db` → `dashboard.html` 并启动 opener |
| `IntegrityOpener.exe` | src/opener_only.py | 只启动 PTC opener 服务（127.0.0.1:8766） |
| `UpdateAll.exe` | src/update_all.py | 一键 = 先取数再出网页并自动打开 |

`--smoke` 两层自检（2026-10-09 起为新口径）：① 用 `src/output/dashboard.db` 喂
GenerateDashboard.exe，**期望计数动态读自 `dashboard_manifest.json`**（counts +
relationship_counts；真实取数更新快照后无需改断言），并断言 aggregations 键齐全、
`ALM_Completed ∈ closed_states`、`meta.generated_at`、自包含正则；② 取数链在 numpy
屏蔽下跑 `src/selftest_fetch.py`（模拟 exe 无 conda 环境；旧版错引
`packaging/selftest_fetch.py` 的坏路径已修复）。

关键实现点（改动时别破坏）：

- **frozen 路径**：`config.py` 的 `BASE_DIR` 与 `generate_dashboard.py` 的 `ROOT` 在 `sys.frozen`
  时以 exe 所在目录为基准（onefile 的 `__file__` 在临时解压目录，退出即删）。frozen 时 fetch 链
  输出到 `exe目录\output\`，dashboard 链默认读写同目录，exe 放同一文件夹即零参数联动。
- **体积**：openpyxl 对 numpy/PIL 是可选 try-import，PyInstaller 会把 anaconda 的整套 Intel MKL
  打进去；build.py 的 `EXCLUDES` 排除了它们（取数链只需纯 Python 的 openpyxl/xlrd）。
- **控制台**：三个入口 `__main__` 都有 try/except + `exe_utils.pause_if_frozen()`（结束停留）+
  `make_streams_tolerant()`（cp1252 不可编码字符替换为 `?`）；CLI 输出 ASCII-only。
- **`src/update_all.py`**：复用 fetcher / generate_dashboard 的 `main()`，通过改写 `sys.argv`
  传 `--open`，不复制流水线逻辑。

同事机器前提详见 `packaging/使用说明.md`（构建时随 exe 拷贝）：UpdateDatabase/UpdateAll 需要
PTC 客户端（`im` 在 PATH）+ 内网 + 已缓存凭据；GenerateDashboard / IntegrityOpener 零依赖。

## 4. 渲染链路验证流程（2026-10-09 适配落地，当日自动化冒烟全过）

通用不变项：

1. **自包含校验**：生成的 HTML 无任何自动加载的外部资源——`Network` 面板 0 请求；或正则扫
   `<script|link|img|iframe …>` 的 `src/href` 不得含 `http(s)://`（用户点击的 `<a href>` 导航
   除外，`w3.org` SVG 命名空间除外）。`packaging/build.py smoke()` 里的正则可直接复用。
2. **JS 语法**：`node --check src/dashboard_generator/assets/app.js`（只查语法不查逻辑）。
3. **聚合基线**：无过滤时五卡数值必须与 payload `aggregations` 逐值一致
   （counts / plannedTotal / actualTotal / byProcessArea / byTeam，dashboard-content.md §3.1
   的自检口径）；控制台可用 `collectScoped(DATA.ecrs)` 对照 `DATA.agg`。
4. **payload 等价**（换库 / 改 data_loader 后）：生成 HTML 的 `__PAYLOAD__` 与
   `design/homepage.html` 注入的 DATA/GRAPH 逐值对比应零差异（`overdue` 除外——生产前端自算，
   设计稿是构建期烘焙）。
5. **打包冒烟**：`packaging/build.py --smoke`（断言动态对照 manifest，见 §3）。

### 4.1 Home 手测清单（适配当日已做自动化冒烟，人工完整过一遍）

1. **首屏**：console 0 error；10 行 ECR；五卡有值且与 aggregations 一致（Totals 10/129/24、
   Effort planned/actual、PA 降序 Other 沉底、Team Top5+Other、Timeline 全部 ECR 事件）。
2. **行展开**：行点击展开 WI 树 + Action 内联子行（共享列、ID 列树形参考线）；展开态 keyed
   持久；叶子行无 chevron。
3. **t-filter**：命中后代内容保留父 ECR + 自动展开命中链 + accent 高亮；清词恢复手动展开态；
   五卡随结果集重算 + scope hint "Cards reflect N of M ECRs" + Clear filters。
4. **状态分段** All/Open/Closed；**列筛选** Excel 式（值搜索 / 三态全选 / 值行计数 /
   (Blanks) 沉底 / facet 语义 / 树存活语义）。
5. **嵌套排序**：ECR 间与同层子行同列同向递归、缺值沉底、父位置仅由自身值决定。
6. **⌘K**：输入即预览（分组 + 计数 + 每组 ≤5 + `<mark>`），选中 = 重置冲突筛选 → 展开父链 →
   flash；Esc 先关面板再清词；ARIA combobox/listbox。
7. **详情抽屉**：detail 按钮打开；**全字段分组** Core / Dates / Effort & Durations / Review /
   Links / Relations（review 两个 Date Ref 已按 1899-12-30 epoch 转 ISO；配置将来新增的列落入
   More 组）；Build 变体无 Effort 段、Core 含 Maturity；关系行就地导航 + 共享 chip；宽度拖拽
   会话记忆；Esc / scrim 关闭并返还焦点。
8. **opener**：点表格 ID 或抽屉 "Open in PTC" → opener 在线时唤起 PTC 客户端；离线弹英文
   modal（提示启动 GenerateDashboard.exe / IntegrityOpener.exe）。
9. **导出 Excel**：范围 = 当前表格（状态 + 文本 + 列筛选 + 排序 + 可见列），始终全展开，
   带 outline 层级。
10. **overdue**：表格 Overdue 列与抽屉徽标均为前端自算（`planned_completion_date <
    generated_at` 且 OPEN；Action 恒空）；DB overdue_* 列不参与。
11. **排序/展开动效（#42）**：点表头排序、行展开/收起、全部展开/收起时存活行平滑滑到新位置
    （进/出行直接出现）；`prefers-reduced-motion` 下无动效直接跳变。
12. **列拖拽重排（#43）**：拖任意数据列表头到新位置（accent 指示线跟随）；chev 恒首位、
    detail 恒末位（拖到其上钳制到首/末数据位）；表头 / 表体 / Columns 菜单 / edge 尾列 /
    Excel 导出列序全部一致；拖拽中源表头半透明；漏斗按钮与排序点击不受拖拽影响。
13. **表头展开收起钮（#44）**：chevron 表头按钮一次点击全展开（10 → 166 行，含共享 WI 的
    重复行；Build 不进表格）、再点收起回 10 行；图标/aria-label 随下一个动作切换；过滤激活时
    只作用于过滤可见集；无可展开行时禁用。
14. **视图往返** Home/Graph 各自状态持久；print 自动回退 Home；断网 / file:// 双击可用
    （0 外部请求）。

### 4.2 Graph 手测清单（原型 2026-10-07/08 实测通过；适配产物同口径适用）

1. **rail 切换**：Graph 点亮指示器；Home/Graph 往返，Home 表格无损、Graph 展开态持久
   （keyed）；print 时自动回退 Home（图布打印为空白）。
2. **默认全折叠（#34）**：仅 10 张 ECR 卡；画布小于视口时垂直居中；右缘按钮显直接下级数、
   悬停换 +、展开后 −。
3. **逐层展开**：第二列 WI/Action/Build 混排（色点/徽章 CR 绿·Task 黄·WP 蓝·Action 橙·Build 紫），
   ECR→L0→L1→L2 最多 4 列；父卡顶对齐不动、子级向下推开、连线随动效出现/收回。
4. **节点点击**：卡片正文点击开抽屉（#39，取代早期"仅选中高亮"的 #37 行为；见第 10 条）。
5. **节点内搜索**（如 `NIO`）：命中卡 accent 描边、命中分支强制展开、非命中分支剪枝；
   **计数徽标随筛选联动**——keyed 复用下 stale toggle 是回归点（kidCount 归零后按钮必须消失）。
6. **状态分段**：树语义（自身匹配或任一后代存活则可见）；Open ≈ 11/168、Closed ≈ 167/168
   （随快照浮动）；Expand all / Collapse all 作用于当前可见集。
7. **共享实体（#35）**：全展开应见 **168 节点 / 164 边 = 158 实线 + 6 虚线跨列边**；共享卡带
   `×N` 芯片（含被 4 个 ECR 共享的 Build `4×`）；跨列边随引用父折叠而消失。
8. **pan/zoom**：空白处拖拽平移、wheel 缩放、右下 −/100%/+；平移钳制不拖飞；file:// 双击打开
   离线可用（零外部请求）。
9. **可达性**：`prefers-reduced-motion` 下无过渡动效；toggle 键盘聚焦带回视野（reveal）。
10. **节点抽屉（#39，2026-10-08 实测通过）**：卡片正文点击开抽屉，源节点带锚点环（随关系导航
    跟随、Esc/✕ 关闭即消、焦点返还触发卡）；**Build 变体**无 Effort 段、Core 含 Maturity；
    共享 Build `10725430` Relations = 4 个父 ECR + "shared · 4 ECRs" 芯片；共享 WI（如
    `10637012`）显示 2 父。**图内关系导航**：点关系行 = 展开主父链 + 卡片 flash + 抽屉原地换
    内容 + 锚点随移，Home 表格不受影响；Home 内抽屉行为回归（detail 按钮/表格同步不变）。
11. **进度环（#40，2026-10-08 实测通过；同日修正 ECR 根卡）**：子卡右上角环 = display effort 占
    当前挂靠 ECR rollup 的百分比——10–99% 环内显整数、<10% 只看弧；缺 effort 留白
    （Build/大部分 Action/部分 WI）；真实 0 = 空环 + tooltip "0%"；**共享实体分母随挂靠父变**
    （搜索过滤掉主 ECR 后 `10637012` 从 "0 of 40" 变 "0 of 212"）；tooltip 显 "N of M · P%"；
    **ECR 根卡不画环**，右上角显 rollup 总量数字（tooltip "N planned effort (ECR total)"）。
12. **维度展开（#41，2026-10-08 实测通过）**：ECR 卡内 Team / Process Area chips 三模式互斥切换
    （维度激活时结构钮隐藏，回退后手动结构展开态恢复）；组卡 = 同尺寸中性卡（组名 / effort 数 /
    占比条 / WI 计数），effort 降序 Other 沉底；组卡 body 或 ± 再展开组内 WI 实体卡（被 claim
    成员虚线跨边；环分母仍 ECR rollup）；搜索命中组名（如 `systemtesting`）强制展开该组；
    Expand/Collapse all 覆盖组卡；nodeH 探针 = 带 chips 的 ECR 卡（最高闭合形态）。

## 5. 调试技巧

```js
// 浏览器控制台看 payload（新信封：data/graph/aggregations/meta）
console.table(window.__PAYLOAD__.aggregations.counts);
console.log(window.__PAYLOAD__.meta);
console.log(window.__PAYLOAD__.graph.nodes.length);
```

- DevTools Network 面板应**完全空**（0 请求）——否则就不是自包含。
- opener 单测：curl `http://127.0.0.1:8766/health` 应返回 `opener ok`。

## 6. 旧 RA-OP 看板遗留（已随适配移除）

旧看板（Overview/Details/Projects 三视图 + RA-OP 六表）的验证资产已随 2026-10-09 的适配
淘汰：`src/dashboard_generator/` 的 template/styles/app.js 已整体替换为新设计（原文件在
git 历史中仍可查）。自检正则骨架已并入 §4 不变项 1/5；旧三页手测清单作废，纪律维度
（键盘集、空态、断网自包含、冲突筛选复位）已吸收进 §4.1。

## 7. 已知命令问题

- **Windows console (cp1252) 不能 print Unicode**：`✓ → — ↑` 等会触发 `UnicodeEncodeError`。
  CLI 里只用 ASCII（模板/前端内不受限）。
- **Node `--check` 只查语法**，不查逻辑；目前无 DOM 级单测。2026-10-09 适配时用本地 HTTP
  + 浏览器自动化做过一轮功能冒烟（五卡/表格/抽屉/Graph/opener 兜底），回归时可复用该思路。
