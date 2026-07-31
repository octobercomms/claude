// Brief cluster mode — Pipeline → Brief.
//
// Two-stage workflow:
//   1. clusterKeywords(list) → Claude groups N keywords into 3–8 topic
//      clusters. Cheap (one Claude call); AM reviews + picks.
//   2. briefForCluster(cluster) → generates a full content brief for a
//      chosen cluster, using the cluster's primary keyword + secondaries
//      as input. Reuses the structure of the existing single-keyword
//      brief so the Draft step doesn't need to know which path
//      produced its input.
//
// Persisted? No — clusters are ephemeral. The AM picks one and turns
// it into a brief; the brief storage already exists via PlanningTab.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');
const claudeService = require('./claude');
const dataForSEO = require('../connectors/dataforseo');
const brandVoice = require('./brandVoice');
const playbooks = require('./playbooks');

const MODEL = 'claude-sonnet-4-6';

// Question-led clustering. Every cluster is ONE publishable piece of content
// defined by the single question it answers — and the series of keywords it must
// hit to answer that question well. This is the model that wins both classic
// search (topical depth) and AI answers (a page that answers one question
// thoroughly is what engines lift and cite).
const CLUSTER_SYSTEM = `You group keywords into topic clusters for a content strategy. British English. Return JSON only — no prose, no markdown fences.

The governing principle: ONE cluster = ONE piece of content = ONE question it answers, by hitting a series of keywords. A cluster is only valid if a single, focused page could genuinely answer its core question and naturally cover all its keywords. If keywords span two different questions, split them into two clusters — don't force breadth that would make a thin, unfocused page.

For each cluster:
- core_question: the single question a searcher is really asking — phrased as a natural question ("what is …", "how do I …", "which … is best for …"). This becomes the page's reason to exist and the answer it leads with.
- primary: the keyword that best represents the cluster (highest commercial intent or search volume).
- secondary: 3–10 related keywords the piece must also hit (variations, sub-topics, long-tail, the sub-questions of the core question).
- label: a tight 2–5 word cluster name.
- intent: informational | navigational | commercial | transactional.
- rationale: one tight sentence on why these belong together as a single answer.

Aim for 3–8 clusters. If some keywords don't cluster naturally, return fewer clusters and put the rest in "unclustered".

Schema:
{
  "clusters": [
    {
      "label": "short cluster name",
      "core_question": "the single question this one piece answers",
      "primary": "the primary keyword",
      "secondary": ["keyword 2", "keyword 3", "..."],
      "intent": "informational" | "navigational" | "commercial" | "transactional",
      "rationale": "one tight sentence on why these go together as one answer"
    }
  ],
  "unclustered": ["keyword that didn't fit anywhere"]
}`;

