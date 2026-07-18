# Dashboard

An admin dashboard with sidebar, metric cards, a 30-day Chart.js area chart, and a sortable user table. Backed by a live mock API so the data feels alive — no database required.

## What's inside

```
dashboard/
  server.js              # express + /api routes mounted
  lib/mock-data.js       # seeded random data — varies day by day, deterministic within a day
  routes/api.js          # GET /api/stats, /api/activity, /api/users
  public/index.html      # admin layout
  public/app.js          # fetches /api/* and renders into the page
  public/styles.css      # dark-mode design system
```

## Start it locally

```bash
npm install
npm start
```

Open http://localhost:3000.

## Wiring to real data

The page hits `/api/stats`, `/api/activity`, and `/api/users`. To replace mock data with real numbers from your store, edit `routes/api.js` — that's the only file you need to change. The frontend doesn't care where the data comes from.

## Ask the agent

- "Connect the dashboard to my Postgres — query the `users` and `payments` tables."
- "Add a fifth stat card for refunds."
- "Add a date-range picker that filters the chart."
