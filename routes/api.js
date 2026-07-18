const express = require('express');
const mock = require('../lib/mock-data');

const router = express.Router();

router.get('/stats', (req, res) => {
  res.json({ stats: mock.stats() });
});

router.get('/activity', (req, res) => {
  res.json({ series: mock.activitySeries() });
});

router.get('/users', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 10));
  const sort = String(req.query.sort || 'createdAt');
  const dir = String(req.query.dir || 'desc');
  const filter = String(req.query.filter || '');
  res.json(mock.users({ page, perPage, sort, dir, filter }));
});

module.exports = router;
