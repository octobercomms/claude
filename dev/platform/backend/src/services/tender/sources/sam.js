// SAM.gov (US) adapter. SAM.gov's Opportunities API needs a free api_key.
// US coverage of city/state arts bodies is poor, so this is low-yield and
// ships disabled; enable it only once a SAM_API_KEY is set and it's proven to
// surface anything worth the noise. Defensive mapping — returns [] on any
// failure so it can never break a run.

const http = require('../http');
const { resolveClosing, parseAmount } = require('../normalise');

function mmddyyyy(d) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
}

async function fetch(source, { log = () => {} } = {}) {
  const cfg = source.config || {};
  const key = process.env[cfg.requiresKey || 'SAM_API_KEY'];
  if (!key) { log('SAM.gov: no API key set — skipping'); return []; }
  const base = source.endpoint.replace(/\/$/, '');
  const to = new Date();
  const from = new Date(to.getTime() - 60 * 86400000);
  const url = `${base}/opportunities/v2/search?api_key=${encodeURIComponent(key)}&postedFrom=${mmddyyyy(from)}&postedTo=${mmddyyyy(to)}&limit=100&ptype=o`;

  let data;
  try { data = await http.get(url, { type: 'json' }); }
  catch (e) { log(`SAM.gov search failed: ${e.message}`); return []; }

  const list = data?.opportunitiesData || data?.opportunities || [];
  const notices = list.map(o => {
    const { closing_at, needs_manual_check } = resolveClosing(o.responseDeadLine || o.responseDeadline || null);
    const award = o.award || {};
    return {
      external_ref: o.noticeId ? `SAM-${o.noticeId}` : (o.solicitationNumber ? `SAM-${o.solicitationNumber}` : null),
      url: o.uiLink || o.link || null,
      title: o.title || null,
      buyer_name: o.fullParentPathName || o.organizationName || o.department || null,
      buyer_country: 'United States',
      buyer_city: o.placeOfPerformance?.city?.name || null,
      cpv_codes: [], // SAM uses NAICS/PSC, not CPV
      published_at: o.postedDate ? new Date(o.postedDate) : null,
      closing_at,
      value_min: parseAmount(award.amount),
      value_max: parseAmount(award.amount),
      currency: 'USD',
      description: o.description || null,
      raw_payload: o,
      needs_manual_check,
    };
  }).filter(n => n.external_ref);
  log(`SAM.gov: ${notices.length} notices`);
  return notices;
}

module.exports = { fetch };
