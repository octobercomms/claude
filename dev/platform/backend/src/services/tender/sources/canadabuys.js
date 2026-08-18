// CanadaBuys adapter. CanadaBuys aggregates federal, provincial and many
// municipal notices and publishes an RSS feed (and an open-data download).
// Phase 1 uses the RSS feed. Ships disabled until validated against the live
// feed on deploy (flip tender_sources.enabled). RSS rarely carries a
// machine-readable deadline, so those notices are flagged for manual check;
// the open-data CSV (a later enrichment) fills value/CPV/deadline.

const cheerio = require('cheerio');
const http = require('../http');
const { resolveClosing } = require('../normalise');

function parseRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    const $el = $(el);
    items.push({
      title: $el.find('title').first().text().trim(),
      link: $el.find('link').first().text().trim() || $el.find('guid').first().text().trim(),
      guid: $el.find('guid').first().text().trim(),
      pubDate: $el.find('pubDate').first().text().trim(),
      description: $el.find('description').first().text().trim(),
    });
  });
  return items;
}

async function fetch(source, { log = () => {} } = {}) {
  const cfg = source.config || {};
  const base = source.endpoint.replace(/\/$/, '');
  const feeds = Array.isArray(cfg.rss) ? cfg.rss : ['/en/tender-notices/rss'];
  const notices = [];
  for (const feed of feeds) {
    let xml;
    try { xml = await http.get(base + feed, { type: 'text' }); }
    catch (e) { log(`CanadaBuys feed ${feed} failed: ${e.message}`); continue; }
    for (const item of parseRss(xml)) {
      const ref = item.guid || item.link;
      if (!ref) continue;
      const { closing_at, needs_manual_check } = resolveClosing(null); // not in RSS
      notices.push({
        external_ref: ref,
        url: item.link || null,
        title: item.title || null,
        buyer_name: null,
        buyer_country: 'Canada',
        buyer_city: null,
        cpv_codes: [],
        published_at: item.pubDate ? new Date(item.pubDate) : null,
        closing_at,
        value_min: null,
        value_max: null,
        currency: 'CAD',
        description: item.description || null,
        raw_payload: { rss: item },
        needs_manual_check,
      });
    }
  }
  log(`CanadaBuys: ${notices.length} notices`);
  return notices;
}

module.exports = { fetch, parseRss };
