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
      // Switched away from /v1/organizations/cost_report — its rows for this
      // account return everything (model / cost_type / token_type /
      // workspace_id) as null, just a date + a single amount. That looked
      // like consumption data but the amounts include billing transactions
      // (credit grants, auto-recharges, internal adjustments) not pure
      // consumption — one June day reported \$3,325 of "cost" on an account
      // with a \$200 cap. Useless for "what did I spend?".
      //
      // /v1/organizations/usage_report/messages returns the underlying
      // token counts, broken down by model. We compute the dollar amount
      // ourselves from our pricing tables (services/costLog.js) — same
      // tables we use for per-call cost logging, so the dashboard total
      // and the per-call log are denominated identically.
      const { period_start, period_end } = monthBounds();
      const starting_at = `${period_start}T00:00:00Z`;
      const ending_at = `${period_end}T23:59:59Z`;
      const headers = { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' };
      const { claudeCostFromUsage, CLAUDE_PRICES } = require('./costLog');

      // Track buckets by (starting_at, ending_at) and pages by cursor so a
      // pagination loop that doesn't advance can't 20x our total. Previous
      // version trusted has_more + next_page blindly — if Anthropic returns
      // the same cursor or repeats buckets, we'd sum the same rows over and
      // over (this is the most plausible cause of the $3,933 reading vs the
      // ~$54 invoice).
      let totalCost = 0;
      let totalInTokens = 0;
      let totalOutTokens = 0;
      const byModel = {};
      const seenBuckets = new Set();
      const seenPages = new Set();
      let page = null;
      let firstPageRaw = null;
      let pageCount = 0;
      let bucketSamples = [];

      while (pageCount < 20) {
        pageCount++;
        const params = page ? { starting_at, ending_at, page } : { starting_at, ending_at };
        const { data } = await axios.get('https://api.anthropic.com/v1/organizations/usage_report/messages', { params, headers });
        if (!firstPageRaw) firstPageRaw = data;

        for (const bucket of (data.data || [])) {
          const bk = `${bucket.starting_at}|${bucket.ending_at}`;
          if (seenBuckets.has(bk)) continue;
          seenBuckets.add(bk);
          if (bucketSamples.length < 2) bucketSamples.push(bucket);

          for (const r of (bucket.results || [])) {
            // usage_report/messages returns token counts per (model,
            // service_tier, token_type, …) breakdown. Compute the dollar
            // value from our pricing tables — same logic the per-call cost
            // log uses, so totals are denominated identically.
            const usage = {
              input_tokens: r.uncached_input_tokens ?? r.input_tokens ?? 0,
              output_tokens: r.output_tokens ?? 0,
              cache_creation_input_tokens: r.cache_creation_input_tokens ?? 0,
              cache_read_input_tokens: r.cache_read_input_tokens ?? 0,
            };
            const model = r.model || 'claude-sonnet-4-6';
            const cost = claudeCostFromUsage(model, usage);
            totalCost += cost;
            totalInTokens += Number(usage.input_tokens) + Number(usage.cache_creation_input_tokens) + Number(usage.cache_read_input_tokens);
            totalOutTokens += Number(usage.output_tokens);
            byModel[model] = (byModel[model] || 0) + cost;
          }
        }

        const nextPage = data.next_page || data.next_page_token || data.next_cursor || null;
        if (!data.has_more || !nextPage || seenPages.has(nextPage) || nextPage === page) break;
        seenPages.add(nextPage);
        page = nextPage;
      }

      console.log(`[Anthropic] usage_report/messages ${period_start}→${period_end}: $${totalCost.toFixed(2)} (computed from ${totalInTokens.toLocaleString()} in + ${totalOutTokens.toLocaleString()} out tokens across ${seenBuckets.size} bucket(s), ${pageCount} page(s))`);

      return {
        cost_this_period: totalCost,
        currency: 'USD',
        unit_label: 'tokens',
        period_start, period_end,
        raw: {
          _source: 'usage_report/messages (token counts × local pricing)',
          _first_page: firstPageRaw,
          _bucket_samples: bucketSamples,
          _aggregated_buckets: seenBuckets.size,
          _aggregated_pages: pageCount,
          _total_input_tokens: totalInTokens,
          _total_output_tokens: totalOutTokens,
          _by_model: byModel,
          _pricing_used: CLAUDE_PRICES,
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
  const balances = [];
  // For each balance-only provider (DataForSEO / Hunter / etc.) work out
  // month-to-date spend from the snapshot history: oldest balance recorded
  // since the 1st of the month minus the latest balance. Quota providers
  // get the same treatment from units_used. Without this the banner only
  // showed Anthropic — every other API was invisible to the cost rollup.
  const pool = require('../db');
  async function inferMtdSpend(provider, kind, currency) {
    try {
      const { rows } = await pool.query(
        `SELECT balance_remaining::float AS balance, units_used::float AS units, snapshot_at
           FROM usage_snapshots
          WHERE provider = $1 AND snapshot_at >= $2::date
          ORDER BY snapshot_at ASC`,
        [provider, bounds.period_start]
      );
      if (rows.length < 2) return null;
      if (kind === 'balance') {
        const first = rows.find(r => r.balance != null)?.balance;
        const last = [...rows].reverse().find(r => r.balance != null)?.balance;
        if (first == null || last == null || first <= last) return null;
        return { amount: first - last, currency: currency || 'USD' };
      }
      if (kind === 'quota') {
        const first = rows.find(r => r.units != null)?.units;
        const last = [...rows].reverse().find(r => r.units != null)?.units;
        if (first == null || last == null || last <= first) return null;
        // No way to price quota-unit consumption without a known per-unit
        // rate (Hunter: 50 free + $0.50 / extra; Serper / etc. vary), so
        // we just record the units burned and let the banner show the
        // count rather than make up a price.
        return { units: last - first };
      }
    } catch { /* table may not exist yet */ }
    return null;
  }

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
      // Derived MTD spend from the balance-burn since the 1st.
      const inferred = await inferMtdSpend(s.name, 'balance', snap.currency || 'USD');
      if (inferred?.amount > 0) {
        totals[inferred.currency] = (totals[inferred.currency] || 0) + inferred.amount;
        byProvider.push({ name: s.name, label: s.label, cost: inferred.amount, currency: inferred.currency, inferred: true });
      }
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
