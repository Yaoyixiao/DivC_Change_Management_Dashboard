# Workflow

## 1. 生成 dashboard.html

```bash
cd D:\Users\yixiao\Documents\GitHub\ReadAcross_Dashboard
python src/generate_dashboard.py --open
```

期望输出：
```
[1/3] Loading payload from ...dashboard.db
      counts: {'ra_ops': 106, 'parent_ops': 108, 'child_ops': 657, ...}
[2/3] Computing aggregations ...
[3/3] Writing dashboard.html ...
      OK D:\...\dashboard.html  (700.8 KB)
```
（默认浏览器打开）

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--db PATH` | `src/output/dashboard.db` | sqlite 路径 |
| `--out PATH` | `./dashboard.html` | 输出路径 |
| `--open` | False | 生成后用默认浏览器打开 |

## 2. 自检脚本（推荐每次提交前跑）

```bash
cd D:\Users\yixiao\Documents\GitHub\ReadAcross_Dashboard
python -c "
import re, pathlib, json
html = pathlib.Path('dashboard.html').read_text(encoding='utf-8')

# 1) 自包含：无外链
externals = [m for m in re.findall(r'(?:src|href)\s*=\s*\"https?://[^\"]+\"', html, re.I) if 'w3.org' not in m]
assert not externals, f'external refs: {externals}'

# 2) payload 完整且 counts 对得上
m = re.search(r'window\.__PAYLOAD__\s*=\s*(\{.*?\});\s*</script>', html, re.DOTALL)
p = json.loads(m.group(1))
counts = {k: len(p['data'][k]) for k in ['ra_ops','parent_ops','child_ops','deliveries','change_requests','builds']}
assert counts == {'ra_ops':106,'parent_ops':108,'child_ops':657,'deliveries':178,'change_requests':713,'builds':370}, counts

# 3) aggregation keys 全在
for k in ['kpis','opened_closed_rates','state_distributions','project_distributions',
          'build_maturity','delivery_timeline','build_target_timeline','owner_rank','team_rank',
          'child_op_by_project_state','ra_op_time','state_colors','node_colors','maturity_colors',
          'open_states','closed_states']:
    assert k in p['aggregations'], k

# 4) 无 dark / CDN 痕迹
assert 'prefers-color-scheme' not in html
assert 'data-theme' not in html

print(f'OK · size = {len(html):,} bytes')
"
```

## 3. Node 单元测试 —— 模拟 DOM 跑 render 模块

测试脚本已固化为 `tests/mock_dom_test.js`（模拟 DOM 的 `El` 类 + 全部用到的元素 id，
eval app.js 后对 render 模块与 TopSearch 做断言）。每次改动后运行：

```bash
cd D:\Users\yixiao\Documents\GitHub\ReadAcross_Dashboard
node --check src/dashboard_generator/assets/app.js && echo SYNTAX_OK
node tests/mock_dom_test.js
```

脚本覆盖：既有回归（Summary KPI / Target / Details 分页 / ProjectTree 搜索）、
TopSearch 搜索与分组排序、面板渲染（分组头 / `<mark>` 高亮 / 空状态 / aria）、
跳转定位（RA-OP 直达；Build → edges 反查关联 Child CR 并展开祖先链 + toast）、
冲突过滤自动重置（状态过滤复位 all；日期遮蔽时清空日期并 toast）、
无关联链返回 `found:false`、CLOSED_STATES 以 `agg.closed_states` 覆盖。

新增页面元素后，把 id 追加进脚本顶部的 `ids` 数组（缺失会被 app.js 的
try/catch 吞掉，难以发现问题）；新交互在文件尾部追加断言即可。

## 4. 浏览器手测清单（每次大改后跑一遍）

**Overview 页**

1. 打开 `dashboard.html`，**不闪退、不报错**（DevTools Console 干净）
2. Summary 4 KPI = 106 / 657 / 533 / 271，trend pill 为 `—`
3. Target 卡：CHILD OP closure 64.4%，CHILD CR closure 99%（文档口径 99.0%，见 known-issues）
4. Hero chart 默认 2 段（Open 琥珀 + Closed 绿）；点 Open pill 钻取 → `← Open / Closed` 返回 → 点 Closed 钻取 → 返回；37 根项目柱可横向滚动

**Details 页**

5. 侧栏切 Details：表头计数 `15 of 106 RA-OPs`（分页 PAGE_SIZE=15，Show more 递增）
6. 展开任一 RA-OP → Child OP 行 → 再展开 → Child CR 行（三层缩进）
7. 状态筛选 All / Open / Closed 计数变化（open = 有未闭环 child OP；closed = 有子级且全闭环）
8. Expand all / Collapse all 正常；行尾 `>` 按钮打开右侧抽屉（RA-OP / Child OP / Child CR 三种），Esc / 遮罩可关

**Projects 页**

9. 侧栏切 Projects：默认 106 个 RA-OP 根节点全部折叠，展开按钮上显示下一级数量（无子级的 12 个无按钮）
10. 点数量按钮展开 → 子级自父级方向淡入、父节点保持原位（与第一个子级顶对齐）、连线同步出现；再点 − 收起淡出
11. 悬停收起按钮：数字换 `+`；展开后显示 `−`
12. 点卡片正文 → 右侧抽屉打开对应实体
13. 状态筛选 + 页内搜索（如输入 `9247617`）→ 只剩命中 RA-OP 及其**完整子树**（1 ra + 5 op + 5 cr），命中卡片蓝框；清空恢复 106
14. Expand all（约 1296 节点）/ Collapse all 不卡死；拖拽平移、滚轮缩放、右下 −/100%/+ 控件正常；筛选到空集时出现空态提示
15. 全局日期区间（如 2024-08-01 ~ 2024-08-31）→ Summary、Details、Projects 树同步过滤；清空恢复

**通用**

16. **顶部搜索**：任意视图按 `Ctrl+K` / `⌘K` → 焦点落搜索框；输入 `814` → 下拉面板按 RA-OP / Child OP / Child CR / Build / Delivery / Parent OP 分组、命中文字高亮；↑↓ 移动选中、Enter 跳转；输入乱串 → "No results" 空态；Esc / 点击面板外关闭
17. **搜索定位**：点某个 Build 结果 → 切到 Details 视图、关联 Child CR 行滚动到视野中央并闪烁、toast 提示 "Build … — located its Child CR …"；先把日期过滤设为遮蔽该行的区间再定位 → 日期被自动清空并 toast 说明
18. 断网：刷新页面仍能完整工作（自包含，Network 面板 0 请求）

## 5. 调试技巧

### 控制台看 payload
```js
console.table(window.__PAYLOAD__.aggregations.opened_closed_rates);
console.log('RA-OP times sample:', Object.entries(window.__PAYLOAD__.aggregations.ra_op_time).slice(0, 5));
```

### 直接调 render 函数
```js
window.Summary._range = {from:'2024-01-01', to:'2024-12-31'};
window.Summary.render(window.__PAYLOAD__.aggregations, window.__PAYLOAD__.data);

