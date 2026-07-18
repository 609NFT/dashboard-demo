const state = {
  sort: 'createdAt',
  dir: 'desc',
  page: 1,
  perPage: 10,
  filter: '',
};

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json();
}

const STAT_ICONS = {
  mrr: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  signups: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  active: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  churn: '<path d="M3 3v18h18"/><path d="M19 9l-5 5-3-3-4 4"/>',
};
function iconFor(label) {
  const l = label.toLowerCase();
  if (l.includes('mrr') || l.includes('revenue')) return STAT_ICONS.mrr;
  if (l.includes('signup')) return STAT_ICONS.signups;
  if (l.includes('churn')) return STAT_ICONS.churn;
  return STAT_ICONS.active;
}

async function loadStats() {
  const grid = document.getElementById('stat-grid');
  let stats;
  try {
    ({ stats } = await fetchJSON('/api/stats'));
  } catch (err) {
    grid.innerHTML = '<div class="load-error">Couldn\'t load stats.</div>';
    return;
  }
  grid.innerHTML = stats.map((s) => {
    const positive = s.invert ? s.delta < 0 : s.delta > 0;
    const up = s.delta > 0;
    const cls = positive ? 'pos' : 'neg';
    const caret = up
      ? '<path d="M12 19V5M5 12l7-7 7 7"/>'
      : '<path d="M12 5v14M5 12l7 7 7-7"/>';
    return `
      <div class="stat-card">
        <div class="stat-top">
          <span class="stat-label">${escape(s.label)}</span>
          <span class="stat-ico" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${iconFor(s.label)}</svg>
          </span>
        </div>
        <div class="stat-value">${escape(String(s.value))}</div>
        <div class="stat-delta ${cls}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caret}</svg>
          ${Math.abs(s.delta)}%
          <span class="delta-note">vs yesterday</span>
        </div>
      </div>`;
  }).join('');
}

let chart = null;
async function loadChart() {
  if (typeof Chart === 'undefined') return;
  let series;
  try {
    ({ series } = await fetchJSON('/api/activity'));
  } catch (err) {
    return;
  }
  const labels = series.map((p) => {
    const d = new Date(p.date + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
  const revenue = series.map((p) => p.revenue);
  const signups = series.map((p) => p.signups);
  const ctx = document.getElementById('chart');
  const g = ctx.getContext('2d');

  const revFill = g.createLinearGradient(0, 0, 0, 240);
  revFill.addColorStop(0, 'rgba(99,102,241,0.34)');
  revFill.addColorStop(1, 'rgba(99,102,241,0.01)');
  const sigFill = g.createLinearGradient(0, 0, 0, 240);
  sigFill.addColorStop(0, 'rgba(52,211,153,0.22)');
  sigFill.addColorStop(1, 'rgba(52,211,153,0.01)');

  // Emphasize the final data point on each line with a visible endpoint dot.
  const endpoint = (color) => ({
    radius: revenue.map((_, i) => (i === revenue.length - 1 ? 4 : 0)),
    hoverRadius: 5,
    pointBackgroundColor: color,
    pointBorderColor: '#0a0c11',
    pointBorderWidth: 2,
    pointHoverBorderWidth: 2,
  });

  const font = { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" };
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revenue,
          borderColor: '#818cf8',
          backgroundColor: revFill,
          borderWidth: 2.5,
          fill: true,
          tension: 0.38,
          yAxisID: 'y',
          ...endpoint('#818cf8'),
        },
        {
          label: 'Signups',
          data: signups,
          borderColor: '#34d399',
          backgroundColor: sigFill,
          borderWidth: 2.5,
          fill: true,
          tension: 0.38,
          yAxisID: 'y1',
          ...endpoint('#34d399'),
        },
      ],
    },
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
      scales: {
        y: {
          position: 'left',
          border: { display: false },
          grid: { color: 'rgba(255,255,255,0.055)' },
          ticks: {
            color: '#868da0', font,
            padding: 8, maxTicksLimit: 6,
            callback: (v) => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v),
          },
        },
        y1: {
          position: 'right',
          border: { display: false },
          grid: { drawOnChartArea: false },
          ticks: { color: '#868da0', font, padding: 8, maxTicksLimit: 6 },
        },
        x: {
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: '#868da0', font,
            maxRotation: 0, autoSkip: true, maxTicksLimit: 7,
          },
        },
      },
    },
  });
}

async function loadUsers() {
  const body = document.getElementById('users-body');
  const params = new URLSearchParams({
    page: state.page,
    perPage: state.perPage,
    sort: state.sort,
    dir: state.dir,
    filter: state.filter,
  });
  let rows, total, page, perPage;
  try {
    ({ rows, total, page, perPage } = await fetchJSON(`/api/users?${params}`));
  } catch (err) {
    body.innerHTML = '<tr><td colspan="6" class="load-error">Couldn\'t load users.</td></tr>';
    return;
  }
  const statusLabel = (s) => escape(String(s).replace(/_/g, ' '));
  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-name">${escape(r.name)}</td>
      <td class="muted">${escape(r.email)}</td>
      <td><span class="pill">${escape(r.plan)}</span></td>
      <td><span class="status status-${escape(r.status)}">${statusLabel(r.status)}</span></td>
      <td class="cell-mrr">$${Number(r.mrr).toLocaleString()}</td>
      <td class="muted">${new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
    </tr>
  `).join('');

  const pagination = document.getElementById('pagination');
  const totalPages = Math.ceil(total / perPage);
  const buttons = [];
  for (let i = 1; i <= totalPages; i++) {
    buttons.push(`<button class="${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`);
  }
  pagination.innerHTML = buttons.join('');
  pagination.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.page = parseInt(btn.dataset.page, 10);
      loadUsers();
    });
  });

  const caretSvg = '<span class="th-caret" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    const key = th.dataset.sort;
    if (!th.dataset.label) th.dataset.label = th.textContent.trim();
    const active = state.sort === key;
    th.innerHTML = `<span class="th-inner">${escape(th.dataset.label)}${caretSvg}</span>`;
    th.setAttribute('aria-sort', active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const activate = () => {
      if (state.sort === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = key;
        state.dir = 'asc';
      }
      state.page = 1;
      loadUsers();
    };
    th.onclick = activate;
    th.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    };
  });
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

document.getElementById('user-search').addEventListener('input', (e) => {
  state.filter = e.target.value;
  state.page = 1;
  loadUsers();
});

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

loadStats();
loadChart();
loadUsers();
