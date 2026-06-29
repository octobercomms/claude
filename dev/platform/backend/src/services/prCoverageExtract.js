// PR — "log coverage from a link". Fetch a coverage URL's HTML (via the stealth
// fetch-with-fallback wrapper), pull publication / journalist / headline / date
// from the page metadata first and an AI model (routable to DeepSeek) for the
// gaps, then look for the client's still-open editorial-log entries on the same
// outlet so the AM can merge instead of duplicating. Extraction only — the route
// does the create/merge, reusing the existing resolveOutlet/resolveContact path.

const db = require('../db');
const { callClaude } = require('./claude');
const { fetchRenderedHtml } = require('../utils/fetchHtml');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

// Statuses that count as "still open" (not yet published / closed) — these are
// the entries we offer to merge a fresh piece of coverage into.
const OPEN_STATUSES = ['pitched', 'pending', 'no_response', 'confirmed', 'interview_prep', 'new'];

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, patterns) {
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return '';
}

// Pull what we can straight from the page — og: tags, article meta, JSON-LD.
function parseMeta(html) {
  const publication = metaContent(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const journalist = metaContent(html, [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i,
    /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i,
  ]);
  const title = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const date = metaContent(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:date|pubdate|publish-date)["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ]);
  return { publication, journalist, title, date: date ? date.slice(0, 10) : '' };
}

const EXTRACT_SYSTEM = `You extract structured facts about an online press article from its text. Respond with ONLY a JSON object: {"publication": "the outlet/site name", "journalist": "the author's full name, or empty", "title": "the article headline", "date": "publish date YYYY-MM-DD or empty"}. Use empty strings for anything you can't determine. Do not guess a journalist if none is credited.`;

async function extractFromUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) { const e = new Error('Enter a full http(s) URL.'); e.status = 400; throw e; }
  await assertPublicHttpUrl(url); // SSRF guard

  const r = await fetchRenderedHtml(url, { timeout: 15000 });
  if (!r.html || r.status >= 400) { const e = new Error(`Couldn't fetch that page${r.status ? ` (status ${r.status})` : ''}. Paywall or login wall? Fill the fields in by hand.`); e.status = 422; throw e; }

  const meta = parseMeta(r.html);
  const text = htmlToText(r.html).slice(0, 6000);

  let ai = {};
  try {
    const raw = await callClaude({
      system: EXTRACT_SYSTEM,
      user: `URL: ${url}\nKnown so far: ${JSON.stringify(meta)}\n\nArticle text:\n"""\n${text}\n"""`,
      max_tokens: 400,
      feature: 'pr_coverage_extract',
    });
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (match) ai = JSON.parse(match[0]);
  } catch (e) { /* metadata-only fallback */ }

  // Metadata wins where present (it's authoritative); AI fills the gaps.
  const pick = (a, b) => (a && a.trim() ? a.trim() : (b && String(b).trim() ? String(b).trim() : ''));
  return {
    url,
    publication: pick(meta.publication, ai.publication),
    journalist: pick(meta.journalist, ai.journalist),
    title: pick(meta.title, ai.title),
    date: pick(meta.date, ai.date).slice(0, 10),
  };
}

// Open editorial-log entries for this client on the same outlet — merge candidates.
async function findOpenMatches(clientId, publication) {
  const pub = String(publication || '').trim();
  if (!pub) return [];
  const { rows } = await db.query(
    `SELECT l.id, l.story_title, l.status, l.request_date, l.issue_date, l.story_url,
            o.name AS outlet, c.name AS contact
       FROM pr_editorial_log l
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       LEFT JOIN outreach_contacts c ON c.id = l.contact_id
      WHERE l.client_id = $1
        AND l.status = ANY($2)
        AND o.name IS NOT NULL
        AND (lower(o.name) = lower($3) OR lower(o.name) LIKE '%' || lower($3) || '%' OR lower($3) LIKE '%' || lower(o.name) || '%')
      ORDER BY l.created_at DESC
      LIMIT 10`,
    [clientId, OPEN_STATUSES, pub]
  );
  return rows;
}

module.exports = { extractFromUrl, findOpenMatches, OPEN_STATUSES };
