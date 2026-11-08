// Accounts module routes.
// Reconciliation queue, rules CRUD, invoice matching, VAT exceptions,
// tax deadlines, digests, and Xero data proxies.

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const accounts = require('../services/accounts');
const xero = require('../connectors/xero');

router.use(authenticate);
router.use(requireAdmin);

// --- Xero OAuth ---

router.get('/xero/auth-url', (req, res) => {
  const clientId = process.env.XERO_CLIENT_ID;
  const redirectUri = process.env.XERO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(400).json({
      error: 'XERO_CLIENT_ID and XERO_REDIRECT_URI must be configured in Settings > Accounts > Xero',
    });
  }
  const crypto = require('crypto');
  const state = crypto.randomBytes(16).toString('hex');
  // Store state in-memory (single-user tool).
  if (!router._xeroStates) router._xeroStates = new Map();
  router._xeroStates.set(state, Date.now());

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: xero.SCOPES,
    state,
  });
  res.json({ url: `${xero.AUTHORIZE_URL}?${params.toString()}` });
});

router.get('/xero/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      const frontendUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/accounts?tab=xero&error=${encodeURIComponent(oauthError)}`);
    }
    if (!code) return res.status(400).json({ error: 'No authorization code' });

    // Validate state to prevent CSRF.
    if (!state || !router._xeroStates || !router._xeroStates.has(state)) {
      const frontendUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/accounts?tab=xero&error=${encodeURIComponent('Invalid OAuth state')}`);
    }
    router._xeroStates.delete(state);

    const axios = require('axios');
    const { encrypt } = require('../utils/encryption');
    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;
    const redirectUri = process.env.XERO_REDIRECT_URI;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await axios.post(
      xero.TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    const connRes = await axios.get(xero.CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const tenant = connRes.data[0];
    if (!tenant) {
      const frontendUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/accounts?tab=xero&error=no_org`);
    }

    await db.query(
      `INSERT INTO xero_connections (tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6)
       ON CONFLICT (tenant_id) DO UPDATE
         SET access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at = EXCLUDED.expires_at,
             tenant_name = EXCLUDED.tenant_name,
             scopes = EXCLUDED.scopes,
             updated_at = now()`,
      [
        tenant.tenantId,
        tenant.tenantName,
        JSON.stringify(encrypt(access_token)),
        JSON.stringify(encrypt(refresh_token)),
        String(expires_in),
        xero.SCOPES,
      ]
    );

    const frontendUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/accounts?tab=xero&connected=1`);
  } catch (err) {
    console.error('[accounts] Xero callback error:', err.response?.data || err.message);
    const frontendUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/accounts?tab=xero&error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/xero/status', async (req, res) => {
  try {
    const status = await xero.getConnectionStatus();
    status.credentialsConfigured = !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.XERO_REDIRECT_URI);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xero/test', async (req, res) => {
  try {
    const result = await xero.testConnection();
    res.json(result);
  } catch (err) {
    console.error('[accounts] Xero test error:', err.message, err.stack);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/xero/disconnect', async (req, res) => {
  try {
    await db.query('DELETE FROM xero_connections');
    res.json({ disconnected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Sync diagnostics (step-by-step, returns where it stalls) ---

router.get('/sync/diagnose', async (req, res) => {
  const steps = [];
  const t0 = Date.now();

  function step(name, ms) {
    steps.push({ step: name, ms, ok: true });
  }
  function fail(name, ms, error) {
    steps.push({ step: name, ms, ok: false, error });
  }

  // Step 1: get token
  let token;
  try {
    const s = Date.now();
    token = await xero.getValidToken();
    step('getValidToken', Date.now() - s);
  } catch (err) {
    fail('getValidToken', Date.now() - t0, err.message);
    return res.json({ steps, totalMs: Date.now() - t0, stalledAt: 'getValidToken' });
  }

  // Step 2: get bank accounts
  let bankAccounts;
  try {
    const s = Date.now();
    bankAccounts = await xero.getBankAccounts(token);
    step('getBankAccounts', Date.now() - s);
    steps[steps.length - 1].count = bankAccounts.length;
    steps[steps.length - 1].accounts = bankAccounts.map(a => ({ name: a.name, id: a.accountId }));
  } catch (err) {
    fail('getBankAccounts', Date.now() - t0, err.message);
    return res.json({ steps, totalMs: Date.now() - t0, stalledAt: 'getBankAccounts' });
  }

  // Step 3: get chart of accounts
  try {
    const s = Date.now();
    const coa = await xero.getChartOfAccounts(token);
    step('getChartOfAccounts', Date.now() - s);
    steps[steps.length - 1].count = (coa || []).length;
  } catch (err) {
    fail('getChartOfAccounts', Date.now() - t0, err.message);
    steps[steps.length - 1].note = 'non-fatal, sync continues without chart';
  }

  // Step 4: get bank statement lines (page 1 only, per account)
  // Call both the raw Xero endpoint and the filtered function so we can
  // distinguish "Xero returned nothing" from "our filter dropped everything".
  for (const account of bankAccounts) {
    try {
      const s = Date.now();
      const lines = await xero.getBankStatementLines(token, account.accountId, { page: 1 });
      const ms = Date.now() - s;
      step(`getBankStatementLines(${account.name})`, ms);
      steps[steps.length - 1].accountId = account.accountId;
      steps[steps.length - 1].filtered = lines.length;

      // Now fetch raw to see what Xero actually returned before client filter
      const s2 = Date.now();
      const rawLines = await xero.getBankStatementLinesRaw(token, account.accountId, { page: 1 });
      steps[steps.length - 1].rawFromXero = rawLines.total;
      steps[steps.length - 1].rawReconciled = rawLines.reconciled;
      steps[steps.length - 1].rawUnreconciled = rawLines.unreconciled;
      steps[steps.length - 1].rawMs = Date.now() - s2;
      if (rawLines.sample) {
        steps[steps.length - 1].sample = rawLines.sample;
      }
    } catch (err) {
      fail(`getBankStatementLines(${account.name})`, Date.now() - t0, err.message);
    }
  }

  // Step 5: DB connectivity check
  try {
    const s = Date.now();
    const { rows } = await db.query('SELECT count(*)::int as total FROM acct_reconcile_queue');
    step('dbQuery(queue count)', Date.now() - s);
    steps[steps.length - 1].queueTotal = rows[0]?.total || 0;
  } catch (err) {
    fail('dbQuery(queue count)', Date.now() - t0, err.message);
  }

  // Step 6: rules engine check
  try {
    const s = Date.now();
    const rules = await accounts.rules.listRules();
    step('listRules', Date.now() - s);
    steps[steps.length - 1].count = rules.length;
  } catch (err) {
    fail('listRules', Date.now() - t0, err.message);
  }

  res.json({ steps, totalMs: Date.now() - t0, stalledAt: null });
});

// --- Sync (manual trigger) ---

const SYNC_TIMEOUT_MS = 90_000;

router.post('/sync', async (req, res) => {
  console.log('[accounts] POST /sync received');
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      console.error('[accounts] Sync timed out after 90s');
      res.status(504).json({ error: 'Sync timed out. Xero or the classification service may be slow to respond. Try again in a minute.' });
    }
  }, SYNC_TIMEOUT_MS);

  try {
    const result = await accounts.reconcile.pullAndClassify({
      since: req.body.since || undefined,
    });
    clearTimeout(timer);
    console.log('[accounts] Sync succeeded:', JSON.stringify(result));
    if (!res.headersSent) res.json(result);
  } catch (err) {
    clearTimeout(timer);
    console.error('[accounts] Sync error:', err.message, err.stack);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// --- Dashboard summary ---

router.get('/dashboard', async (req, res) => {
  try {
    const [queueStats, invoiceStats, upcomingDeadlines] = await Promise.all([
      accounts.reconcile.getQueueStats(),
      accounts.invoices.getInvoiceStats(),
      accounts.deadlines.getUpcoming(30),
    ]);
    res.json({
      queue: queueStats,
      invoices: invoiceStats,
      deadlines: upcomingDeadlines,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Reconciliation queue ---

router.get('/queue', async (req, res) => {
  try {
    const items = await accounts.reconcile.getQueueItems({
      status: req.query.status !== 'all' ? req.query.status : undefined,
      bankAccount: req.query.bankAccount || undefined,
      search: req.query.search || undefined,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    });
    const stats = await accounts.reconcile.getQueueStats();
    res.json({ items, total: stats.total, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/queue/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM acct_reconcile_queue WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:id/approve', async (req, res) => {
  try {
    const result = await accounts.reconcile.confirmItem(
      parseInt(req.params.id),
      req.body || {}
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:id/reject', async (req, res) => {
  try {
    await accounts.reconcile.skipItem(parseInt(req.params.id));
    res.json({ skipped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/auto-confirm', async (req, res) => {
  try {
    const threshold = parseFloat(req.body.threshold) || 0.95;
    const count = await accounts.reconcile.autoConfirmHighConfidence(threshold);
    res.json({ confirmed: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/write-back', async (req, res) => {
  try {
    const result = await accounts.reconcile.writeBackToXero();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/batch-approve', async (req, res) => {
  try {
    const { ids, accountCode, taxRate } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const result = await accounts.reconcile.batchApprove(
      ids.map(Number),
      { accountCode, taxRate }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/batch-skip', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const result = await accounts.reconcile.batchSkip(ids.map(Number));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Rules ---

router.get('/rules', async (req, res) => {
  try {
    const rules = await accounts.rules.listRules({
      search: req.query.search || undefined,
    });
    res.json({ rules, total: rules.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules', async (req, res) => {
  try {
    const rule = await accounts.rules.createRule(req.body);
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/rules/:id', async (req, res) => {
  try {
    const rule = await accounts.rules.updateRule(parseInt(req.params.id), req.body);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules/seed', async (req, res) => {
  try {
    const count = await accounts.rules.seedRules();
    res.json({ seeded: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rules/:id', async (req, res) => {
  try {
    const deleted = await accounts.rules.deleteRule(parseInt(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Invoices ---

router.get('/invoices/stats', async (req, res) => {
  try {
    const stats = await accounts.invoices.getInvoiceStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices/missing', async (req, res) => {
  try {
    const missing = await accounts.invoices.getMissingInvoices();
    res.json({ invoices: missing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- VAT exceptions ---

router.get('/vat/exceptions', async (req, res) => {
  try {
    const period = req.query.period;
    const where = period ? 'WHERE period = $1' : '';
    const params = period ? [period] : [];
    const { rows } = await db.query(
      `SELECT * FROM acct_vat_exceptions ${where} ORDER BY created_at DESC`,
      params
    );
    res.json({ exceptions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vat/exceptions/:id/resolve', async (req, res) => {
  try {
    await db.query(
      `UPDATE acct_vat_exceptions SET resolution = $1, resolved_at = now() WHERE id = $2`,
      [req.body.resolution, parseInt(req.params.id)]
    );
    res.json({ resolved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Tax deadlines ---

router.get('/deadlines', async (req, res) => {
  try {
    const deadlines = await accounts.deadlines.getAll();
    res.json({ deadlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deadlines/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const upcoming = await accounts.deadlines.getUpcoming(days);
    res.json({ deadlines: upcoming });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/deadlines/:id', async (req, res) => {
  try {
    const updated = await accounts.deadlines.updateDeadline(
      parseInt(req.params.id),
      req.body
    );
    if (!updated) return res.status(404).json({ error: 'Deadline not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deadlines/seed', async (req, res) => {
  try {
    const { year } = req.body;
    const result = year
      ? await accounts.deadlines.seedForYear(parseInt(year, 10))
      : await accounts.deadlines.seedDeadlines();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Digests ---

router.get('/digests', async (req, res) => {
  try {
    const digests = await accounts.digest.getDigests(parseInt(req.query.limit) || 12);
    res.json({ digests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/digests/build', async (req, res) => {
  try {
    const result = await accounts.digest.buildWeeklyDigest();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/digests/:id/send', async (req, res) => {
  try {
    const result = await accounts.digest.sendDigestEmail(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/digests/build-and-send', async (req, res) => {
  try {
    const result = await accounts.digest.buildAndSend();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- VAT pack ---

router.get('/vat/quarters', (req, res) => {
  const current = accounts.vatPack.getCurrentQuarter();
  const previous = accounts.vatPack.getPreviousQuarter();
  res.json({ current, previous });
});

router.get('/vat/pack/:year/:quarter', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const quarter = parseInt(req.params.quarter);
    if (!year || quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'Invalid year or quarter (1-4)' });
    }
    const result = await accounts.vatPack.buildVatPack(year, quarter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vat/report/:year/:quarter', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const quarter = parseInt(req.params.quarter);
    if (!year || quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'Invalid year or quarter (1-4)' });
    }
    const result = await accounts.vatPack.getVatReport(year, quarter);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Drive folder config (inline paste-the-URL) ---

router.get('/drive-folder', async (req, res) => {
  try {
    const { getServiceAccountEmail } = require('../services/googleAuth');
    const folderId = accounts.driveScanner.getFolderId();
    res.json({
      folderId: folderId || null,
      serviceAccountEmail: getServiceAccountEmail() || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/drive-folder', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !String(url).trim()) {
      return res.status(400).json({ error: 'url is required' });
    }
    const input = String(url).trim();
    const folderIdRe = /\/folders\/([a-zA-Z0-9_-]+)/;
    let folderId;
    if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) {
      folderId = input;
    } else {
      const m = input.match(folderIdRe);
      if (!m) return res.status(400).json({ error: 'Could not parse a folder ID from that URL' });
      folderId = m[1];
    }

    const { encrypt } = require('../utils/encryption');
    await db.query(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ('ACCOUNTS_DRIVE_FOLDER_ID', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(encrypt(folderId))]
    );
    process.env.ACCOUNTS_DRIVE_FOLDER_ID = folderId;

    res.json({ folderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Drive invoice scanner ---

router.get('/drive/status', async (req, res) => {
  try {
    const status = await accounts.driveScanner.checkStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drive/scan', async (req, res) => {
  try {
    const result = await accounts.driveScanner.scanAndMatch();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/drive/files', async (req, res) => {
  try {
    const folderId = accounts.driveScanner.getFolderId();
    if (!folderId) return res.status(400).json({ error: 'No invoice folder configured' });
    const files = await accounts.driveScanner.getAllInvoiceFiles(folderId);
    res.json({ files, total: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drive/attach/:matchId', async (req, res) => {
  try {
    const result = await accounts.driveScanner.attachMatchedInvoice(parseInt(req.params.matchId));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Xero data proxies ---

router.get('/xero/bank-accounts', async (req, res) => {
  try {
    const token = await xero.getValidToken();
    const bankAccounts = await xero.getBankAccounts(token);
    res.json({ accounts: bankAccounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xero/chart-of-accounts', async (req, res) => {
  try {
    const token = await xero.getValidToken();
    const chartAccounts = await xero.getChartOfAccounts(token);
    res.json({ accounts: chartAccounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xero/tax-rates', async (req, res) => {
  try {
    const token = await xero.getValidToken();
    const rates = await xero.getTaxRates(token);
    res.json({ rates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xero/trial-balance', async (req, res) => {
  try {
    const token = await xero.getValidToken();
    const report = await xero.getTrialBalance(token, req.query.date);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xero/profit-and-loss', async (req, res) => {
  try {
    const token = await xero.getValidToken();
    const report = await xero.getProfitAndLoss(token, req.query.from, req.query.to);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/xero/balance-sheet', async (req, res) => {
  try {
    const token = await xero.getValidToken();
    const report = await xero.getBalanceSheet(token, req.query.date);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Audit trail ---

router.get('/audit-trail', async (req, res) => {
  try {
    const result = await accounts.reconcile.getAuditTrail({
      lineRef: req.query.lineRef || undefined,
      source: req.query.source || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FX tracking ---

router.get('/fx/events', async (req, res) => {
  try {
    const events = await accounts.fxTracker.getFxEvents({
      currency: req.query.currency || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/fx/summary', async (req, res) => {
  try {
    const summary = await accounts.fxTracker.getFxSummary({
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fx/scan', async (req, res) => {
  try {
    const result = await accounts.fxTracker.scanQueueForFx();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fx/record', async (req, res) => {
  try {
    const event = await accounts.fxTracker.recordFxEvent(req.body);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CSV exports ---

function toCsv(rows, columns) {
  if (!rows.length) return '';
  const cols = columns || Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map(escape).join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

router.get('/queue/export.csv', async (req, res) => {
  try {
    const items = await accounts.reconcile.getQueueItems({
      status: req.query.status !== 'all' ? req.query.status : undefined,
      bankAccount: req.query.bankAccount || undefined,
      limit: 10000,
      offset: 0,
    });
    const csv = toCsv(items, [
      'id', 'xero_line_id', 'date', 'description', 'amount', 'currency',
      'bank_account', 'contact_name', 'status', 'account_code', 'account_name',
      'tax_type', 'confidence', 'source', 'approved_by', 'approved_at',
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reconcile-queue.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit-trail/export.csv', async (req, res) => {
  try {
    const result = await accounts.reconcile.getAuditTrail({
      lineRef: req.query.lineRef || undefined,
      source: req.query.source || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      limit: 10000,
      offset: 0,
    });
    const csv = toCsv(result.rows || result, [
      'id', 'line_ref', 'action', 'account_code', 'account_name', 'tax_type',
      'confidence', 'source', 'changed', 'user_name', 'created_at', 'notes',
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Deadline alerts (manual trigger) ---

router.post('/deadlines/send-alerts', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const result = await accounts.deadlines.sendAlerts(days);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Supplier brain ---

router.get('/suppliers', async (req, res) => {
  try {
    const result = await accounts.suppliers.list({
      search: req.query.search || undefined,
      sort: req.query.sort || undefined,
      limit: parseInt(req.query.limit) || 200,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/suppliers/stats', async (req, res) => {
  try {
    const stats = await accounts.suppliers.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/suppliers/:id', async (req, res) => {
  try {
    const supplier = await accounts.suppliers.getById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppliers', async (req, res) => {
  try {
    const supplier = await accounts.suppliers.create(req.body);
    res.status(201).json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/suppliers/:id', async (req, res) => {
  try {
    const supplier = await accounts.suppliers.update(req.params.id, req.body);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/suppliers/:id', async (req, res) => {
  try {
    const deleted = await accounts.suppliers.remove(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppliers/:id/correct', async (req, res) => {
  try {
    const supplier = await accounts.suppliers.correctSupplier(req.params.id, req.body);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppliers/bootstrap', async (req, res) => {
  try {
    const result = await accounts.suppliers.bootstrapFromXero();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
