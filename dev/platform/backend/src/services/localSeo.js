// Local SEO toolkit — five on-demand Claude tools for local search.
//
//   competition_gap  — paste competitor URLs → content gaps + topics to outrank
//   schema_audit     — read a URL's structured data → audit + generated JSON-LD
//   buyer_intent     — service + city → 20 buyer-intent local keywords
//   competitor_xray  — your site vs competitors → comparison + advantages
//   gbp_posts        — competitor GBP analysis → 10 ready Google Business posts
//
// Each tool gathers its inputs (fetching competitor / target HTML through the
// stealth-aware fetchRenderedHtml seam, behind the SSRF guard), prompts Claude
// grounded in the local-seo / schema playbooks, parses strict JSON, persists
// the run, and returns it. The deterministic shape lets the panel re-open any
// past run from history without a re-run.

const pool = require('../db');
const claudeService = require('./claude');
const playbooks = require('./playbooks');
const { fetchRenderedHtml } = require('../utils/fetchHtml');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

const TOOLS = ['competition_gap', 'schema_audit', 'buyer_intent', 'competitor_xray', 'gbp_posts', 'ranking_playbook'];

function isTool(t) { return TOOLS.includes(t); }

// ─── helpers ────────────────────────────────────────────────────────────────

function normUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fetch a page and return its visible text (+ raw HTML for the schema tool).
// Soft-fails: returns ok:false with a reason rather than throwing, so one dead
// competitor URL doesn't sink a whole run. SSRF guard runs first and DOES throw
// (a blocked host is a user error worth surfacing as a 400).
async function fetchPage(rawUrl, { maxLen = 12000 } = {}) {
  const url = normUrl(rawUrl);
  if (!url) return { url: rawUrl, ok: false, reason: 'empty url', text: '', html: '' };
  await assertPublicHttpUrl(url);
  try {
    const r = await fetchRenderedHtml(url, { timeout: 15000 });
    if (!r.html || r.status >= 400) {
      return { url, ok: false, reason: `fetch returned ${r.status || 'no response'}`, text: '', html: '' };
    }
    return { url, ok: true, status: r.status, via: r.via, html: r.html, text: htmlToText(r.html).slice(0, maxLen) };
  } catch (err) {
    return { url, ok: false, reason: err.message, text: '', html: '' };
  }
}

// Pull every JSON-LD block out of a page for the schema audit.
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null && out.length < 12) {
    const block = (m[1] || '').trim();
    if (block) out.push(block.slice(0, 4000));
  }
  return out;
}

function firstMatch(html, re) {
  const m = re.exec(html);
  return m ? m[1].trim() : '';
}

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error(`Claude returned malformed JSON: ${cleaned.slice(0, 200)}`); }
}

