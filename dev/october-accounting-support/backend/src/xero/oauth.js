const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db');
const { encrypt } = require('../crypto');

// Xero OAuth2 authorization-code flow for a single organisation.
// Endpoints: https://developer.xero.com/documentation/guides/oauth2/auth-flow

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

// Scopes: read settings/contacts, read reports (VAT + year-end packs), and
// read/write transactions (payments + coded bank transactions on write-back).
const SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.contacts.read',
  'accounting.reports.read',
  'accounting.transactions',
].join(' ');

// CSRF state store. In-memory is fine for a single-user internal tool on one
// process; move to the DB or a signed cookie if the backend is ever scaled out.
const pendingStates = new Map();

const router = express.Router();

router.get('/xero/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI,
    scope: SCOPES,
    state,
  });
  res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
});

router.get('/xero/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!state || !pendingStates.has(state)) {
      return res.status(400).send('Invalid or expired state');
    }
    pendingStates.delete(state);

    const basic = Buffer.from(
      `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
    ).toString('base64');

    const tokenRes = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI,
      }).toString(),
      { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    const connRes = await axios.get(CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const tenant = connRes.data[0];
    if (!tenant) return res.status(400).send('No Xero organisation connected');

    // Tokens are encrypted at rest. Xero rotates the refresh token on every
    // refresh, so the stored value must always be replaced with the newest one.
    await db.query(
      `INSERT INTO xero_connections (tenant_id, tenant_name, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
       ON CONFLICT (tenant_id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at,
             tenant_name = EXCLUDED.tenant_name,
             updated_at = now()`,
      [tenant.tenantId, tenant.tenantName, encrypt(access_token), encrypt(refresh_token), String(expires_in)]
    );

    res.send(`Connected to Xero organisation: ${tenant.tenantName}. You can close this tab.`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
