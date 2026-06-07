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
      const { period_start, period_end } = monthBounds();
      const { data } = await axios.get('https://api.anthropic.com/v1/organizations/usage_report/messages', {
        params: { starting_at: period_start, ending_at: period_end },
        headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
      });
      const totalCost = (data.data || []).reduce((s, row) => s + (row.cost_usd || 0), 0);
      return {
        cost_this_period: totalCost,
        currency: 'USD',
        unit_label: 'tokens',
        period_start, period_end,
        raw: data,
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
  return { totals, by_provider: byProvider, balances, ...bounds };
}

module.exports = { runAllPollers, pollOne, currentSnapshots, monthlySpend, POLLERS };
