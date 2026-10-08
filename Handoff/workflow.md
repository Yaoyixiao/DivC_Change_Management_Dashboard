# Workflow

> **状态（2026-10-07）**：渲染链路（`src/dashboard_generator/`）尚未适配新 ECR 库——
> `generate_dashboard.py` 对当前 `src/output/dashboard.db` 必报错（`no such table: ra_op`），属预期。
> 本文区分「现在就能跑」与「旧 RA-OP 看板遗留（适配时重写）」两部分。
> 内容与口径依据见 [dashboard-content.md](dashboard-content.md)。

## 1. 现在就能跑的命令

```bash
cd D:\Users\yixiao\Documents\GitHub\DivC_Change_Management_Dashboard

python src/selftest_fetch.py             # 取数链路回归（离线假数据，改 fetch 链后必跑）
python src/generate_dashboard.py --open  # 渲染 dashboard.html —— 对新库当前必报错（见状态）
python src/generate_dashboard.py --serve # 渲染后启动 PTC opener 服务（见 §2）
python .zcode/mockup_build.py            # 重建设计稿数据（见 §2.3）
python packaging/build.py --smoke        # 打包 4 exe（见 §3）
```

### 1.1 generate_dashboard.py 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--db PATH` | `src/output/dashboard.db` | sqlite 路径 |
| `--out PATH` | `./dashboard.html`（frozen：exe 目录） | 输出路径 |
| `--open` | False | 生成后用默认浏览器打开 |
| `--serve` | False（frozen 双击 exe 时自动等效于 True） | 渲染后启动 opener 服务，阻塞至 Ctrl+C |

当前对真实库运行会在 `[1/3] Loading payload` 抛 `sqlite3.OperationalError: no such table: ra_op`
——data_loader 仍读旧 RA-OP 六表，新库是 items/edges/metadata 三表。

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

`--smoke` 两层自检：① 用 `src/output/dashboard.db` 喂 GenerateDashboard.exe、断言 payload
与自包含性；② 取数链在 numpy 屏蔽下跑 selftest_fetch（模拟 exe 无 conda 环境）。

**⚠️ 冒烟有两处旧口径/坏引用，适配落地时一并修**：① 里硬编码的 RA-OP counts（106/108/657/…）
与新库不符，需换成新 payload 断言；② 引用的 `packaging/selftest_fetch.py` 当前**不存在**
（应为 `src/selftest_fetch.py` 或把副本落到 packaging/），现状跑 `--smoke` 第二步必失败。

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

## 4. 渲染链路适配后的验证流程（适配时按新 dashboard 重写细则）

通用的不变项：

1. **自包含校验**：生成的 HTML 无任何自动加载的外部资源——`Network` 面板 0 请求；或正则扫
   `<script|link|img|iframe …>` 的 `src/href` 不得含 `http(s)://`（用户点击的 `<a href>` 导航
   除外，`w3.org` SVG 命名空间除外）。`packaging/build.py smoke()` 里的正则可直接复用。
2. **JS 语法**：`node --check src/dashboard_generator/assets/app.js`（只查语法不查逻辑）。
3. **聚合基线**：无过滤时五卡数值必须与 payload 全量聚合逐值一致（dashboard-content.md §3.1
   的自检口径）；对照 `design/homepage.html` 的 `collectScoped()`。
4. **浏览器手测**：按 dashboard-content.md 的信息架构（Home 五卡联动 / 表格树形 / 列筛选 /
   嵌套排序 / ⌘K 定位 / Graph）重写清单；可参考下方 §6 旧清单的纪律（键盘集、空态、
   断网自包含、冲突筛选复位等维度）。
5. **打包冒烟**：`packaging/build.py --smoke`（断言先换成新口径）。

### 4.1 Graph 原型手测清单（graph-view 分支，design/homepage.html；2026-10-07 实测通过）

1. **rail 切换**：Graph 点亮指示器；Home/Graph 往返，Home 表格无损、Graph 展开态持久
   （keyed）；print 时自动回退 Home（图布打印为空白）。
2. **默认全折叠（#34）**：仅 10 张 ECR 卡；画布小于视口时垂直居中；右缘按钮显直接下级数、
   悬停换 +、展开后 −。
