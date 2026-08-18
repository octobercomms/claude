// TED (EU) adapter. TED exposes a public notices search API (v3). We query by
// the PR/communications/cultural CPV codes and map each notice into the common
// shape. TED's field model is broad and versioned, so parsing is defensive:
// anything we can't map cleanly is left null (and flagged for manual check when
// it's the deadline). Live field names should be confirmed against the API on
// first deploy — see docs/platform/tender-agent/STACK.md.

const http = require('../http');
const { resolveClosing, parseAmount, cpvList } = require('../normalise');

// Best-effort pick of the first present value across candidate keys / locales.
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v == null) continue;
    if (typeof v === 'object') {
      // TED multilingual fields look like { eng: "…", fra: "…" }.
      const first = v.eng || v.en || Object.values(v)[0];
      if (first) return first;
    } else if (String(v).trim()) return v;
  }
  return null;
}

function mapNotice(n) {
  const ref = pick(n, ['publication-number', 'publicationNumber', 'ND', 'noticeId', 'id']);
  const title = pick(n, ['notice-title', 'title', 'TI', 'name-of-procedure']);
  const buyer = pick(n, ['buyer-name', 'buyerName', 'organisation-name-buyer', 'AA', 'contracting-body']);
  const closingRaw = pick(n, ['deadline-receipt-tender', 'deadline', 'submission-deadline', 'DT', 'tender-deadline']);
  const publishedRaw = pick(n, ['publication-date', 'publicationDate', 'PD', 'dispatch-date']);
  const country = pick(n, ['country', 'buyer-country', 'CY']);
  const valueRaw = pick(n, ['estimated-value', 'value', 'total-value']);
  const currency = pick(n, ['currency', 'value-currency']);
  const cpv = n['classification-cpv'] || n.cpv || n.CPV || n.mainCpv || null;
  const link = pick(n, ['links', 'uri', 'html', 'url']) ||
    (ref ? `https://ted.europa.eu/en/notice/-/detail/${ref}` : null);

  const { closing_at, needs_manual_check } = resolveClosing(closingRaw);
  return {
    external_ref: ref ? `TED-${ref}` : null,
    url: typeof link === 'string' ? link : (link?.self || null),
    title,
    buyer_name: buyer,
    buyer_country: country,
    buyer_city: null,
    cpv_codes: cpvList(cpv),
    published_at: publishedRaw ? new Date(publishedRaw) : null,
    closing_at,
    value_min: parseAmount(valueRaw),
    value_max: parseAmount(valueRaw),
    currency: currency || 'EUR',
    description: pick(n, ['description', 'short-description', 'notice-title']) || null,
    raw_payload: n,
    needs_manual_check,
  };
}

async function fetch(source, { log = () => {} } = {}) {
  const cfg = source.config || {};
  const cpv = Array.isArray(cfg.cpv) && cfg.cpv.length ? cfg.cpv : ['79416000', '79416100', '79416200', '92500000', '92520000'];
  const base = source.endpoint.replace(/\/$/, '');
  // Expert query: CPV in our set, published in the last 60 days.
  const query = `classification-cpv IN (${cpv.join(' ')}) AND publication-date>=today(-60)`;
  const body = {
    query,
    fields: [
      'publication-number', 'notice-title', 'buyer-name', 'deadline-receipt-tender',
      'publication-date', 'classification-cpv', 'estimated-value', 'currency', 'country', 'links',
    ],
    limit: 100,
    scope: 'ACTIVE',
  };
  let data;
  try {
    data = await http.get(`${base}/v3/notices/search`, {
      type: 'json',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Some deployments require POST; axios.get can't carry a body, so fall back
    // to the documented GET query param form before giving up.
    try {
      const q = encodeURIComponent(query);
      data = await http.get(`${base}/v3/notices/search?query=${q}&limit=100&scope=ACTIVE`, { type: 'json' });
    } catch (e2) {
      log(`TED search failed: ${e.message} / ${e2.message}`);
      return [];
    }
  }
  const list = data?.notices || data?.results || data?.hits || [];
  const notices = list.map(mapNotice).filter(n => n.external_ref);
  log(`TED: ${notices.length} notices`);
  return notices;
}

module.exports = { fetch, mapNotice };
