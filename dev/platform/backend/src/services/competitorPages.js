// Competitor landing-page diff. Weekly cron walks every configured
// competitor URL across every client, fetches the HTML, extracts the
// semantic content blocks (h1 / h2 / h3 / hero p / button text), and
// compares to the previous snapshot. Material changes — i.e. ones that
// affect the message rather than incidental copy edits — surface on
// the Competitor Tracker panel and feed into the next batch's prompt.
//
// Built on the same urlSafety guard as the press parser so an AM
// can't aim the fetcher at an internal service.

const cheerio = require('cheerio');
const crypto = require('crypto');
const pool = require('../db');
const { assertPublicHttpUrl } = require('../utils/urlSafety');
const { fetchRenderedHtml } = require('../utils/fetchHtml');

// Tags we consider semantic — the ones that carry brand message rather
// than navigation chrome. h1/h2 lead the page, hero paragraphs are
// the value prop, button text is the CTA, price-class tags catch
// pricing-page numbers.
const SEMANTIC_SELECTORS = ['h1', 'h2', 'h3', 'p[class*="hero"]', 'p[class*="lead"]',
  '.hero p', '[class*="pricing"] [class*="amount"]', '[class*="price"]',
  'button', 'a[class*="cta"], a[class*="btn"]'];

async function scrapePage(url) {
  // SSRF guard first — unchanged. The URL is validated public BEFORE it can
  // reach either axios or (on a challenge) the Camofox sidecar.
  await assertPublicHttpUrl(url);
  // Routed through the fetch-with-fallback wrapper. Competitor pages are sites
  // we don't control, so they're the likeliest to sit behind a WAF — exactly
  // what Camofox is for. Degrades to the old axios behaviour until a sidecar
  // is live.
  const res = await fetchRenderedHtml(url, {
    timeout: 15000,
    maxRedirects: 0,
    userAgent: 'Mozilla/5.0 (compatible; OctoberPlatform/1.0; +https://platform.octobercomms.com)',
  });
  // Preserve the previous 2xx-only contract: any other status is an error the
  // caller records. A WAF challenge therefore stays an error today, and once
  // Camofox is live the wrapper returns the rendered 200 page to scrape.
  if (res.status < 200 || res.status >= 300) {
    throw new Error(res.error || `Request failed with status ${res.status}`);
  }
  const $ = cheerio.load(res.html || '');
  $('script, style, noscript, iframe').remove();

  const blocks = [];
  for (const sel of SEMANTIC_SELECTORS) {
    $(sel).each((_, el) => {
      const tag = el.tagName ? el.tagName.toLowerCase() : 'block';
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (!text || text.length < 3 || text.length > 400) return;
      blocks.push({ tag, text });
    });
  }
  // Dedupe within a snapshot — same H2 appearing twice on a page
  // shouldn't count as two separate blocks.
  const seen = new Set();
  const deduped = blocks.filter(b => {
    const k = `${b.tag}::${b.text.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return deduped;
}

// Build the canonical content string for hashing + diffing.
function blocksToText(blocks) {
  return blocks.map(b => `${b.tag}: ${b.text}`).join('\n');
}

function hashContent(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Diff two block lists. Returns three arrays:
//   added — blocks present in `curr` but not `prev`
//   removed — present in `prev` but not `curr`
//   changed_blocks — sections where the same tag-position has new text
//
// "Same tag-position" is approximated by hashing the tag + a 25-char
// prefix of the previous text — good enough for the kind of edits
// brands actually make (rewording a hero, dropping a section).
function diffBlocks(prevBlocks, currBlocks) {
  const prevByKey = new Map();
  const currByKey = new Map();
  for (const b of (prevBlocks || [])) prevByKey.set(`${b.tag}::${b.text.toLowerCase()}`, b);
  for (const b of (currBlocks || [])) currByKey.set(`${b.tag}::${b.text.toLowerCase()}`, b);

  const added = [...currByKey.entries()].filter(([k]) => !prevByKey.has(k)).map(([, b]) => b);
  const removed = [...prevByKey.entries()].filter(([k]) => !currByKey.has(k)).map(([, b]) => b);

  // Cap to keep summaries digestible.
  return {
    added: added.slice(0, 10),
    removed: removed.slice(0, 10),
  };
}

async function getLatestSnapshot(pageId) {
  const { rows } = await pool.query(
    `SELECT content_text, content_hash FROM competitor_page_snapshots
      WHERE page_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
    [pageId]
  );
  return rows[0] || null;
}

// Scrape one page + record the snapshot. Returns the diff so the
// caller can surface what changed.
async function scrapeAndStore(page) {
  let blocks;
  try {
    blocks = await scrapePage(page.url);
  } catch (err) {
    return { page_id: page.id, ok: false, error: err.message };
  }
  const text = blocksToText(blocks);
  const hash = hashContent(text);
  const prev = await getLatestSnapshot(page.id);

  // No-op if content hasn't changed at all — keeps the table from
  // bloating with identical snapshots week after week.
  if (prev && prev.content_hash === hash) {
    return { page_id: page.id, ok: true, changed: false };
  }

  const prevBlocks = prev ? parseBlocksFromText(prev.content_text) : [];
  const diff = diffBlocks(prevBlocks, blocks);

  await pool.query(
    `INSERT INTO competitor_page_snapshots
       (page_id, content_text, content_hash, changed_blocks)
     VALUES ($1, $2, $3, $4)`,
    [page.id, text, hash, JSON.stringify(diff)]
  );

  return { page_id: page.id, ok: true, changed: true, diff };
}

// Inverse of blocksToText.
function parseBlocksFromText(text) {
  return String(text || '').split('\n').map(line => {
    const idx = line.indexOf(': ');
    if (idx < 0) return { tag: 'block', text: line };
    return { tag: line.slice(0, idx), text: line.slice(idx + 2) };
  }).filter(b => b.text);
}

async function scrapeClient(clientId) {
  const { rows: pages } = await pool.query(
    `SELECT id, url, label FROM competitor_pages WHERE client_id = $1 AND active = true`,
    [clientId]
  );
  const results = [];
  for (const p of pages) results.push(await scrapeAndStore(p));
  return results;
}

async function scrapeAllClients() {
  const { rows: pages } = await pool.query(
    `SELECT p.id, p.url, p.client_id, c.name AS client_name
       FROM competitor_pages p
       JOIN clients c ON c.id = p.client_id
      WHERE p.active = true AND c.active = true`
  );
  const summary = [];
  for (const p of pages) {
    const r = await scrapeAndStore(p);
    summary.push({ ...r, client_name: p.client_name, url: p.url });
  }
  return summary;
}

// Read-side: latest snapshot per page for this client, with the diff
// summary so the UI can show "Nike's pricing page added 3 new lines".
async function getRecentChanges(clientId, { limit = 25 } = {}) {
  const { rows } = await pool.query(
    `SELECT p.id AS page_id, p.url, p.label,
            s.id AS snapshot_id, s.changed_blocks, s.fetched_at,
            (SELECT COUNT(*)::int FROM competitor_page_snapshots
              WHERE page_id = p.id) AS snapshot_count
       FROM competitor_pages p
       LEFT JOIN LATERAL (
         SELECT id, changed_blocks, fetched_at FROM competitor_page_snapshots
          WHERE page_id = p.id ORDER BY fetched_at DESC LIMIT 1
       ) s ON true
      WHERE p.client_id = $1 AND p.active = true
      ORDER BY s.fetched_at DESC NULLS LAST
      LIMIT $2`,
    [clientId, limit]
  );
  return rows;
}

module.exports = {
  scrapePage, scrapeAndStore, scrapeClient, scrapeAllClients,
  getRecentChanges, diffBlocks, blocksToText, hashContent,
};
