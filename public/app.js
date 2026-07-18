// Single-page dashboard: a tiny hash router swaps four real views into #view.
// Each view fetches its own data from /api/* and wires its own controls.

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json();
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function money(n) {
  return '$' + Number(n).toLocaleString();
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  void el.offsetWidth; // reflow so the transition replays on rapid calls
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2200);
}

const STAT_ICONS = {
  mrr: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  signups: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  active: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  churn: '<path d="M3 3v18h18"/><path d="M19 9l-5 5-3-3-4 4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
};
function iconFor(label) {
  const l = label.toLowerCase();
  if (l.includes('mrr') || l.includes('revenue') || l.includes('arr') || l.includes('arpu')) return STAT_ICONS.mrr;
  if (l.includes('signup')) return STAT_ICONS.signups;
  if (l.includes('churn')) return STAT_ICONS.churn;
  if (l.includes('paid') || l.includes('customer') || l.includes('user')) return STAT_ICONS.users;
  return STAT_ICONS.active;
}

// Dependency-free sparkline: a full-width SVG that bleeds to the card edges.
// preserveAspectRatio=none stretches the path to fill; a non-scaling stroke keeps
// the line crisp. Colour (green/red) is driven by the metric's trend direction.
function sparkSVG(data, positive) {
  const w = 110, h = 30, pad = 3;
  const min = Math.min(...data), max = Math.max(...data), range = (max - min) || 1;
  const step = (w - pad * 2) / (data.length - 1);
  const xy = data.map((v, i) => [pad + i * step, h - pad - ((v - min) / range) * (h - pad * 2)]);
  const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = xy[xy.length - 1];
  const area = `${line} L ${last[0].toFixed(1)} ${h} L ${xy[0][0].toFixed(1)} ${h} Z`;
  return `<svg class="spark ${positive ? 'pos' : 'neg'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-fill" d="${area}"/>
    <path class="spark-line" d="${line}"/>
  </svg>`;
}

function statCard(s) {
  const positive = s.invert ? s.delta < 0 : s.delta > 0;
  const up = s.delta > 0;
  const cls = positive ? 'pos' : 'neg';
  const caret = up
    ? '<path d="M12 19V5M5 12l7-7 7 7"/>'
    : '<path d="M12 5v14M5 12l7 7 7-7"/>';
  const foot = s.delta == null
    ? (s.sub ? `<div class="stat-sub">${escape(s.sub)}</div>` : '')
    : `<div class="stat-delta ${cls}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caret}</svg>
          ${Math.abs(s.delta)}%
          <span class="delta-note">${escape(s.note || 'vs yesterday')}</span>
        </div>`;
  const spark = s.spark ? `<div class="stat-spark">${sparkSVG(s.spark, positive)}</div>` : '';
  return `
      <div class="stat-card${spark ? ' has-spark' : ''}">
        <div class="stat-top">
          <span class="stat-label">${escape(s.label)}</span>
          <span class="stat-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${iconFor(s.label)}</svg>
          </span>
        </div>
        <div class="stat-value">${escape(String(s.value))}</div>
        ${foot}
        ${spark}
      </div>`;
}

