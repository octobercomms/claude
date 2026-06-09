/**
 * PR module proxy — surfaces the October Outreach (OMI) PR REST API inside
 * nvelope. The OMI API key stays server-side here; the SPA calls these routes,
 * not WordPress directly. Read-only for now (dashboards); writes can follow.
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate } = require('../middleware/auth');
const { getSetting } = require('../utils/settings');

router.use(authenticate);

async function omiConfig() {
  // Prefer platform settings (encrypted in DB), fall back to env.
  let base = '';
  let key = '';
  try {
    base = (await getSetting('OMI_BASE')) || '';
    key = (await getSetting('OMI_KEY')) || '';
  } catch (e) { /* settings store optional */ }
  base = base || process.env.OMI_BASE || '';
  key = key || process.env.OMI_KEY || '';
  return { base: base.replace(/\/$/, ''), key };
}

async function omiGet(path, params) {
  const { base, key } = await omiConfig();
  if (!base || !key) {
    const err = new Error('PR module not connected — set OMI_BASE and OMI_KEY in Settings.');
    err.status = 503;
    throw err;
  }
  const { data } = await axios.get(base + path, {
    headers: { 'X-OO-Key': key },
    params: params || {},
    timeout: 15000,
  });
  return data;
}

function fail(res, err) {
  const status = err.status || (err.response && err.response.status) || 502;
  const msg = (err.response && err.response.data && err.response.data.message)
    || err.message || 'PR API request failed';
  res.status(status).json({ error: msg });
}

router.get('/stats', async (req, res) => {
  try { res.json(await omiGet('/stats')); } catch (e) { fail(res, e); }
});

router.get('/editorial-log', async (req, res) => {
  try {
    const { client, status, search, page, per_page } = req.query;
    res.json(await omiGet('/editorial-log', { client, status, search, page, per_page }));
  } catch (e) { fail(res, e); }
});

router.get('/journalists', async (req, res) => {
  try { res.json(await omiGet('/journalists', { client: req.query.client })); } catch (e) { fail(res, e); }
});

router.get('/clients', async (req, res) => {
  try { res.json(await omiGet('/clients')); } catch (e) { fail(res, e); }
});

module.exports = router;