async function loadClient(clientId) {
  const { rows } = await pool.query(
    'SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!rows.length) throw new Error('Client not found');
  return rows[0];
}

async function clusterKeywords({ clientId, keywords }) {
  const list = Array.isArray(keywords)
    ? keywords.map(k => String(k || '').trim()).filter(Boolean)
    : String(keywords || '').split('\n').map(k => k.trim()).filter(Boolean);
  if (list.length < 2) throw new Error('Need at least 2 keywords to cluster');
  if (list.length > 200) throw new Error('200 keyword limit per cluster run');

  const client = await loadClient(clientId);
  const userPrompt = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing — infer from the keywords themselves)'}

Keywords to cluster (${list.length}):
${list.map(k => `- ${k}`).join('\n')}

Group these into topic clusters. Return the JSON only.`;

  const raw = await claudeService.callClaude({
    model: MODEL,
    max_tokens: 4000,
    system: CLUSTER_SYSTEM,
    user: userPrompt,
  });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error('Claude returned malformed cluster JSON: ' + cleaned.slice(0, 200)); }
  const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
  return {
    clusters: clusters.map(c => ({
      label: String(c.label || '').trim() || 'Untitled cluster',
      core_question: String(c.core_question || '').trim(),
      primary: String(c.primary || '').trim(),
      secondary: Array.isArray(c.secondary) ? c.secondary.map(s => String(s).trim()).filter(Boolean) : [],
      intent: ['informational','navigational','commercial','transactional'].includes(c.intent) ? c.intent : 'informational',
      rationale: String(c.rationale || '').trim(),
    })).filter(c => c.primary),
    unclustered: Array.isArray(parsed.unclustered) ? parsed.unclustered.map(k => String(k).trim()).filter(Boolean) : [],
  };
}

const BRIEF_SYSTEM = `You are an SEO content strategist at October Communications who briefs for BOTH classic search ranking and AI-answer citation (GEO). British English. Tight, commercial, no filler. Output JSON only — no prose, no markdown fences.` +
  playbooks.systemSuffix(['eeat', 'content-strategy']);

// Fetch a page and extract its top-level H2 / H3 headings + meta title.
// Used by the SERP-grounded outline path so Claude can see what's
// actually winning page 1 for the target keyword.
async function fetchPageHeadings(url) {
  try {
    const { data, status } = await axios.get(url, {
      timeout: 8000, maxRedirects: 5, validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com/brief)',
        'Accept': 'text/html',
      },
    });
    if (status >= 400 || typeof data !== 'string') return null;
    const $ = cheerio.load(data);
    $('script, style, noscript, nav, header, footer, aside').remove();
    const root = $('main').first().length ? $('main').first()
              : $('article').first().length ? $('article').first()
              : $('body');
    const title = ($('head > title').first().text() || '').trim();
    const h2 = root.find('h2').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 12);
    const h3 = root.find('h3').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 12);
    return { url, title, h2, h3 };
  } catch { return null; }
}

// Build a "what's ranking right now" summary for Claude to ground its
// outline against. Up to 10 SERP results, fetched in parallel, capped
// at 3s each. Soft-fails — if SERP / fetches fail we just don't
// ground the outline and the brief still generates.
async function fetchSerpHeadings(keyword) {
  let serp;
  try {
    serp = await dataForSEO.fetchTopSerpResults(keyword, { limit: 10 });
  } catch { return null; }
  if (!serp?.length) return null;
  const results = await Promise.all(serp.map(s => fetchPageHeadings(s.url)));
  return results.filter(Boolean);
}

async function briefForCluster({ clientId, cluster }) {
  if (!cluster?.primary) throw new Error('cluster.primary required');
  const client = await loadClient(clientId);

  // SERP grounding — fetch the top 10 organic results for the primary
  // keyword and pull their H2 / H3 headings, so Claude builds the
  // outline against what's *actually* ranking right now rather than
  // its training-time guess. Soft-fails: if DFS or any fetch errors,
  // we still generate the brief without the grounding context.
  const serpHeadings = await fetchSerpHeadings(cluster.primary);
  let serpContext = '';
  if (serpHeadings?.length) {
    serpContext = '\n\nWhat\'s currently ranking on page 1 for this keyword (use as inspiration — DO NOT copy headings verbatim, find a unique angle):\n' +
      serpHeadings.map((p, i) =>
        `${i + 1}. ${p.title || p.url}\n   H2s: ${(p.h2 || []).join(' | ') || '(none extracted)'}\n   H3s: ${(p.h3 || []).join(' | ') || '(none extracted)'}`
      ).join('\n');
  }

  // Brand voice profile (when set up) — injected as a tight rubric so
  // the generated outline + headings inherit the client's voice rather
  // than generic SEO-speak.
  const voiceProfile = await brandVoice.loadActiveProfile(clientId);
  const voiceContext = brandVoice.renderForPrompt(voiceProfile);

  const coreQuestion = cluster.core_question || `What should someone know about ${cluster.primary}?`;
  const userPrompt = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing)'}
Domain: ${client.domain || '(no domain)'}${voiceContext}

Target cluster: "${cluster.label}"
Core question this piece answers: "${coreQuestion}"
Primary keyword: "${cluster.primary}"
Secondary keywords (the series the piece must hit): ${(cluster.secondary || []).join(', ') || '(none — primary only)'}
Cluster rationale: ${cluster.rationale || '(none)'}${serpContext}

Brief ONE piece of content that answers the core question thoroughly, with the primary keyword as the H1/focus and the secondary keywords woven in as sub-topics and sub-headings. Brief it for BOTH classic ranking AND AI-answer citation (GEO): the page must open by answering the core question directly, use question-shaped headings, cite statistics to sources, and carry the E-E-A-T trust signals (named author, first-hand experience, dates).${serpHeadings?.length ? ' Where the SERP context shows a common sub-topic (e.g. several results cover \'pricing\'), include it so the piece can compete; pick at least one angle the ranking results DON\'T cover, to differentiate.' : ''}

Return a JSON object with the keys:
- title: working title (≤ 70 chars, includes primary keyword)
- target_intent: ${cluster.intent || 'Informational'}
- core_question: the single question the piece answers (echo/refine the one above)
- answer_block: a ready-to-lift 40–60 word direct answer to the core question, written to be quoted verbatim by an AI answer engine (this goes near the top of the piece)
- summary: 1-2 sentence pitch
- outline: 5-8 section objects { heading, points: [3-5 bullet strings] } — headings should be question-shaped where natural, and the sections must cover the secondary keywords
- faqs: array of 4-6 { question, answer } — natural buyer questions with concise (~40-60 word) answers, for an on-page FAQ section (and FAQPage schema)
- key_stats: array of 2-5 { stat, source } the writer must include — real, specific, attributed to a named source (never invent numbers; if unsure, describe the stat to find and leave source as the type of source to cite)
- comparison_table: ${['commercial','transactional'].includes(cluster.intent) ? '{ columns: [..], rows: [{...}] } — a comparison the buyer needs to decide (options vs criteria). Include it; this intent warrants one.' : 'null unless the topic genuinely calls for an at-a-glance comparison, in which case { columns, rows }'}
- eeat: { author_persona: "who should be bylined (role/expertise)", first_hand_angle: "the lived/tested detail that proves experience", credibility_signals: ["what to cite or link for trust"] }
- questions_to_answer: array of 4-6 specific questions
- suggested_word_count: integer
- internal_link_targets: array of 3-5 page URL slug suggestions
- meta_title: < 60 chars, includes primary keyword, click-worthy
- meta_description: < 155 chars, benefit-led, includes primary keyword
- slug: url slug, lowercase-hyphenated, ≤ 6 words, no stop-word padding
- secondary_keyword_coverage: object mapping each secondary keyword to which section heading covers it
${serpHeadings?.length ? '- serp_grounding: { sources_used: integer (the count of SERP results that fed this outline), differentiating_angle: "one sentence on what makes this piece stand out vs the current page 1" }' : ''}

Return ONLY the JSON object.`;

  const raw = await claudeService.callClaude({
    model: MODEL,
    max_tokens: 3000,
    system: BRIEF_SYSTEM,
    user: userPrompt,
  });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Claude returned malformed brief JSON: ' + cleaned.slice(0, 200)); }
}

module.exports = { clusterKeywords, briefForCluster };
