const axios = require('axios');
const { getSetting } = require('../utils/settings');

const authType = 'apikey';

// Moz API — Domain Authority, one site at a time.
//
// Why this exists: `moz_da` on the Authority panel was copied from moz.com by
// hand once a month, for every client. One call a month per client replaces
// that, and it fits the free tier with room to spare: the allowance is **50
// rows a month**, a row is one site queried, and October has twelve clients.
//
// **This is the JSON-RPC API, not the old REST one.** The first build of this
// connector POSTed to `lsapi.seomoz.com/v2/url_metrics` with an Access ID and
// Secret Key over HTTP Basic. Moz now calls that pair a legacy credential and
// issues a single API token instead, so both the endpoint and the auth moved:
//
//   POST https://api.moz.com/jsonrpc
//   x-moz-token: <token>
//   { jsonrpc, id, method: 'data.site.metrics.fetch',
//     params: { data: { site_query: { query: <domain>, scope: 'domain' } } } }
//
// JSON-RPC answers 200 with an `error` member rather than an HTTP status, so
// a response that looks fine to axios can still be a failure. `call()` below
// raises on `error` explicitly; without that a bad token reads as "Moz
// returned no metrics", which sends you looking in the wrong place.
//
// Two properties of the free tier shape the rest:
//
//   **Rows, not requests.** Quota is spent per site returned, so batching
//   gains nothing and costs something: one bad domain would fail the whole
//   call. This fetches one site at a time, and a failure costs one client.
//
//   **Roughly one request every ten seconds.** The caller paces itself; see
//   `services/seoAuthority.js`.
//
// The token lives in platform_settings, written by the Settings page, and is
// read at call time so a saved change takes effect without a restart.

const ENDPOINT = 'https://api.moz.com/jsonrpc';

async function getToken() {
  const token = (await getSetting('MOZ_API_TOKEN') || '').trim();
  if (!token) {
    const err = new Error('Moz API token not configured. Add it on Settings → Connections.');
    err.code = 'MOZ_NOT_CONFIGURED';
    throw err;
  }
  return token;
}

// Has the workspace got a token at all? Used by the Authority panel to say
// "not configured" rather than showing a silent blank, and by the monthly job
// to skip without logging an error every month.
async function isConfigured() {
  return !!(await getSetting('MOZ_API_TOKEN'));
}

let rpcId = 0;

async function call(token, method, data) {
  const { data: body } = await axios.post(
    ENDPOINT,
    { jsonrpc: '2.0', id: (rpcId += 1), method, params: { data } },
    { headers: { 'Content-Type': 'application/json', 'x-moz-token': token }, timeout: 30000 }
  );
  // JSON-RPC reports failure in the body at HTTP 200. Letting that through
  // would turn "your token is wrong" into "Moz returned no metrics".
  if (body && body.error) {
    const e = body.error;
    const err = new Error(e.message || `Moz error ${e.code ?? ''}`.trim());
    err.mozCode = e.code;
    throw err;
  }
  return body ? body.result : null;
}

// Moz wants a bare host. A client's `domain` column holds either
// "falconenamelware.com" or "https://falconenamelware.com/", so normalise:
// a scheme and a trailing slash are harmless but the www/non-www split is a
// different target with a different DA, and we query whatever is on file.
function normaliseTarget(domain) {
  const d = String(domain || '').trim();
  if (!d) return null;
  return d.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase() || null;
}

// Domain Authority for one site. Returns
// { target, domain_authority, page_authority, linking_root_domains, spam_score }
// or throws.
async function urlMetrics(domain) {
  const target = normaliseTarget(domain);
  if (!target) throw new Error('No domain set for this client');
  const token = await getToken();
  const result = await call(token, 'data.site.metrics.fetch', {
    site_query: { query: target, scope: 'domain' },
  });
  // The metrics sit under `site_metrics`. Falling back to the result itself
  // covers a shape change without pretending nothing was returned.
  const m = (result && (result.site_metrics || result)) || null;
  if (!m || typeof m !== 'object') throw new Error(`Moz returned no metrics for ${target}`);
  return {
    target,
    domain_authority: numOrNull(m.domain_authority),
    page_authority: numOrNull(m.page_authority),
    // Moz's own count of referring root domains. Recorded for comparison
    // only: referring domains on the Authority panel come from DataForSEO,
    // which refreshes every three days rather than monthly.
    linking_root_domains: numOrNull(m.root_domains_to_root_domain ?? m.linking_root_domains),
    spam_score: numOrNull(m.spam_score),
  };
}

// Settings → "Test" button. Spends one row on purpose: a credential that
// cannot fetch a number is not configured, whatever the form says, and
// finding that out here beats finding it out on the 1st when a report runs
// with no DA in it.
async function testCredentials({ token, domain = 'moz.com' } = {}) {
  try {
    const t = (token && token.trim()) || await getToken();
    const result = await call(t, 'data.site.metrics.fetch', {
      site_query: { query: normaliseTarget(domain), scope: 'domain' },
    });
    const m = (result && (result.site_metrics || result)) || null;
    const da = m ? numOrNull(m.domain_authority) : null;
    if (da == null) {
      return { ok: false, error: 'Authenticated, but Moz returned no domain authority. The response shape may have changed.' };
    }
    return {
      ok: true,
      domain_authority: da,
      note: 'This test spent one of the 50 free rows for this month.',
    };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403 || err.mozCode === 401 || err.mozCode === 403) {
      return { ok: false, error: 'Moz rejected that token. Check it is the API token from moz.com/api, not an Access ID.' };
    }
    if (status === 429 || err.mozCode === 429) {
      return { ok: false, error: 'Moz rate-limited the test. The free tier allows about one request every ten seconds; wait and try again.' };
    }
    return { ok: false, error: err.response?.data?.error?.message || err.message };
  }
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

module.exports = { urlMetrics, testCredentials, isConfigured, normaliseTarget, ENDPOINT, authType };
