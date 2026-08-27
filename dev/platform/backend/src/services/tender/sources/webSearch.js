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

// One focused search brief per market — named portals + concrete below-threshold
// patterns so recall is high on exactly the small jobs the API feeds miss. Each
// runs as its own web_search-enabled call so every market gets dedicated search
// budget (one broad call ran too few queries and missed Venice / River Tweed).
const MARKET_BRIEFS = {
  'United Kingdom': {
    country: 'United Kingdom',
    portals: 'Find a Tender (find-tender.service.gov.uk), Contracts Finder (contractsfinder.service.gov.uk), Public Contracts Scotland (publiccontractsscotland.gov.uk), Sell2Wales (sell2wales.gov.wales), and the aggregators Infobrokers (infobrokers.co.uk — a curated list of UK marketing & PR public tenders, a strong source for the small ones), Tussell and BidStats',
    examples: 'PR consultancy for a national pavilion at an international exhibition (e.g. the British Council at the Venice Biennale); brand positioning and audience development for a heritage trail, park or destination (e.g. a river/coastal trail); press office and media relations for a museum, gallery, festival or arts council; strategic communications for a cultural or tourism body',
    buyers: 'the British Council, Arts Council England/Wales, Creative Scotland, national museums and galleries, heritage trusts, festivals and biennales, VisitBritain/VisitScotland and regional destination organisations, local authority culture/tourism teams',
    // Portal search-result pages to read directly with web_fetch — these list
    // EVERY current notice for the keyword (incl. small below-threshold ones
    // that rank too low to appear in general web search).
    fetchUrls: [
      'https://www.find-tender.service.gov.uk/Search/Results?keywords=public+relations',
      'https://www.find-tender.service.gov.uk/Search/Results?keywords=communications',
      'https://www.find-tender.service.gov.uk/Search/Results?keywords=marketing',
      'https://www.contractsfinder.service.gov.uk/Search/Results?keywords=public+relations',
      'https://www.publiccontractsscotland.gov.uk/search/search_mainpage.aspx',
      'https://www.infobrokers.co.uk/',
    ],
  },
  'Canada': {
    country: 'Canada',
    portals: 'CanadaBuys (canadabuys.canada.ca), MERX (merx.com), Biddingo (biddingo.com), BC Bid, and provincial/municipal portals',
    examples: 'media relations and public relations services for a destination or business-events body; advertising/creative production; audience and marketing communications for a museum, gallery or cultural agency',
    buyers: 'Destination Canada, provincial tourism bodies, national museums and cultural agencies, arts councils, city culture/tourism departments',
  },
  'European Union': {
    country: 'European Union',
    portals: 'TED (ted.europa.eu) and national procurement portals',
    examples: 'communications, PR and audience-development services for a cultural institution, museum, festival, biennale or European Capital of Culture; destination marketing for a tourism board',
    buyers: 'national museums and cultural ministries, festivals and biennales, tourism boards, European cultural programmes',
  },
  'United States': {
    country: 'United States',
    portals: 'SAM.gov (sam.gov) and state/city procurement portals',
    examples: 'public relations, media relations and marketing communications for an arts commission, museum, cultural district or tourism office; audience development and destination marketing',
    buyers: 'state arts commissions, museums and cultural institutions, city tourism/destination-marketing offices, national cultural agencies',
  },
};

const DEFAULT_MARKETS = Object.keys(MARKET_BRIEFS);

