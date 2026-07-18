const NAMES = [
  'Avery Chen', 'Jordan Patel', 'Riley Kim', 'Morgan Diaz', 'Casey Nguyen',
  'Taylor Brooks', 'Sam Okafor', 'Drew Bennett', 'Quinn Lee', 'Reese Martin',
  'Skylar Iverson', 'Hayden Russo', 'Parker Wong', 'Rowan Singh', 'Emerson Cole',
  'Sage Holloway', 'Adrian Ortiz', 'Bryn Cohen', 'Cameron Hayes', 'Devon Foster',
];

const COMPANIES = ['Acme', 'Vector', 'Northwind', 'Globex', 'Hooli', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Wonka'];

const PLANS = ['Free', 'Pro', 'Team', 'Enterprise'];
const STATUSES = ['active', 'trialing', 'past_due', 'paused'];

// Monthly price band per plan. Paid plans get a deterministic amount inside the
// band; Free is always $0 so the revenue view never shows revenue on a free seat.
const PLAN_MRR = {
  Free: [0, 0],
  Pro: [20, 60],
  Team: [80, 240],
  Enterprise: [300, 900],
};

function seededRand(seed) {
  // Scramble + warm up: raw Park-Miller with small consecutive seeds (day
  // buckets differ by 1) yields nearly identical first draws, which rendered
  // the revenue series as a flat line with sub-cent axis ticks and pinned
  // every day-over-day delta at 0%.
  let s = (Math.imul(seed, 2654435761) >>> 0) % 2147483647;
  if (s <= 0) s += 2147483646;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  next(); next(); next();
  return next;
}

function dayBucket(d = new Date()) {
  return Math.floor(d.getTime() / (1000 * 60 * 60 * 24));
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// The canonical 47-user set. Built once per call from a per-user seed so plan,
// status, MRR and join date are internally consistent (a Free user is $0, an
// Enterprise user's MRR sits in the Enterprise band). Every view derives from
// this so numbers agree across Users, Revenue and Overview.
function buildUsers() {
  return Array.from({ length: 47 }, (_, i) => {
    const r = seededRand(100 + i);
    const name = NAMES[i % NAMES.length];
    const suffix = i >= NAMES.length ? i : '';
    const plan = pick(r, PLANS);
    const [lo, hi] = PLAN_MRR[plan];
    const mrr = hi === 0 ? 0 : Math.round(lo + r() * (hi - lo));
    return {
      id: `usr_${(1000 + i).toString(36)}`,
      name,
      email: `${name.toLowerCase().replace(' ', '.')}${suffix}@${pick(r, COMPANIES).toLowerCase()}.com`,
      plan,
      status: pick(r, STATUSES),
      mrr,
      createdAt: new Date(Date.now() - Math.floor(r() * 90) * 86400000).toISOString(),
    };
  });
}

function stats() {
  const today = dayBucket();
  const rand = seededRand(today);
  const yesterday = seededRand(today - 1);

  const mrr = 18000 + Math.floor(rand() * 9000);
  const mrrPrev = 18000 + Math.floor(yesterday() * 9000);
  const signups = 40 + Math.floor(rand() * 30);
  const signupsPrev = 40 + Math.floor(yesterday() * 30);
  const churn = 1.2 + rand() * 1.6;
  const churnPrev = 1.2 + yesterday() * 1.6;
  const active = 1200 + Math.floor(rand() * 400);
  const activePrev = 1200 + Math.floor(yesterday() * 400);

  return [
    { label: 'MRR', value: `$${mrr.toLocaleString()}`, delta: pctDelta(mrr, mrrPrev), unit: '$' },
    { label: 'Signups (24h)', value: signups, delta: pctDelta(signups, signupsPrev) },
    { label: 'Active users', value: active.toLocaleString(), delta: pctDelta(active, activePrev) },
    { label: 'Churn (30d)', value: `${churn.toFixed(2)}%`, delta: pctDelta(churn, churnPrev), invert: true },
  ];
}

function pctDelta(now, prev) {
  if (!prev) return 0;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

function activitySeries() {
  const today = dayBucket();
  const points = [];
  for (let i = 29; i >= 0; i--) {
    const rand = seededRand(today - i);
    points.push({
      date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
      revenue: 4000 + Math.floor(rand() * 3500),
      signups: 30 + Math.floor(rand() * 40),
    });
  }
  return points;
}

function sortAndPage(list, { page = 1, perPage = 10, sort = 'createdAt', dir = 'desc', filter = '' } = {}) {
  let all = list;
  const q = String(filter).trim().toLowerCase();
  if (q) {
    all = all.filter((u) =>
      Object.values(u).some((v) => String(v).toLowerCase().includes(q))
    );
  }

  const sortable = ['name', 'email', 'plan', 'status', 'mrr', 'createdAt'];
  const sortKey = sortable.includes(sort) ? sort : 'createdAt';
  const direction = dir === 'asc' ? 1 : -1;
  all = all.slice().sort((a, b) => {
    if (a[sortKey] < b[sortKey]) return -1 * direction;
    if (a[sortKey] > b[sortKey]) return 1 * direction;
    return 0;
  });

  const total = all.length;
  const start = (page - 1) * perPage;
  return { total, page, perPage, rows: all.slice(start, start + perPage) };
}

function users(opts) {
  return sortAndPage(buildUsers(), opts);
}

// Aggregate the user set into the numbers the Revenue view needs. Server owns
// the math so the client never has to page through every user to add it up.
function revenue() {
  const all = buildUsers();
  const paid = all.filter((u) => u.mrr > 0);
  const totalMrr = paid.reduce((s, u) => s + u.mrr, 0);

  const byPlan = PLANS.map((plan) => {
    const rows = all.filter((u) => u.plan === plan);
    const mrr = rows.reduce((s, u) => s + u.mrr, 0);
    return {
      plan,
      customers: rows.length,
      mrr,
      share: totalMrr ? Math.round((mrr / totalMrr) * 100) : 0,
    };
  });

  const top = paid
    .slice()
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 6)
    .map((u) => ({ name: u.name, email: u.email, plan: u.plan, mrr: u.mrr }));

  return {
    totalMrr,
    arr: totalMrr * 12,
    arpu: paid.length ? Math.round(totalMrr / paid.length) : 0,
    paidCount: paid.length,
    totalCount: all.length,
    byPlan,
    top,
  };
}

module.exports = { stats, activitySeries, users, revenue };