// Shared area-chart renderer. `datasets` decide which series show and whether
// signups gets its own right axis. Returns the Chart instance to destroy later.
function areaChart(canvas, series, opts = {}) {
  if (typeof Chart === 'undefined') return null;
  const g = canvas.getContext('2d');
  const labels = series.map((p) => {
    const d = new Date(p.date + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });

  const revFill = g.createLinearGradient(0, 0, 0, 240);
  revFill.addColorStop(0, 'rgba(99,102,241,0.34)');
  revFill.addColorStop(1, 'rgba(99,102,241,0.01)');
  const sigFill = g.createLinearGradient(0, 0, 0, 240);
  sigFill.addColorStop(0, 'rgba(52,211,153,0.22)');
  sigFill.addColorStop(1, 'rgba(52,211,153,0.01)');

  const endpoint = (color, len) => ({
    radius: Array.from({ length: len }, (_, i) => (i === len - 1 ? 4 : 0)),
    hoverRadius: 5,
    pointBackgroundColor: color,
    pointBorderColor: '#0a0c11',
    pointBorderWidth: 2,
    pointHoverBorderWidth: 2,
  });

  const font = { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" };
  const revenue = series.map((p) => p.revenue);
  const datasets = [{
    label: 'Revenue',
    data: revenue,
    borderColor: '#818cf8',
    backgroundColor: revFill,
    borderWidth: 2.5,
    fill: true,
    tension: 0.38,
    yAxisID: 'y',
    ...endpoint('#818cf8', revenue.length),
  }];
  if (opts.signups !== false) {
    const signups = series.map((p) => p.signups);
    datasets.push({
      label: 'Signups',
      data: signups,
      borderColor: '#34d399',
      backgroundColor: sigFill,
      borderWidth: 2.5,
      fill: true,
      tension: 0.38,
      yAxisID: 'y1',
      ...endpoint('#34d399', signups.length),
    });
  }

  const scales = {
    y: {
      position: 'left',
      border: { display: false },
      grid: { color: 'rgba(255,255,255,0.055)' },
      ticks: {
        color: '#868da0', font, padding: 8, maxTicksLimit: 6,
        callback: (v) => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
      },
    },
    x: {
      border: { display: false },
      grid: { display: false },
      ticks: { color: '#868da0', font, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
    },
  };
  if (opts.signups !== false) {
    scales.y1 = {
      position: 'right',
      border: { display: false },
      grid: { drawOnChartArea: false },
      ticks: { color: '#868da0', font, padding: 8, maxTicksLimit: 6 },
    };
  }

  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 550 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1b1f2c',
          borderColor: '#333a4d',
          borderWidth: 1,
          titleColor: '#eef0f6',
          bodyColor: '#c4c9d6',
          padding: 10,
          cornerRadius: 8,
          usePointStyle: true,
          bodyFont: font,
          titleFont: { ...font, weight: '600' },
          callbacks: {
            label: (c) => c.dataset.label === 'Revenue'
              ? `  Revenue  $${c.parsed.y.toLocaleString()}`
              : `  Signups  ${c.parsed.y}`,
          },
        },
      },
      scales,
    },
  });
}

// ---- Chart range (7/30/90d), shared by Overview and Revenue ----------------

let chart = null;
let chartRange = 30;
function destroyChart() {
  if (chart) { chart.destroy(); chart = null; }
}

function rangeControl(active) {
  return `<div class="seg" role="tablist" aria-label="Date range">
    ${[7, 30, 90].map((d) => `<button role="tab" aria-selected="${d === active}" class="${d === active ? 'active' : ''}" data-range="${d}">${d}D</button>`).join('')}
  </div>`;
}

async function mountActivityChart(opts = {}) {
  const canvas = document.getElementById('chart');
  const sub = document.getElementById('chart-sub');
  if (!canvas) return;
  try {
    const { series, range } = await fetchJSON('/api/activity?range=' + chartRange);
    if (sub) sub.textContent = `Last ${range} days`;
    destroyChart();
    chart = areaChart(canvas, series, opts);
  } catch (_) { /* leave the previous chart in place */ }
}

function wireRange(scope, opts) {
  scope.querySelectorAll('.seg button').forEach((b) => {
    b.addEventListener('click', () => {
      chartRange = parseInt(b.dataset.range, 10);
      scope.querySelectorAll('.seg button').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', on);
      });
      mountActivityChart(opts);
    });
  });
}

// ---- Views -----------------------------------------------------------------