window.ProjectStateChart._view = 'closed';
window.ProjectStateChart.render(window.__PAYLOAD__.aggregations);

// Projects 树：搜索 / 展开状态是模块内部字段
window.ProjectTree._query = '9247617';
window.ProjectTree.render();
window.ProjectTree._expanded.add('ra:10835498');
window.ProjectTree.render();
```

### 浏览器 DevTools Network 面板
应该**完全空**（0 请求）—— 否则就不是自包含。

## 6. 典型改动 → 验证流程

| 想做的事 | 改文件 | 验证 |
|---|---|---|
| 调色 | styles.css | 重新生成 + 浏览器看 |
| 加 KPI | aggregations.py + template.html + app.js | 重新生成 + Node 单元测试 |
| 改分类口径 | aggregations.py `OPEN_STATES`/`CLOSED_STATES` | 重新生成 + 跑 Python 自检（数应该变）；app.js 的 CLOSED_STATES 会在 boot 时自动跟随 `agg.closed_states`（known-issues §1 已修复） |
| 加新过滤 | app.js 新模块 + DOMContentLoaded 调 | 浏览器手测 |
| 加 drill-down 层级 | ProjectStateChart `_view` 加新值 | Node 单元测试 4 阶段 |
| 加新视图（页） | template.html 加 `.page-view#view-x` + 导航项 `data-page="x"` + app.js `Pages.TITLES` 加 x + 新 render 模块 | 重新生成 + 浏览器手测（参考 Projects 页的做法） |

## 7. 打包 exe（PyInstaller）

```bash
cd D:\Users\yixiao\Documents\GitHub\ReadAcross_Dashboard
python packaging/build.py --smoke
```

产物在 `Release/`（gitignore，本机构建后拷给同事）：

| exe | 入口 | 作用 | 体积约 |
|---|---|---|---|
| `UpdateDatabase.exe` | src/fetcher.py | PTC `im` 取数 → `output\dashboard.db` 等 4 个文件 | 16 MB |
| `GenerateDashboard.exe` | src/generate_dashboard.py | 读 `output\dashboard.db` → `dashboard.html`，双击自动打开 | 10 MB |
| `UpdateAll.exe` | src/update_all.py | 一键 = 先取数再出网页 | 16 MB |

`--smoke` 跑两层自检：① 用仓库 `src/output/dashboard.db` 喂 GenerateDashboard.exe 并断言 payload；② `selftest_fetch.py` 屏蔽 numpy 后用假数据跑取数链（openpyxl/sqlite 读写回归），替代无法在本机做的真实取数验证。

关键实现点（改动时别破坏）：

- **frozen 路径**：`config.py` 的 `BASE_DIR` 与 `generate_dashboard.py` 的 `ROOT` 在 `sys.frozen` 时以 exe 所在目录为基准（onefile 的 `__file__` 在临时解压目录，退出即删）。frozen 时 fetch 链输出到 `exe目录\output\`，dashboard 链默认读写同目录，两个 exe 放同一文件夹即零参数联动。
- **frozen 体验**：三个入口的 `__main__` 有 try/except + `exe_utils.pause_if_frozen()`（结束停留）+ `make_streams_tolerant()`（控制台代码页不含的字符替换为 `?` 不崩溃）。
- **体积**：openpyxl 对 numpy/PIL 是可选 try-import，PyInstaller 会把 anaconda 的整套 Intel MKL（400MB）打进去；build.py 里 `EXCLUDES` 把它们排除了（取数链只需纯 Python 的 openpyxl/xlrd）。换非 conda 环境打包时同样保留排除。
- **`src/update_all.py`**：复用 fetcher/generate_dashboard 的 `main()`，通过改写 `sys.argv` 传 `--open`，不复制流水线逻辑。

同事机器前提（详见 `packaging/使用说明.md`，构建时随 exe 拷贝）：UpdateDatabase/UpdateAll 需要 PTC 客户端（`im` 在 PATH）+ 内网 + 已缓存凭据（首次 `im connect` 一次）；GenerateDashboard 零依赖。

## 8. 已知命令问题

- **Windows console (cp1252) 不能 print Unicode**：`✓`、`→`、`—`、`↑` 都会触发 `UnicodeEncodeError`。CLI 里只用 ASCII。模板/前端爱怎么用都行。
- **Node `--check` 只检查语法**，不检查逻辑。要做逻辑测试得跑上面的 mock 脚本。