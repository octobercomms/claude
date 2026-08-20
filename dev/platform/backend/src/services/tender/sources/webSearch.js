// Web-search discovery — the way a person (or a scheduled Claude task) actually
// finds these: search the open web and read the notice pages, instead of polling
// a threshold-filtered government data feed. This is what surfaces the SMALL,
// below-threshold jobs October wants (a £20k Venice Biennale PR brief, a River
// Tweed brand project) — they're on the public web even when the OCDS API hides
// them.
//
// Crucially the search runs at Anthropic's end (the web_search tool), NOT from
// our server — so it sidesteps the portal firewalls/rate-limits that block our
// direct API fetches. OMI already uses this exact tool in services/claude.js
// (researchBriefing), so it's a proven capability on this box.
//
// Claude searches, reads pages, and returns a JSON array of open notices; we
// normalise them into the common shape and hand them to the same ingest →
// classify → dedupe → store → email pipeline as every other source.

const Anthropic = require('@anthropic-ai/sdk');
const { resolveClosing, parseAmount } = require('../normalise');
const { prefilter } = require('../classify');
const { recordClaudeCost } = require('../../costLog');

const MODEL = 'claude-sonnet-4-6';

// Default markets + the search framing. Overridable via source.config.
const DEFAULT_MARKETS = ['United Kingdom', 'Canada', 'European Union', 'United States'];

function buildPrompt(markets, maxResults) {
  return `You are the sourcing scout for October, a PR and communications agency that works with the creative sector — arts, culture, museums, galleries, heritage, design, architecture, festivals, biennales, and tourism/destination organisations.

Use web search to find PUBLIC-SECTOR and public-body tender or contract opportunities that October could bid for RIGHT NOW. Search the official portals AND the open web:
- UK: Find a Tender, Contracts Finder, Public Contracts Scotland, Sell2Wales
- Canada: CanadaBuys, provincial portals (e.g. BC Bid)
- EU: TED and national portals
- US: SAM.gov and state/city portals
plus arts councils, museums, cultural bodies and destination-marketing organisations advertising directly.

Target the kind of work October does: public relations, media relations, press office, strategic communications, marketing communications, brand/positioning strategy, audience development, campaign and destination marketing — for creative-sector buyers.

CRITICAL:
- Include SMALL and below-threshold notices (e.g. £10k–£200k). These are the ones that matter most and the ones the tidy data feeds miss. Do NOT skip an opportunity for being low-value.
- Only include opportunities that are OPEN now, with a submission deadline in the future (after today). Never include closed, awarded or expired notices.
- Markets to cover: ${markets.join(', ')}.

Return up to ${maxResults} opportunities. When you are done searching, output ONLY a JSON array (in a \`\`\`json code block) with one object per opportunity:
[
  {
    "title": "notice title",
    "buyer": "the contracting organisation",
    "country": "United Kingdom | Canada | European Union | United States | …",
    "url": "the canonical public notice URL",
    "closing": "the submission deadline as YYYY-MM-DD (omit if genuinely unknown)",
    "value": "contract value if stated, e.g. £20,000 (omit if unknown)",
    "summary": "one sentence on the requirement"
  }
]
No commentary outside the JSON block. If you find nothing genuinely relevant, return [].`;
}

// Pull the JSON array out of Claude's final text (it emits planning text between
// searches, then the array). Prefer a ```json fence; fall back to the last
// top-level [ … ] balanced array.
function extractArray(text) {
  if (!text) return [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const tryParse = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };
  if (fence) { const v = tryParse(fence[1].trim()); if (v) return v; }
  // Fall back: last balanced [...] in the text.
  const start = text.lastIndexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) { const v = tryParse(text.slice(start, end + 1)); if (v) return v; }
  return [];
}

// A stable external_ref from the notice URL (host + path, no query/hash), so the
// same opportunity found on two runs dedupes instead of duplicating.
function refFromUrl(url, title) {
  if (url) {
    try { const u = new URL(url); return `${u.host}${u.pathname}`.replace(/\/$/, '').toLowerCase(); }
    catch { /* fall through */ }
  }
  return (title || '').trim().toLowerCase().slice(0, 200) || null;
}

async function fetch(source, { log = () => {}, stats = {} } = {}) {
  const cfg = source.config || {};
  const markets = Array.isArray(cfg.markets) && cfg.markets.length ? cfg.markets : DEFAULT_MARKETS;
  const maxResults = cfg.maxResults || 25;
  const maxSearches = cfg.maxSearches || 8;

  const key = process.env.CLAUDE_API_KEY;
  if (!key) { log('Web search: CLAUDE_API_KEY not set'); return []; }

  let message;
  try {
    message = await new Anthropic({ apiKey: key }).messages.create({
      model: cfg.model || MODEL,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }],
      messages: [{ role: 'user', content: buildPrompt(markets, maxResults) }],
    });
  } catch (e) {
    log(`Web search failed: ${e.message}`);
    return [];
  }
  try { recordClaudeCost({ model: cfg.model || MODEL, response: message, feature: 'tender_web_search' }); } catch { /* non-fatal */ }

  const text = (message.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  const raw = extractArray(text);
  stats.scanned = raw.length;

  const notices = [];
  for (const item of raw) {
    const title = (item.title || '').trim();
    const url = (item.url || '').trim() || null;
    const external_ref = refFromUrl(url, title);
    if (!title || !external_ref) continue;
    const { closing_at, needs_manual_check } = resolveClosing(item.closing);
    const n = {
      external_ref,
      url,
      title,
      buyer_name: (item.buyer || '').trim() || null,
      buyer_country: (item.country || '').trim() || cfg.country || null,
      buyer_city: null,
      cpv_codes: [],
      published_at: null,
      closing_at,
      value_min: parseAmount(item.value),
      value_max: parseAmount(item.value),
      currency: null,
      description: (item.summary || '').trim() || null,
      raw_payload: { via: 'web_search', url },
      needs_manual_check,
    };
    // Keep the niche (match + maybe); drop obvious noise the same way the API
    // adapters do. Claude is already told to filter, so this is a light backstop.
    if (prefilter(n).tier === 'noise') continue;
    notices.push(n);
  }
  log(`Web search: ${raw.length} found → ${notices.length} relevant`);
  return notices;
}

module.exports = { fetch, extractArray, refFromUrl };
