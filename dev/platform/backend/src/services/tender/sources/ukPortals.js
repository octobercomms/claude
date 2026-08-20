// UK official OCDS APIs — Find a Tender and Contracts Finder. D3 only mirrors
// these and its search is a JS SPA we can't scrape, so we go to the source.
// Both return standard OCDS release packages ({ releases, links.next }); each
// release is a FULL record (no separate enrichment fetch), so we page, map with
// the shared OCDS reader, and keep only the niche matches (filtered at ingest so
// the firehose doesn't fill the DB with construction/IT/works notices).
//
// Source config:
//   mode: 'firehose' — page listUrl (optionally windowed by updatedFrom/sinceDays)
//   mode: 'keyword'  — for each searchTerm, GET base?keyword=<term>
//   noticeBase, country, sinceDays, maxPages / maxPagesPerTerm

const http = require('../http');
const { resolveClosing, parseAmount } = require('../normalise');
const { fromOcds } = require('./d3');
const { prefilter } = require('../classify');

// Best public URL for a notice: a tenderNotice document link, else the
// release's self link, else portal base + id.
function noticeUrl(release, noticeBase) {
  const docs = (release.tender && release.tender.documents) || [];
  const doc = docs.find(d => d.documentType === 'tenderNotice' && d.url) || docs.find(d => d.url);
  if (doc && doc.url) return doc.url;
  if (release.links && release.links.self) return release.links.self;
  const id = release.id || release.ocid;
  return noticeBase && id ? `${noticeBase}${id}` : null;
}

function mapRelease(release, { country, noticeBase }) {
  const f = fromOcds(release); // fromOcds falls through to the bare release object
  const id = release.id || release.ocid;
  const { closing_at, needs_manual_check } = resolveClosing(f.closing_raw);
  return {
    external_ref: release.ocid || id,
    url: noticeUrl(release, noticeBase),
    title: f.title,
    buyer_name: f.buyer_name,
    buyer_country: f.buyer_country || country,
    buyer_city: f.buyer_city,
    cpv_codes: f.cpv_codes,
    published_at: release.date ? new Date(release.date) : null,
    closing_at,
    value_min: parseAmount(f.value_amount),
    value_max: parseAmount(f.value_amount),
    currency: f.currency,
    description: f.description,
    raw_payload: { notice_id: id },
    needs_manual_check,
  };
}

// Page an OCDS release-packages endpoint via links.next, stopping at maxPages or
// once a page's releases are all older than cutoffDate.
async function pageReleases(startUrl, { maxPages, cutoffDate, log }) {
  const out = [];
  let url = startUrl, page = 0;
  while (url && page < maxPages) {
    let data;
    try { data = await http.get(url, { type: 'json' }); }
    catch (e) { log(`OCDS page failed: ${e.message}`); break; }
    const rs = Array.isArray(data.releases) ? data.releases : [];
    out.push(...rs);
    page++;
    if (cutoffDate && rs.length) {
      const oldest = rs.reduce((m, r) => { const d = new Date(r.date); return (!m || d < m) ? d : m; }, null);
      if (oldest && oldest < cutoffDate) break;
    }
    url = data.links?.next || null;
  }
  return out;
}

async function fetch(source, { log = () => {}, stats = {} } = {}) {
  const cfg = source.config || {};
  const country = cfg.country || 'United Kingdom';
  const cutoff = cfg.sinceDays ? new Date(Date.now() - cfg.sinceDays * 86400000) : null;

  let releases = [];
  if (cfg.mode === 'keyword') {
    const base = cfg.base;
    const terms = Array.isArray(cfg.searchTerms) && cfg.searchTerms.length ? cfg.searchTerms : ['public relations', 'media relations', 'communications agency'];
    const seen = new Set();
    for (const term of terms) {
      const url = `${base}?keyword=${encodeURIComponent(term)}`;
      const rs = await pageReleases(url, { maxPages: cfg.maxPagesPerTerm || 2, cutoffDate: cutoff, log });
      for (const r of rs) { const k = r.ocid || r.id; if (k && !seen.has(k)) { seen.add(k); releases.push(r); } }
    }
  } else {
    // firehose: page listUrl. windowParam names the server-side date filter
    // ('updatedFrom' for Find a Tender, 'dateFrom' for PCS/Sell2Wales); set it
    // false for a batch API with no windowing.
    //
    // When the server windows the result we TRUST it and page links.next to
    // exhaustion (up to maxPages) — we must NOT early-stop on release.date,
    // because a notice updated inside the window can carry an older publication
    // date and would wrongly truncate the feed (that is why Find a Tender was
    // surfacing only a handful, and the Venice Biennale notice went missing).
    // For an unwindowed feed we keep the release.date early-stop so we don't
    // page the whole history.
    const maxPages = cfg.maxPages || 40;
    const wp = cfg.windowParam === undefined ? 'updatedFrom' : cfg.windowParam;
    let start = cfg.listUrl, windowed = false;
    if (cutoff && wp) {
      const val = cfg.windowFormat === 'dd-mm-yyyy'
        ? `${String(cutoff.getDate()).padStart(2, '0')}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${cutoff.getFullYear()}`
        : cfg.windowFormat === 'mm-yyyy'
        ? `${String(cutoff.getMonth() + 1).padStart(2, '0')}-${cutoff.getFullYear()}`
        : cutoff.toISOString().slice(0, 19);
      start += (start.includes('?') ? '&' : '?') + wp + '=' + val;
      windowed = true;
    }
    releases = await pageReleases(start, { maxPages, cutoffDate: windowed ? null : cutoff, log });
    // If the windowed call came back empty (e.g. the portal rejected our date
    // format), fall back to the unwindowed batch so a daily poll still picks up
    // the current open notices. /v1/Notices returns the recent set in one page.
    if (windowed && releases.length === 0) {
      log(`${source.name}: windowed fetch empty — retrying without ${wp}`);
      releases = await pageReleases(cfg.listUrl, { maxPages, cutoffDate: cutoff, log });
    }
  }

  // Map + filter to the niche at ingest (keep match + maybe; drop the noise).
  stats.scanned = releases.length; // raw notices fetched, before the niche filter
  const notices = [];
  for (const r of releases) {
    const n = mapRelease(r, { country, noticeBase: cfg.noticeBase });
    if (!n.external_ref || !n.title) continue;
    if (prefilter(n).tier === 'noise') continue;
    notices.push(n);
  }
  log(`${source.name}: ${releases.length} releases → ${notices.length} relevant`);
  return notices;
}

module.exports = { fetch, mapRelease };
