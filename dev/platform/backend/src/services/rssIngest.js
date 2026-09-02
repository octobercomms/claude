// RSS/Atom ingestion. For each publication with a known feed, fetch it, parse
// the items, and upsert them into pr_outlet_articles — matching each byline to a
// journalist already in the DB where we can. Pure HTTP + cheerio, no LLM, so it
// runs cheaply on a schedule and becomes the firehose that later phases mine for
// new journalists and inactivity.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');

const UA = 'Mozilla/5.0 (compatible; OMI-MediaBot/1.0; +https://platform.octobercomms.com)';

// Find the first descendant whose LOCAL tag name (ignoring any namespace
// prefix like dc: / atom:) is one of `names`, and return its text or an attr.
function pick(el, $, names, attr) {
  let out = '';
  el.find('*').each((_, node) => {
    if (out) return;
    const tag = (node.tagName || node.name || '').toLowerCase();
    const local = tag.includes(':') ? tag.split(':').pop() : tag;
    if (names.includes(local)) {
      const $n = $(node);
      const v = attr ? ($n.attr(attr) || '') : ($n.text() || '');
      if (v && v.trim()) out = v.trim();
    }
  });
  return out;
}

function parseFeed(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item, entry').each((_, node) => {
    const el = $(node);
    const title = pick(el, $, ['title']);
    // RSS <link>text</link>; Atom <link href="…"/>.
    let url = pick(el, $, ['link'], 'href') || pick(el, $, ['link']) || pick(el, $, ['guid']);
    const guid = pick(el, $, ['guid', 'id']) || null;
    const author = pick(el, $, ['creator', 'author', 'name']) || null;
    const dateStr = pick(el, $, ['pubdate', 'published', 'updated', 'date']) || null;
    let published_at = null;
    if (dateStr) { const t = new Date(dateStr); if (!isNaN(t)) published_at = t.toISOString(); }
    if (title || url) items.push({ title: title || null, url: url || null, guid, author_name: author, published_at });
  });
  return items;
}

// Match a raw byline to a journalist already attached to this outlet.
async function matchContact(outletId, authorName) {
  const name = String(authorName || '').trim();
  if (!name) return null;
  const parts = name.toLowerCase().replace(/[^a-z\s'-]/g, '').split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const last = parts[parts.length - 1] || '';
  const { rows } = await pool.query(
    `SELECT id FROM outreach_contacts
      WHERE kind IN ('media','industry') AND outlet_id = $1
        AND ( lower(name) = lower($2)
              OR (lower(first_name) = $3 AND lower(last_name) = $4) )
      LIMIT 1`,
    [outletId, name, first, last]
  );
  return rows[0]?.id || null;
}

// Ingest one outlet's feed. Returns { inserted, matched } (never throws).
async function ingestOutlet(outletId, { log = () => {} } = {}) {
  const { rows } = await pool.query('SELECT id, rss_url FROM pr_outlets WHERE id = $1', [outletId]);
  const outlet = rows[0];
  if (!outlet || !outlet.rss_url) return { inserted: 0, matched: 0 };
  let xml;
  try {
    const r = await axios.get(outlet.rss_url, {
      timeout: 12000, maxContentLength: 8 * 1024 * 1024, maxRedirects: 4,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8' },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    xml = r.data;
  } catch (e) {
    await pool.query(`UPDATE pr_outlets SET rss_status = 'error', feed_fetched_at = NOW() WHERE id = $1`, [outletId]);
    log(`ingest ${outletId}: fetch failed — ${e.message}`);
    return { inserted: 0, matched: 0 };
  }
  const items = parseFeed(xml);
  let inserted = 0, matched = 0;
  for (const it of items.slice(0, 100)) {
    const contactId = await matchContact(outletId, it.author_name);
    if (contactId) matched++;
    const r = await pool.query(
      `INSERT INTO pr_outlet_articles (outlet_id, contact_id, title, url, author_name, guid, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (outlet_id, COALESCE(guid, url)) DO UPDATE
         SET contact_id = COALESCE(pr_outlet_articles.contact_id, EXCLUDED.contact_id)
       RETURNING (xmax = 0) AS is_new`,
      [outletId, contactId, it.title, it.url, it.author_name, it.guid, it.published_at]
    );
    if (r.rows[0]?.is_new) inserted++;
  }
  await pool.query(`UPDATE pr_outlets SET feed_fetched_at = NOW(), rss_status = 'found' WHERE id = $1`, [outletId]);
  return { inserted, matched };
}

// Ingest every outlet that has a feed. Bounded per run.
async function ingestAll({ limit = 400, log = () => {} } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM pr_outlets
      WHERE merged_into IS NULL AND rss_status = 'found' AND rss_url IS NOT NULL
      ORDER BY feed_fetched_at NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  let inserted = 0, matched = 0;
  for (const r of rows) {
    try { const o = await ingestOutlet(r.id, { log }); inserted += o.inserted; matched += o.matched; }
    catch (e) { log(`ingestAll: outlet ${r.id} failed: ${e.message}`); }
  }
  log(`ingestAll: ${rows.length} feeds, ${inserted} new articles, ${matched} byline matches`);
  return { feeds: rows.length, inserted, matched };
}

module.exports = { parseFeed, ingestOutlet, ingestAll, matchContact };
