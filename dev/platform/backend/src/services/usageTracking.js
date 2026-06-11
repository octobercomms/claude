// Polls each pay-per-use provider's balance / usage endpoint, writes a
// snapshot row per provider per run, and exposes an aggregator for the
// Settings UI. Daily cron + manual "Refresh now" both call runAllPollers().
//
// Adding a new provider means appending one entry to POLLERS — each
// poller resolves to { cost_this_period?, balance_remaining?, currency?,
// units_used?, units_limit?, unit_label?, raw }. Returning a thrown
// error or null marks the snapshot as `no_credentials` / `error` so the
// UI can flag it rather than silently miss spend.

const axios = require('axios');
const pool = require('../db');
const { getSetting } = require('../utils/settings');
const { resolveCreds } = require('../connectors/dataforseo');

// Monthly period helpers — most providers think in calendar months.
function monthBounds(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10) };
}

const POLLERS = [
  {
    name: 'dataforseo',
    label: 'DataForSEO',
    async poll() {
      const login = await getSetting('DATAFORSEO_LOGIN');
      const password = await getSetting('DATAFORSEO_PASSWORD');
      if (!login || !password) return null;
      // Use the same credential resolution as the SEO connector — trims
      // whitespace and unpacks a base64 email:password token if that's how
      // the key was pasted. Without this the poller 401s even when SEO works.
      const { username, password: pass } = resolveCreds(login, password);
      const { data } = await axios.get('https://api.dataforseo.com/v3/appendix/user_data', {
        auth: { username, password: pass },
      });
      const result = data.tasks?.[0]?.result?.[0];
      if (!result) throw new Error('No user_data returned');
      return {
        balance_remaining: result.money?.balance ?? null,
        currency: result.money?.currency || 'USD',
        unit_label: 'credits',
        raw: result,
      };
    },
  },
  {
    name: 'elevenlabs',
    label: 'ElevenLabs',
    async poll() {
      const key = await getSetting('ELEVENLABS_API_KEY');
      if (!key) return null;
      const { data } = await axios.get('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': key },
      });
      return {
        units_used: data.character_count ?? null,
        units_limit: data.character_limit ?? null,
        unit_label: 'characters',
        raw: data,
      };
    },
  },
  {
    name: 'hunter',
    label: 'Hunter',
    async poll() {
      const key = await getSetting('HUNTER_API_KEY');
      if (!key) return null;
      const { data } = await axios.get(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`);
      const acct = data.data || {};
      return {
        units_used: acct.requests?.searches?.used ?? null,
        units_limit: acct.requests?.searches?.available ?? null,
        unit_label: 'searches',
        period_start: acct.reset_date,
        raw: acct,
      };
    },
  },
  {
    name: 'serper',
    label: 'Serper',
    async poll() {
      const key = await getSetting('SERPER_API_KEY');
      if (!key) return null;
      // Serper doesn't have a stable balance endpoint at this writing;
      // fall back to "credentials present" status without numbers. We
      // still snapshot so the UI shows the provider is configured.
      return { raw: { note: 'No public balance endpoint — track via dashboard.' } };
    },
  },
  {
    name: 'replicate',
    label: 'Replicate',
    async poll() {
      const token = await getSetting('REPLICATE_API_TOKEN');
      if (!token) return null;
      // Replicate's billing endpoint is plan-tier-dependent; the account
      // endpoint at minimum tells us the connection works.
      const { data } = await axios.get('https://api.replicate.com/v1/account', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { raw: data, unit_label: 'predictions' };
    },
  },
  {
    name: 'anthropic',
    label: 'Anthropic (Claude)',
    async poll() {
      // The admin usage API requires an admin-tier key (separate from the
      // regular CLAUDE_API_KEY). Without it we can't read $ spend — but the
      // chat/report features still work off the regular key, so show
      // "connected, add an admin key to track spend" rather than the
      // misleading "Not configured".
      const adminKey = await getSetting('ANTHROPIC_ADMIN_KEY');
      if (!adminKey) {
        const regularKey = (await getSetting('CLAUDE_API_KEY')) || process.env.CLAUDE_API_KEY;
        if (!regularKey) return null;
        return { unit_label: 'tokens', raw: { note: 'Connected — add an Anthropic Admin key in Settings to track spend here.' } };
      }
      // Anthropic publishes spend at /v1/organizations/cost_report. Two
      // gotchas the previous fix missed:
      //   1. starting_at / ending_at require RFC3339 timestamps with a
      //      timezone offset. A bare date string ("2026-06-01") silently
      //      returns an empty bucket — the request succeeds (200) but
      //      data.data is empty.
      //   2. Response shape is nested: data[].results[].amount (a string).
      //      The previous parser looked at data[].amount_usd which doesn't
      //      exist on this endpoint, so the sum stayed at $0 even on a
      //      well-billed organisation.
      // Pagination: follow next_page when has_more is true; hard cap to
      // stop a parser typo from looping forever.
      const { period_start, period_end } = monthBounds();
      const starting_at = `${period_start}T00:00:00Z`;
      const ending_at = `${period_end}T23:59:59Z`;
      const headers = { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' };

      // Track buckets by (starting_at, ending_at) and pages by cursor so a
      // pagination loop that doesn't advance can't 20x our total. Previous
      // version trusted has_more + next_page blindly — if Anthropic returns
      // the same cursor or repeats buckets, we'd sum the same rows over and
      // over (this is the most plausible cause of the $3,933 reading vs the
      // ~$54 invoice).
      let totalCost = 0;
      let totalRows = 0;
      const seenBuckets = new Set();
      const seenPages = new Set();
      const byCostType = {}; // breakdown so the diagnose panel can show where the money went
      let page = null;
      let firstPageRaw = null;
      let pageCount = 0;

      while (pageCount < 20) {
        pageCount++;
        const params = page ? { starting_at, ending_at, page } : { starting_at, ending_at };
        const { data } = await axios.get('https://api.anthropic.com/v1/organizations/cost_report', { params, headers });
        if (!firstPageRaw) firstPageRaw = data;

        for (const bucket of (data.data || [])) {
          // Skip a bucket we've already counted on a previous page (defends
          // against duplicate-data pagination).
          const bk = `${bucket.starting_at}|${bucket.ending_at}`;
          if (seenBuckets.has(bk)) continue;
          seenBuckets.add(bk);

          for (const r of (bucket.results || [])) {
            // Currency safety: don't sum non-USD amounts into a USD total.
            // If a result lacks a currency field, assume USD (the endpoint's
            // default).
            if (r.currency && r.currency !== 'USD') continue;
            const amount = Number(r.amount ?? r.amount_usd ?? r.cost_usd ?? 0);
            if (Number.isNaN(amount)) continue;
            totalCost += amount;
            totalRows++;
            const key = r.cost_type || r.token_type || 'other';
            byCostType[key] = (byCostType[key] || 0) + amount;
          }
        }

        // Pagination dedup. If the next-page token matches one we already
        // used (or matches the current one), bail.
        const nextPage = data.next_page || data.next_page_token || data.next_cursor || null;
        if (!data.has_more || !nextPage || seenPages.has(nextPage) || nextPage === page) break;
        seenPages.add(nextPage);
        page = nextPage;
      }

      // One-line breadcrumb so a wrong reading is debuggable from pm2 logs
      // without round-tripping through the diagnose panel.
      console.log(`[Anthropic] cost_report ${period_start}→${period_end}: $${totalCost.toFixed(2)} across ${totalRows} rows, ${pageCount} page(s), ${seenBuckets.size} bucket(s)`);

      return {
        cost_this_period: totalCost,
        currency: 'USD',
        unit_label: 'tokens',
        period_start, period_end,
        raw: {
          ...(firstPageRaw || {}),
          _aggregated_rows: totalRows,
          _aggregated_pages: pageCount,
          _aggregated_buckets: seenBuckets.size,
          _by_cost_type: byCostType,
        },
      };
    },
  },
  {
    name: 'ideogram',
    label: 'Ideogram',
    async poll() {
      const key = await getSetting('IDEOGRAM_API_KEY');
      if (!key) return null;
      // Ideogram doesn't publish a balance API; just record credentials
      // presence so the panel shows it.
      return { raw: { note: 'No public balance endpoint — track via dashboard.' } };
    },
  },
  {
    name: 'arcads',
    label: 'Arcads',
    async poll() {
      const key = await getSetting('ARCADS_API_KEY');
      if (!key) return null;
      return { raw: { note: 'No public balance endpoint — track via dashboard.' } };
    },
  },
  {
    name: 'adobe',
    label: 'Adobe Firefly + Photoshop',
    async poll() {
      const id = await getSetting('ADOBE_CLIENT_ID');
      if (!id) return null;
      return { raw: { note: 'No public balance endpoint — track via dashboard.' } };
    },
  },
];

async function pollOne(spec) {
  const { period_start, period_end } = monthBounds();
  try {
    const result = await spec.poll();
    if (result === null) {
      return await write({
        provider: spec.name, status: 'no_credentials', period_start, period_end,
      });
    }
    return await write({
      provider: spec.name, status: 'ok', period_start, period_end, ...result,
    });
  } catch (err) {
    return await write({
      provider: spec.name, status: 'error', period_start, period_end,
      error_message: err.response?.data?.error?.message || err.message,
    });
  }
}

async function write(row) {
  const cols = [
    'provider', 'period_start', 'period_end', 'cost_this_period', 'balance_remaining',
    'currency', 'units_used', 'units_limit', 'unit_label', 'status', 'error_message', 'raw',
  ];
  const values = cols.map(c => c === 'raw' ? JSON.stringify(row[c] || null) : row[c] ?? null);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO usage_snapshots (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return rows[0];
}

async function runAllPollers() {
  const results = [];
  for (const spec of POLLERS) {
    const row = await pollOne(spec);
    results.push({ provider: spec.name, label: spec.label, row });
  }
  return results;
}

// Aggregator for the Settings panel — returns one row per provider
// with the latest snapshot, plus a manual provider entry for ones the
// platform can't auto-poll.
async function currentSnapshots() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (provider) provider, snapshot_at, period_start, period_end,
       cost_this_period, balance_remaining, currency, units_used, units_limit,
       unit_label, status, error_message, raw
     FROM usage_snapshots
     ORDER BY provider, snapshot_at DESC`
  );
  const byProvider = Object.fromEntries(rows.map(r => [r.provider, r]));
  return POLLERS.map(p => ({
    name: p.name,
    label: p.label,
    snapshot: byProvider[p.name] || null,
  }));
}

// Combined spend for the current calendar month — sums each provider's
// latest cost_this_period, grouped by currency (no FX guessing). Used by
// the Dashboard banner so the admin can see total API cost at a glance.
async function monthlySpend() {
  const bounds = monthBounds();
  const snaps = await currentSnapshots();
  const totals = {};
  const byProvider = [];
  const balances = [];   // providers that report a remaining balance / quota rather than spend
  for (const s of snaps) {
    const snap = s.snapshot;
    if (!snap) continue;
    if (snap.cost_this_period != null) {
      const currency = snap.currency || 'USD';
      const amount = Number(snap.cost_this_period) || 0;
      totals[currency] = (totals[currency] || 0) + amount;
      byProvider.push({ name: s.name, label: s.label, cost: amount, currency });
    } else if (snap.balance_remaining != null) {
      balances.push({ name: s.name, label: s.label, kind: 'balance', value: Number(snap.balance_remaining), currency: snap.currency || 'USD' });
    } else if (snap.units_used != null) {
      balances.push({ name: s.name, label: s.label, kind: 'quota', value: Number(snap.units_used), limit: snap.units_limit != null ? Number(snap.units_limit) : null, unit: snap.unit_label || '' });
    }
  }
  // Burn-rate flag for the dashboard banner. Pulls the last 7 days of
  // per-call cost events (instrumented in costLog.js) — independent of the
  // monthly poller, so it works even when Anthropic / DataForSEO snapshots
  // are stale. Thresholds: <$5/day green, $5–15 amber, >$15 red.
  let burn = null;
  try {
    const pool = require('../db');
    const { rows } = await pool.query(
      `SELECT date_trunc('day', ts) AS day, SUM(cost_usd)::float AS cost
         FROM api_cost_events
        WHERE ts >= NOW() - INTERVAL '7 days'
        GROUP BY day`
    );
    const total = rows.reduce((s, r) => s + (r.cost || 0), 0);
    const daily_avg = rows.length ? total / Math.min(7, rows.length) : 0;
    const flag = daily_avg > 15 ? 'red' : daily_avg > 5 ? 'amber' : 'green';
    burn = { daily_avg_usd: daily_avg, last_7_total_usd: total, flag };
  } catch { /* table may not exist on a freshly-deployed instance */ }
  return { totals, by_provider: byProvider, balances, burn, ...bounds };
}

module.exports = { runAllPollers, pollOne, currentSnapshots, monthlySpend, POLLERS };
