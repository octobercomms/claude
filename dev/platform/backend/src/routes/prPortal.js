/**
 * Public PR coverage portal — token-gated, NO auth (clients open it without
 * logging in). Shows Published + positive pipeline only; never internal notes.
 */
const express = require('express');
const router = express.Router();
const pr = require('../services/pr');

router.get('/:token', async (req, res) => {
  try {
    const data = await pr.getCoverageByToken(req.params.token);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:token/download', async (req, res) => {
  try {
    const data = await pr.getCoverageByToken(req.params.token);
    if (!data) return res.status(404).send('Not found');
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [['Publication', 'Journalist', 'Country', 'Status', 'Issue Date', 'Link']];
    data.items.forEach((i) => rows.push([i.outlet, i.journalist, i.country, i.status_label, i.issue_date || '', i.story_url || '']));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="coverage-${(data.client_name || 'client').replace(/\W+/g, '-').toLowerCase()}.csv"`);
    res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
  } catch (err) { res.status(500).send('Error'); }
});

module.exports = router;
