const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/clientAccess');
const { encrypt, decrypt } = require('../utils/encryption');
const nodemailer = require('nodemailer');
const dataforseo = require('../connectors/dataforseo');
const flaresolverr = require('../services/flaresolverr');

const bcrypt = require('bcryptjs');

const SETTINGS_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_MCC_ID',
  // Full service-account key file contents (JSON). Pasted once; used as the
  // durable, never-expiring auth path for Google connectors set to
  // auth_mode='service_account'. Handled by googleAuth.js.
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  // Manager-account (MCC) OAuth refresh token. Obtained once by authorising
  // the MCC account; used as the durable auth path for Google Ads connectors
  // set to auth_mode='mcc_link' (Google Ads can't use the service account).
  'GOOGLE_ADS_MANAGER_REFRESH_TOKEN',
  'META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI',
  'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI',
  'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'SHOPIFY_REDIRECT_URI',
  // Shared secret the public Shopify app signs its /api/shopify-app/* forwards
  // with (HMAC-SHA256 over the raw body). Set the same value in the app's env.
  'OMI_FORWARD_SECRET',
  'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI',
  'CLAUDE_API_KEY', 'ANTHROPIC_ADMIN_KEY',
  'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD',
  'REPLICATE_API_TOKEN', 'IDEOGRAM_API_KEY',
  'ADOBE_CLIENT_ID', 'ADOBE_CLIENT_SECRET',
  'ARCADS_API_KEY', 'ELEVENLABS_API_KEY',
  'APIFY_API_TOKEN',
  // Camofox stealth browser (shared scraping fallback). CAMOFOX_URL is the
  // sidecar's base URL (e.g. http://127.0.0.1:3100); CAMOFOX_API_KEY is the
  // optional bearer token the sidecar is started with. Leave both blank to
  // keep scrapers on the axios-only path. Used by services/camofox.js.
  'CAMOFOX_URL', 'CAMOFOX_API_KEY',
  // FlareSolverr stealth proxy — base URL (e.g. http://127.0.0.1:8191). Solves
  // WAF challenges and returns rendered HTML; the render backend for the
  // fetch-with-fallback scraper wrapper. Leave blank to keep scrapers on the
  // axios-only path. Used by services/flaresolverr.js. No auth/token.
  'FLARESOLVERR_URL',
  'AMAZON_CLIENT_ID', 'AMAZON_CLIENT_SECRET', 'AMAZON_REDIRECT_URI',
  'HUNTER_API_KEY', 'ICYPEAS_API_KEY', 'ICYPEAS_API_SECRET', 'ICYPEAS_USER_ID', 'SERPER_API_KEY',
  'APOLLO_API_KEY', 'PEOPLEDATALABS_API_KEY',
  'OUTREACH_IMAP_HOST', 'OUTREACH_IMAP_PORT', 'OUTREACH_IMAP_USER', 'OUTREACH_IMAP_PASSWORD',
  'N8N_WEBHOOK_BASE_URL',
  'EMAIL_PROVIDER',
  'GMAIL_USER', 'GMAIL_APP_PASSWORD',
  'SES_SMTP_USER', 'SES_SMTP_PASS', 'SES_REGION', 'SES_FROM_EMAIL',
  'SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY',
  'OUTREACH_SENDING_DOMAIN', 'OUTREACH_DEFAULT_REPLY_TO',
  'ALERT_EMAIL',
  // Editable report footer — three lines printed on every PDF page beneath
  // the "Page X of Y" line. Leave blank to use the built-in defaults.
  'REPORT_FOOTER_LINE_1', 'REPORT_FOOTER_LINE_2', 'REPORT_FOOTER_LINE_3',
];

router.use(authenticate);
// Every endpoint in this router exposes or mutates platform-wide secrets
// (API keys, OAuth client secrets, SMTP credentials, account password
// hashes). Viewers must never reach any of these.
router.use(requireAdmin);

