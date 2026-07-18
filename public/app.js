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
  // reflow so the transition replays if called again quickly
  void el.offsetWidth;
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
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
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

function statCard(s) {
  const positive = s.invert ? s.delta < 0 : s.delta > 0;
  const up = s.delta > 0;
  const cls = positive ? 'pos' : 'neg';
  const caret = up
    ? '<path d="M12 19V5M5 12l7-7 7 7"/>'
    : '<path d="M12 5v14M5 12l7 7 7-7"/>';
  const delta = s.delta == null ? '' : `
        <div class="stat-delta ${cls}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caret}</svg>
          ${Math.abs(s.delta)}%
          <span class="delta-note">${escape(s.note || 'vs yesterday')}</span>
        </div>`;
  const sub = s.sub ? `<div class="stat-sub">${escape(s.sub)}</div>` : '';
  return `
      <div class="stat-card">
        <div class="stat-top">
          <span class="stat-label">${escape(s.label)}</span>
          <span class="stat-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${iconFor(s.label)}</svg>
          </span>
        </div>
        <div class="stat-value">${escape(String(s.value))}</div>
        ${delta || sub}
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
      animation: { duration: 650 },
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

// ---- Views -----------------------------------------------------------------

let chart = null;
function destroyChart() {
  if (chart) { chart.destroy(); chart = null; }
}

function userRow(r) {
  const statusLabel = String(r.status).replace(/_/g, ' ');
  return `
    <tr>
      <td class="cell-name">${escape(r.name)}</td>
      <td class="muted">${escape(r.email)}</td>
      <td><span class="pill">${escape(r.plan)}</span></td>
      <td><span class="status status-${escape(r.status)}">${escape(statusLabel)}</span></td>
      <td class="cell-mrr">${money(r.mrr)}</td>
      <td class="muted">${new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
    </tr>`;
}

async function renderOverview(view) {
  view.innerHTML = `
    <section class="stat-grid" id="stat-grid">${skeletonCards(4)}</section>
    <section class="chart-card">
      <div class="chart-head">
        <div>
          <h2>Revenue and signups</h2>
          <div class="sub">Last 30 days</div>
        </div>
        <div class="legend">
          <span><i class="dot dot-revenue"></i> Revenue</span>
          <span><i class="dot dot-signups"></i> Signups</span>
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

  fetchJSON('/api/stats')
    .then(({ stats }) => { document.getElementById('stat-grid').innerHTML = stats.map(statCard).join(''); })
    .catch(() => { document.getElementById('stat-grid').innerHTML = '<div class="load-error">Couldn\'t load stats.</div>'; });

  fetchJSON('/api/activity')
    .then(({ series }) => { destroyChart(); chart = areaChart(document.getElementById('chart'), series); })
    .catch(() => {});

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
        <input type="search" id="user-search" placeholder="Filter rows…" value="${escape(usersState.filter)}" />
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
  search.addEventListener('input', (e) => {
    usersState.filter = e.target.value;
    usersState.page = 1;
    loadUsers();
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
    : '<tr><td colspan="6" class="muted" style="padding:20px;text-align:center">No users match that filter.</td></tr>';

  const pagination = document.getElementById('pagination');
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) {
    pagination.innerHTML = total ? `<span class="page-count">${total} users</span>` : '';
  } else {
    const buttons = [`<span class="page-count">${total} users</span>`];
    for (let i = 1; i <= totalPages; i++) {
      buttons.push(`<button class="${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`);
    }
    pagination.innerHTML = buttons.join('');
    pagination.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        usersState.page = parseInt(btn.dataset.page, 10);
        loadUsers();
      });
    });
  }

  const caretSvg = '<span class="th-caret" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';
  document.querySelectorAll('#users-body').length && document.querySelectorAll('th[data-sort]').forEach((th) => {
    const key = th.dataset.sort;
    if (!th.dataset.label) th.dataset.label = th.textContent.trim();
    const active = usersState.sort === key;
    th.innerHTML = `<span class="th-inner">${escape(th.dataset.label)}${caretSvg}</span>`;
    th.setAttribute('aria-sort', active ? (usersState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
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
          <div class="sub">Last 30 days</div>
        </div>
        <div class="legend"><span><i class="dot dot-revenue"></i> Daily revenue</span></div>
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

  fetchJSON('/api/activity')
    .then(({ series }) => { destroyChart(); chart = areaChart(document.getElementById('chart'), series, { signups: false }); })
    .catch(() => {});

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
        <td class="cell-name">${escape(c.name)}<div class="muted small">${escape(c.email)}</div></td>
        <td><span class="pill">${escape(c.plan)}</span></td>
        <td class="cell-mrr">${money(c.mrr)}</td>
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
if (!currentRoute() || !location.hash) {
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

router();
