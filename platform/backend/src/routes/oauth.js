const express = require('express');
const pool = require('../db');
const { encrypt } = require('../utils/encryption');
const googleConnector = require('../connectors/google');
const metaConnector = require('../connectors/meta');

const router = express.Router();

// ─── Google OAuth ───────────────────────────────────────────────

router.get('/google/start', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = googleConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`<script>window.opener.postMessage({type:'oauth_error',error:'${error}'},'*');window.close();</script>`);

  try {
    const { client_id } = JSON.parse(Buffer.from(state, 'base64').toString());
    const tokens = await googleConnector.exchangeCode(code);
    const encrypted = encrypt(tokens);

    // Update all Google connectors for this client
    const googleTypes = ['ga4', 'google_search_console', 'google_ads', 'google_merchant_center'];
    for (const type of googleTypes) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
         WHERE client_id = $2 AND connector_type = $3`,
        [JSON.stringify(encrypted), client_id, type]
      );
    }

    res.send(`<script>window.opener.postMessage({type:'oauth_success',provider:'google'},'*');window.close();</script>`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.send(`<script>window.opener.postMessage({type:'oauth_error',error:'${err.message}'},'*');window.close();</script>`);
  }
});

// ─── Meta OAuth ─────────────────────────────────────────────────

router.get('/meta/start', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = metaConnector.getAuthUrl(state);
  res.redirect(url);
});

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`<script>window.opener.postMessage({type:'oauth_error',error:'${error}'},'*');window.close();</script>`);

  try {
    const { client_id } = JSON.parse(Buffer.from(state, 'base64').toString());
    const tokens = await metaConnector.exchangeCode(code);
    const encrypted = encrypt(tokens);

    // Update Meta Ads and Instagram Insights connectors
    const metaTypes = ['meta_ads', 'instagram_insights'];
    for (const type of metaTypes) {
      await pool.query(
        `UPDATE connectors SET credentials = $1, status = 'active', last_checked = NOW(), error_message = NULL
         WHERE client_id = $2 AND connector_type = $3`,
        [JSON.stringify(encrypted), client_id, type]
      );
    }

    res.send(`<script>window.opener.postMessage({type:'oauth_success',provider:'meta'},'*');window.close();</script>`);
  } catch (err) {
    console.error('Meta OAuth callback error:', err);
    res.send(`<script>window.opener.postMessage({type:'oauth_error',error:'${err.message}'},'*');window.close();</script>`);
  }
});

// Reauth link from email alert (token-less, opens OAuth flow)
router.get('/meta/reauth', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).send('client_id required');
  const state = Buffer.from(JSON.stringify({ client_id })).toString('base64');
  const url = metaConnector.getAuthUrl(state);
  res.redirect(url);
});

module.exports = router;
