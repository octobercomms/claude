// D3 Tenders (UK) adapter. D3 aggregates all four UK portals (Contracts Finder,
// Find a Tender, Public Contracts Scotland, Sell2Wales). We poll the industry
// RSS feeds (the intended access route — lower breakage than scraping search)
// and enrich each item from its OCDS JSON, which gives structured buyer, CPV
// codes, value and a machine-readable deadline without parsing prose.
//
// D3's llms.txt welcomes AI retrieval of public records; we cite it as
// "D3 Tenders (d3tenders.com)", set a descriptive UA and rate-limit (see http.js).

const cheerio = require('cheerio');
const http = require('../http');
const { resolveClosing, parseAmount, cpvList } = require('../normalise');

// Pull the OCID out of a notice URL. D3 uses two forms: a query form
// (…/contract/?ocid=ocds-…) — which is what the RSS <link> carries — and a
// clean path form (…/contract/ocds-….json|.md). Handle both, plus an optional
// file suffix, so enrichment gets a real OCID instead of an empty capture.
function ocidFromUrl(url) {
  if (!url) return null;
  const s = String(url);
  let m = s.match(/[?&]ocid=([^&#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  m = s.match(/\/contract\/([^/?#]+?)(?:\.(?:json|md|html))?(?:[?#]|$)/i);
  if (m && m[1]) return m[1];
  return null;
}

// Parse an RSS feed body into basic items via cheerio in XML mode.
function parseRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    const $el = $(el);
    const link = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim();
    items.push({
      title: $el.find('title').first().text().trim(),
      link,
      guid: $el.find('guid').first().text().trim(),
      pubDate: $el.find('pubDate').first().text().trim(),
      description: $el.find('description').first().text().trim(),
    });
  });
  return items;
}

// Pull the useful fields out of an OCDS document (compiledRelease or the first
// release). Defensive: OCDS shapes vary a little between publishers.
function fromOcds(doc) {
  const rel = doc?.compiledRelease || doc?.releases?.[0] || doc?.release || doc || {};
  const tender = rel.tender || {};
  const parties = Array.isArray(rel.parties) ? rel.parties : [];
  const buyerParty = parties.find(p => (p.roles || []).includes('buyer')) || rel.buyer || {};
  const addr = buyerParty.address || {};

  // CPV: the tender classification id plus any additional CPV classifications.
  const cpv = [];
  if (tender.classification?.scheme && /cpv/i.test(tender.classification.scheme) && tender.classification.id) cpv.push(tender.classification.id);
  for (const item of (tender.items || [])) {
    if (item.classification?.id && /cpv/i.test(item.classification.scheme || 'CPV')) cpv.push(item.classification.id);
    for (const ac of (item.additionalClassifications || [])) if (/cpv/i.test(ac.scheme || '')) cpv.push(ac.id);
  }

  return {
    title: tender.title || null,
    description: tender.description || null,
    buyer_name: buyerParty.name || rel.buyer?.name || null,
    buyer_country: addr.countryName || null,
    buyer_city: addr.locality || addr.region || null,
    cpv_codes: cpvList(cpv),
    closing_raw: tender.tenderPeriod?.endDate || null,
    published_raw: rel.date || tender.tenderPeriod?.startDate || null,
    value_amount: tender.value?.amount ?? null,
    currency: tender.value?.currency || null,
  };
}

// source: the tender_sources row. Returns an array of normalised notices.
async function fetch(source, { log = () => {} } = {}) {
  const cfg = source.config || {};
  const base = source.endpoint.replace(/\/$/, '');
  const feeds = Array.isArray(cfg.rss) ? cfg.rss : ['/feeds/rss-79.xml', '/feeds/rss-92.xml'];
  const ocdsTemplate = cfg.ocds || '/contract/{OCID}.json';
  const maxEnrich = Number(cfg.maxEnrich) || 60;

  // 1) Gather RSS items across every configured feed, de-duplicated by OCID.
  const byOcid = new Map();
  for (const feed of feeds) {
    let xml;
    try { xml = await http.get(base + feed, { type: 'text' }); }
    catch (e) { log(`D3 feed ${feed} failed: ${e.message}`); continue; }
    for (const item of parseRss(xml)) {
      const ocid = ocidFromUrl(item.link) || item.guid || null;
      if (!ocid) continue;
      if (!byOcid.has(ocid)) byOcid.set(ocid, { ...item, ocid });
    }
  }

  // 2) Enrich each (up to maxEnrich) via its OCDS JSON; fall back to RSS fields.
  const notices = [];
  let enriched = 0;
  for (const [ocid, item] of byOcid) {
    const url = item.link || `${base}/contract/${ocid}`;
    let fields = null;
    if (enriched < maxEnrich) {
      try {
        const doc = await http.get(base + ocdsTemplate.replace('{OCID}', ocid), { type: 'json' });
        fields = fromOcds(doc);
        enriched++;
      } catch (e) { log(`D3 OCDS ${ocid} failed: ${e.message}`); }
    }
    const title = fields?.title || item.title || null;
    const description = fields?.description || item.description || null;
    const { closing_at, needs_manual_check } = resolveClosing(fields?.closing_raw);
    notices.push({
      external_ref: ocid,
      url,
      title,
      buyer_name: fields?.buyer_name || null,
      buyer_country: fields?.buyer_country || 'United Kingdom',
      buyer_city: fields?.buyer_city || null,
      cpv_codes: fields?.cpv_codes || [],
      published_at: fields?.published_raw ? new Date(fields.published_raw) : (item.pubDate ? new Date(item.pubDate) : null),
      closing_at,
      value_min: parseAmount(fields?.value_amount),
      value_max: parseAmount(fields?.value_amount),
      currency: fields?.currency || 'GBP',
      description,
      raw_payload: { rss: item, ocds_fields: fields },
      needs_manual_check,
    });
  }
  log(`D3: ${byOcid.size} items, ${enriched} enriched`);
  return notices;
}

module.exports = { fetch, parseRss, fromOcds, ocidFromUrl };