// GET masked settings (•••• if set)
router.get('/platform-keys', async (req, res) => {
  try {
    const result = await db.query('SELECT key FROM platform_settings');
    const saved = new Set(result.rows.map(r => r.key));
    const settings = {};
    for (const key of SETTINGS_KEYS) {
      settings[key] = saved.has(key) ? '••••••••' : (process.env[key] ? '••••••••' : '');
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PR Gmail add-on key — the shared secret the Apps Script add-on sends as
// X-OMI-Key. Returned in full (admin-only route) so it can be pasted into the
// add-on's config; regenerate to rotate.
async function readAddonKey() {
  const { rows } = await db.query("SELECT value FROM platform_settings WHERE key = 'PR_ADDON_KEY'");
  if (!rows.length) return '';
  try { return decrypt(JSON.parse(rows[0].value)) || ''; } catch { return ''; }
}
router.get('/pr-addon-key', async (req, res) => {
  try { res.json({ key: await readAddonKey() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/pr-addon-key/regenerate', async (req, res) => {
  try {
    const key = require('crypto').randomBytes(24).toString('hex');
    await db.query(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('PR_ADDON_KEY', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(encrypt(key))]
    );
    res.json({ key });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET revealed settings (decrypted values)
router.get('/platform-keys/values', async (req, res) => {
  try {
    const result = await db.query('SELECT key, value FROM platform_settings');
    const settings = {};
    for (const row of result.rows) {
      try {
        settings[row.key] = decrypt(JSON.parse(row.value)) || '';
      } catch {
        settings[row.key] = '';
      }
    }
    // Fill in env vars for keys not in DB
    for (const key of SETTINGS_KEYS) {
      if (!settings[key] && process.env[key]) settings[key] = process.env[key];
      if (!settings[key]) settings[key] = '';
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save settings. A key present in the request body with an empty
// string value is treated as an explicit clear (delete the row + drop
// the process.env entry) — that's how the Settings UI flags a field the
// AM has wiped. A masked '••••••••' placeholder means "unchanged, leave
// the stored value alone".
router.post('/platform-keys', async (req, res) => {
  try {
    const updates = [];
    const cleared = [];
    for (const key of SETTINGS_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      const val = req.body[key];
      if (val === '••••••••') continue;
      if (val === '' || val === null) {
        await db.query('DELETE FROM platform_settings WHERE key = $1', [key]);
        delete process.env[key];
        cleared.push(key);
        continue;
      }
      const encrypted = encrypt(val);
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(encrypted)]
      );
      process.env[key] = val;
      updates.push(key);
    }
    res.json({ updated: updates, cleared });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST test DataForSEO credentials (uses supplied values, or the saved ones)
router.post('/test-dataforseo', async (req, res) => {
  const clean = v => (v && v !== '••••••••' ? v : undefined);
  try {
    const result = await dataforseo.testCredentials({
      login: clean(req.body.login),
      password: clean(req.body.password),
    });
    res.json(result);
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// POST test FlareSolverr (uses the supplied URL, or the saved one). Pings the
// service, then does a real end-to-end solve of a benign page to prove the
// whole chain returns HTML — not just that the port is open.
router.post('/test-flaresolverr', async (req, res) => {
  const override = (req.body.url && req.body.url !== '••••••••') ? req.body.url : undefined;
  try {
    const h = await flaresolverr.health(override);
    if (!h.ok) return res.json({ ok: false, message: h.message });
    const testUrl = req.body.testUrl || 'https://www.example.com';
    const solved = await flaresolverr.render(testUrl, { baseUrlOverride: override, maxTimeout: 30000 });
    if (solved && solved.html) {
      const version = h.detail?.version ? ` (v${h.detail.version})` : '';
      return res.json({
        ok: true,
        message: `Connected${version}. Solved ${testUrl} — HTTP ${solved.status}, ${solved.html.length.toLocaleString()} bytes of HTML.`,
      });
    }
    return res.json({ ok: false, message: `Reachable, but couldn't solve ${testUrl}. Check the FlareSolverr container logs.` });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// GET account info (username only)
router.get('/account', async (req, res) => {
  try {
    const result = await db.query(`SELECT value FROM platform_settings WHERE key = 'ADMIN_USERNAME'`);
    let username = '';
    if (result.rows.length) {
      try { username = decrypt(JSON.parse(result.rows[0].value)) || ''; } catch {}
    }
    res.json({ username: username || process.env.ADMIN_USERNAME || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST update account credentials
router.post('/account', async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!currentPassword) return res.status(400).json({ error: 'Current password required' });

  try {
    // Verify current password
    const storedHash = await (async () => {
      const r = await db.query(`SELECT value FROM platform_settings WHERE key = 'ADMIN_PASSWORD'`);
      if (r.rows.length) {
        try { return decrypt(JSON.parse(r.rows[0].value)) || null; } catch { return null; }
      }
      return null;
    })();

    const envPassword = process.env.ADMIN_PASSWORD || '';
    const passwordToCheck = storedHash || envPassword;

    const valid = passwordToCheck.startsWith('$2')
      ? await bcrypt.compare(currentPassword, passwordToCheck)
      : currentPassword === passwordToCheck;

    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    // Update username
    if (username) {
      const encUser = encrypt(username);
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('ADMIN_USERNAME', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(encUser)]
      );
      process.env.ADMIN_USERNAME = username;
    }

    // Update password
    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 12);
      const encPass = encrypt(hash);
      await db.query(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('ADMIN_PASSWORD', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(encPass)]
      );
      process.env.ADMIN_PASSWORD = hash;
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test email using whichever provider is configured
router.post('/test-email', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing to address' });
  try {
    const transporter = buildTransporter();
    const from = process.env.EMAIL_PROVIDER === 'ses'
      ? process.env.SES_FROM_EMAIL
      : `"October Communications" <${process.env.GMAIL_USER}>`;
    await transporter.sendMail({
      from,
      to,
      subject: 'October Marketing Intelligence — Test Email',
      text: 'This is a test email from October Marketing Intelligence.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildTransporter() {
  if (process.env.EMAIL_PROVIDER === 'ses') {
    const region = process.env.SES_REGION || 'eu-west-1';
    return nodemailer.createTransport({
      host: `email-smtp.${region}.amazonaws.com`,
      port: 587,
      secure: false,
      auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASS },
    });
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

// ─── USAGE / COSTS ────────────────────────────────────────────────────────
const usageTracking = require('../services/usageTracking');

router.get('/usage', async (req, res) => {
  try {
    res.json(await usageTracking.currentSnapshots());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usage/refresh', async (req, res) => {
  try {
    const results = await usageTracking.runAllPollers();
    res.json({ refreshed: results.length, snapshots: await usageTracking.currentSnapshots() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Per-provider snapshot history — used by the future charting view; for
// now the panel just shows current numbers. Keeping the route lets
// the frontend trend-chart drop in later without a backend change.
router.get('/usage/history', async (req, res) => {
  const { provider, days = 90 } = req.query;
  try {
    const params = [days];
    let where = `snapshot_at >= NOW() - ($1::int || ' days')::interval`;
    if (provider) { params.push(provider); where += ` AND provider = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT provider, snapshot_at, cost_this_period, balance_remaining, units_used, units_limit, status
       FROM usage_snapshots
       WHERE ${where}
       ORDER BY snapshot_at ASC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Per-call API cost log — surfaces where credits are actually going.
// Returns daily totals (for the dashboard burn-rate banner) plus a
// feature-level breakdown for the settings panel.
router.get('/usage/cost-log', async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  try {
    const [byFeature, daily, recent] = await Promise.all([
      db.query(
        `SELECT provider, feature, SUM(cost_usd)::float AS cost_usd, COUNT(*)::int AS calls
           FROM api_cost_events
          WHERE ts >= NOW() - ($1::int || ' days')::interval
          GROUP BY provider, feature
          ORDER BY cost_usd DESC
          LIMIT 50`, [days]
      ),
      db.query(
        `SELECT date_trunc('day', ts) AS day, SUM(cost_usd)::float AS cost_usd, COUNT(*)::int AS calls
           FROM api_cost_events
          WHERE ts >= NOW() - ($1::int || ' days')::interval
          GROUP BY day ORDER BY day ASC`, [days]
      ),
      db.query(
        `SELECT id, ts, provider, feature, cost_usd::float AS cost_usd, meta
           FROM api_cost_events
          WHERE ts >= NOW() - INTERVAL '7 days'
          ORDER BY ts DESC LIMIT 200`
      ),
    ]);
    res.json({
      window_days: days,
      by_feature: byFeature.rows,
      daily: daily.rows,
      recent: recent.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DataForSEO recurring-spend estimate. Mirrors the scheduled jobs that
// actually bill per active keyword, so the daily cap can be sized safely:
//   - Rank checks: serp/google/organic/live/advanced at depth 50 (5 pages),
//     every 4 days   (connectors/dataforseo.js checkRank + scheduler cron */4)
//   - AI Overview:  serp/google/ai_overview/live/advanced at depth 10,
//     weekly         (scheduler runWeeklyAIOChecks)
// Live-Advanced pricing: $0.002 first page + $0.0015 per extra page.
const DFS_COST = {
  rankPerCheck: 0.002 + 4 * 0.0015,   // depth 50 → $0.008
  aioPerCheck: 0.002,                  // depth 10 → $0.002
  rankCadenceDays: 4,
  aioCadenceDays: 7,
  gbpPerUsd: 0.79,                     // approx, display only
};
const DAYS_PER_MONTH = 30.437;
const round2 = (n) => Math.round(n * 100) / 100;

router.get('/dataforseo-estimate', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS active_keywords,
              COUNT(DISTINCT k.client_id)::int AS active_clients
         FROM seo_keywords k
         JOIN clients c ON c.id = k.client_id
        WHERE k.active = true AND c.active = true`
    );
    const activeKeywords = rows[0]?.active_keywords || 0;
    const activeClients = rows[0]?.active_clients || 0;

    const rankMonthly = activeKeywords * DFS_COST.rankPerCheck * (DAYS_PER_MONTH / DFS_COST.rankCadenceDays);
    const aioMonthly = activeKeywords * DFS_COST.aioPerCheck * (DAYS_PER_MONTH / DFS_COST.aioCadenceDays);
    const monthlyUsd = rankMonthly + aioMonthly;

    // Peak single-day spend: the 4-day rank sweep landing on the same day as
    // the weekly AIO sweep — worst case for sizing a daily cap.
    const peakDayUsd = activeKeywords * (DFS_COST.rankPerCheck + DFS_COST.aioPerCheck);
    // Recommended daily cap = 3x the peak run day (headroom so a legitimate
    // sweep never trips it), floored at $5. A real runaway loop is 10-100x
    // normal, so this still catches it.
    const recommendedDailyCapUsd = Math.max(5, Math.ceil(peakDayUsd * 3));

    res.json({
      active_keywords: activeKeywords,
      active_clients: activeClients,
      rank: { per_check_usd: round2(DFS_COST.rankPerCheck), cadence_days: DFS_COST.rankCadenceDays, monthly_usd: round2(rankMonthly) },
      aio: { per_check_usd: round2(DFS_COST.aioPerCheck), cadence_days: DFS_COST.aioCadenceDays, monthly_usd: round2(aioMonthly) },
      est_monthly_usd: round2(monthlyUsd),
      est_monthly_gbp: round2(monthlyUsd * DFS_COST.gbpPerUsd),
      peak_day_usd: round2(peakDayUsd),
      recommended_daily_cap_usd: recommendedDailyCapUsd,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.buildTransporter = buildTransporter;
