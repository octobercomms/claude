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
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// --- Sync (manual trigger) ---

router.post('/sync', async (req, res) => {
  try {
    const result = await accounts.reconcile.pullAndClassify({
      since: req.body.since || undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('[accounts] Sync error:', err.message);
    res.status(500).json({ error: err.message });
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
    const count = await accounts.deadlines.seedDeadlines();
    res.json({ seeded: count });
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

module.exports = router;
