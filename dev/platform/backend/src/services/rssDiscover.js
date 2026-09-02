// RSS/Atom feed discovery for publications. Given an outlet's home URL (or its
// domain), find the feed: read the homepage's <link rel="alternate"> tags, then
// probe the common feed paths, validating that each candidate really returns a
// feed. Pure HTTP + cheerio — no LLM, so a full sweep is essentially free.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');

const UA = 'Mozilla/5.0 (compatible; OMI-MediaBot/1.0; +https://platform.octobercomms.com)';
const COMMON_PATHS = [
  '/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml',
  '/feeds/posts/default', '/?feed=rss2', '/blog/feed', '/news/feed', '/feed/',
];

function normBase(outlet) {
  let u = (outlet.url || '').trim();
  if (!u && outlet.domain) u = `https://${String(outlet.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).origin + (new URL(u).pathname === '/' ? '' : new URL(u).pathname); }
  catch { return null; }
}

async function get(url) {
  return axios.get(url, {
    timeout: 10000, maxContentLength: 5 * 1024 * 1024, maxRedirects: 4,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8' },
    validateStatus: (s) => s >= 200 && s < 400,
  });
}

// Does this body look like an RSS/Atom feed?
function looksLikeFeed(body, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) {
    if (/<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(body)) return true;
  }
  // Some servers mislabel content-type; sniff the body regardless.
  return /<rss[\s>]|<feed[\s>][\s\S]*<entry[\s>]|<channel>[\s\S]*<item[\s>]/i.test(body);
}

async function validateFeed(url) {
  try {
    const r = await get(url);
    if (looksLikeFeed(r.data, r.headers['content-type'])) return true;
  } catch { /* not a feed / unreachable */ }
  return false;
}

// Discover a feed for one outlet. Returns { url, rss_url } | null (never throws).
async function discover(outlet) {
  const base = normBase(outlet);
  if (!base) return null;
  const origin = (() => { try { return new URL(base).origin; } catch { return base; } })();

  // 1) Homepage <link rel="alternate" type="application/rss+xml|atom+xml">.
  try {
    const r = await get(base);
    const $ = cheerio.load(r.data || '');
    const links = [];
    $('link[rel="alternate"]').each((_, el) => {
      const type = ($(el).attr('type') || '').toLowerCase();
      const href = $(el).attr('href');
      if (href && (type.includes('rss') || type.includes('atom') || type.includes('xml'))) links.push(href);
    });
    for (const href of links) {
      let abs;
      try { abs = new URL(href, base).href; } catch { continue; }
      if (await validateFeed(abs)) return { url: base, rss_url: abs };
    }
  } catch { /* homepage unreachable — still try common paths */ }

  // 2) Common feed paths off the origin.
  for (const p of COMMON_PATHS) {
    const cand = origin + p;
    if (await validateFeed(cand)) return { url: base, rss_url: cand };
  }
  return null;
}

// Discover + persist for one outlet id. Returns the new rss_status.
async function findForOutlet(outletId) {
  const { rows } = await pool.query('SELECT id, name, url, domain FROM pr_outlets WHERE id = $1', [outletId]);
  const outlet = rows[0];
  if (!outlet) throw new Error('Outlet not found');
  if (!outlet.url && !outlet.domain) {
    await pool.query(`UPDATE pr_outlets SET rss_status = 'none', rss_checked_at = NOW() WHERE id = $1`, [outletId]);
    return { rss_status: 'none', reason: 'no url/domain' };
  }
  let found = null;
  try { found = await discover(outlet); }
  catch { /* treat as error below */ }
  if (found) {
    await pool.query(
      `UPDATE pr_outlets SET url = COALESCE(url, $2), rss_url = $3, rss_status = 'found', rss_checked_at = NOW() WHERE id = $1`,
      [outletId, found.url, found.rss_url]
    );
    return { rss_status: 'found', rss_url: found.rss_url };
  }
  await pool.query(`UPDATE pr_outlets SET rss_status = 'none', rss_checked_at = NOW() WHERE id = $1`, [outletId]);
  return { rss_status: 'none' };
}

// Sweep — find feeds for outlets not yet resolved. Bounded per run; skips
// outlets with no url/domain (nothing to work from).
async function sweep({ limit = 60, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM pr_outlets
      WHERE merged_into IS NULL
        AND rss_status = 'unknown'
        AND (url IS NOT NULL OR (domain IS NOT NULL AND domain <> ''))
      ORDER BY rss_checked_at NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  let found = 0, none = 0;
  for (const r of rows) {
    try {
      const out = await findForOutlet(r.id);
      if (out.rss_status === 'found') found++; else none++;
    } catch (e) { log(`rss sweep: outlet ${r.id} failed: ${e.message}`); }
  }
  log(`rss sweep: ${rows.length} checked, ${found} feeds found`);
  return { checked: rows.length, found, none };
}

module.exports = { discover, findForOutlet, sweep };
