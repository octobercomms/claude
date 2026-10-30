const axios = require('axios');
const { getSetting } = require('../utils/settings');

const authType = 'apikey';

// Moz Links API v2 — Domain Authority, one row per domain.
//
// Why this exists: `moz_da` on the Authority panel was copied from moz.com by
// hand once a month, for every client. One call a month per client replaces
// that, and it fits the free tier with room to spare: the allowance is **50
// rows a month**, a row is one URL returned, and October has twelve clients.
//
// Two properties of the free tier shape the code below:
//
//   **Rows, not requests.** Batching twenty-five domains into one call still
//   spends twenty-five rows. There is nothing to gain by batching and
//   something to lose: one bad domain fails the whole call. So this fetches
//   one domain at a time and a failure costs one client, not twelve.
//
//   **Roughly one request every ten seconds.** The caller paces itself; see
//   `services/seoAuthority.js`. A monthly job taking two minutes is fine.
//
// Auth is HTTP Basic with the Access ID as username and the Secret Key as
// password, both from the Moz API dashboard. They live in platform_settings,
// written by the Settings page, and are read at call time so a saved change
// takes effect without a restart.

const BASE = 'https://lsapi.seomoz.com/v2';

async function getCreds() {
  const accessId = (await getSetting('MOZ_ACCESS_ID') || '').trim();
  const secretKey = (await getSetting('MOZ_SECRET_KEY') || '').trim();
  if (!accessId || !secretKey) {
    const err = new Error('Moz API credentials not configured. Add them on Settings → Connections.');
    err.code = 'MOZ_NOT_CONFIGURED';
    throw err;
  }
  return { accessId, secretKey };
}

// Has the workspace got Moz credentials at all? Used by the Authority panel
// to say "not configured" rather than silently showing a blank number, and by
// the monthly job to skip without logging an error every month.
async function isConfigured() {
  const accessId = await getSetting('MOZ_ACCESS_ID');
  const secretKey = await getSetting('MOZ_SECRET_KEY');
  return !!(accessId && secretKey);
}

function client({ accessId, secretKey }) {
  return axios.create({
    baseURL: BASE,
    auth: { username: accessId, password: secretKey },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });
}

// Moz wants a bare host or a URL. A client's `domain` column holds either
// "falconenamelware.com" or "https://falconenamelware.com/", so normalise:
// a scheme and a trailing slash are harmless but the www/non-www split is a
// different target with a different DA, and we query whatever is on file.
function normaliseTarget(domain) {
  const d = String(domain || '').trim();
  if (!d) return null;
  return d.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase() || null;
}

// Domain Authority for one domain. Returns { domain_authority, page_authority,
// linking_root_domains, target } or throws.
async function urlMetrics(domain) {
  const target = normaliseTarget(domain);
  if (!target) throw new Error('No domain set for this client');
  const creds = await getCreds();
  const { data } = await client(creds).post('/url_metrics', { targets: [target] });
  const row = (data && data.results && data.results[0]) || null;
  if (!row) throw new Error(`Moz returned no row for ${target}`);
  return {
    target,
    domain_authority: numOrNull(row.domain_authority),
    page_authority: numOrNull(row.page_authority),
    // Moz's own count of referring root domains. Recorded for comparison
    // only: referring domains on the Authority panel come from DataForSEO,
    // which is refreshed every three days rather than monthly.
    linking_root_domains: numOrNull(row.root_domains_to_root_domain),
  };
}

// Settings → "Test" button. Spends one row, which is the point: a credential
// that cannot fetch a number is not configured, whatever the form says.
async function testCredentials({ accessId, secretKey, domain = 'moz.com' } = {}) {
  try {
    const creds = accessId && secretKey
      ? { accessId: accessId.trim(), secretKey: secretKey.trim() }
      : await getCreds();
    const { data } = await client(creds).post('/url_metrics', { targets: [normaliseTarget(domain)] });
    const row = (data && data.results && data.results[0]) || null;
    if (!row) return { ok: false, error: 'Authenticated, but Moz returned no row.' };
    return {
      ok: true,
      domain_authority: numOrNull(row.domain_authority),
      note: 'This test spent one of the 50 free rows for this month.',
    };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return { ok: false, error: 'Moz rejected those credentials. Check the Access ID and Secret Key, in that order.' };
    }
    if (status === 429) {
      return { ok: false, error: 'Moz rate-limited the test. The free tier allows about one request every ten seconds; wait and try again.' };
    }
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

module.exports = { urlMetrics, testCredentials, isConfigured, normaliseTarget, authType };
