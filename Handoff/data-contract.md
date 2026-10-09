# Data Contract

> **⚠️ 过时声明（2026-10-09 更新）**：本文正文描述旧 RA-OP 口径的实体表/边/聚合字段，仅作
> 历史参照。**现行契约**以 [src/dashboard_generator/data_loader.py](../src/dashboard_generator/data_loader.py)
> 模块 docstring 为准（2026-10-09 适配落地）：
>
> ```js
> window.__PAYLOAD__ = {
>   data:  { ecrs, builds, items },   // ecrs=嵌套树(#27 effort 双字段), builds=抽屉用,
>                                     // items=id→全字段原始行(抽屉全字段, 剔除 overdue_*)
>   graph: { nodes, edges: {work_items, actions, work_item_for}, generatedAt },
>   aggregations: { counts, plannedTotal, actualTotal, byProcessArea, byTeam,
>                   open_states, closed_states },   // 五卡无过滤基线(#14 含 ALM_Completed)
>   meta:  { generated_at, ... },     // metadata 表全部键值; overdue 由前端按 generated_at 自算
> }
> ```
>
> 字段语义与口径的权威描述见 [dashboard-content.md](dashboard-content.md) §3/§4/§7。

`window.__PAYLOAD__` 的完整结构，由 Python 端 `load_payload` + `compute_all_aggregations` 拼装，浏览器侧 `app.js` 消费。（以下正文为旧 RA-OP 版本。）

## 顶层结构

```js
window.__PAYLOAD__ = {
  data:          {...},   // 来自 data_loader.load_payload()
  aggregations:  {...},   // 来自 aggregations.compute_all_aggregations()
  meta:          {...},   // 来自 metadata 表
};
```

## data.* （DB 表 → JSON）

| Key | 元素 schema | 来源 |
|---|---|---|
| `data.ra_ops` | `{id:int, summary, project, created_date}` | `ra_op` 表（created_date 为后加列；旧库可能没有，见 §"ra_op_time"） |
| `data.parent_ops` | `{id, state, summary, project}` | `parent_op` 表 |
| `data.child_ops` | `{id, state, summary, project}` | `child_op` 表 |
| `data.deliveries` | `{id, summary, project, target_date}` | `deliveries` 表 |
| `data.change_requests` | `{id, state, summary, project, team, owners}` | `change_requests` 表 |
| `data.builds` | `{id, summary, project, target_date, planned_completion_date, maturity_level}` | `builds` 表 |
| `data.edges.ra_to_parent` | `{ra_op_id, parent_op_id}` | `ra_op_parent_op` |
| `data.edges.ra_to_child` | `{ra_op_id, child_op_id}` | `ra_op_child_op` |
| `data.edges.related_to_delivery` | `{related_id, delivery_id}` | `related_delivery`（related_id ≈ child_op_id） |
| `data.edges.related_to_cr` | `{related_id, change_request_id}` | `related_change_request`（related_id ≈ child_op_id） |
| `data.edges.cr_to_build` | `{change_request_id, build_id}` | `change_request_build` |

## aggregations.*

| Key | 形状 | 消费者 |
|---|---|---|
| `kpis` | `{counts:{ra_ops, parent_ops, child_ops, deliveries, change_requests, builds}, closure_rate_percent, closed:{parent_ops, child_ops, change_requests}, in_progress_child_ops, avg_links:{change_requests_per_child_op, builds_per_change_request}}` | (目前未消费，备用) |
| `opened_closed_rates` | `{child_op:{total, open, closed, closed_percent}, change_request:{total, open, closed, closed_percent}}` | **Target 卡** |
| `state_distributions` | `{parent_ops, child_ops, change_requests}` 每项 `[{key:state, count}]` | 备用 |
| `project_distributions` | `{parent_ops, child_ops, change_requests, deliveries, builds}` 每项 `{top:[{project, count}], other_count, total}` | 备用 |
| `build_maturity` | `[{key:maturity_level, count}]` | 备用 |
| `delivery_timeline` | `[{month:'YYYY-MM', count}]` | 备用 |
| `build_target_timeline` | `[{month:'YYYY-MM', count}]` | 备用 |
| `owner_rank` | `[{owner, count}]` Top 20 | 备用 |
| `team_rank` | `[{team, count}]` | 备用 |
| `child_op_by_project_state` | `{projects:[37], states:[~6], matrix:[[37×6]], totals:[37]}`（全部项目各自成柱，无 Other 归并、无 top_n） | **Hero chart** |
| `ra_op_time` | `{ra_op_id: 'YYYY-MM-DD' or null}` | **Summary / DetailsTable / ProjectTree 日期过滤** |
| `state_colors` | `{state: '#hex'}` 11 项 | Hero chart detail 模式 |
| `node_colors` | `{kind: '#hex'}` 6 项 | 备用 |
| `maturity_colors` | `{level: '#hex'}` 6 项 | 备用 |
| `open_states` | `['ALM_Initiated', 'ALM_Defined', ...]` 6 项 | Hero chart 钻取 |
| `closed_states` | `['ALM_Closed', 'ALM_Realized', ...]` 5 项 | Hero chart 钻取 |