function userRow(r) {
  const statusLabel = String(r.status).replace(/_/g, ' ');
  return `
    <tr>
      <td data-label="Name" class="cell-name">${escape(r.name)}</td>
      <td data-label="Email" class="muted">${escape(r.email)}</td>
      <td data-label="Plan"><span class="pill">${escape(r.plan)}</span></td>
      <td data-label="Status"><span class="status status-${escape(r.status)}">${escape(statusLabel)}</span></td>
      <td data-label="MRR" class="cell-mrr">${money(r.mrr)}</td>
      <td data-label="Joined" class="muted">${new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
    </tr>`;
}

async function renderOverview(view) {
  view.innerHTML = `
    <section class="stat-grid" id="stat-grid">${skeletonCards(4)}</section>
    <section class="chart-card">
      <div class="chart-head">
        <div>
          <h2>Revenue and signups</h2>
          <div class="sub" id="chart-sub">Last ${chartRange} days</div>
        </div>
        <div class="chart-tools">
          <div class="legend">
            <span><i class="dot dot-revenue"></i> Revenue</span>
            <span><i class="dot dot-signups"></i> Signups</span>
          </div>
          ${rangeControl(chartRange)}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chart" height="220"></canvas></div>
    </section>
    <section class="table-card">
      <div class="table-head">
        <h2>Recent signups</h2>
        <a class="link-btn" href="#/users">View all users →</a>
      </div>
      <div class="table-wrap">
        <table class="users-table">
          <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Status</th><th>MRR</th><th>Joined</th></tr></thead>
          <tbody id="recent-body"><tr><td colspan="6" class="muted" style="padding:16px">Loading…</td></tr></tbody>
        </table>
      </div>
    </section>`;

  wireRange(view, {});
  mountActivityChart({});

  fetchJSON('/api/stats')
    .then(({ stats }) => { document.getElementById('stat-grid').innerHTML = stats.map(statCard).join(''); })
    .catch(() => { document.getElementById('stat-grid').innerHTML = '<div class="load-error">Couldn\'t load stats.</div>'; });

  fetchJSON('/api/users?perPage=6&sort=createdAt&dir=desc')
    .then(({ rows }) => { document.getElementById('recent-body').innerHTML = rows.map(userRow).join(''); })
    .catch(() => { document.getElementById('recent-body').innerHTML = '<tr><td colspan="6" class="load-error">Couldn\'t load users.</td></tr>'; });
}

const usersState = { sort: 'createdAt', dir: 'desc', page: 1, perPage: 10, filter: '' };

async function renderUsers(view) {
  view.innerHTML = `
    <section class="table-card">
      <div class="table-head">
        <h2>Users</h2>
        <div class="search-box">
          <svg class="search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="search" id="user-search" placeholder="Search name, email, plan…" value="${escape(usersState.filter)}" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="users-table">
          <thead>
            <tr>
              <th data-sort="name" tabindex="0" role="columnheader">Name</th>
              <th data-sort="email" tabindex="0" role="columnheader">Email</th>
              <th data-sort="plan" tabindex="0" role="columnheader">Plan</th>
              <th data-sort="status" tabindex="0" role="columnheader">Status</th>
              <th data-sort="mrr" tabindex="0" role="columnheader">MRR</th>
              <th data-sort="createdAt" tabindex="0" role="columnheader">Joined</th>
            </tr>
          </thead>
          <tbody id="users-body"></tbody>
        </table>
      </div>
      <div class="pagination" id="pagination"></div>
    </section>`;

  const search = document.getElementById('user-search');
  let searchTimer;
  search.addEventListener('input', (e) => {
    const v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      usersState.filter = v;
      usersState.page = 1;
      loadUsers();
    }, 200);
  });

  loadUsers();
}