async function loadClient(clientId) {
  const { rows } = await pool.query(
    'SELECT id, name, domain, briefing_field, competitor_domains FROM clients WHERE id = $1',
    [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  return rows[0];
}

async function saveRun({ clientId, tool, title, input, output }) {
  const { rows } = await pool.query(
    `INSERT INTO local_seo_runs (client_id, tool, title, input_json, output_json)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [clientId, tool, title || null, JSON.stringify(input || {}), JSON.stringify(output || {})]
  );
  return rows[0];
}

const clientLine = (c) => `Client: ${c.name}${c.domain ? ` (${c.domain})` : ''}\nAbout: ${c.briefing_field || '(no briefing set)'}`;

// ─── 1. COMPETITION GAP KILLER ───────────────────────────────────────────────
async function runCompetitionGap({ clientId, competitorUrls }) {
  const client = await loadClient(clientId);
  let urls = (Array.isArray(competitorUrls) ? competitorUrls : [])
    .map(normUrl).filter(Boolean).slice(0, 3);
  if (!urls.length && Array.isArray(client.competitor_domains)) {
    urls = client.competitor_domains.map(normUrl).filter(Boolean).slice(0, 3);
  }
  if (!urls.length) throw new Error('Add at least one competitor URL (or set competitor domains on the client).');

  const pages = await Promise.all(urls.map(u => fetchPage(u)));
  const usable = pages.filter(p => p.ok && p.text.length > 80);
  if (!usable.length) throw new Error('Could not read any competitor page (all fetches failed or were empty).');

  const prompt = `${clientLine(client)}

Analyse these competitor pages and find where ${client.name} can outrank them.

${usable.map((p, i) => `--- COMPETITOR ${i + 1}: ${p.url} ---\n${p.text}`).join('\n\n')}

Identify missing content, weak pages, under-optimised sections and trust gaps the competitors expose. Be specific to what you actually see on the pages.

Return ONLY a JSON object, no preamble or code fences:
{
  "content_gaps": [{"title": "string", "description": "what's missing / weak", "why_they_rank": "why the competitor wins here", "competition_level": "low|medium|high"}],
  "topics_to_create": [{"title": "string", "angle": "the specific angle to take", "target_intent": "informational|commercial|transactional", "why_it_will_rank": "search intent + competition reasoning"}],
  "trust_gaps": ["specific trust signals competitors have that the client should add"],
  "summary": "2-3 sentence AM briefing"
}
Give 5 content_gaps and 5 topics_to_create. Be specific. British English.`;

  const raw = await claudeService.callClaude({
    max_tokens: 3500,
    system: 'You are a local SEO strategist for October Communications. Specific, commercial, evidence-led. British English. Output JSON only.' + playbooks.systemSuffix(['local-seo', 'seo-audit']),
    user: prompt,
    feature: 'local_seo_competition_gap',
    clientId,
  });
  const output = parseJson(raw);
  output._meta = { competitors: usable.map(p => p.url), skipped: pages.filter(p => !p.ok).map(p => ({ url: p.url, reason: p.reason })) };
  const run = await saveRun({ clientId, tool: 'competition_gap', title: usable.map(p => p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')).join(', '), input: { competitorUrls: urls }, output });
  return run;
}

// ─── 2. FULL SCHEMA AUDIT ────────────────────────────────────────────────────
async function runSchemaAudit({ clientId, url }) {
  const client = await loadClient(clientId);
  const page = await fetchPage(url, { maxLen: 6000 });
  if (!page.ok) throw new Error(`Could not read ${normUrl(url)} — ${page.reason}`);

  const jsonLd = extractJsonLd(page.html);
  const title = firstMatch(page.html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = firstMatch(page.html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i);

  const prompt = `${clientLine(client)}

Audit the structured data on this page and propose fixes.

URL: ${page.url}
<title>: ${title || '(none)'}
<meta description>: ${metaDesc || '(none)'}

Existing JSON-LD blocks found on the page (${jsonLd.length}):
${jsonLd.length ? jsonLd.map((b, i) => `--- block ${i + 1} ---\n${b}`).join('\n\n') : '(none found)'}

Visible page text (truncated, to judge whether schema matches real content):
${page.text.slice(0, 3500)}

Evaluate every existing schema type (useful / weak / broken). Check specifically whether LocalBusiness (or the correct subtype) exists and is complete. Identify missing or under-utilised schema with a priority. For each HIGH-priority missing type, generate clean, valid JSON-LD with {{PLACEHOLDER}} values for anything not derivable from the page.

Return ONLY a JSON object, no preamble or code fences:
{
  "localbusiness_present": true|false,
  "existing": [{"type": "string", "verdict": "useful|weak|broken", "note": "string"}],
  "missing": [{"type": "string", "priority": "high|medium|low", "why": "string"}],
  "generated": [{"type": "string", "jsonld": "the full <script type=\\"application/ld+json\\"> ... </script> string"}],
  "summary": "2-3 sentence verdict"
}
No guessing, no fluff. British English.`;

  const raw = await claudeService.callClaude({
    max_tokens: 4000,
    system: 'You are a technical SEO specialist auditing Schema.org structured data. Precise, no fluff, no hallucinated markup. Output JSON only.' + playbooks.systemSuffix(['schema']),
    user: prompt,
    feature: 'local_seo_schema_audit',
    clientId,
  });
  const output = parseJson(raw);
  output._meta = { url: page.url, blocks_found: jsonLd.length };
  const run = await saveRun({ clientId, tool: 'schema_audit', title: page.url.replace(/^https?:\/\//, ''), input: { url: page.url }, output });
  return run;
}

// ─── 3. BUYER-INTENT KEYWORD SNIPER ──────────────────────────────────────────
async function runBuyerIntent({ clientId, service, city }) {
  const client = await loadClient(clientId);
  const svc = String(service || '').trim();
  const loc = String(city || '').trim();
  if (!svc || !loc) throw new Error('Both service and city are required.');

  const prompt = `${clientLine(client)}

List 20 high-intent local search keywords for the service "${svc}" in "${loc}".

Requirements:
- Must signal immediate buying intent where possible (e.g. "near me", "emergency", "same day", "open now", "cost", "quote").
- Include long-tail variations.
- Prioritise low competition + high conversion.

Return ONLY a JSON object, no preamble or code fences:
{
  "keywords": [{"keyword": "string", "intent_type": "transactional|commercial|informational", "long_tail": true|false, "why_converts": "one short reason"}],
  "summary": "2-3 sentence note on the strongest opportunities"
}
Exactly 20 keywords, strongest buying intent first. British English.`;

  const raw = await claudeService.callClaude({
    max_tokens: 3000,
    system: 'You are a local SEO keyword strategist. Commercial, specific. Output JSON only.' + playbooks.systemSuffix(['local-seo']),
    user: prompt,
    feature: 'local_seo_buyer_intent',
    clientId,
  });
  const output = parseJson(raw);
  const run = await saveRun({ clientId, tool: 'buyer_intent', title: `${svc} · ${loc}`, input: { service: svc, city: loc }, output });
  return run;
}

// ─── 4. BUSINESS vs COMPETITOR X-RAY ─────────────────────────────────────────
async function runCompetitorXray({ clientId, myUrl, competitorUrls }) {
  const client = await loadClient(clientId);
  const mine = normUrl(myUrl) || normUrl(client.domain);
  if (!mine) throw new Error('Set the client domain or provide your website URL.');
  let comps = (Array.isArray(competitorUrls) ? competitorUrls : []).map(normUrl).filter(Boolean).slice(0, 3);
  if (!comps.length && Array.isArray(client.competitor_domains)) {
    comps = client.competitor_domains.map(normUrl).filter(Boolean).slice(0, 3);
  }
  if (!comps.length) throw new Error('Add at least one competitor URL (or set competitor domains on the client).');

  const [myPage, ...compPages] = await Promise.all([fetchPage(mine), ...comps.map(u => fetchPage(u))]);
  if (!myPage.ok) throw new Error(`Could not read your site ${mine} — ${myPage.reason}`);
  const usableComps = compPages.filter(p => p.ok && p.text.length > 80);
  if (!usableComps.length) throw new Error('Could not read any competitor page.');

  const prompt = `${clientLine(client)}

Compare ${client.name}'s site against its competitors and find advantages to exploit.

--- MY SITE: ${myPage.url} ---
${myPage.text}

${usableComps.map((p, i) => `--- COMPETITOR ${i + 1}: ${p.url} ---\n${p.text}`).join('\n\n')}

For my business and each competitor, extract: services offered, target locations, unique selling points / strengths, and trust signals (reviews, certifications, guarantees, case studies). Then produce a side-by-side comparison and the strategic advantages I can exploit immediately.

Return ONLY a JSON object, no preamble or code fences:
{
  "me": {"name": "string", "services": ["..."], "locations": ["..."], "usps": ["..."]},
  "competitors": [{"domain": "string", "name": "string", "services": ["..."], "locations": ["..."], "strengths": ["..."], "trust_signals": ["..."]}],
  "comparison": [{"dimension": "e.g. Services / Locations / Reviews / Guarantees", "you": "string", "competitors": "string"}],
  "advantages": [{"advantage": "string", "how_to_exploit": "concrete next action"}],
  "summary": "2-3 sentence AM briefing"
}
Give at least 3 advantages. Be specific and evidence-led. British English.`;

  const raw = await claudeService.callClaude({
    max_tokens: 3800,
    system: 'You are a competitive strategist for a marketing agency. Evidence-led, specific, commercial. Output JSON only.' + playbooks.systemSuffix(['local-seo']),
    user: prompt,
    feature: 'local_seo_competitor_xray',
    clientId,
  });
  const output = parseJson(raw);
  output._meta = { my_url: myPage.url, competitors: usableComps.map(p => p.url) };
  const run = await saveRun({ clientId, tool: 'competitor_xray', title: usableComps.map(p => p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')).join(', '), input: { myUrl: myPage.url, competitorUrls: comps }, output });
  return run;
}

// ─── 5. GOOGLE BUSINESS PROFILE POST GENERATOR ───────────────────────────────
async function runGbpPosts({ clientId, competitorUrl, service, city }) {
  const client = await loadClient(clientId);
  const svc = String(service || '').trim();
  const loc = String(city || '').trim();
  if (!svc || !loc) throw new Error('Both service and city are required.');

  let compNote = '(no competitor page supplied — work from the service + city)';
  let compUrlNorm = null;
  if (competitorUrl && String(competitorUrl).trim()) {
    const page = await fetchPage(competitorUrl);
    compUrlNorm = page.url;
    if (page.ok && page.text.length > 80) {
      compNote = `Competitor page (${page.url}):\n${page.text.slice(0, 6000)}`;
    } else {
      compNote = `(competitor page ${page.url} could not be read: ${page.reason} — work from the service + city)`;
    }
  }

  const prompt = `${clientLine(client)}

Generate Google Business Profile posts for ${client.name} — a ${svc} in ${loc}.

${compNote}

Identify keyword gaps and content patterns the competitor is missing, then write 10 high-converting GBP posts for my business.

Each post must include: a local keyword, a landmark / area reference in ${loc}, a clear urgency-driven CTA (e.g. "Call now", "Book today"), and a clear service angle. Tone: persuasive, local, action-driven. ~1500 characters max each, one idea per post.

Return ONLY a JSON object, no preamble or code fences:
{
  "gaps": ["what the competitor is NOT doing that we can own"],
  "posts": [{"local_keyword": "string", "landmark": "string", "body": "the full post text", "cta": "string"}],
  "summary": "2-3 sentence note"
}
Exactly 10 posts. British English.`;

  const raw = await claudeService.callClaude({
    max_tokens: 4000,
    system: 'You write Google Business Profile posts for local businesses. Local, specific, action-driven — never generic. Output JSON only.' + playbooks.systemSuffix(['local-seo', 'copywriting']),
    user: prompt,
    feature: 'local_seo_gbp_posts',
    clientId,
  });
  const output = parseJson(raw);
  output._meta = { competitor_url: compUrlNorm };
  const run = await saveRun({ clientId, tool: 'gbp_posts', title: `${svc} · ${loc}`, input: { service: svc, city: loc, competitorUrl: compUrlNorm }, output });
  return run;
}

// ─── 6. GBP RANKING PLAYBOOK (ranking levers + reviews + photos) ─────────────
// Reverse-engineers what actually drives the local pack for a category and
// turns it into an execution playbook — the ranking-levers table, a review
// strategy, and a photo strategy from the "Claude for SEO" deck, in one run.
async function runRankingPlaybook({ clientId, service, city, competitorUrls }) {
  const client = await loadClient(clientId);
  const svc = String(service || '').trim();
  const loc = String(city || '').trim();
  if (!svc || !loc) throw new Error('Both service and city are required.');

  let comps = (Array.isArray(competitorUrls) ? competitorUrls : []).map(normUrl).filter(Boolean).slice(0, 3);
  if (!comps.length && Array.isArray(client.competitor_domains)) {
    comps = client.competitor_domains.map(normUrl).filter(Boolean).slice(0, 3);
  }
  const compPages = comps.length ? (await Promise.all(comps.map(u => fetchPage(u)))).filter(p => p.ok && p.text.length > 80) : [];
  const compBlock = compPages.length
    ? compPages.map((p, i) => `--- COMPETITOR ${i + 1}: ${p.url} ---\n${p.text.slice(0, 5000)}`).join('\n\n')
    : '(no readable competitor pages supplied — work from the category + best practice)';

  const prompt = `${clientLine(client)}

Business: ${client.name} — a ${svc} in ${loc}.

${compBlock}

Build a Google Business Profile ranking playbook for the local map pack for "${svc} ${loc}". Cover three things:
1. RANKING LEVERS — the levers Google actually rewards for this category/local pack, ranked by impact, each with the evidence (what top competitors demonstrate) and why it matters.
2. REVIEW STRATEGY — how to use reviews as a ranking signal: keyword themes to seed naturally, review pacing/cadence, a rating-distribution target, and a reply approach.
3. PHOTO STRATEGY — the priority GBP photo types, ideal weekly upload cadence, and what top profiles rely on.

Return ONLY a JSON object, no preamble or code fences:
{
  "ranking_levers": [{"lever":"string","evidence":"what competitors demonstrate / why it ranks","impact":"high|medium|low"}],
  "review_strategy": {"keyword_themes":["..."],"pacing":"string","rating_target":"string","reply_approach":"string"},
  "photo_strategy": {"priority_types":["..."],"cadence":"string","notes":"string"},
  "summary": "2-3 sentence AM briefing"
}
At least 5 ranking levers, ordered highest-impact first. Specific and execution-focused — avoid generic advice. British English.`;

  const raw = await claudeService.callClaude({
    max_tokens: 3500,
    system: 'You are a local-SEO strategist specialising in Google Business Profile / map-pack ranking. Evidence-led, specific, execution-focused. Output JSON only.' + playbooks.systemSuffix(['local-seo']),
    user: prompt,
    feature: 'local_seo_ranking_playbook',
    clientId,
  });
  const output = parseJson(raw);
  output._meta = { competitors: compPages.map(p => p.url) };
  const run = await saveRun({ clientId, tool: 'ranking_playbook', title: `${svc} · ${loc}`, input: { service: svc, city: loc, competitorUrls: comps }, output });
  return run;
}

// ─── run history (shared across all tools) ───────────────────────────────────
async function listRuns(clientId, tool) {
  const { rows } = await pool.query(
    `SELECT id, tool, title, input_json, output_json, created_at
     FROM local_seo_runs WHERE client_id = $1 AND tool = $2
     ORDER BY created_at DESC LIMIT 40`,
    [clientId, tool]
  );
  return rows;
}

async function deleteRun(clientId, runId) {
  await pool.query('DELETE FROM local_seo_runs WHERE id = $1 AND client_id = $2', [runId, clientId]);
}

const RUNNERS = {
  competition_gap: runCompetitionGap,
  schema_audit: runSchemaAudit,
  buyer_intent: runBuyerIntent,
  competitor_xray: runCompetitorXray,
  gbp_posts: runGbpPosts,
  ranking_playbook: runRankingPlaybook,
};

// Dispatch by tool name with the route's body as named args.
async function run(tool, clientId, body = {}) {
  const fn = RUNNERS[tool];
  if (!fn) throw new Error(`Unknown local SEO tool: ${tool}`);
  return fn({ clientId, ...body });
}

module.exports = { TOOLS, isTool, run, listRuns, deleteRun };
