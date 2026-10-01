/* ==========================================================================
   Read-Across Dashboard — App entry (Step B: data integration)
   五个 render 模块全部接入 window.__PAYLOAD__
   ========================================================================== */
(function () {
  'use strict';

  const AGG = () => window.__PAYLOAD__ && window.__PAYLOAD__.aggregations;
  const DATA = () => window.__PAYLOAD__ && window.__PAYLOAD__.data;

  // ---------- utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmt = {
    int: (n) => Number(n).toLocaleString('en-US'),
    pct: (n, digits = 1) => `${Number(n).toFixed(digits)}%`,
    truncate: (s, n) => {
      if (!s) return '';
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    },
    hash: (s) => {
      // 简单字符串 hash → 0..359（hue）
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h % 360;
    },
    // '/IBC/Customer/Leap/A12_REV/IBC' → 'A12_REV/IBC'
    // （右起第二个分隔号之后的文本，即末两段；无内容返回 ''）
    project: (s) => {
      const parts = String(s || '').split('/').filter(Boolean);
      return parts.slice(-2).join('/');
    },
  };

  // CLOSED_STATES 以聚合端(agg.closed_states)为准，boot 时覆盖默认值；
  // 默认值仅在聚合缺失时兜底（known-issue #1：此前硬编码缺 Rejected/Cancelled）
  let CLOSED_STATES = new Set(['ALM_Closed', 'ALM_Realized', 'ALM_Checked', 'ALM_Approved', 'ALM_Rejected', 'ALM_Cancelled']);
  const ACTIVE_STATES = new Set(['ALM_Initiated', 'ALM_Defined', 'ALM_Analysed', 'ALM_Started', 'ALM_Planned']);
  const FAILED_STATES = new Set(['ALM_Rejected', 'ALM_Cancelled']);

  // PTC Integrity Web deep-link：把 RA-OP / Child OP / Child CR 的 ID 接到
  // HTTPS Web Integrity 地址，点开即在新标签页打开对应 item。
// 之前用 `integrity://` 自定义协议时，企业部署的 Mimecast URL Rewriting 会
// 在浏览器内把含 `skobde-mks-im.kobde.trw.com` 的 URL 改写成它的包装地址，
// PTC 客户端拿到后报 `MS154475: Incorrect URL format`。改成 HTTPS Web 版后
// 走的是普通 HTTPS 派发，不会触发自定义协议派发路径，浏览器原生处理。
  const INTEGRITY_HOST = 'skobde-mks-im.kobde.trw.com:7001';
  const integrityUrl = (id) => `https://${INTEGRITY_HOST}/im/issues?selection=${encodeURIComponent(String(id))}`;

  // ===============================================================
  // Summary — 4 KPI metrics cascaded from filtered RA-OPs
  // ===============================================================
  const Summary = {
    _range: { from: '', to: '' }, // RA-OP created date interval; both empty = all time

    _cascade(agg, data) {
      // RA-OP time map (created date, subtree target_date fallback)
      const t = agg.ra_op_time || {};
      const { from, to } = this._range;

      // Filter RA-OPs by created-date interval (ISO strings compare lexicographically)
      const raIds = new Set();
      for (const ra of data.ra_ops) {
        if (!from && !to) {
          raIds.add(ra.id);
        } else {
          const d = t[ra.id];
          if (d && (!from || d >= from) && (!to || d <= to)) raIds.add(ra.id);
        }
      }

      // Index edges for cascade
      const raToChild = new Map();
      for (const e of data.edges.ra_to_child) {
        if (!raToChild.has(e.ra_op_id)) raToChild.set(e.ra_op_id, []);
        raToChild.get(e.ra_op_id).push(e.child_op_id);
      }
      const childToCr = new Map();
      for (const e of data.edges.related_to_cr) {
        if (!childToCr.has(e.related_id)) childToCr.set(e.related_id, []);
        childToCr.get(e.related_id).push(e.change_request_id);
      }
      const crToBuild = new Map();
      for (const e of data.edges.cr_to_build) {
        if (!crToBuild.has(e.change_request_id)) crToBuild.set(e.change_request_id, []);
        crToBuild.get(e.change_request_id).push(e.build_id);
      }

      // Cascade
      const childIds = new Set();
      for (const rid of raIds) {
        for (const cid of raToChild.get(rid) || []) childIds.add(cid);
      }
      const crIds = new Set();
      for (const cid of childIds) {
        for (const crid of childToCr.get(cid) || []) crIds.add(crid);
      }
      const buildIds = new Set();
      for (const crid of crIds) {
        for (const bid of crToBuild.get(crid) || []) buildIds.add(bid);
      }

      return {
        ra: raIds.size,
        child: childIds.size,
        cr: crIds.size,
        build: buildIds.size,
        totals: {
          ra: data.ra_ops.length,
          child: data.child_ops.length,
          cr: data.change_requests.length,
          build: data.builds.length,
        },
      };
    },

    _initDateInputs(agg) {
      const fromEl = $('#date-from');
      const toEl = $('#date-to');
      if (!fromEl || !toEl) return;
      // constrain both inputs to the created-date span present in the data
      const dates = Object.values(agg.ra_op_time || {})
        .filter((d) => typeof d === 'string' && d.length >= 10)
        .sort();
      if (dates.length) {
        fromEl.min = toEl.min = dates[0];
        fromEl.max = toEl.max = dates[dates.length - 1];
      }
    },

    _renderTrend(pillEl, filtered, total) {
      if (!pillEl) return;
      if (!this._range.from && !this._range.to) {
        pillEl.textContent = '—';
        pillEl.classList.add('placeholder');
      } else {
        pillEl.textContent = `${filtered} / ${total}`;
        pillEl.classList.remove('placeholder');
      }
    },

    render(agg, data) {
      if (!agg || !data) return;

      this._range = readDateRange();
      this._initDateInputs(agg);

      const c = this._cascade(agg, data);

      $('#m-ra-op').textContent     = fmt.int(c.ra);
      $('#m-child-op').textContent  = fmt.int(c.child);
      $('#m-child-cr').textContent  = fmt.int(c.cr);
      $('#m-build').textContent     = fmt.int(c.build);

      this._renderTrend($('#t-ra-op'),   c.ra,    c.totals.ra);
      this._renderTrend($('#t-child-op'), c.child, c.totals.child);
      this._renderTrend($('#t-cr'),       c.cr,    c.totals.cr);
      this._renderTrend($('#t-build'),    c.build, c.totals.build);

      // 数字非占位 → 移除 placeholder class
      ['#m-ra-op', '#m-child-op', '#m-child-cr', '#m-build'].forEach((s) => {
        const el = $(s); if (el) el.classList.remove('placeholder');
      });

      // 更新 CHILD OP / CHILD CR / BUILD 副标题（链路上限）
      $('#m-child-sub').textContent = `linked to ${fmt.int(c.ra)} RA-OP${c.ra === 1 ? '' : 's'}`;
      $('#m-cr-sub').textContent     = `under ${fmt.int(c.child)} child-OP${c.child === 1 ? '' : 's'}`;
      $('#m-build-sub').textContent  = `under ${fmt.int(c.cr)} CR${c.cr === 1 ? '' : 's'}`;
    },
  };

  // ===============================================================
  // Target — 新分类（Open/Closed）下的 CHILD OP / CHILD CR 关闭率
  // ===============================================================
  const Target = {
    render(agg) {
      if (!agg) return;
      const rates = agg.opened_closed_rates || {};
      const child = rates.child_op || { total: 0, closed: 0, closed_percent: 0 };
      const cr    = rates.change_request || { total: 0, closed: 0, closed_percent: 0 };

      const rows = [
        { id: 'child', label: 'CHILD OP closure', pct: child.closed_percent },
        { id: 'cr',    label: 'CHILD CR closure', pct: cr.closed_percent    },
      ];

      rows.forEach(({ id, pct }) => {
        const num = Number(Number(pct).toFixed(1));
        $(`#p-${id}`).textContent = `${num}%`;
        $(`#p-${id}`).classList.remove('placeholder');
        $(`#pf-${id}`).style.width = `${Math.max(0, Math.min(100, num))}%`;
      });
    },
  };

  // ===============================================================
  // ProjectStateChart — Hero chart with 2-level drill-down
  // Level 1 (top): Open / Closed (2 segments per bar)
  // Level 2: drill into specific states of the clicked category
  // Bars follow the shared RA-OP created-date filter (readDateRange)
  // ===============================================================
  const ProjectStateChart = {
    _view: 'top', // 'top' | 'open' | 'closed'

    // 与 Summary / DetailsTable 同口径：区间命中 RA-OP（ra_op_time），
    // 级联到其 Child OP 后按 project × state 重算矩阵；无筛选时直接用构建期聚合
    _cpsForRange(agg, data) {
      const base = agg.child_op_by_project_state;
      if (!base) return base;
      const { from, to } = readDateRange();
      if (!from && !to) return base;

      const raTime = agg.ra_op_time || {};
      const raIds = new Set();
      for (const ra of data.ra_ops || []) {
        const d = raTime[ra.id];
        if (d && (!from || d >= from) && (!to || d <= to)) raIds.add(ra.id);
      }

      const childIds = new Set();
      for (const e of data.edges.ra_to_child || []) {
        if (raIds.has(e.ra_op_id)) childIds.add(e.child_op_id);
      }
      const byId = new Map((data.child_ops || []).map((c) => [c.id, c]));

      const perProject = new Map(); // project -> Map(state -> count)
      const stateTotals = new Map();
      for (const cid of childIds) {
        const c = byId.get(cid);
        if (!c) continue;
        const p = c.project || '(empty)';
        const s = c.state || '(empty)';
        if (!perProject.has(p)) perProject.set(p, new Map());
        const row = perProject.get(p);
        row.set(s, (row.get(s) || 0) + 1);
        stateTotals.set(s, (stateTotals.get(s) || 0) + 1);
      }

      // 行/列顺序与构建期聚合一致：项目按总数倒序，state 按全局计数倒序
      const rowTotal = (row) => [...row.values()].reduce((a, b) => a + b, 0);
      const projects = [...perProject.keys()].sort(
        (a, b) => rowTotal(perProject.get(b)) - rowTotal(perProject.get(a)));
      const states = [...stateTotals.keys()].sort(
        (a, b) => stateTotals.get(b) - stateTotals.get(a));
      const matrix = projects.map((p) => states.map((s) => perProject.get(p).get(s) || 0));
      const totals = projects.map((p) => rowTotal(perProject.get(p)));
      return { projects, states, matrix, totals, top_n: base.top_n };
    },

    render(agg, data) {
      if (!agg) return;
      const cps = this._cpsForRange(agg, data);
      if (!cps || !cps.projects) return;

      // 记住渲染上下文:图例钻取与气泡卡片都从最近的筛选结果取数
      this._agg = agg;
      this._data = data;
      this._cps = cps;
      this._hidePop();

      const { projects, states: allStates, matrix, totals } = cps;
      const sc = agg.state_colors || {};
      const openStates   = new Set(agg.open_states   || []);
      const closedStates = new Set(agg.closed_states || []);

      // Per-project Open / Closed counts (used for legend in Level 1)
      const projectOC = projects.map((_, i) => {
        let open = 0, closed = 0;
        for (let j = 0; j < allStates.length; j++) {
          const c = matrix[i][j] || 0;
          if (openStates.has(allStates[j])) open += c;
          else if (closedStates.has(allStates[j])) closed += c;
        }
        return { open, closed };
      });
      const totalOpen   = projectOC.reduce((s, x) => s + x.open, 0);
      const totalClosed = projectOC.reduce((s, x) => s + x.closed, 0);

      // ---- determine segment definitions based on view
      let segsDef; // [{ key, states: [...], displayName }]
      if (this._view === 'top') {
        segsDef = [
          { key: 'Open',   states: [...openStates],   color: '#f59e0b', displayName: 'Open' },
          { key: 'Closed', states: [...closedStates], color: '#16a34a', displayName: 'Closed' },
        ];
      } else {
        const statesList = this._view === 'open'
          ? [...openStates]
          : [...closedStates];
        // order by global count desc, but keep only those present in cps.states
        const stateCounts = statesList.map((s) => ({
          state: s,
          count: allStates.includes(s)
            ? matrix.reduce((sum, row) => sum + (row[allStates.indexOf(s)] || 0), 0)
            : 0,
        }));
        stateCounts.sort((a, b) => b.count - a.count);
        segsDef = stateCounts.map(({ state, count }) => ({
          key: state,
          states: [state],
          color: sc[state] || '#94a3b8',
          displayName: state.replace(/^ALM_/, ''),
          _count: count,
        }));
      }

      // ---- x-axis labels: full names when they fit, rotate/truncate only as fallback
      const fullProj = (p) => (p === '__other__' ? 'Other' : p);
      // 显示名 = 数据库 Project 完整路径的最后两段：/IBC/Customer/Geely/Lotus_EPA → Geely/Lotus_EPA
      const labelNames = projects.map((p) => {
        if (p === '__other__') return 'Other';
        const parts = p.split('/').filter(Boolean);
        return parts.length ? parts.slice(-2).join('/') : (p || '—');
      });

      const labelFont = 11;
      const labelW = (s) => textWidth(s, labelFont);
      const labelWidths = labelNames.map(labelW);
      const maxLabelW = Math.max(...labelWidths, 0);

      // ---- geometry: fixed min slot width keeps labels readable; the svg grows
      // with the project count and the container scrolls horizontally.
      const H = 420;
      const padL = 32, padR = 32, padT = 30;
      const N = projects.length;
      const slotW = Math.max(96, (1200 - padL - padR) / N);
      const W = Math.max(1200, padL + padR + N * slotW);
      const barW = Math.min(slotW * 0.55, 50);
      const barR = 5;     // top-corner radius of the topmost segment
      const segGap = 1.5; // hairline gap between stacked segments (bg-colored stroke)

      let labelAngle = 0;
      let padB = 30;
      let fittedNames = labelNames;
      if (maxLabelW > slotW - 12) {
        // smallest standard angle whose footprint still fits one slot
        labelAngle = [30, 40, 50, 60].find(
          (a) => maxLabelW * Math.cos(a * Math.PI / 180) <= slotW - 12) || 60;
        const rad = (labelAngle * Math.PI) / 180;
        const maxFootprint = (slotW - 10) / Math.cos(rad);
        fittedNames = labelNames.map((s, i) =>
          labelWidths[i] <= maxFootprint ? s : truncateToWidth(s, maxFootprint, labelW));
        padB = Math.ceil(labelFont + 10
          + Math.max(...fittedNames.map(labelW), 0) * Math.sin(rad));
      }

      const innerH = H - padT - padB;
      const maxCount = Math.max(...totals, 1); // 永远按 total 缩放（钻取保持柱高）
      const yScale = (v) => padT + innerH * (1 - v / maxCount);

      // ---- baseline only — every bar is direct-labeled, so no grid or y-axis
      const baseY = padT + innerH;

      // ---- bars
      const labelY = H - padB + labelFont + 2;
      const segStroke = ` style="stroke:var(--surface-2)" stroke-width="${segGap}"`;
      const bars = projects.map((proj, i) => {
        const x = padL + slotW * i + (slotW - barW) / 2;
        const counts = segsDef.map((sd) => sd.states.reduce((s, st) => {
          const idx = allStates.indexOf(st);
          return s + (idx >= 0 ? (matrix[i][idx] || 0) : 0);
        }, 0));
        const topIdx = counts.reduce((acc, c, k) => (c > 0 ? k : acc), -1);
        let cumH = 0;
        const segs = segsDef.map((sd, k) => {
          const count = counts[k];
          if (!count) return '';
          const segH = (count / maxCount) * innerH;
          const y = padT + innerH - cumH - segH;
          cumH += segH;
          const tip = `<title>${esc(fullProj(proj))} · ${esc(sd.displayName)}: ${fmt.int(count)}</title>`;
          if (k === topIdx) {
            return `
              <path class="bar-seg" data-cat="${esc(sd.key)}"
                    d="${topRoundedBarPath(x, y, barW, segH, barR)}"
                    fill="${sd.color}"${segStroke}>${tip}</path>
            `;
          }
          return `
            <rect class="bar-seg" data-cat="${esc(sd.key)}"
                  x="${x.toFixed(1)}" y="${y.toFixed(1)}"
                  width="${barW.toFixed(1)}" height="${Math.max(segH, 0.5).toFixed(1)}"
                  fill="${sd.color}"${segStroke}>${tip}</rect>
          `;
        }).join('');

        // 标签跟住当前视图实际堆叠的顶部与合计（钻取时 ≠ 项目总数）
        const viewTotal = counts.reduce((a, b) => a + b, 0);
        const totalY = yScale(viewTotal);
        const labelX = labelAngle ? x + barW / 2 + 4 : x + barW / 2;
        const rotateAttr = labelAngle
          ? ` transform="rotate(${-labelAngle} ${labelX.toFixed(1)} ${labelY.toFixed(1)})"`
          : '';

        return `
          <g class="bar-group" data-project="${esc(proj)}">
            ${segs}
            <text x="${(x + barW / 2).toFixed(1)}" y="${(totalY - 8).toFixed(1)}" text-anchor="middle"
                  font-size="13" font-weight="600" fill="#0f172a"
                  font-family="-apple-system,Segoe UI,sans-serif">${fmt.int(viewTotal)}</text>
            <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${labelAngle ? 'end' : 'middle'}"
                  font-size="${labelFont}" fill="#64748b"
                  font-family="-apple-system,Segoe UI,sans-serif"${rotateAttr}>${esc(fittedNames[i])}<title>${esc(fullProj(proj))}</title></text>
          </g>
        `;
      }).join('');

      // ---- legend
      let legendHtml;
      if (this._view === 'top') {
        legendHtml = `
          <button type="button" class="legend-pill legend-pill-lg active" data-cat="Open">
            <span class="legend-dot" style="background:#f59e0b"></span>
            <span>Open</span>
            <span class="legend-count">${fmt.int(totalOpen)}</span>
          </button>
          <button type="button" class="legend-pill legend-pill-lg" data-cat="Closed">
            <span class="legend-dot" style="background:#16a34a"></span>
            <span>Closed</span>
            <span class="legend-count">${fmt.int(totalClosed)}</span>
          </button>
        `;
      } else {
        const backLabel = '< Open / Closed';
        const detailPills = segsDef.map((sd) => `
          <span class="legend-pill legend-pill-static">
            <span class="legend-dot" style="background:${sd.color}"></span>
            <span>${esc(sd.displayName)}</span>
            <span class="legend-count">${fmt.int(sd._count || 0)}</span>
          </span>
        `).join('');
        legendHtml = `
          <button type="button" class="legend-back" data-cat="top">${backLabel}</button>
          ${detailPills}
        `;
      }

      $('#lg-legend-host').innerHTML = legendHtml;
      const host = $('#lg-chart-host');
      host.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
             style="width:${Math.round(W)}px;min-width:100%;height:100%">
          <line x1="${padL}" y1="${baseY.toFixed(1)}" x2="${W - padR}" y2="${baseY.toFixed(1)}"
                style="stroke:var(--border-strong)" stroke-width="1" shape-rendering="crispEdges"/>
          ${bars}
        </svg>
      `;
      // innerHTML 会连带清掉气泡节点,重新挂回(置于 svg 之后保证叠放层级)
      if (this._pop) host.appendChild(this._pop);

      // ---- interactions
      $$('.legend-pill[data-cat]').forEach((pill) => {
        pill.onclick = () => {
          const cat = pill.dataset.cat;
          if (cat === 'Open' || cat === 'Closed') {
            this._view = cat.toLowerCase();
            this.render(this._agg, this._data);
          }
        };
      });
      $$('.legend-back').forEach((btn) => {
        btn.onclick = () => {
          this._view = 'top';
          this.render(this._agg, this._data);
        };
      });
    },

    // =============================================================
    // 气泡卡片 — 点击柱子显示该项目各状态数量
    // init() 只跑一次:创建节点 + 事件委托(柱子随 render 重建,委托挂在容器上)
    // =============================================================
    init() {
      const host = $('#lg-chart-host');
      if (!host) return;
      const pop = document.createElement('div');
      pop.className = 'lg-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-modal', 'false');
      pop.setAttribute('aria-label', 'Project state breakdown');
      host.appendChild(pop);
      this._pop = pop;

      host.addEventListener('click', (ev) => {
        const g = ev.target.closest('.bar-group');
        if (!g) { this._hidePop(); return; }
        if (this._openBar === g) { this._hidePop(); return; }
        this._showPopover(g);
      });
      // 点击图表外任意区域关闭(柱子点击由上面的委托处理)
      document.addEventListener('click', (ev) => {
        if (!this._openBar) return;
        if (this._pop.contains(ev.target)) return;
        if (ev.target.closest && ev.target.closest('.bar-group')) return;
        this._hidePop();
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && this._openBar) this._hidePop();
      });
    },

    _showPopover(g) {
      const cps = this._cps, agg = this._agg;
      if (!cps || !agg) return;
      const proj = g.dataset.project;
      const i = (cps.projects || []).indexOf(proj);
      if (i < 0) return;

      const sc = agg.state_colors || {};
      const openSet = new Set(agg.open_states || []);
      const closedSet = new Set(agg.closed_states || []);
      const rows = (cps.states || [])
        .map((s, j) => ({ state: s, count: (cps.matrix[i] || [])[j] || 0 }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count);
      let open = 0, closed = 0;
      for (const r of rows) {
        if (openSet.has(r.state)) open += r.count;
        else if (closedSet.has(r.state)) closed += r.count;
      }
      const maxRow = rows.length ? rows[0].count : 1;
      const fullProj = proj === '__other__' ? 'Other' : proj;
      const shortName = proj === '__other__'
        ? 'Other'
        : (proj.split('/').filter(Boolean).slice(-2).join('/') || proj || '—');

      const rowsHtml = rows.map((r) => {
        const color = sc[r.state] || '#94a3b8';
        const name = String(r.state).replace(/^ALM_/, '');
        const pct = (r.count / maxRow * 100).toFixed(1);
        return `
          <li>
            <span class="lg-pop-dot" style="background:${color}"></span>
            <span class="lg-pop-state" title="${esc(name)}">${esc(name)}</span>
            <span class="lg-pop-count">${fmt.int(r.count)}</span>
            <span class="lg-pop-track"><i style="width:${pct}%;background:${color}"></i></span>
          </li>`;
      }).join('');

      this._pop.innerHTML = `
        <header class="lg-pop-head">
          <div>
            <div class="lg-pop-name">${esc(shortName)}</div>
            <div class="lg-pop-path" title="${esc(fullProj)}">${esc(fullProj)}</div>
          </div>
          <div class="lg-pop-total">${fmt.int(cps.totals[i] || 0)}<span>child OPs</span></div>
        </header>
        <ul class="lg-pop-rows">${rowsHtml || '<li class="lg-pop-empty">No child OPs</li>'}</ul>
        <footer class="lg-pop-foot">
          <span><i style="background:#f59e0b"></i>Open ${fmt.int(open)}</span>
          <span><i style="background:#16a34a"></i>Closed ${fmt.int(closed)}</span>
        </footer>
      `;

      this._placePopover(g);
      if (this._sel) this._sel.classList.remove('selected');
      g.classList.add('selected');
      this._sel = g;
      this._openBar = g;
      // 重新触发入场动画
      this._pop.classList.remove('open');
      void this._pop.offsetWidth;
      this._pop.classList.add('open');
    },

    // 定位:柱顶上方空间足够 → 居中悬于柱上;否则贴柱侧(右优先,放不下换左)。
    // 坐标系 = .lg-chart 的内容坐标(容器是滚动容器,气泡随横向滚动保持锚定)
    _placePopover(g) {
      const pop = this._pop;
      const host = $('#lg-chart-host');
      const svg = host.querySelector('svg');
      if (!svg) return;

      const hostRect = host.getBoundingClientRect();
      const gRect = g.getBoundingClientRect();
      const segRects = [...g.querySelectorAll('.bar-seg')].map((s) => s.getBoundingClientRect());
      const barTop = segRects.length
        ? Math.min(...segRects.map((r) => r.top)) - hostRect.top
        : gRect.top - hostRect.top;
      const barX = gRect.left - hostRect.left + host.scrollLeft;
      const barW = gRect.width;
      const barCX = barX + barW / 2;
      const svgW = svg.getBoundingClientRect().width;
      const cardW = pop.offsetWidth, cardH = pop.offsetHeight;
      const minL = 6, maxL = Math.max(minL, svgW - cardW - 6);
      const maxT = Math.max(6, hostRect.height - cardH - 8);
      let left, top, origin;

      if (barTop >= cardH + 18) {
        top = barTop - cardH - 10;
        left = Math.min(Math.max(barCX - cardW / 2, minL), maxL);
        origin = '50% 100%';
      } else if (barX + barW + 14 + cardW <= svgW - 6) {
        top = Math.min(Math.max(barTop - 10, 6), maxT);
        left = barX + barW + 14;
        origin = '0% 50%';
      } else {
        top = Math.min(Math.max(barTop - 10, 6), maxT);
        left = Math.max(barX - cardW - 14, minL);
        origin = '100% 50%';
      }

      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(Math.max(6, top))}px`;
      pop.style.transformOrigin = origin;
    },

    _hidePop() {
      this._openBar = null;
      if (this._sel) { this._sel.classList.remove('selected'); this._sel = null; }
      if (this._pop) this._pop.classList.remove('open');
    },
  };

  // ===============================================================
  // DetailsTable — Details 页面的 RA-OPs 列表（三级可展开树）
  // L0 RA-OP：Project = 关联 parent OP 的 project（多条取第一条），
  //           Child State = 关联 child OP 的 Open 数 / 总数；
  // L1 Child OP：Summary/ID/Project/State 为自身字段，可展开显示
  //   L2 Child CR：Summary 列 = summary，ID 列 = id，
  //                Project 列 = team，Child State 列 = state 徽章。
  // 状态筛选（Open = 有未闭环 child OP，Closed = child OP 全部闭环）
  // 与日期过滤（agg.ra_op_time）只作用于 RA-OP 层。
  // 展开状态键带实体前缀（ra:/op:），跨重渲染保持。
  // ===============================================================
  const DetailsTable = {
    PAGE_SIZE: 15,
    _status: 'all',
    _shown: 15,
    _sort: null, // null | 'desc' | 'asc'  (Child State column: open count)
    _childIndex: null,
    _crIndex: null,
    _parentProjects: null,
    _expanded: new Set(),

    reset() {
      this._shown = this.PAGE_SIZE;
      // 不重置 _sort：用户对 Child State 的排序意图在状态/日期切换后仍保留，
      // 与「展开状态 _expanded」跨重渲染保持是同一套约定。
    },

    init(agg, data) {
      this.reset();
      const seg = $('#rt-status');
      if (seg) {
        seg.addEventListener('click', (ev) => {
          const btn = ev.target.closest('.seg-btn');
          if (!btn) return;
          this._status = btn.dataset.status || 'all';
          $$('.seg-btn', seg).forEach((b) => {
            const on = b === btn;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          });
          this.reset();
          this.render(agg, data);
        });
      }
      const more = $('#rt-more');
      if (more) {
        more.addEventListener('click', () => {
          this._shown += this.PAGE_SIZE;
          this.render(agg, data);
        });
      }
      // 全部展开：展开当前页所有 RA-OP 及其 child OP（仅限有关联子项的行）
      const expandAll = $('#rt-expand-all');
      if (expandAll) {
        expandAll.addEventListener('click', () => {
          const { byRa, stats } = this._buildChildIndex(agg, data);
          const crIndex = this._buildCrIndex(agg, data);
          const page = this._filtered(agg, data).slice(0, this._shown);
          for (const p of page) {
            if ((stats[p.id]?.total || 0) > 0) this._expanded.add(`ra:${p.id}`);
            for (const cid of byRa[p.id] || []) {
              if ((crIndex.byOp[cid] || []).length > 0) this._expanded.add(`op:${cid}`);
            }
          }
          this.render(agg, data);
        });
      }
      // 全部收起
      const collapseAll = $('#rt-collapse-all');
      if (collapseAll) {
        collapseAll.addEventListener('click', () => {
          this._expanded.clear();
          this.render(agg, data);
        });
      }
      // Child State 列排序：L0 行按关联 child OP 的「open 数」排，
      // null → desc（未闭环最多在前）→ asc → null（恢复默认按 ID 倒序）。
      // 子行（L1/L2）跟随父行位置，不独立排序——它们本就是父行的展开细节。
      const sortBtn = $('.th-sort[data-sort-key="childstate"]');
      if (sortBtn) {
        sortBtn.addEventListener('click', () => {
          this._sort = this._sort === 'desc' ? 'asc'
                      : this._sort === 'asc'  ? null
                      : 'desc';
          this.reset();
          this.render(agg, data);
          sortBtn.focus();
        });
      }
      // 展开箭头事件委托（tbody 的 innerHTML 每次重渲染都会替换）
      const tbody = $('#recent-tx-host');
      if (tbody) {
        tbody.addEventListener('click', (ev) => {
          const btn = ev.target.closest('.tx-expand');
          if (!btn) return;
          const raId = btn.dataset.ra;
          if (this._expanded.has(raId)) this._expanded.delete(raId);
          else this._expanded.add(raId);
          this.render(agg, data);
          // 重新渲染后把焦点还给同一按钮，键盘操作不丢位置
          const again = tbody.querySelector(`.tx-expand[data-ra="${raId}"]`);
          if (again) again.focus();
        });
      }
    },

    // child OP 索引：byId（id → 行数据）、byRa（ra_op → child id 列表，
    // 按 id 倒序）、stats（ra_op → { total, open }）
    _buildChildIndex(agg, data) {
      if (this._childIndex) return this._childIndex;
      const byId = new Map();
      for (const c of data.child_ops || []) byId.set(c.id, c);
      const byRa = {};
      for (const e of data.edges.ra_to_child) {
        (byRa[e.ra_op_id] || (byRa[e.ra_op_id] = [])).push(e.child_op_id);
      }
      const stats = {};
      for (const [raId, ids] of Object.entries(byRa)) {
        let open = 0;
        for (const cid of ids) {
          if (!CLOSED_STATES.has(byId.get(cid)?.state)) open += 1;
        }
        stats[raId] = { total: ids.length, open };
      }
      for (const ids of Object.values(byRa)) {
        ids.sort((a, b) => Number(b) - Number(a));
      }
      this._childIndex = { byId, byRa, stats };
      return this._childIndex;
    },

    // change_request 索引：byId（id → 行数据）、byOp（child_op → cr id 列表，
    // 按 id 倒序）
    _buildCrIndex(agg, data) {
      if (this._crIndex) return this._crIndex;
      const byId = new Map();
      for (const cr of data.change_requests || []) byId.set(cr.id, cr);
      const byOp = {};
      for (const e of data.edges.related_to_cr) {
        (byOp[e.related_id] || (byOp[e.related_id] = [])).push(e.change_request_id);
      }
      for (const ids of Object.values(byOp)) {
        ids.sort((a, b) => Number(b) - Number(a));
      }
      this._crIndex = { byId, byOp };
      return this._crIndex;
    },

    // ra_op → 关联 parent OP 的 project 字段
    _buildParentProjects(agg, data) {
      if (this._parentProjects) return this._parentProjects;
      const projById = new Map();
      for (const p of data.parent_ops || []) projById.set(p.id, p.project);
      const map = {};
      for (const e of data.edges.ra_to_parent) {
        if (map[e.ra_op_id] !== undefined) continue;
        map[e.ra_op_id] = projById.get(e.parent_op_id);
      }
      this._parentProjects = map;
      return map;
    },

    _filtered(agg, data) {
      const range = readDateRange();
      const raTime = (agg && agg.ra_op_time) || {};
      const { stats } = this._buildChildIndex(agg, data);
      let rows = (data.ra_ops || []).slice();
      if (this._status === 'open') rows = rows.filter((p) => (stats[p.id] || { open: 0 }).open > 0);
      else if (this._status === 'closed') {
        rows = rows.filter((p) => {
          const s = stats[p.id];
          return s && s.total > 0 && s.open === 0;
        });
      }
      if (range.from || range.to) {
        rows = rows.filter((p) => {
          const d = raTime[p.id];
          return d && (!range.from || d >= range.from) && (!range.to || d <= range.to);
        });
      }
      // 默认按 id 倒序（id 大致随时间递增）；Child State 列被激活排序时，
      // 按关联 child OP 的「未闭环数」排；open 数相同的，按 id 倒序作稳定次序。
      if (this._sort) {
        const dir = this._sort === 'desc' ? -1 : 1;
        rows.sort((a, b) => {
          const oa = (stats[a.id] || { open: 0 }).open;
          const ob = (stats[b.id] || { open: 0 }).open;
          if (oa !== ob) return dir * (oa - ob);
          return Number(b.id) - Number(a.id);
        });
      } else {
        rows.sort((a, b) => Number(b.id) - Number(a.id));
      }
      return rows;
    },

    render(agg, data) {
      if (!data) return;
      const tbody = $('#recent-tx-host');
      if (!tbody) return;
      const sc = (agg && agg.state_colors) || {};
      const { byId, byRa, stats } = this._buildChildIndex(agg, data);
      const crIndex = this._buildCrIndex(agg, data);
      const parentProj = this._buildParentProjects(agg, data);
      const rows = this._filtered(agg, data);
      const shown = rows.slice(0, this._shown);

      const stateBadge = (state) => stateBadgeHtml(sc, state);
      const chevSvg = '<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      const detailIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      const detailBtn = (kind, id) => `<td class="tx-actions"><button type="button" class="row-detail" data-kind="${kind}" data-id="${esc(id)}" aria-label="View details">${detailIcon}</button></td>`;

      // L2：Child CR 行（叶子）—— Summary 列 = summary，ID 列 = id，
      // Project 列 = team（去掉原数据开头的 "(数字)" 段），Child State 列 = state 徽章
      const crRowHtml = (crid) => {
        const cr = crIndex.byId.get(crid) || {};
        const team = String(cr.team || '').replace(/^\s*\(\d+\)\s*/, '');
        const crIdHtml = `<a class="tx-id-link" href="${esc(integrityUrl(cr.id))}" target="_blank" rel="noopener noreferrer" title="Open ${esc(cr.id)} in PTC Integrity">${esc(cr.id)}</a>`;
        return `
          <tr class="tx-child-row lv2" data-cr-id="${esc(cr.id)}">
            <td class="tx-child-id"><span>${crIdHtml}</span></td>
            <td><div class="tx-name">${esc(fmt.truncate(cr.summary || '(no summary)', 60))}</div></td>
            <td class="tx-muted">${esc(fmt.truncate(team, 24))}</td>
            <td>${stateBadge(cr.state)}</td>
            ${detailBtn('cr', cr.id)}
          </tr>
        `;
      };

      // L1：Child OP 行 —— 自身 Summary/ID/Project/State，可展开显示 CR
      const opRowHtml = (cid) => {
        const c = byId.get(cid) || {};
        const key = `op:${cid}`;
        const opExpanded = this._expanded.has(key);
        const crIds = crIndex.byOp[cid] || [];
        const opExpander = crIds.length > 0
          ? `<button type="button" class="tx-expand" data-ra="${key}" aria-expanded="${opExpanded}" aria-label="${opExpanded ? 'Hide' : 'Show'} child CRs">${chevSvg}</button>`
          : '<span class="tx-expand-spacer"></span>';
        const crRows = opExpanded ? crIds.map(crRowHtml).join('') : '';
        const opIdHtml = `<a class="tx-id-link" href="${esc(integrityUrl(c.id))}" target="_blank" rel="noopener noreferrer" title="Open ${esc(c.id)} in PTC Integrity">${esc(c.id)}</a>`;
        return `
          <tr class="tx-child-row lv1" data-op-id="${esc(c.id)}">
            <td class="tx-child-id">
              <div class="tx-id-cell">${opExpander}<span>${opIdHtml}</span></div>
            </td>
            <td><div class="tx-name">${esc(fmt.truncate(c.summary || '(no summary)', 60))}</div></td>
            <td class="tx-muted">${esc(fmt.truncate(fmt.project(c.project), 24))}</td>
            <td>${stateBadge(c.state)}</td>
            ${detailBtn('op', c.id)}
          </tr>
          ${crRows}
        `;
      };

      if (!rows.length) {
        tbody.innerHTML = '';
      } else {
        tbody.innerHTML = shown.map((p) => {
          const s = stats[p.id] || { total: 0, open: 0 };
          const proj = fmt.project(parentProj[p.id]);
          const key = `ra:${p.id}`;
          const expanded = this._expanded.has(key);
          const expander = s.total > 0
            ? `<button type="button" class="tx-expand" data-ra="${key}" aria-expanded="${expanded}" aria-label="${expanded ? 'Hide' : 'Show'} child OPs">${chevSvg}</button>`
            : '<span class="tx-expand-spacer"></span>';
          const childRows = expanded ? (byRa[p.id] || []).map(opRowHtml).join('') : '';
          const raIdHtml = `<a class="tx-id-link" href="${esc(integrityUrl(p.id))}" target="_blank" rel="noopener noreferrer" title="Open ${esc(p.id)} in PTC Integrity">${esc(p.id)}</a>`;
          return `
            <tr data-ra-id="${esc(p.id)}">
              <td class="tx-id">
                <div class="tx-id-cell">${expander}<span>${raIdHtml}</span></div>
              </td>
              <td>
                <div class="tx-name">${esc(fmt.truncate(p.summary || '(no summary)', 60))}</div>
              </td>
              <td class="tx-muted">${esc(fmt.truncate(proj, 24))}</td>
              <td class="tx-childstate" title="${s.open} open · ${s.total} child OPs">${fmt.int(s.open)} / ${fmt.int(s.total)}</td>
              ${detailBtn('ra', p.id)}
            </tr>
            ${childRows}
          `;
        }).join('');
      }

      const countEl = $('#rt-count');
      if (countEl) {
        countEl.classList.remove('placeholder');
        countEl.textContent = rows.length === shown.length
          ? `${fmt.int(rows.length)} RA-OPs`
          : `${fmt.int(shown.length)} of ${fmt.int(rows.length)} RA-OPs`;
      }
      // 同步 Child State 表头的排序指示（aria-sort + 图标 data-state）。
      const sortHeader = $('.th-sortable');
      if (sortHeader) {
        const aria = this._sort === 'desc' ? 'descending'
                    : this._sort === 'asc'  ? 'ascending'
                    : 'none';
        sortHeader.setAttribute('aria-sort', aria);
        const sortBtn = sortHeader.querySelector('.th-sort');
        if (sortBtn) sortBtn.dataset.state = this._sort || 'none';
      }
      const emptyEl = $('#rt-empty');
      if (emptyEl) emptyEl.hidden = rows.length > 0;
      const moreWrap = $('#rt-more-wrap');
      if (moreWrap) moreWrap.hidden = shown.length >= rows.length;
    },

    // 顶部搜索的定位入口：kind ∈ { ra, op, cr }（Details 表可显示的三类行）。
    // 自动重置冲突过滤（状态→all；日期滤掉目标 RA-OP 时清空日期并全站联动），
    // 保证目标行在分页内且祖先链已展开，重渲染后由 TopSearch 负责滚动+闪烁。
    locate(agg, data, kind, id) {
      const wantId = String(id);
      const { byRa } = this._buildChildIndex(agg, data);
      const crIndex = this._buildCrIndex(agg, data);

      // 由目标行反查祖先（op → RA；cr → OP → RA），查不到链则视为不可定位
      let raId = null;
      let opId = null;
      if (kind === 'ra') {
        raId = wantId;
      } else if (kind === 'op') {
        opId = wantId;
        for (const [rid, ids] of Object.entries(byRa)) {
          if (ids.some((x) => String(x) === wantId)) { raId = String(rid); break; }
        }
      } else if (kind === 'cr') {
        for (const [oid, crs] of Object.entries(crIndex.byOp)) {
          if (crs.some((x) => String(x) === wantId)) { opId = String(oid); break; }
        }
        if (opId) {
          for (const [rid, ids] of Object.entries(byRa)) {
            if (ids.some((x) => String(x) === opId)) { raId = String(rid); break; }
          }
        }
      }
      if (!raId) return { found: false };

      if (this._status !== 'all') {
        this._status = 'all';
        const seg = $('#rt-status');
        if (seg) {
          $$('.seg-btn', seg).forEach((b) => {
            const on = b.dataset.status === 'all';
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          });
        }
      }

      // 日期过滤遮蔽目标 → 清空日期（clearDateFilter 内部会 reset+render）
      const range = readDateRange();
      let clearedDate = false;
      if (range.from || range.to) {
        const d = (agg && agg.ra_op_time) ? agg.ra_op_time[raId] : undefined;
        if (!d || (range.from && d < range.from) || (range.to && d > range.to)) {
          clearDateFilter();
          clearedDate = true;
        }
      }

      // 目标 RA-OP 抬到当前分页内
      const rows = this._filtered(agg, data);
      const idx = rows.findIndex((p) => String(p.id) === raId);
      if (idx < 0) return { found: false };
      const needShown = (Math.floor(idx / this.PAGE_SIZE) + 1) * this.PAGE_SIZE;
      if (needShown > this._shown) this._shown = needShown;

      this._expanded.add(`ra:${raId}`);
      if (opId) this._expanded.add(`op:${opId}`);

      this.render(agg, data);
      return { found: true, raId, opId, clearedDate };
    },
  };

  // ===============================================================
  // ProjectTree — Projects 页的横向节点树（RA-OP → Child OP → Child CR）
  // 结构：节点卡片绝对定位在画布上，底层 SVG 画肘形连线；紧凑树布局
  // （叶子纵向堆叠、父节点对齐子级中点、按层级分列，横向展开）。
  // 交互：点卡片正文打开详情抽屉；点右缘圆形 +/- 展开/收起；
  // 状态筛选与 DetailsTable 同语义（open = 有未闭环 child OP，
  // closed = 有 child OP 且全部闭环）；搜索按 ID/摘要命中：命中节点
  // 整棵子树展开显示（上下游链路不裁剪），未命中节点仅保留通向命中
  // 的路径；日期区间过滤 RA-OP 根（语义与 Details 一致，
  // 激活时排除无日期的 RA-OP）；画布支持拖拽平移与滚轮/按钮缩放。
  // 默认状态：只显示 RA-OP 根节点（全部折叠）。
  // ===============================================================
  const ProjectTree = {
    CARD_W: 240,  // 与 styles.css 的 .tnode 宽度保持一致
    COL_GAP: 76,
    ROW_GAP: 18,
    PAD: 28,
    _idx: null,
    _status: 'all',
    _query: '',
    _expanded: new Set(),        // 手动展开状态（'ra:<id>' / 'op:<id>'），跨筛选保持
    _searchCollapsed: new Set(), // 搜索态下用户手动收起的节点（查询变化时清空）
    _nodeEls: new Map(),         // key → 卡片元素，跨渲染复用以获得位移动画
    _leaving: new Map(),         // key → 退场中的卡片（淡出结束后移除）
    _linkEls: new Map(),         // edge key → 连线 path，跨渲染复用
    _linksLeaving: new Map(),    // edge key → 退场中的连线
    _nodeH: 0,                   // 首次渲染实测的卡片高度
    _scale: 1,
    _tx: 0, _ty: 0,
    _W: 0, _H: 0,
    _agg: null, _data: null,

    init(agg, data) {
      this._agg = agg;
      this._data = data;

      const seg = $('#pt-status');
      if (seg) {
        seg.addEventListener('click', (ev) => {
          const btn = ev.target.closest('.seg-btn');
          if (!btn) return;
          this._status = btn.dataset.status || 'all';
          $$('.seg-btn', seg).forEach((b) => {
            const on = b === btn;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          });
          this.render();
        });
      }

      const search = $('#pt-search');
      if (search) {
        search.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          if (!q || !this._query) this._searchCollapsed.clear();
          this._query = q;
          this.render();
        });
      }

      const expandAll = $('#pt-expand-all');
      if (expandAll) {
        expandAll.addEventListener('click', () => {
          for (const n of this._allNodes()) {
            if (this._kids(n).length) this._expanded.add(this._key(n));
          }
          this._searchCollapsed.clear();
          this.render();
        });
      }
      const collapseAll = $('#pt-collapse-all');
      if (collapseAll) {
        collapseAll.addEventListener('click', () => {
          this._expanded.clear();
          // 搜索态下节点默认强制展开，全收时逐个记入手动收起
          if (this._query) {
            for (const n of this._allNodes()) {
              if (this._kids(n).length) this._searchCollapsed.add(this._key(n));
            }
          }
          this.render();
        });
      }

      // 事件委托：+/− 切换展开，卡片正文打开详情抽屉
      const canvas = $('#pt-canvas');
      if (canvas) {
        canvas.addEventListener('click', (ev) => {
          const tgl = ev.target.closest('.tnode-toggle');
          if (tgl) {
            const key = tgl.closest('.tnode')?.dataset.key;
            if (!key) return;
            if (this._query) {
              if (this._searchCollapsed.has(key)) this._searchCollapsed.delete(key);
              else this._searchCollapsed.add(key);
            } else if (this._expanded.has(key)) this._expanded.delete(key);
            else this._expanded.add(key);
            this.render();
            // 重渲染后把焦点还给同一按钮，键盘操作不丢位置
            const again = this._nodeEls.get(key)?.querySelector('.tnode-toggle');
            if (again) {
              again.focus();
              this._revealCard(key);
            }
            return;
          }
          const body = ev.target.closest('.tnode-body');
          if (body) DetailsDrawer.open(body.dataset.kind, body.dataset.id, body);
        });
      }

      this._bindPanZoom();
      this.render();
    },

    // ---------- 索引（惰性构建一次） ----------
    _index() {
      if (this._idx) return this._idx;
      const data = this._data || {};
      const raById = new Map((data.ra_ops || []).map((r) => [r.id, r]));
      const opById = new Map((data.child_ops || []).map((c) => [c.id, c]));
      const crById = new Map((data.change_requests || []).map((c) => [c.id, c]));
      const opsOfRa = new Map();
      for (const e of data.edges?.ra_to_child || []) {
        if (!opById.has(e.child_op_id)) continue;
        if (!opsOfRa.has(e.ra_op_id)) opsOfRa.set(e.ra_op_id, []);
        opsOfRa.get(e.ra_op_id).push(e.child_op_id);
      }
      const crsOfOp = new Map();
      for (const e of data.edges?.related_to_cr || []) {
        // related_to_cr 的 related_id 少数指向 parent OP，仅保留合法的 child OP 边
        if (!opById.has(e.related_id) || !crById.has(e.change_request_id)) continue;
        if (!crsOfOp.has(e.related_id)) crsOfOp.set(e.related_id, []);
        crsOfOp.get(e.related_id).push(e.change_request_id);
      }
      const raStats = {};
      for (const [raId, ops] of opsOfRa) {
        let open = 0;
        for (const oid of ops) {
          if (!CLOSED_STATES.has(opById.get(oid)?.state)) open += 1;
        }
        raStats[raId] = { total: ops.length, open };
      }
      const opStats = {};
      for (const [opId, crs] of crsOfOp) {
        let open = 0;
        for (const cid of crs) {
          if (!CLOSED_STATES.has(crById.get(cid)?.state)) open += 1;
        }
        opStats[opId] = { total: crs.length, open };
      }
      // 按 id 倒序（id 大致随时间递增，与 Details 一致）
      for (const m of [opsOfRa, crsOfOp]) {
        for (const ids of m.values()) ids.sort((a, b) => Number(b) - Number(a));
      }
      this._idx = { raById, opById, crById, opsOfRa, crsOfOp, raStats, opStats };
      return this._idx;
    },

    _key(n) { return `${n.kind}:${n.id}`; },

    _nodeData(n) {
      const idx = this._index();
      return n.kind === 'ra' ? idx.raById.get(n.id)
        : n.kind === 'op' ? idx.opById.get(n.id)
        : idx.crById.get(n.id);
    },

    _kids(n) {
      const idx = this._index();
      if (n.kind === 'ra') return (idx.opsOfRa.get(n.id) || []).map((id) => ({ kind: 'op', id }));
      if (n.kind === 'op') return (idx.crsOfOp.get(n.id) || []).map((id) => ({ kind: 'cr', id }));
      return [];
    },

    _kindColor(kind) {
      const nc = (this._agg && this._agg.node_colors) || {};
      return kind === 'ra' ? (nc.ra_op || '#7c3aed')
        : kind === 'op' ? (nc.child_op || '#06b6d4')
        : (nc.change_request || '#22c55e');
    },

    // ---------- 筛选 ----------
    _match(n) {
      if (!this._query) return false;
      const d = this._nodeData(n) || {};
      return String(d.id).toLowerCase().includes(this._query)
        || String(d.summary || '').toLowerCase().includes(this._query);
    },

    // 自身或任一后代命中搜索词
    _hasHit(n) {
      if (this._match(n)) return true;
      for (const k of this._kids(n)) {
        if (this._hasHit(k)) return true;
      }
      return false;
    },

    _roots() {
      const agg = this._agg;
      const idx = this._index();
      const range = readDateRange();
      const raTime = (agg && agg.ra_op_time) || {};
      let rows = Array.from(idx.raById.values());
      if (this._status === 'open') {
        rows = rows.filter((p) => (idx.raStats[p.id] || { open: 0 }).open > 0);
      } else if (this._status === 'closed') {
        rows = rows.filter((p) => {
          const s = idx.raStats[p.id];
          return s && s.total > 0 && s.open === 0;
        });
      }
      if (range.from || range.to) {
        rows = rows.filter((p) => {
          const d = raTime[p.id];
          return d && (!range.from || d >= range.from) && (!range.to || d <= range.to);
        });
      }
      if (this._query) rows = rows.filter((p) => this._hasHit({ kind: 'ra', id: p.id }));
      rows.sort((a, b) => Number(b.id) - Number(a.id));
      return rows;
    },

    // 当前筛选下可见的全部节点（忽略展开状态，供 Expand/Collapse all 使用）。
    // 搜索态可见规则与 _layout 一致：命中节点整棵子树、未命中节点仅命中分支
    _allNodes() {
      const out = [];
      const visit = (n, inMatch) => {
        out.push(n);
        const force = this._query && (inMatch || this._match(n));
        for (const k of this._kids(n)) {
          if (this._query && !force && !this._hasHit(k)) continue;
          visit(k, force);
        }
      };
      for (const ra of this._roots()) visit({ kind: 'ra', id: ra.id }, false);
      return out;
    },

    // ---------- 布局 ----------
    // 叶子按序纵向堆叠，父节点 y = 首末子节点 y 的中点；x 按层级分列。
    // 返回 nodes（含 x/y/kids）与 links（父子连线端点）及画布尺寸。
    _layout() {
      const q = this._query;
      const NH = this._nodeH, RH = this.ROW_GAP, CW = this.CARD_W, CG = this.COL_GAP;
      const nodes = [];
      const links = [];
      let cursor = this.PAD;
      let maxRight = 0;

      const walk = (n, depth, inMatch) => {
        const key = this._key(n);
        const kidsAll = this._kids(n);
        let kids;
        if (q) {
          // 搜索态：命中节点整棵子树强制展开（上下游链路不裁剪），
          // 未命中节点仅保留通向命中的分支；手动收起的除外
          const force = inMatch || this._match(n);
          kids = this._searchCollapsed.has(key) ? []
            : force ? kidsAll
            : kidsAll.filter((k) => this._hasHit(k));
        } else {
          kids = this._expanded.has(key) ? kidsAll : [];
        }
        const node = { kind: n.kind, id: n.id, key, depth, kids: [],
                       x: this.PAD + depth * (CW + CG), y: 0 };
        if (!kids.length) {
          node.y = cursor;
          cursor += NH + RH;
        } else {
          // 父节点与第一个子节点顶部对齐：展开后父节点停在原位不动，
          // 子级向下推开（资源管理器式的展开方向）
          let minY = Infinity;
          for (const k of kids) {
            const kn = walk(k, depth + 1, q && (inMatch || this._match(n)));
            node.kids.push(kn);
            if (kn.y < minY) minY = kn.y;
          }
          node.y = minY;
        }
        maxRight = Math.max(maxRight, node.x + CW);
        nodes.push(node);
        return node;
      };

      for (const ra of this._roots()) walk({ kind: 'ra', id: ra.id }, 0, false);

      for (const node of nodes) {
        const y1 = node.y + NH / 2;
        for (const kn of node.kids) {
          links.push({ key: `${node.key}->${kn.key}`,
                       x1: node.x + CW, y1, x2: kn.x, y2: kn.y + NH / 2 });
        }
      }
      return {
        nodes,
        links,
        W: maxRight + this.PAD,
        H: Math.max(cursor - RH, NH) + this.PAD,
      };
    },

    // ---------- 渲染 ----------
    _ensureNodeH(canvas) {
      if (this._nodeH) return;
      const probe = this._buildNode({ kind: 'ra', id: 0, key: '__probe__' });
      probe.style.visibility = 'hidden';
      canvas.appendChild(probe);
      this._nodeH = probe.offsetHeight || 84;
      probe.remove();
    },

    _buildNode(n) {
      const idx = this._index();
      const sc = (this._agg && this._agg.state_colors) || {};
      const d = this._nodeData(n) || {};
      const el = document.createElement('div');
      el.className = `tnode tnode-${n.kind}`;
      el.dataset.key = n.key;
      const kindLabel = n.kind === 'ra' ? 'RA-OP' : n.kind === 'op' ? 'Child OP' : 'Child CR';
      // RA-OP 无 state 字段：右上角显示创建日期；OP/CR 显示状态徽章
      const side = n.kind === 'ra'
        ? (d.created_date ? `<span class="tnode-date">${esc(d.created_date)}</span>` : '')
        : stateBadgeHtml(sc, d.state);
      const total = n.kind === 'ra' ? (idx.raStats[n.id] || { total: 0 }).total
        : n.kind === 'op' ? (idx.opStats[n.id] || { total: 0 }).total : 0;
      const countHtml = total > 0
        ? `<span class="tnode-count">${fmt.int(total)} ${n.kind === 'ra'
            ? (total === 1 ? 'op' : 'ops')
            : (total === 1 ? 'CR' : 'CRs')}</span>`
        : '';
      const summary = fmt.truncate(d.summary || '(no summary)', 140);
      const kidCount = this._kids(n).length;
      // 收起态按钮内直接显示下一级数量，悬停切换为 +，展开后为 −
      const toggle = kidCount > 0
        ? `<button type="button" class="tnode-toggle" aria-expanded="false"
                   aria-label="Expand ${kidCount} ${n.kind === 'ra' ? 'child OPs' : 'child CRs'} of ${esc(n.id)}">
             <span class="tt-num" aria-hidden="true">${fmt.int(kidCount)}</span>
             <svg class="tt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><line class="v" x1="12" y1="5" x2="12" y2="19"/></svg>
           </button>`
        : '';
      el.innerHTML = `
        <button type="button" class="tnode-body" data-kind="${n.kind}" data-id="${esc(n.id)}"
                aria-label="View details of ${esc(n.id)}">
          <span class="tnode-top">
            <span class="tnode-kind"><i class="dot" aria-hidden="true"></i>${kindLabel}</span>
            ${side}
          </span>
          <span class="tnode-idrow">
            <span class="tnode-id">${esc(n.id)}</span>
            ${countHtml}
          </span>
          <span class="tnode-sum" title="${esc(summary)}">${esc(summary)}</span>
        </button>
        ${toggle}
      `;
      return el;
    },

    render() {
      const canvas = $('#pt-canvas');
      if (!canvas || !this._data) return;
      this._ensureNodeH(canvas);

      const { nodes, links, W, H } = this._layout();
      this._W = W;
      this._H = H;
      canvas.style.width = `${Math.round(W)}px`;
      canvas.style.height = `${Math.round(H)}px`;

      // 连线 keyed 复用：新增的淡入、移除的淡出，与卡片动效同步
      const svg = $('#pt-links');
      if (svg) {
        svg.setAttribute('width', String(Math.round(W)));
        svg.setAttribute('height', String(Math.round(H)));
        const seenLinks = new Set();
        for (const l of links) {
          seenLinks.add(l.key);
          let p = this._linkEls.get(l.key);
          if (!p && this._linksLeaving.has(l.key)) {
            // 收起动画期间重新展开：复活退场中的连线
            clearTimeout(this._linksLeaving.get(l.key).timer);
            p = this._linksLeaving.get(l.key).el;
            p.classList.remove('link-leave');
            this._linksLeaving.delete(l.key);
            this._linkEls.set(l.key, p);
          }
          if (!p) {
            p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('class', 'tree-link');
            this._linkEls.set(l.key, p);
            svg.appendChild(p);
            p.classList.add('link-enter');
            requestAnimationFrame(() =>
              requestAnimationFrame(() => p.classList.remove('link-enter')));
          }
          p.setAttribute('d', treeLinkPath(l.x1, l.y1, l.x2, l.y2));
        }
        for (const [lk, p] of this._linkEls) {
          if (!seenLinks.has(lk)) {
            this._linkEls.delete(lk);
            p.classList.add('link-leave');
            const timer = setTimeout(() => {
              p.remove();
              this._linksLeaving.delete(lk);
            }, 240);
            this._linksLeaving.set(lk, { el: p, timer });
          }
        }
      }

      // keyed 复用已有卡片元素：展开/收起时兄弟节点平滑滑动，
      // 新卡片自父级方向淡入，收起的卡片淡出后再移除
      const seen = new Set();
      for (const n of nodes) {
        seen.add(n.key);
        let el = this._nodeEls.get(n.key);
        if (!el && this._leaving.has(n.key)) {
          // 收起动画期间重新展开：复活退场中的卡片
          clearTimeout(this._leaving.get(n.key).timer);
          el = this._leaving.get(n.key).el;
          el.classList.remove('tnode-leave');
          this._leaving.delete(n.key);
          this._nodeEls.set(n.key, el);
        }
        if (!el) {
          el = this._buildNode(n);
          this._nodeEls.set(n.key, el);
          canvas.appendChild(el);
          el.classList.add('tnode-enter');
          requestAnimationFrame(() =>
            requestAnimationFrame(() => el.classList.remove('tnode-enter')));
        }
        el.style.transform = `translate(${n.x.toFixed(1)}px, ${n.y.toFixed(1)}px)`;
        el.style.setProperty('--tnode-accent', this._kindColor(n.kind));
        el.classList.toggle('hit', !!this._query && this._match(n));
        const exp = this._query
          ? !this._searchCollapsed.has(n.key)
          : this._expanded.has(n.key);
        // 收起时数量由右缘按钮承载，卡片内徽标仅在展开后显示
        el.classList.toggle('expanded', exp);
        const tgl = el.querySelector('.tnode-toggle');
        if (tgl) {
          tgl.setAttribute('aria-expanded', String(exp));
          const cnt = this._kids(n).length;
          tgl.setAttribute('aria-label',
            `${exp ? 'Collapse' : 'Expand'} ${cnt} ${n.kind === 'ra' ? 'child OPs' : 'child CRs'} of ${n.id}`);
        }
      }
      for (const [key, el] of this._nodeEls) {
        if (!seen.has(key)) {
          this._nodeEls.delete(key);
          el.classList.add('tnode-leave');
          const timer = setTimeout(() => {
            el.remove();
            this._leaving.delete(key);
          }, 240);
          this._leaving.set(key, { el, timer });
        }
      }

      // 计数与空态
      const idx = this._index();
      const roots = this._roots();
      const countEl = $('#pt-count');
      if (countEl) {
        const range = readDateRange();
        const filtered = this._status !== 'all' || this._query || range.from || range.to;
        countEl.classList.remove('placeholder');
        countEl.textContent = filtered
          ? `${fmt.int(roots.length)} of ${fmt.int(idx.raById.size)} RA-OPs`
          : `${fmt.int(idx.raById.size)} RA-OPs`;
      }
      const emptyEl = $('#pt-empty');
      if (emptyEl) emptyEl.hidden = nodes.length > 0;

      this._applyTransform();
    },

    // ---------- 平移与缩放 ----------
    _bindPanZoom() {
      const vp = $('#pt-viewport');
      if (!vp || this._panBound) return;
      this._panBound = true;

      let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
      vp.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        // 卡片与缩放控件自身有点击语义，不作为拖拽起点
        if (ev.target.closest('.tree-zoom, .tnode')) return;
        dragging = true;
        sx = ev.clientX; sy = ev.clientY;
        ox = this._tx; oy = this._ty;
        vp.setPointerCapture(ev.pointerId);
      });
      vp.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        this._tx = ox + (ev.clientX - sx);
        this._ty = oy + (ev.clientY - sy);
        this._applyTransform();
      });
      const stop = () => { dragging = false; };
      vp.addEventListener('pointerup', stop);
      vp.addEventListener('pointercancel', stop);

      vp.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const rect = vp.getBoundingClientRect();
        this._zoomAt(this._scale * Math.exp(-ev.deltaY * 0.0016),
                     ev.clientX - rect.left, ev.clientY - rect.top);
      }, { passive: false });

      const zoomCenter = (factor) => {
        const r = vp.getBoundingClientRect();
        this._zoomAt(this._scale * factor, r.width / 2, r.height / 2);
      };
      $('#pt-zoom-in')?.addEventListener('click', () => zoomCenter(1.25));
      $('#pt-zoom-out')?.addEventListener('click', () => zoomCenter(1 / 1.25));
      $('#pt-zoom-reset')?.addEventListener('click', () => {
        this._scale = 1;
        this._tx = 0;
        this._ty = 0;
        this._applyTransform();
      });
      window.addEventListener('resize', () => this._applyTransform());
    },

    _zoomAt(scale, mx, my) {
      const s0 = this._scale;
      const s1 = Math.max(0.35, Math.min(2, scale));
      if (s1 === s0) return;
      // 保持光标下的画布点不动
      this._tx = mx - (mx - this._tx) * (s1 / s0);
      this._ty = my - (my - this._ty) * (s1 / s0);
      this._scale = s1;
      this._applyTransform();
    },

    // 将节点卡片平移进视野（overflow:clip 下浏览器不会自动滚动，
    // 键盘聚焦画布外的卡片时由这里负责带回）
    _revealCard(key) {
      const vp = $('#pt-viewport');
      const el = this._nodeEls.get(key);
      if (!vp || !el) return;
      const r = el.getBoundingClientRect();
      const vr = vp.getBoundingClientRect();
      const margin = 24;
      if (r.top < vr.top + margin) this._ty += vr.top + margin - r.top;
      else if (r.bottom > vr.bottom - margin) this._ty -= r.bottom - (vr.bottom - margin);
      if (r.left < vr.left + margin) this._tx += vr.left + margin - r.left;
      else if (r.right > vr.right - margin) this._tx -= r.right - (vr.right - margin);
      this._applyTransform();
    },

    _applyTransform() {
      const canvas = $('#pt-canvas');
      const vp = $('#pt-viewport');
      if (!canvas || !vp) return;
      // 钳制平移范围：画布最多拖出视口 40px，不允许完全拖飞
      const minX = Math.min(0, vp.clientWidth - this._W * this._scale) - 40;
      const minY = Math.min(0, vp.clientHeight - this._H * this._scale) - 40;
      this._tx = Math.max(minX, Math.min(40, this._tx));
      this._ty = Math.max(minY, Math.min(40, this._ty));
      canvas.style.transform =
        `translate(${this._tx.toFixed(1)}px, ${this._ty.toFixed(1)}px) scale(${this._scale})`;
      const val = $('#pt-zoom-reset');
      if (val) val.textContent = `${Math.round(this._scale * 100)}%`;
    },
  };

  // ===============================================================
  // Sidebar — 侧栏收起/展开（.nav-collapsed 挂在 <html> 上）
  // 首屏前的恢复脚本在 template.html；这里负责切换、aria 与持久化
  // ===============================================================
  const Sidebar = {
    KEY: 'readacross.sidebar',

    init() {
      const btn = $('#sidebar-toggle');
      if (!btn) return;
      const root = document.documentElement;
      const apply = (collapsed) => {
        root.classList.toggle('nav-collapsed', collapsed);
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        btn.title = collapsed ? 'Expand' : 'Collapse';
        try { localStorage.setItem(this.KEY, collapsed ? 'collapsed' : 'expanded'); } catch (e) { /* 隐私模式等场景下忽略 */ }
      };
      // 与首屏前恢复的类同步按钮状态（不改样式，只同步 aria/title）
      apply(root.classList.contains('nav-collapsed'));
      btn.addEventListener('click', () => apply(!root.classList.contains('nav-collapsed')));
    },
  };

  // ===============================================================
  // Pages — 侧边栏导航切换 Overview / Details
  // 页头（标题 + 日期选择器）跨页面共享，只切换下方视图
  // ===============================================================
  const Pages = {
    TITLES: { overview: 'Overview', details: 'Details', projects: 'Graph' },

    init() {
      $$('.nav-item[data-page]').forEach((link) => {
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          this.show(link.dataset.page);
        });
      });
    },

    show(name) {
      if (!this.TITLES[name]) return;
      $$('.nav-item[data-page]').forEach((a) => {
        const on = a.dataset.page === name;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      $$('.page-view').forEach((v) => {
        v.hidden = v.id !== `view-${name}`;
      });
      const h1 = $('#page-title');
      if (h1) h1.textContent = this.TITLES[name];
      document.title = `${this.TITLES[name]} · Read-Across Dashboard`;
    },
  };

  // ===============================================================
  // DetailsDrawer — 行详情右侧抽屉
  // 三种实体（ra / op / cr）：身份区（大号 ID + 状态徽章）+ 完整
  // Summary + 键值明细 + 关联实体迷你行。
  // 打开 = 淡入 + 轻微滑入；Esc / 遮罩 / 关闭按钮关闭；焦点困在
  // 抽屉内，关闭后归还给触发行按钮。
  // ===============================================================
  const DetailsDrawer = {
    _trigger: null,
    _rel: null,
    _closeTimer: null,

    init() {
      const tbody = $('#recent-tx-host');
      if (tbody) {
        tbody.addEventListener('click', (ev) => {
          const btn = ev.target.closest('.row-detail');
          if (!btn) return;
          this.open(btn.dataset.kind, btn.dataset.id, btn);
        });
      }
      $('#drawer-close')?.addEventListener('click', () => this.close());
      $('#drawer-scrim')?.addEventListener('click', () => this.close());
      document.addEventListener('keydown', (ev) => {
        if (!this.isOpen()) return;
        if (ev.key === 'Escape') this.close();
        else if (ev.key === 'Tab') this._trapTab(ev);
      });
    },

    isOpen() {
      const d = $('#drawer');
      return !!d && !d.hidden;
    },

    // 反向关联索引（op → ra、cr → op）与 builds 索引，惰性构建一次
    _ensureRelations(agg, data) {
      if (this._rel) return this._rel;
      const { byRa } = DetailsTable._buildChildIndex(agg, data);
      const { byOp } = DetailsTable._buildCrIndex(agg, data);
      const opToRa = {};
      for (const [raId, ops] of Object.entries(byRa)) {
        for (const oid of ops) opToRa[oid] = Number(raId);
      }
      const crToOp = {};
      for (const [oid, crs] of Object.entries(byOp)) {
        for (const cid of crs) crToOp[cid] = Number(oid);
      }
      const buildById = new Map((data.builds || []).map((b) => [b.id, b]));
      const buildsByCr = {};
      for (const e of data.edges.cr_to_build) {
        (buildsByCr[e.change_request_id] || (buildsByCr[e.change_request_id] = [])).push(e.build_id);
      }
      for (const ids of Object.values(buildsByCr)) {
        ids.sort((a, b) => Number(b) - Number(a));
      }
      const delById = new Map((data.deliveries || []).map((d) => [d.id, d]));
      const delsByOp = {};
      for (const e of data.edges.related_to_delivery) {
        (delsByOp[e.related_id] || (delsByOp[e.related_id] = [])).push(e.delivery_id);
      }
      for (const ids of Object.values(delsByOp)) {
        ids.sort((a, b) => Number(b) - Number(a));
      }
      this._rel = { opToRa, crToOp, buildById, buildsByCr, delById, delsByOp };
      return this._rel;
    },

    open(kind, id, trigger) {
      const agg = AGG();
      const data = DATA();
      if (!agg || !data) return;
      const labels = { ra: 'RA-OP', op: 'Child OP', cr: 'Child CR' };
      if (!labels[kind]) return;
      const html = kind === 'ra' ? this._raHtml(agg, data, Number(id))
        : kind === 'op' ? this._opHtml(agg, data, Number(id))
        : this._crHtml(agg, data, Number(id));
      if (!html) return;
      // 取消尚未生效的关闭定时器，避免关闭后立刻重开时被旧定时器藏掉
      if (this._closeTimer) {
        clearTimeout(this._closeTimer);
        this._closeTimer = null;
      }
      $('#drawer-kind').textContent = labels[kind];
      const body = $('#drawer-body');
      body.innerHTML = html;
      body.scrollTop = 0;
      this._trigger = trigger || null;
      trigger?.closest('tr')?.classList.add('detail-open');
      const drawer = $('#drawer');
      const scrim = $('#drawer-scrim');
      scrim.hidden = false;
      drawer.hidden = false;
      // 强制布局提交“未打开”起始样式后同步加 class——过渡动画确定发生，
      // 不依赖 rAF 时序（页面繁忙时 rAF 可能推迟数百毫秒）
      drawer.getBoundingClientRect();
      scrim.classList.add('open');
      drawer.classList.add('open');
      document.body.classList.add('drawer-open');
      $('#drawer-close').focus();
    },

    close() {
      const drawer = $('#drawer');
      const scrim = $('#drawer-scrim');
      if (!drawer || drawer.hidden) return;
      scrim.classList.remove('open');
      drawer.classList.remove('open');
      document.body.classList.remove('drawer-open');
      this._trigger?.closest('tr')?.classList.remove('detail-open');
      const trigger = this._trigger;
      this._trigger = null;
      this._closeTimer = setTimeout(() => {
        scrim.hidden = true;
        drawer.hidden = true;
        this._closeTimer = null;
      }, 230);
      trigger?.focus();
    },

    _trapTab(ev) {
      const focusables = $('#drawer').querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    },

    // ---------- 内容构建 ----------
    _kv(label, value) {
      if (value === null || value === undefined || value === '') return '';
      return `<div class="drawer-kv"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
    },

    _section(title, inner, count) {
      if (!inner) return '';
      const n = count ? `<span class="drawer-section-count">${esc(count)}</span>` : '';
      return `<section class="drawer-section"><h3 class="drawer-section-title">${esc(title)}${n}</h3>${inner}</section>`;
    },

    _item(id, meta, state, sc) {
      const badge = state ? stateBadgeHtml(sc, state) : '';
      return `<div class="drawer-item"><span class="id">${esc(id)}</span><span class="meta">${esc(meta || '')}</span>${badge}</div>`;
    },

    // 多行卡片：第一行 ID + 日期 + 徽章，第二行完整 Summary。
    // 用于 Delivery / Build 这类带摘要与日期的产物条目。
    _artifact(id, summary, date, badgeState, badgeSc) {
      const badge = badgeState ? stateBadgeHtml(badgeSc, badgeState) : '';
      const dateHtml = date ? `<span class="date">${esc(date)}</span>` : '';
      const sub = summary ? `<div class="drawer-card-sub">${esc(summary)}</div>` : '';
      return `
        <div class="drawer-card">
          <div class="drawer-card-top">
            <span class="id">${esc(id)}</span>
            <span class="drawer-card-side">${dateHtml}${badge}</span>
          </div>
          ${sub}
        </div>
      `;
    },

    _summary(text) {
      if (!text) return '';
      return `<p class="drawer-summary">${esc(text)}</p>`;
    },

    _raHtml(agg, data, id) {
      const p = (data.ra_ops || []).find((r) => r.id === id);
      if (!p) return '';
      const sc = agg.state_colors || {};
      const { byRa, byId: opById, stats } = DetailsTable._buildChildIndex(agg, data);
      const created = (agg.ra_op_time || {})[id];
      const s = stats[id] || { total: 0, open: 0 };
      const parentIds = (data.edges.ra_to_parent || [])
        .filter((e) => e.ra_op_id === id).map((e) => e.parent_op_id);
      const parentItems = parentIds.map((pid) => {
        const po = (data.parent_ops || []).find((x) => x.id === pid);
        return this._item(pid, fmt.project(po?.project), po?.state, sc);
      }).join('');
      const childItems = (byRa[id] || []).map((cid) => {
        const c = opById.get(cid) || {};
        return this._item(cid, fmt.project(c.project), c.state, sc);
      }).join('');
      return `
        <div class="drawer-id">${esc(p.id)}</div>
        ${this._summary(p.summary)}
        ${this._section('Details', this._kv('Project', fmt.project(p.project))
          + this._kv('Created', created)
          + this._kv('Child OPs', `${fmt.int(s.open)} open / ${fmt.int(s.total)} total`))}
        ${this._section('Parent OP', parentItems, parentIds.length ? String(parentIds.length) : '')}
        ${this._section('Child OPs', childItems, String(s.total))}
      `;
    },

    _opHtml(agg, data, id) {
      const c = (data.child_ops || []).find((x) => x.id === id);
      if (!c) return '';
      const sc = agg.state_colors || {};
      const rel = this._ensureRelations(agg, data);
      const crIndex = DetailsTable._buildCrIndex(agg, data);
      const raId = rel.opToRa[id];
      const ra = raId ? (data.ra_ops || []).find((r) => r.id === raId) : null;
      const crIds = crIndex.byOp[id] || [];
      const crItems = crIds.map((crid) => {
        const cr = crIndex.byId.get(crid) || {};
        const team = String(cr.team || '').replace(/^\s*\(\d+\)\s*/, '');
        return this._item(crid, team, cr.state, sc);
      }).join('');
      const raSection = ra
        ? this._section('RA-OP', this._item(ra.id, fmt.truncate(ra.summary || '', 40), null, sc))
        : '';
      // 关联 Delivery
      const delIds = rel.delsByOp[id] || [];
      const delItems = delIds.map((did) => {
        const d = rel.delById.get(did) || {};
        return this._artifact(did, d.summary, d.target_date, null, sc);
      }).join('');
      // Created：child_op 无 created_date 字段时，用关联 Delivery / Build 的
      // 最早 target_date 作近似（与 compute_ra_op_time 的回退约定一致）
      let created = c.created_date;
      if (!created) {
        const dates = [];
        for (const did of delIds) {
          const d = rel.delById.get(did);
          if (d?.target_date) dates.push(d.target_date);
        }
        for (const crid of crIds) {
          for (const bid of rel.buildsByCr[crid] || []) {
            const b = rel.buildById.get(bid);
            if (b?.target_date) dates.push(b.target_date);
          }
        }
        created = dates.length ? dates.sort()[0] : '';
      }
      return `
        <div class="drawer-identity">
          <div class="drawer-id">${esc(c.id)}</div>
          ${stateBadgeHtml(sc, c.state)}
        </div>
        ${this._summary(c.summary)}
        ${this._section('Details', this._kv('Project', fmt.project(c.project)) + this._kv('Created', created))}
        ${raSection}
        ${this._section('Deliveries', delItems, delIds.length ? String(delIds.length) : '')}
        ${this._section('Child CRs', crItems, crIds.length ? String(crIds.length) : '')}
      `;
    },

    _crHtml(agg, data, id) {
      const cr = (data.change_requests || []).find((x) => x.id === id);
      if (!cr) return '';
      const sc = agg.state_colors || {};
      const mc = agg.maturity_colors || {};
      const rel = this._ensureRelations(agg, data);
      const opId = rel.crToOp[id];
      const op = opId ? DetailsTable._buildChildIndex(agg, data).byId.get(opId) : null;
      const buildIds = rel.buildsByCr[id] || [];
      const buildItems = buildIds.map((bid) => {
        const b = rel.buildById.get(bid) || {};
        return this._artifact(bid, b.summary, b.target_date || b.planned_completion_date,
          b.maturity_level || null, mc);
      }).join('');
      const opSection = op
        ? this._section('Child OP', this._item(op.id, fmt.truncate(op.summary || '', 40), op.state, sc))
        : '';
      return `
        <div class="drawer-identity">
          <div class="drawer-id">${esc(cr.id)}</div>
          ${stateBadgeHtml(sc, cr.state)}
        </div>
        ${this._summary(cr.summary)}
        ${this._section('Details', this._kv('Project', fmt.project(cr.project))
          + this._kv('Team', String(cr.team || '').replace(/^\s*\(\d+\)\s*/, ''))
          + this._kv('Owners', cr.owners))}
        ${opSection}
        ${this._section('Builds', buildItems, buildIds.length ? String(buildIds.length) : '')}
      `;
    },
  };

  // ===============================================================
  // TopSearch — 顶部搜索（下拉结果面板 + 键盘导航 + Details 定位）
  // 覆盖全部 6 类实体、大小写不敏感子串匹配，不受日期过滤影响。
  // 点击/回车结果一律跳 Details 视图：ra/op/cr 定位自身行；
  // build/delivery/parent_op 经 edges 反查最近可显示关联行并以 toast 注明。
  // ===============================================================
  const TopSearch = {
    _query: '',
    _results: [], // [{ def, item }]，面板展示顺序 = GROUP_DEFS 顺序
    _active: -1,
    _open: false,
    _chain: null,
    _panelTimer: null,
    _toastTimer: null,

    // 分组定义：顺序即面板展示顺序；text = 参与匹配的文本字段（id 恒参与）
    GROUP_DEFS: [
      { key: 'ra_ops', label: 'RA-OP', kind: 'ra', colorKey: 'ra_op',
        text: (it) => [it.summary, it.project, it.created_date] },
      { key: 'child_ops', label: 'Child OP', kind: 'op', colorKey: 'child_op',
        text: (it) => [it.summary, it.project, it.state] },
      { key: 'change_requests', label: 'Child CR', kind: 'cr', colorKey: 'change_request',
        text: (it) => [it.summary, it.project, it.team, it.owners] },
      { key: 'builds', label: 'Build', kind: 'build', colorKey: 'build',
        text: (it) => [it.summary, it.project, it.maturity_level] },
      { key: 'deliveries', label: 'Delivery', kind: 'delivery', colorKey: 'delivery',
        text: (it) => [it.summary, it.project, it.target_date] },
      { key: 'parent_ops', label: 'Parent OP', kind: 'parent_op', colorKey: 'parent_op',
        text: (it) => [it.summary, it.project, it.state] },
    ],
    PER_GROUP: 5,

    init(agg, data) {
      const input = $('#top-search');
      const panel = $('#search-panel');
      if (!input || !panel) return;

      input.addEventListener('input', () => {
        this._query = input.value.trim();
        if (!this._query) { this.close(); return; }
        this._results = this._search(this._query);
        this._active = this._results.length ? 0 : -1;
        this.open();
        this.render(agg, data);
      });
      // 已有查询时聚焦即重开面板
      input.addEventListener('focus', () => {
        if (this._query) { this.open(); this.render(agg, data); }
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          if (!this._open || !this._results.length) return;
          ev.preventDefault();
          const dir = ev.key === 'ArrowDown' ? 1 : -1;
          this._active = (this._active + dir + this._results.length) % this._results.length;
          this._syncActive(panel);
        } else if (ev.key === 'Enter') {
          if (!this._open || !this._results.length) return;
          ev.preventDefault();
          this._go(this._results[this._active], agg, data);
        } else if (ev.key === 'Escape') {
          if (!this._open) return;
          ev.stopPropagation(); // 面板的 Esc 不应同时波及抽屉/气泡
          this.close();
          input.blur();
        }
      });
      // ⌘K / Ctrl+K 全局聚焦搜索框
      document.addEventListener('keydown', (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && String(ev.key).toLowerCase() === 'k') {
          ev.preventDefault();
          input.focus();
          input.select();
        }
      });
      // 点击面板外关闭（mousedown 判定，先于行点击的 preventDefault）
      document.addEventListener('mousedown', (ev) => {
        if (this._open && !ev.target.closest('.search')) this.close();
      });
      // 行内按下鼠标不转移焦点（保持输入框焦点与面板打开），click 再跳转
      panel.addEventListener('mousedown', (ev) => {
        if (ev.target.closest('.search-row')) ev.preventDefault();
      });
      panel.addEventListener('click', (ev) => {
        const row = ev.target.closest('.search-row');
        if (!row) return;
        this._go(this._results[Number(row.dataset.idx)], agg, data);
      });
    },

    open() {
      const panel = $('#search-panel');
      const input = $('#top-search');
      if (!panel) return;
      if (this._panelTimer) { clearTimeout(this._panelTimer); this._panelTimer = null; }
      panel.hidden = false;
      // 强制布局提交“未打开”起始样式后同步加 class——过渡动画确定发生
      panel.getBoundingClientRect();
      panel.classList.add('open');
      this._open = true;
      if (input) input.setAttribute('aria-expanded', 'true');
    },

    close() {
      const panel = $('#search-panel');
      const input = $('#top-search');
      if (!panel) return;
      if (this._panelTimer) clearTimeout(this._panelTimer);
      panel.classList.remove('open');
      this._panelTimer = setTimeout(() => { panel.hidden = true; }, 160);
      this._open = false;
      if (input) input.setAttribute('aria-expanded', 'false');
    },

    // 全量子串扫描（~1,900 条，无 debounce 必要，同 #pt-search 先例）
    _search(q) {
      const data = DATA();
      if (!data) return [];
      const needle = q.toLowerCase();
      const digits = /^\d+$/.test(q) ? q : null;
      const out = [];
      for (const def of this.GROUP_DEFS) {
        const hits = [];
        for (const it of (data[def.key] || [])) {
          const inId = String(it.id).toLowerCase().includes(needle);
          const inText = inId || def.text(it).some((f) => String(f == null ? '' : f).toLowerCase().includes(needle));
          if (inText) hits.push({ def, item: it });
        }
        if (!hits.length) continue;
        // 纯数字查询：ID 前缀命中排前；组内按 id 倒序（新者优先）
        hits.sort((a, b) => {
          if (digits) {
            const pa = String(a.item.id).startsWith(digits) ? 0 : 1;
            const pb = String(b.item.id).startsWith(digits) ? 0 : 1;
            if (pa !== pb) return pa - pb;
          }
          return Number(b.item.id) - Number(a.item.id);
        });
        out.push(...hits.slice(0, this.PER_GROUP));
      }
      return out;
    },

    render(agg, data) {
      const panel = $('#search-panel');
      if (!panel || !this._open) return;
      if (!this._results.length) {
        panel.innerHTML = `<div class="search-empty">No results for “${esc(this._query)}”</div>`;
        panel.removeAttribute('aria-activedescendant');
        return;
      }
      const nc = (agg && agg.node_colors) || {};
      const sc = (agg && agg.state_colors) || {};
      const mc = (agg && agg.maturity_colors) || {};
      let html = '';
      let lastLabel = null;
      this._results.forEach((r, i) => {
        if (r.def.label !== lastLabel) {
          lastLabel = r.def.label;
          const n = this._results.filter((x) => x.def.label === lastLabel).length;
          html += `<div class="search-group-head">${esc(r.def.label)}<span class="search-group-n">· ${n}</span></div>`;
        }
        const it = r.item;
        const color = nc[r.def.colorKey] || '#64748b';
        // 徽章：Build 用 maturity，其余有 state 用 state；无状态实体显示日期
        let badge = '';
        if (r.def.kind === 'build') badge = stateBadgeHtml(mc, it.maturity_level);
        else if (it.state) badge = stateBadgeHtml(sc, it.state);
        else if (it.created_date || it.target_date) {
          badge = `<span style="font-size:11px;color:var(--muted)">${esc(it.created_date || it.target_date)}</span>`;
        }
        html += `
          <button type="button" class="search-row${i === this._active ? ' active' : ''}" role="option" id="search-opt-${i}" data-idx="${i}" aria-selected="${i === this._active}">
            <span class="search-type" style="background:${esc(color)}" aria-hidden="true"></span>
            <span class="search-id">${this._hi(String(it.id), this._query)}</span>
            <span class="search-name">${this._hi(fmt.truncate(String(it.summary || '(no summary)'), 70), this._query)}</span>
            ${badge ? `<span class="search-badge">${badge}</span>` : ''}
          </button>`;
      });
      panel.innerHTML = html;
      panel.setAttribute('aria-activedescendant', `search-opt-${Math.max(0, this._active)}`);
    },

    // 命中高亮：按命中位置切分、逐段 esc 后对命中段包 <mark>，全程转义
    _hi(text, q) {
      const s = String(text);
      const nq = q.toLowerCase();
      if (!nq) return esc(s);
      const lower = s.toLowerCase();
      let out = '';
      let i = 0;
      while (i < s.length) {
        const hit = lower.indexOf(nq, i);
        if (hit < 0) { out += esc(s.slice(i)); break; }
        if (hit > i) out += esc(s.slice(i, hit));
        out += `<mark>${esc(s.slice(hit, hit + nq.length))}</mark>`;
        i = hit + nq.length;
      }
      return out;
    },

    _syncActive(panel) {
      $$('.search-row', panel).forEach((el) => {
        const on = Number(el.dataset.idx) === this._active;
        el.classList.toggle('active', on);
        el.setAttribute('aria-selected', String(on));
      });
      panel.setAttribute('aria-activedescendant', `search-opt-${Math.max(0, this._active)}`);
      const el = $(`.search-row[data-idx="${this._active}"]`, panel);
      if (el) el.scrollIntoView({ block: 'nearest' });
    },

    // edges 反查索引（惰性）：每类无行实体 → Details 表可显示的最近关联行。
    // related_to_cr / related_to_delivery 的 related_id 少数指向 parent OP，
    // 只保留指向合法 child OP 的边（与 ProjectTree 的处理一致）。
    _buildChain(data) {
      if (this._chain) return this._chain;
      const opIds = new Set((data.child_ops || []).map((c) => String(c.id)));
      const opToRa = {};
      for (const e of data.edges.ra_to_child) opToRa[String(e.child_op_id)] = String(e.ra_op_id);
      const crToOp = {};
      for (const e of data.edges.related_to_cr) {
        const oid = String(e.related_id);
        if (opIds.has(oid)) crToOp[String(e.change_request_id)] = oid;
      }
      const delToOp = {};
      for (const e of data.edges.related_to_delivery) {
        const oid = String(e.related_id);
        if (opIds.has(oid)) delToOp[String(e.delivery_id)] = oid;
      }
      const buildToCr = {};
      for (const e of data.edges.cr_to_build) buildToCr[String(e.build_id)] = String(e.change_request_id);
      const parentToRa = {};
      for (const e of data.edges.ra_to_parent) parentToRa[String(e.parent_op_id)] = String(e.ra_op_id);
      this._chain = { opToRa, crToOp, delToOp, buildToCr, parentToRa };
      return this._chain;
    },

    // 点击结果 → Details 定位目标；via = 原实体类型（toast 用），无链返回 null
    _locateTarget(kind, id, data) {
      const chain = this._buildChain(data);
      if (kind === 'ra' || kind === 'op' || kind === 'cr') return { kind, id, via: null };
      if (kind === 'parent_op') {
        const raId = chain.parentToRa[id];
        return raId ? { kind: 'ra', id: raId, via: 'Parent OP' } : null;
      }
      if (kind === 'delivery') {
        const opId = chain.delToOp[id];
        return opId ? { kind: 'op', id: opId, via: 'Delivery' } : null;
      }
      if (kind === 'build') {
        const crId = chain.buildToCr[id];
        return crId ? { kind: 'cr', id: crId, via: 'Build' } : null;
      }
      return null;
    },

    _go(r, agg, data) {
      if (!r) return;
      this.close();
      const input = $('#top-search');
      if (input) { input.value = ''; input.blur(); }
      this._query = '';
      this._results = [];

      const target = this._locateTarget(r.def.kind, String(r.item.id), data);
      if (!target) {
        this.toast(`No related row found for ${r.def.label} ${r.item.id}`);
        return;
      }
      Pages.show('details');
      const kindLabel = target.kind === 'ra' ? 'RA-OP' : target.kind === 'op' ? 'Child OP' : 'Child CR';
      const loc = DetailsTable.locate(agg, data, target.kind, target.id);
      if (!loc.found) {
        this.toast(`Could not locate ${r.def.label} ${r.item.id} in Details`);
        return;
      }
      if (loc.clearedDate) {
        this.toast(`Date filter cleared to show ${kindLabel} ${target.id}`);
      }
      const attr = target.kind === 'ra' ? 'data-ra-id' : target.kind === 'op' ? 'data-op-id' : 'data-cr-id';
      const row = $(`#recent-tx-host tr[${attr}="${target.id}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center' });
        row.classList.remove('row-flash');
        void row.offsetWidth; // 重启动画
        row.classList.add('row-flash');
        row.addEventListener('animationend', () => row.classList.remove('row-flash'), { once: true });
      }
      if (target.via) this.toast(`${target.via} ${r.item.id} — located its ${kindLabel} ${target.id}`);
    },

    toast(msg) {
      const el = $('#toast');
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
      el.getBoundingClientRect();
      el.classList.add('show');
      if (this._toastTimer) clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        el.classList.remove('show');
        this._toastTimer = setTimeout(() => { el.hidden = true; }, 240);
      }, 2600);
    },
  };

  // ---------- helpers ----------
  let _measureCtx = null;
  // 读取共享日期区间：起点晚于终点时自动交换，保证过滤始终有意义
  function readDateRange() {
    const fromEl = $('#date-from');
    const toEl = $('#date-to');
    if (fromEl && toEl && fromEl.value && toEl.value && fromEl.value > toEl.value) {
      [fromEl.value, toEl.value] = [toEl.value, fromEl.value];
    }
    const range = {
      from: fromEl ? fromEl.value : '',
      to: toEl ? toEl.value : '',
    };
    const pill = $('#date-range');
    if (pill) pill.classList.toggle('has-filter', !!(range.from || range.to));
    return range;
  }

  function textWidth(s, fontSize) {
    try {
      _measureCtx = _measureCtx || document.createElement('canvas').getContext('2d');
      _measureCtx.font = `${fontSize}px -apple-system,Segoe UI,sans-serif`;
      return _measureCtx.measureText(s).width * 1.05;
    } catch (e) {
      return String(s == null ? '' : s).length * fontSize * 0.62;
    }
  }

  function truncateToWidth(s, maxW, measure) {
    if (measure(s) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measure(s.slice(0, mid) + '…') <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return (lo > 0 ? s.slice(0, lo) : '') + '…';
  }

  function topRoundedBarPath(x, y, w, h, r) {
    const rr = Math.min(r, h, w / 2);
    return [
      `M${x.toFixed(1)},${(y + h).toFixed(1)}`,
      `L${x.toFixed(1)},${(y + rr).toFixed(1)}`,
      `Q${x.toFixed(1)},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)}`,
      `L${(x + w - rr).toFixed(1)},${y.toFixed(1)}`,
      `Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)}`,
      `L${(x + w).toFixed(1)},${(y + h).toFixed(1)}`,
      'Z',
    ].join(' ');
  }

  // 树图谱连线：父卡片右缘中点 → 子卡片左缘中点的肘形路径，
  // 中点处垂直转折，转角用二次曲线倒圆；同一水平线时退化为直线
  function treeLinkPath(x1, y1, x2, y2) {
    if (Math.abs(y2 - y1) < 1) {
      return `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    const mx = (x1 + x2) / 2;
    const dir = y2 > y1 ? 1 : -1;
    const r = Math.min(10, Math.abs(y2 - y1) / 2);
    return [
      `M${x1.toFixed(1)},${y1.toFixed(1)}`,
      `L${(mx - r).toFixed(1)},${y1.toFixed(1)}`,
      `Q${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${(y1 + dir * r).toFixed(1)}`,
      `L${mx.toFixed(1)},${(y2 - dir * r).toFixed(1)}`,
      `Q${mx.toFixed(1)},${y2.toFixed(1)} ${(mx + r).toFixed(1)},${y2.toFixed(1)}`,
      `L${x2.toFixed(1)},${y2.toFixed(1)}`,
    ].join(' ');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function hexAlpha(hex, alpha) {
    // '#2563eb' + 0.12 → 'rgba(37,99,235,0.12)'
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return `rgba(100,116,139,${alpha})`;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function stateBadgeHtml(sc, state) {
    const s = state || '(empty)';
    const color = sc[s] || '#64748b';
    return `<span class="status-badge" style="background:${hexAlpha(color, 0.12)};color:${color}">${esc(String(s).replace(/^ALM_/, ''))}</span>`;
  }

  // ===============================================================
  // Mount
  // ===============================================================
  // 日期区间变化 / 清空后的全站联动重渲染；boot 与 TopSearch（定位时
  // 自动清除冲突日期过滤）共用。读取放在函数内，保证拿到的总是当前聚合。
  function refreshAll() {
    const agg = AGG();
    const data = DATA();
    if (!agg || !data) return;
    try { Summary.render(agg, data); } catch (e) { console.error('Summary (filter):', e); }
    try { ProjectStateChart.render(agg, data); } catch (e) { console.error('ProjectStateChart (filter):', e); }
    try { DetailsTable.reset(); DetailsTable.render(agg, data); } catch (e) { console.error('DetailsTable (filter):', e); }
    try { ProjectTree.render(agg, data); } catch (e) { console.error('ProjectTree (filter):', e); }
  }

  function clearDateFilter() {
    ['date-from', 'date-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    refreshAll();
  }

  document.addEventListener('DOMContentLoaded', function () {
    const payload = window.__PAYLOAD__;
    if (!payload) {
      console.error('[ReadAcross] __PAYLOAD__ missing');
      return;
    }
    const agg = AGG();
    const data = DATA();

    // 状态闭环集合以聚合端为准（known-issue #1 修复），须在首次 render 前生效
    if (agg && Array.isArray(agg.closed_states) && agg.closed_states.length) {
      CLOSED_STATES = new Set(agg.closed_states);
    }

    try { Summary.render(agg, data); } catch (e) { console.error('Summary:', e); }
    try { Target.render(agg); } catch (e) { console.error('Target:', e); }
    try { ProjectStateChart.render(agg, data); } catch (e) { console.error('ProjectStateChart:', e); }
    try { ProjectStateChart.init(); } catch (e) { console.error('ProjectStateChart init:', e); }
    try { DetailsTable.init(agg, data); DetailsTable.render(agg, data); } catch (e) { console.error('DetailsTable:', e); }
    try { DetailsDrawer.init(); } catch (e) { console.error('DetailsDrawer:', e); }
    try { ProjectTree.init(agg, data); } catch (e) { console.error('ProjectTree:', e); }
    try { TopSearch.init(agg, data); } catch (e) { console.error('TopSearch:', e); }
    Pages.init();
    Sidebar.init();

    ['date-from', 'date-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', refreshAll);
    });
    const clearBtn = document.getElementById('date-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearDateFilter);
  });

  // expose for debugging
  window.Summary = Summary;
  window.Target = Target;
  window.ProjectStateChart = ProjectStateChart;
  window.DetailsTable = DetailsTable;
  window.DetailsDrawer = DetailsDrawer;
  window.ProjectTree = ProjectTree;
  window.Pages = Pages;
  window.Sidebar = Sidebar;
  window.TopSearch = TopSearch;

  // ----- DEBUG: integrity link inspector (only when ?debug=integrity) -----
  // 链接是 HTTPS Web Integrity URL（不再是 integrity:// 自定义协议），
  // 浏览器原生 <a href> 点击会直接在新标签页打开，无需任何 JS 派发。
  // 保留 ?debug=integrity 调试开关：拦截点击、把链接原文打到右上角蓝框，
  // 方便在客户端机器上核对实际 URL 是否被 Mimecast / 浏览器改写。
  if (/[?&]debug=integrity\b/.test(location.search)) {
    const ensureBanner = () => {
      let b = document.getElementById('dbg-integrity-banner');
      if (b) return b;
      b = document.createElement('div');
      b.id = 'dbg-integrity-banner';
      b.style.cssText = [
        'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
        'background:#fff', 'color:#0f172a',
        'border:2px solid #2563eb', 'border-radius:8px',
        'padding:12px 16px', 'font:12px/1.4 ui-monospace,Menlo,monospace',
        'max-width:760px', 'box-shadow:0 6px 18px rgba(0,0,0,.15)',
        'white-space:pre-wrap', 'word-break:break-all',
      ].join(';');
      b.textContent = 'DEBUG: click an ID in the Details table to see the URL the browser would navigate to.';
      document.body.appendChild(b);
      return b;
    };
    ensureBanner();
    document.addEventListener('click', (ev) => {
      const link = ev.target.closest && ev.target.closest('a.tx-id-link');
      if (!link) return;
      ev.preventDefault();
      ev.stopPropagation();
      const href = link.getAttribute('href') || '(no href)';
      const b = ensureBanner();
      b.textContent =
        'DEBUG — click intercepted, navigation blocked.\n' +
        '\n' +
        `  link text:   "${link.textContent}"\n` +
        `  href attr:   "${href}"\n` +
        `  href length: ${href.length}\n` +
        `  startsWithSpace: ${href.startsWith(' ')}\n` +
        '\n' +
        'If href attr looks correct, the issue is in how the OS / Integrity\n' +
        'client receives the URL when dispatched — not in the page itself.';
    }, true);
  }
})();