async function loadUsers() {
  const body = document.getElementById('users-body');
  if (!body) return;
  const params = new URLSearchParams({
    page: usersState.page,
    perPage: usersState.perPage,
    sort: usersState.sort,
    dir: usersState.dir,
    filter: usersState.filter,
  });
  let rows, total, page, perPage;
  try {
    ({ rows, total, page, perPage } = await fetchJSON(`/api/users?${params}`));
  } catch (err) {
    body.innerHTML = '<tr><td colspan="6" class="load-error">Couldn\'t load users.</td></tr>';
    return;
  }
  body.innerHTML = rows.length
    ? rows.map(userRow).join('')
    : '<tr><td colspan="6"><div class="empty-row">No users match “' + escape(usersState.filter) + '”.</div></td></tr>';

  const pagination = document.getElementById('pagination');
  const totalPages = Math.ceil(total / perPage);
  const count = `<span class="page-count">${total} ${total === 1 ? 'user' : 'users'}</span>`;
  if (totalPages <= 1) {
    pagination.innerHTML = total ? count : '';
  } else {
    const buttons = [count];
    for (let i = 1; i <= totalPages; i++) {
      buttons.push(`<button class="${i === page ? 'active' : ''}" data-page="${i}" aria-label="Page ${i}">${i}</button>`);
    }
    pagination.innerHTML = buttons.join('');
    pagination.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        usersState.page = parseInt(btn.dataset.page, 10);
        loadUsers();
        document.querySelector('.table-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  const caretSvg = '<span class="th-caret" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';
  document.querySelectorAll('#view th[data-sort]').forEach((th) => {
    const key = th.dataset.sort;
    if (!th.dataset.label) th.dataset.label = th.textContent.trim();
    const active = usersState.sort === key;
    th.innerHTML = `<span class="th-inner">${escape(th.dataset.label)}${caretSvg}</span>`;
    th.setAttribute('aria-sort', active ? (usersState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.classList.toggle('sorted', active);
    const activate = () => {
      if (usersState.sort === key) {
        usersState.dir = usersState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        usersState.sort = key;
        usersState.dir = 'asc';
      }
      usersState.page = 1;
      loadUsers();
    };
    th.onclick = activate;
    th.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    };
  });
}

async function renderRevenue(view) {
  view.innerHTML = `
    <section class="stat-grid" id="rev-stats">${skeletonCards(4)}</section>
    <section class="chart-card">
      <div class="chart-head">
        <div>
          <h2>Revenue trend</h2>
          <div class="sub" id="chart-sub">Last ${chartRange} days</div>
        </div>
        <div class="chart-tools">
          <div class="legend"><span><i class="dot dot-revenue"></i> Daily revenue</span></div>
          ${rangeControl(chartRange)}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chart" height="220"></canvas></div>
    </section>
    <div class="rev-columns">
      <section class="table-card">
        <div class="table-head"><h2>Revenue by plan</h2></div>
        <div id="by-plan" class="by-plan"><div class="muted" style="padding:12px">Loading…</div></div>
      </section>
      <section class="table-card">
        <div class="table-head"><h2>Top customers</h2></div>
        <div class="table-wrap">
          <table class="users-table">
            <thead><tr><th>Customer</th><th>Plan</th><th>MRR</th></tr></thead>
            <tbody id="top-body"><tr><td colspan="3" class="muted" style="padding:16px">Loading…</td></tr></tbody>
          </table>
        </div>
      </section>
    </div>`;

  wireRange(view, { signups: false });
  mountActivityChart({ signups: false });

  let data;
  try {
    data = await fetchJSON('/api/revenue');
  } catch (err) {
    document.getElementById('rev-stats').innerHTML = '<div class="load-error">Couldn\'t load revenue.</div>';
    return;
  }

  document.getElementById('rev-stats').innerHTML = [
    { label: 'MRR', value: money(data.totalMrr), sub: `${data.paidCount} paying customers` },
    { label: 'ARR', value: money(data.arr), sub: 'Annualized run rate' },
    { label: 'ARPU', value: money(data.arpu), sub: 'Avg revenue / paid user' },
    { label: 'Paid accounts', value: `${data.paidCount}`, sub: `of ${data.totalCount} total` },
  ].map(statCard).join('');

  const max = Math.max(...data.byPlan.map((p) => p.mrr), 1);
  document.getElementById('by-plan').innerHTML = data.byPlan.map((p) => `
    <div class="plan-row">
      <div class="plan-row-top">
        <span class="pill">${escape(p.plan)}</span>
        <span class="muted small">${p.customers} ${p.customers === 1 ? 'customer' : 'customers'}</span>
        <span class="plan-mrr">${money(p.mrr)}</span>
      </div>
      <div class="plan-bar"><span style="width:${Math.round((p.mrr / max) * 100)}%"></span></div>
      <div class="plan-share muted small">${p.share}% of MRR</div>
    </div>`).join('');

  document.getElementById('top-body').innerHTML = data.top.length
    ? data.top.map((c) => `
      <tr>
        <td data-label="Customer" class="cell-name">${escape(c.name)}<div class="muted small">${escape(c.email)}</div></td>
        <td data-label="Plan"><span class="pill">${escape(c.plan)}</span></td>
        <td data-label="MRR" class="cell-mrr">${money(c.mrr)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" class="muted" style="padding:16px">No paying customers yet.</td></tr>';
}

const SETTINGS_KEY = 'dashboard.settings';
const SETTINGS_DEFAULT = {
  workspace: 'Acme Inc.',
  supportEmail: 'support@acme.com',
  notifyProduct: true,
  notifyWeekly: true,
  notifyBilling: false,
};
function loadSettings() {
  try {
    return { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (_) {
    return { ...SETTINGS_DEFAULT };
  }
}

async function renderSettings(view) {
  const s = loadSettings();
  const toggle = (name, label, desc, on) => `
    <label class="setting-toggle">
      <div>
        <div class="setting-name">${label}</div>
        <div class="muted small">${desc}</div>
      </div>
      <span class="switch">
        <input type="checkbox" name="${name}" ${on ? 'checked' : ''} />
        <span class="switch-track" aria-hidden="true"></span>
      </span>
    </label>`;

  view.innerHTML = `
    <form id="settings-form" class="settings">
      <section class="settings-card">
        <h2>Workspace</h2>
        <label class="field">
          <span class="field-label">Workspace name</span>
          <input type="text" name="workspace" value="${escape(s.workspace)}" />
        </label>
        <label class="field">
          <span class="field-label">Support email</span>
          <input type="email" name="supportEmail" value="${escape(s.supportEmail)}" />
        </label>
      </section>

      <section class="settings-card">
        <h2>Notifications</h2>
        ${toggle('notifyProduct', 'Product updates', 'New features and improvements', s.notifyProduct)}
        ${toggle('notifyWeekly', 'Weekly report', 'A summary of your metrics every Monday', s.notifyWeekly)}
        ${toggle('notifyBilling', 'Billing alerts', 'Failed payments and plan changes', s.notifyBilling)}
      </section>

      <section class="settings-card danger">
        <h2>Danger zone</h2>
        <div class="danger-row">
          <div>
            <div class="setting-name">Delete workspace</div>
            <div class="muted small">Permanently remove this workspace and all its data.</div>
          </div>
          <button type="button" class="btn-danger" id="delete-ws">Delete</button>
        </div>
      </section>

      <div class="settings-actions">
        <button type="button" class="btn-ghost" id="reset-btn">Reset</button>
        <button type="submit" class="btn-primary">Save changes</button>
      </div>
    </form>`;

  const form = document.getElementById('settings-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const next = {
      workspace: fd.get('workspace') || '',
      supportEmail: fd.get('supportEmail') || '',
      notifyProduct: form.notifyProduct.checked,
      notifyWeekly: form.notifyWeekly.checked,
      notifyBilling: form.notifyBilling.checked,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    toast('Settings saved');
  });
  document.getElementById('reset-btn').addEventListener('click', () => {
    localStorage.removeItem(SETTINGS_KEY);
    renderSettings(view);
    toast('Settings reset to defaults');
  });
  document.getElementById('delete-ws').addEventListener('click', () => {
    toast('This is a demo — nothing was deleted');
  });
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => '<div class="stat-card skeleton"><div class="sk-line sk-sm"></div><div class="sk-line sk-lg"></div><div class="sk-line sk-md"></div></div>').join('');
}

// ---- Notifications (topbar bell) -------------------------------------------

const NOTIF_ICONS = {
  signup: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  payment: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  churn: '<path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  report: '<path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/>',
};

async function initNotifications() {
  const wrap = document.getElementById('notif');
  const btn = document.getElementById('notif-btn');
  const panel = document.getElementById('notif-panel');
  const dot = document.getElementById('notif-dot');
  if (!wrap || !btn || !panel) return;

  let items = [];
  try { ({ notifications: items } = await fetchJSON('/api/notifications')); } catch (_) { items = []; }

  const unread = () => items.filter((i) => i.unread).length;
  const renderDot = () => { dot.hidden = unread() === 0; };

  const render = () => {
    const n = unread();
    panel.innerHTML = `
      <div class="notif-head">
        <span class="notif-h-title">Notifications ${n ? `<span class="notif-badge">${n}</span>` : ''}</span>
        <button class="notif-clear" id="notif-clear" ${n ? '' : 'disabled'}>Mark all read</button>
      </div>
      <div class="notif-list">
        ${items.length ? items.map((i) => `
          <div class="notif-item ${i.unread ? 'unread' : ''}">
            <span class="notif-ico ${escape(i.type)}" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${NOTIF_ICONS[i.type] || NOTIF_ICONS.report}</svg></span>
            <div class="notif-text">
              <div class="notif-title">${escape(i.title)}</div>
              <div class="notif-body">${escape(i.body)}</div>
            </div>
            <span class="notif-ago">${escape(i.ago)}</span>
          </div>`).join('') : '<div class="notif-empty">You\'re all caught up.</div>'}
      </div>`;
    const clr = document.getElementById('notif-clear');
    if (clr) clr.addEventListener('click', () => {
      items = items.map((i) => ({ ...i, unread: false }));
      render();
      renderDot();
    });
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) render();
  };

  renderDot();
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

// ---- Router ----------------------------------------------------------------

const ROUTES = {
  overview: { title: 'Overview', render: renderOverview },
  users: { title: 'Users', render: renderUsers },
  revenue: { title: 'Revenue', render: renderRevenue },
  settings: { title: 'Settings', render: renderSettings },
};

function currentRoute() {
  const key = (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
  return ROUTES[key] ? key : 'overview';
}

async function router() {
  const key = currentRoute();
  const route = ROUTES[key];
  document.getElementById('page-title').textContent = route.title;
  document.title = `${route.title} · Dashboard`;
  document.querySelectorAll('#nav .nav-item').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === key);
  });
  destroyChart();
  const view = document.getElementById('view');
  view.classList.remove('view-in');
  void view.offsetWidth;
  view.classList.add('view-in');
  await route.render(view);
}

window.addEventListener('hashchange', router);

// Normalize a bare/empty hash to the overview route so refreshes land somewhere.
if (!location.hash || !ROUTES[location.hash.replace(/^#\/?/, '').split('?')[0]]) {
  location.replace('#/overview');
}

// ---- Sidebar (off-canvas on mobile) ----------------------------------------

const hamburger = document.getElementById('hamburger');
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('sidebar-backdrop');
if (hamburger && sidebar) {
  const setOpen = (open) => {
    sidebar.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    if (backdrop) {
      backdrop.classList.toggle('show', open);
      backdrop.hidden = !open;
    }
    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  hamburger.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
  if (backdrop) backdrop.addEventListener('click', () => setOpen(false));
  sidebar.querySelectorAll('.nav-item').forEach((a) => {
    a.addEventListener('click', () => setOpen(false));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) setOpen(false);
  });
}

initNotifications();
router();