## meta

DB `metadata` 表全量注入：

```js
{
  schema_version: "1",
  generated_at: "2026-09-20T22:00:00",
  root_query_definition: "..."
}
```

前端主要用 `generated_at` 显示在副标 "Read-Across ALM data · generated ..."。

## 边界与坑

### `data.edges.related_to_delivery.related_id` 不一定是 delivery_id
实测是 child_op_id（多对一：1 个 child_op 可关联多个 delivery）。`aggregations.compute_ra_op_time` 已经按 child_op 解释，写新聚合时注意。

### `data.edges.related_to_cr.related_id` 几乎全是 child_op_id
实测 572/572 条的 related_id 都存在于 child_ops；其中 16 个数值 id 同时也出现在 parent_ops 表（跨表 id 重合，并非真的指向 parent）。`ProjectTree` 建索引时统一按 child_op 解释并过滤掉不在 child_ops 里的边。

### `data.ra_ops` 的 created_date 与 ra_op_time
当前 DB 的 ra_op 表已有 `created_date` 列。`compute_ra_op_time` **优先取 created_date**，缺失（旧库）时回退为子树内最早 target_date。当前 106/106 全部有时间（2023-08-29 .. 2026-08-27，0 个 null）；旧库场景下 null 的 RA-OP 在日期过滤激活时不包含（无日期 = 不进任何具体区间）。

### CR / build 不都从 RA-OP 可达
- All time 下级联 RA→child→CR→build，CR=533/713、BUILD=271/370
- 孤立 CR/build（约 180 CR + 99 build）不进 Summary 任何时间窗
- 这是业务需求"对应RA OP"的严格语义，**不是 bug**

### Closed 关闭率口径
业务口径：已 dispositioned = closed（Rejected/Cancelled 也算）。所以 CHILD CR closure = 99.0%。
详见 `aggregations.OPEN_STATES` / `CLOSED_STATES` 定义。

## 体积预估

- `data.*`：~1.5 MB（6 表 + 5 类边）
- `aggregations.*`：~50 KB
- 总 payload：约 1.55 MB
- `dashboard.html` 总大小：约 700 KB（CSS ~25 KB + JS ~45 KB + payload ~1.55 MB 压缩空白后；Details/Projects 功能加入后从早期 ~620 KB 增长）

## 改聚合 → 前端影响

| 改 aggregations 的某 key | 前端是否需要改 | 备注 |
|---|---|---|
| `kpis.*` | 否 | 当前未消费 |
| `opened_closed_rates.*` | 否 | Target 只读 `child_op.closed_percent` 和 `change_request.closed_percent` |
| `project_distributions.change_requests.top` | 否 | 当前无消费者（备用；早期 TopProjects 卡已移除） |
| `child_op_by_project_state` shape | **是** | Hero chart 严格依赖 `projects/states/matrix/totals` |
| `ra_op_time` 字段名 | 否 | Summary 用 `agg.ra_op_time[id]`，key 是 ra_op_id |
| `state_colors` | 否 | 浏览器侧直接用 |
| `open_states` / `closed_states` | **是**（增减 state 时） | Hero chart 钻取依赖这两个数组 |
| 加全新聚合 key | **是** | `app.js` 要写新模块消费 |