3. **逐层展开**：第二列 WI/Action/Build 混排（色点/徽章 CR 绿·Task 黄·WP 蓝·Action 橙·Build 紫），
   ECR→L0→L1→L2 最多 4 列；父卡顶对齐不动、子级向下推开、连线随动效出现/收回。
4. **节点点击（#37）**：仅选中高亮（再点取消、点空白清除），不进抽屉。
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
11. **进度环（#40，2026-10-08 实测通过）**：右上角环 = display effort 占当前挂靠 ECR rollup 的
    百分比——ECR 恒满环（tooltip 显总量）；子项 10–99% 环内显整数、<10% 只看弧；缺 effort 留白
    （Build/大部分 Action/部分 WI）；真实 0 = 空环 + tooltip "0%"；**共享实体分母随挂靠父变**
    （搜索过滤掉主 ECR 后 `10637012` 从 "0 of 40" 变 "0 of 212"）；tooltip 显 "N of M · P%"。

## 5. 调试技巧

```js
// 浏览器控制台看 payload（渲染链路适配后字段名以 data-contract 信封形状为准）
console.table(window.__PAYLOAD__.aggregations.kpis);
console.log(window.__PAYLOAD__.meta);
```

- DevTools Network 面板应**完全空**（0 请求）——否则就不是自包含。
- opener 单测：curl `http://127.0.0.1:8766/health` 应返回 `opener ok`。

## 6. 旧 RA-OP 看板遗留（适配前仅供参考，适配时重写/删除）

以下为旧看板（Overview/Details/Projects 三视图 + RA-OP 六表）时代的验证资产。结构上
`src/dashboard_generator/` 现仍与之对应（Summary / Target / ProjectStateChart / DetailsTable /
ProjectTree / DetailsDrawer / TopSearch 等模块），故保留作参照；数据规模、口径、页面清单
一律以 dashboard-content.md 为准。

### 6.1 自检脚本（正则骨架可复用，counts 是旧口径）

```bash
python -c "
import re, pathlib, json
html = pathlib.Path('dashboard.html').read_text(encoding='utf-8')
externals = [m for m in re.findall(r'(?:src|href)\s*=\s*\"https?://[^\"]+\"', html, re.I) if 'w3.org' not in m]
assert not externals, f'external refs: {externals}'
m = re.search(r'window\.__PAYLOAD__\s*=\s*(\{.*?\});\s*</script>', html, re.DOTALL)
p = json.loads(m.group(1))
# TODO(适配): counts/keys 换成新 payload 口径
print(f'OK · size = {len(html):,} bytes')
"
```

### 6.2 浏览器手测清单（旧看板）

**Overview 页**：不闪退、Console 干净；Summary 4 KPI 与文档一致；Target 卡关闭率与口径一致；
Hero chart Open/Closed 钻取往返、项目柱横向滚动。

**Details 页**：分页 PAGE_SIZE=15 + Show more；三层展开（RA-OP → Child OP → Child CR）；
状态筛选 All/Open/Closed；Expand/Collapse all；行尾 `>` 开抽屉，Esc / 遮罩可关。

**Projects 页**：默认全折叠、计数按钮展开、子级淡入连线同步；卡片点开抽屉；搜索命中保留
完整子树 + 蓝框；Expand all 不卡死；拖拽平移 / 滚轮缩放 / −/100%/+ 控件；空态提示。

**通用**：`Ctrl+K` / `⌘K` 聚焦搜索，分组下拉 + `<mark>` 高亮 + ↑↓/Enter 键盘集 + Esc 分层
（先关面板再清词）；搜索定位（Build → 反查关联 CR → 展开祖先链 + toast）；被日期过滤遮蔽的
定位目标自动清过滤并 toast；断网刷新完整可用（0 请求）。

## 7. 已知命令问题

- **Windows console (cp1252) 不能 print Unicode**：`✓ → — ↑` 等会触发 `UnicodeEncodeError`。
  CLI 里只用 ASCII（模板/前端内不受限）。
- **Node `--check` 只查语法**，不查逻辑；目前无 DOM 级单测（旧仓库的 mock DOM 脚本未随
  ECR 改版迁移，适配时可考虑按新模块重建）。