function buildPrompt(marketName, maxResults) {
  const b = MARKET_BRIEFS[marketName] || { country: marketName, portals: 'the official government procurement portals and the open web', examples: 'PR, media relations, communications, brand and audience-development work for creative-sector buyers', buyers: 'museums, galleries, arts councils, heritage bodies and destination-marketing organisations' };
  const fetchBlock = Array.isArray(b.fetchUrls) && b.fetchUrls.length
    ? `\nFIRST, use web_fetch to read these portal SEARCH-RESULT pages directly and extract every open notice listed on them (this catches the small, low-value notices that don't rank in general web search):\n${b.fetchUrls.map(u => `- ${u}`).join('\n')}\nFollow into a result's notice page with web_fetch when you need its deadline or value. THEN also run web searches to widen coverage.\n`
    : '';
  return `You are the sourcing scout for October, a PR and communications agency that works with the creative sector — arts, culture, museums, galleries, heritage, design, architecture, festivals, biennales, and tourism/destination organisations.

Find PUBLIC-SECTOR tender or contract opportunities in ${b.country} that October could bid for RIGHT NOW. Be thorough: read the portal search pages directly AND run several web searches, combining the service terms with the sector terms. Read the notice pages to confirm the deadline and requirement.
${fetchBlock}
Portals to search: ${b.portals}.
Also search buyers advertising directly: ${b.buyers}.

Service terms (what October does): public relations, PR agency, media relations, press office, communications agency, marketing communications, strategic communications, earned media, thought leadership, press strategy, brand and positioning strategy, audience development, destination marketing.
Sector terms (who the buyer is): museum, gallery, arts, culture, cultural, heritage, design, architecture, tourism, exhibition, festival, biennale, theatre. Ignore generic marketing, advertising, digital-build or non-cultural procurement.

Concretely, look for opportunities like: ${b.examples}.

CRITICAL:
- Prioritise SMALL and below-threshold notices (roughly £10k–£250k). These are the ones October wants and the ones the tidy government data feeds hide — do NOT skip an opportunity for being low value. Chase them deliberately.
- Only include opportunities that are OPEN now, with a submission deadline in the future (after today). Never include closed, awarded or expired notices.
- Don't stop after one search — keep searching different service×sector combinations and portals until you've been genuinely thorough.

URL RULES (important — a wrong link destroys trust):
- The "url" must be the canonical notice page on the OFFICIAL government portal or the buyer's own procurement site (Find a Tender, Contracts Finder, Public Contracts Scotland, Sell2Wales, CanadaBuys, TED, SAM.gov, or the buyer's own page).
- NEVER link to an aggregator or reseller page (Infobrokers, Tussell, BidStats, TenderSignal, Jorpex, GovBid, and similar). Use those only to DISCOVER an opportunity — then find and link the official source. Their per-tender ids often mismatch the notice.
- Only include a "url" you are confident resolves to THIS exact notice (same title and buyer). If you cannot identify the exact official URL, set "url" to null — do NOT guess or approximate. A missing link is fine; a wrong one is not.

Return up to ${maxResults} opportunities. When done, output ONLY a JSON array (in a \`\`\`json code block), one object per opportunity:
[
  {
    "title": "notice title",
    "buyer": "the contracting organisation",
    "country": "${b.country}",
    "url": "the canonical public notice URL",
    "closing": "the submission deadline as YYYY-MM-DD (omit if genuinely unknown)",
    "value": "contract value if stated, e.g. £20,000 (omit if unknown)",
    "summary": "one sentence on the requirement"
  }
]
No commentary outside the JSON block. If you genuinely find nothing relevant, return [].`;
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

// Aggregator / reseller hosts that gate the real source behind a signup — the
// model can't see the notice there and its per-tender ids often mismatch, so we
// never keep a link to one (the row falls back to a title+buyer web search).
const AGGREGATOR_HOSTS = /(^|\.)(tendersignal|infobrokers|tussell|bidstats|jorpex|govbid|biddingo|merx)\./i;
function cleanUrl(url) {
  const u = (url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try { if (AGGREGATOR_HOSTS.test(new URL(u).host)) return null; } catch { return null; }
  return u;
}

// A stable external_ref from the notice URL, so the same opportunity found on
// two runs dedupes instead of duplicating. Host + path, plus a recognised notice
// id from the query when the portal keys notices that way (e.g. Public Contracts
// Scotland's ?ID=…) — otherwise two distinct notices on a generic script path
// (search_view.aspx) would wrongly collapse to one. Volatile params (origin,
// page, utm…) are dropped so the ref is stable across how the link was reached.
const ID_PARAMS = ['id', 'noticeid', 'ocid', 'ref', 'reference', 'noticeref'];
function refFromUrl(url, title) {
  if (url) {
    try {
      const u = new URL(url);
      let ref = `${u.host}${u.pathname}`.replace(/\/$/, '').toLowerCase();
      for (const [k, v] of u.searchParams) {
        if (v && ID_PARAMS.includes(k.toLowerCase())) { ref += `?${k.toLowerCase()}=${v.toLowerCase()}`; break; }
      }
      return ref;
    } catch { /* fall through */ }
  }
  return (title || '').trim().toLowerCase().slice(0, 200) || null;
}

// One Claude call for a single market. Uses web_fetch (read portal search pages
// directly — catches the small notices general search misses) + web_search (to
// widen coverage). Returns the raw JSON items Claude reported. If web_fetch is
// not enabled on the account the first call errors, so we retry with web_search
// only rather than failing the whole source.
async function searchMarket(client, marketName, { model, maxResults, maxSearches, maxFetches, log }) {
  const prompt = buildPrompt(marketName, maxResults);
  const withFetch = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: maxFetches },
  ];
  const searchOnly = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }];

  const base = { model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] };
  // web_fetch is a beta API tool — it only activates when the request carries the
  // web-fetch beta flag. Send it via the beta namespace; if that path (or the
  // tool) isn't available on this account, fall back to plain web_search so the
  // source never hard-fails.
  async function callWithFetch() {
    return client.beta.messages.create({ ...base, tools: withFetch, betas: ['web-fetch-2025-09-10'] });
  }
  async function callSearchOnly() {
    return client.messages.create({ ...base, tools: searchOnly });
  }

  let message;
  try {
    message = await callWithFetch();
  } catch (e) {
    // web_fetch may not be enabled for this account — fall back to search only.
    log(`Web (${marketName}) web_fetch unavailable (${e.message}); retrying search-only`);
    try { message = await callSearchOnly(); }
    catch (e2) { log(`Web search (${marketName}) failed: ${e2.message}`); return []; }
  }
  try { recordClaudeCost({ model, response: message, feature: 'tender_web_search' }); } catch { /* non-fatal */ }
  const text = (message.content || []).filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  const items = extractArray(text);
  log(`Web (${marketName}): ${items.length} found`);
  return items;
}

