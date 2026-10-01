# ReadAcross Dashboard — Handoff

> 单文件自包含 HTML dashboard，把 `src/output/dashboard.db`（PTC Integrity / Windchill RV&S 导出）的 5 层 ALM 数据转成可视化看板。

## 1. 一句话命令

```bash
cd D:\Users\yixiao\Documents\GitHub\ReadAcross_Dashboard
python src/generate_dashboard.py --open
```

- 读 `src/output/dashboard.db` → 计算 aggregations → 写 `dashboard.html`（约 700 KB）→ 浏览器打开
- 加 `--out path.html` 指定输出位置
- 双击 `dashboard.html` 离线可用，零外部依赖

## 2. 当前状态（2026-09-27）

**已交付**

| 模块 | 状态 | 文件 |
|---|---|---|
| 数据加载 (6 表 + 5 类边) | ✅ | [src/dashboard_generator/data_loader.py](../src/dashboard_generator/data_loader.py) |
| 聚合（13 个函数） | ✅ | [src/dashboard_generator/aggregations.py](../src/dashboard_generator/aggregations.py) |
| HTML 模板 + 内联 | ✅ | [src/dashboard_generator/html_template.py](../src/dashboard_generator/html_template.py) + [assets/](../src/dashboard_generator/assets/) |
| CLI 入口 | ✅ | [src/generate_dashboard.py](../src/generate_dashboard.py) |
| Sidebar + Topbar | ✅ | template.html |
| Topbar 全局搜索（6 类实体下拉面板 + ⌘K + Details 定位） | ✅ | app.js `TopSearch` 模块 |
| 页面路由（Overview / Details / Projects） | ✅ | app.js `Pages` 模块 |
| Summary 4 KPI + 日期区间过滤 | ✅ | app.js `Summary` 模块 |
| Target (CHILD OP / CHILD CR 关闭率) | ✅ | app.js `Target` 模块 |
| Hero chart (Open/Closed + 钻取) | ✅ | app.js `ProjectStateChart` 模块 |
| Details（RA-OP → Child OP → Child CR 三层展开表 + 状态筛选） | ✅ | app.js `DetailsTable` 模块 |
| 详情抽屉（右侧滑出，RA-OP / Child OP / Child CR 三种实体） | ✅ | app.js `DetailsDrawer` 模块 |
| Projects 节点树（横向三层图谱 + 筛选/搜索/缩放平移/展开动效） | ✅ | app.js `ProjectTree` 模块 |
| 浅色主题 | ✅ | styles.css（无 dark 关键字） |
| PyInstaller 打包（免 Python 环境的 3 个 exe → Release/） | ✅ | [packaging/build.py](../packaging/build.py)，用法见 [workflow.md §7](workflow.md#7-打包-exepyinstaller) |

**不在本轮**

- 原地展开下钻（drilldown 子看板）
- 深色模式切换
- 多主题 / i18n

## 3. 文档索引

| 文件 | 内容 |
|---|---|
| [architecture.md](architecture.md) | 数据流 / 模块依赖图 / 关键设计决策 |
| [file-map.md](file-map.md) | 每个文件的职责 + 关键函数清单 |
| [workflow.md](workflow.md) | 重新生成 / 浏览器手测 / Node 单元测试 / 自检脚本 |
| [data-contract.md](data-contract.md) | `__PAYLOAD__` 结构 / aggregation 输出契约 |
| [ui-components.md](ui-components.md) | 三个视图（Overview / Details / Projects）+ 抽屉的语义、数据源、交互 |
| [known-issues.md](known-issues.md) | 已知 bug / 口径差异 / TODO / 口径待确认 |
| [extension-points.md](extension-points.md) | 加新卡 / 加新聚合 / 加新过滤器 |

## 4. 设计一句话

参考 [Reference/f4438fa28eb44c511490ccad504c6c23.jpg](../Reference/f4438fa28eb44c511490ccad504c6c23.jpg)（Jajanken Ltd. 浅色 SaaS 单页 dashboard）做的：
左侧 240px 导航 + 顶部 68px 搜索栏；Overview 是 8/4 + 12 网格，Details 与 Projects 是全宽卡片视图（`Pages` 模块切换）。所有数字从 `aggregations.*` 取，0 硬编码。

## 5. 数据规模（DB manifest）

```
ra_op (106) → parent_op (108)
            → child_op (657) → delivery (178)
                              → change_request (713) → build (370)
```

## 6. 关键口径

- **Open / Closed 业务分类**（参考最新业务 spec）：
  - **Open** = Initiated / Defined / Analysed / Checked / Started / Planned
  - **Closed** = Closed / Realized / Approved / Rejected / Cancelled（已 dispositioned 即算 closed）
- **RA-OP 时间**：DB 的 `ra_op` 表已有 `created_date` 列。`compute_ra_op_time()` 优先取 created_date，缺失（旧库）时回退为子树内 `min(target_date)`（5 层链路：ra_op → child_op → delivery / change_request → build）。当前 106/106 全有时间。
- **日期过滤**：页头右上日期区间双 input（`#date-from` / `#date-to`，ISO 字符串比较，起点晚于终点自动交换）。改变时 **Summary、Details 表、Projects 树**实时重渲染；**Hero chart / Target 不级联**（保持全量视角）。清空按钮 `#date-clear` 恢复全量。

## 7. 接下来的工作

看 [extension-points.md](extension-points.md) 与 [known-issues.md](known-issues.md)。当前最值得做的：

1. ~~**统一 app.js 内置 CLOSED_STATES 口径**~~（✅ 已修复，2026-09-27——boot 以 `agg.closed_states` 覆盖，见 [known-issues.md §1](known-issues.md#1-appjs-内置-closed_states-旧口径与-aggregations-不一致已修复-2026-09-27)）
2. **让 Hero chart / Target 也级联日期过滤**（[extension-points.md §4](extension-points.md#4-让其他卡片级联日期过滤)）——Details 与 Projects 树已级联
3. **删 html_template.py 里的死代码**（[known-issues.md §2](known-issues.md#2-html_templatepy-残留死代码)）
4. **E2E 校验脚本**（plan 07 提到的，**未做**——用 workflow.md 里的 inline 命令替代；单测已固化为 [tests/mock_dom_test.js](../tests/mock_dom_test.js)）
5. **README 章节（HTML dashboard 用法）**（plan 07 提到，如果要给同事用，先补这个）