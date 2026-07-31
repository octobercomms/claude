// One source of truth for the GEO-complete content brief. Every brief generator
// (cluster, single-keyword, programmatic) uses this so they can't drift apart —
// and so the field names always match what contentDraft.buildGeoDirectives()
// looks for when it turns a brief into writing instructions.
//
// The model: one piece = one question answered by a series of keywords, briefed
// for BOTH classic ranking AND AI-answer citation (GEO) — answer block, FAQs,
// attributed stats, comparison table, E-E-A-T signals, and real meta + slug.

const playbooks = require('./playbooks');

// System prompt shared by every brief generator. Injects the E-E-A-T + CITE
// methodology so the GEO standard is baked in, not bolted on downstream.
const BRIEF_SYSTEM =
  `You are an SEO content strategist at October Communications who briefs for BOTH classic search ranking and AI-answer citation (GEO). British English. Tight, commercial, no filler. Output JSON only — no prose, no markdown fences.` +
  playbooks.systemSuffix(['eeat', 'content-strategy']);

// The GEO-complete list of JSON keys to request. `intent` tunes the
// comparison_table guidance; `extra` appends caller-specific keys (e.g. the
// cluster brief's secondary_keyword_coverage / serp_grounding).
function briefKeySpec({ intent = 'Informational', extra = [] } = {}) {
  const commercial = ['commercial', 'transactional'].includes(String(intent).toLowerCase());
  return [
    `- title: working title (≤ 70 chars, includes the primary keyword)`,
    `- target_intent: ${intent}`,
    `- core_question: the single question this one piece answers, phrased naturally ("what is …", "how do I …", "which … is best for …")`,
    `- answer_block: a ready-to-lift 40–60 word direct answer to the core question, written to be quoted verbatim by an AI answer engine (this goes near the top of the piece)`,
    `- summary: 1-2 sentence pitch`,
    `- outline: 5-8 section objects { heading, points: [3-5 bullet strings] } — headings question-shaped where natural, covering the keyword series`,
    `- faqs: array of 4-6 { question, answer } — natural buyer questions with concise (~40-60 word) answers, for an on-page FAQ section (and FAQPage schema)`,
    `- key_stats: array of 2-5 { stat, source } the writer must include — real, specific, attributed to a named source; never invent numbers (if unsure, describe the stat to find and name the type of source to cite)`,
    `- comparison_table: ${commercial ? '{ columns: [..], rows: [{...}] } — include it; this intent warrants a buyer comparison (options vs criteria)' : 'null unless the topic genuinely needs an at-a-glance comparison, in which case { columns, rows }'}`,
    `- eeat: { author_persona: "who should be bylined (role/expertise)", first_hand_angle: "the lived/tested detail that proves experience", credibility_signals: ["what to cite or link for trust"] }`,
    `- questions_to_answer: array of 4-6 specific questions`,
    `- suggested_word_count: integer`,
    `- internal_link_targets: array of 3-5 page URL slug suggestions`,
    `- meta_title: < 60 chars, includes the primary keyword, click-worthy`,
    `- meta_description: < 155 chars, benefit-led, includes the primary keyword`,
    `- slug: url slug, lowercase-hyphenated, ≤ 6 words, no stop-word padding`,
    ...extra,
  ].join('\n');
}

module.exports = { BRIEF_SYSTEM, briefKeySpec };