async function fetch(source, { log = () => {}, stats = {} } = {}) {
  const cfg = source.config || {};
  const markets = Array.isArray(cfg.markets) && cfg.markets.length ? cfg.markets : DEFAULT_MARKETS;
  const maxResults = cfg.maxResults || 20;
  const maxSearches = cfg.maxSearches || 6; // per market
  const maxFetches = cfg.maxFetches || 6;   // per market (portal search pages + notice pages)
  const model = cfg.model || MODEL;

  const key = process.env.CLAUDE_API_KEY;
  if (!key) { log('Web search: CLAUDE_API_KEY not set'); return []; }
  const client = new Anthropic({ apiKey: key });

  // A focused pass per market (serial, to stay polite on token/rate budgets),
  // then merge. Each market gets its own dedicated search budget so recall on
  // the small, below-threshold notices stays high.
  const raw = [];
  for (const m of markets) {
    raw.push(...await searchMarket(client, m, { model, maxResults, maxSearches, maxFetches, log }));
  }
  stats.scanned = raw.length;

  const seen = new Set();
  const notices = [];
  for (const item of raw) {
    const title = (item.title || '').trim();
    const url = cleanUrl(item.url);
    const external_ref = refFromUrl(url, title);
    if (!title || !external_ref) continue;
    if (seen.has(external_ref)) continue; // dedupe across market passes
    seen.add(external_ref);
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
  log(`Web search: ${raw.length} found across ${markets.length} markets → ${notices.length} relevant`);
  return notices;
}

module.exports = { fetch, extractArray, refFromUrl, searchMarket };
