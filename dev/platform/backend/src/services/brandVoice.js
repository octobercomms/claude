// Brand voice extraction — Setup → Brand → Voice profile.
//
// AM supplies 3–10 URLs of pages that read like the brand at its
// best. Service fetches each, extracts main-content text, asks Claude
// to surface a structured voice profile (tone, sentence structure,
// vocabulary, reading level, do/don't examples). The profile is
// injected into every future brief + draft so generated copy actually
// sounds like the brand instead of generic Claude.
//
// One active profile per client; re-running supersedes the previous
// (kept in history). Two helper exports — loadActiveProfile() and
// renderForPrompt() — let the brief/draft services read + inject the
// profile without re-implementing the prompt formatting.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');
const claudeService = require('./claude');

const MODEL = 'claude-sonnet-4-6';
const USER_AGENT = 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0; +https://platform.octobercomms.com/voice)';

const SYSTEM = `You are a senior content editor analysing how a brand writes. You're producing a voice profile that a junior writer will use to imitate the brand's style in new pieces. Your output must capture the SPECIFIC mannerisms of THIS brand — not generic 'write clearly' advice.

British English. Specific over abstract. Quote-able examples over rules.

NEVER use AI tells in your own analysis: "delve into", "leverage", "robust", "moreover", "in conclusion", "comprehensive", "in today's fast-paced world", "it's worth noting".

Return ONE JSON object — no prose outside it. Schema:

{
  "voice_summary": "2-3 sentence narrative of what makes this brand's voice distinctive",
  "tone_descriptors": ["3-6 adjectives, terse, brand-specific"],
  "reading_level": "Grade 6" | "Grade 8" | "Grade 10" | "Grade 12" | "Postgraduate",
  "avg_sentence_length_words": integer,
  "avg_paragraph_length_sentences": integer,
  "vocabulary_patterns": ["5-8 specific observations about word choice — e.g. 'uses British spellings', 'prefers active verbs over passive', 'avoids superlatives'"],
  "signature_phrases": ["3-8 phrases or constructions the brand reaches for repeatedly"],
  "avoid_phrases": ["3-8 phrases / words / constructions the brand never uses or actively avoids"],
  "do_examples": ["3-5 short example sentences that sound exactly like this brand"],
  "dont_examples": ["3-5 short example sentences that would feel off-brand"]
}`;

async function fetchPageText(url) {
  try {
    const { data, status, headers } = await axios.get(url, {
      timeout: 12000, maxRedirects: 5, validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
    });
    if (status >= 400 || typeof data !== 'string' || !/html/i.test(headers['content-type'] || '')) return null;
    const $ = cheerio.load(data);
    $('script, style, noscript, nav, header, footer, aside, [role="navigation"]').remove();
    const root = $('main').first().length ? $('main').first()
              : $('article').first().length ? $('article').first()
              : $('body');
    const text = root.text().replace(/\s+/g, ' ').trim();
    return { url, text };
  } catch { return null; }
}

async function runExtraction({ clientId, urls }) {
  const cleanUrls = (urls || []).map(u => String(u || '').trim()).filter(u => /^https?:\/\//i.test(u));
  if (cleanUrls.length < 1) throw new Error('Need at least 1 URL to extract a voice profile');
  if (cleanUrls.length > 12) throw new Error('Max 12 URLs per extraction');

  const { rows: clientRows } = await pool.query('SELECT name, briefing_field FROM clients WHERE id = $1', [clientId]);
  if (!clientRows.length) throw new Error('Client not found');
  const client = clientRows[0];

  // Create the running profile row up front so the UI can poll. Mark
  // any previous active profile as inactive so the unique-active
  // partial index is satisfied when this run completes.
  await pool.query(`UPDATE brand_voice_profiles SET active = FALSE WHERE client_id = $1 AND active = TRUE`, [clientId]);
  const { rows: profileRows } = await pool.query(
    `INSERT INTO brand_voice_profiles (client_id, active, status, source_urls, claude_model)
     VALUES ($1, TRUE, 'running', $2, $3) RETURNING *`,
    [clientId, JSON.stringify(cleanUrls), MODEL]
  );
  const profile = profileRows[0];

  try {
    const pages = (await Promise.all(cleanUrls.map(fetchPageText))).filter(Boolean);
    if (!pages.length) throw new Error('Could not fetch text from any of the supplied URLs');

    // Cap each page at ~3k chars (~550 words) — voice is in the prose,
    // not the length. 8 pages × 3k = 24k chars stays well inside
    // Claude's context with room for the instruction.
    const samples = pages.map(p => `--- ${p.url} ---\n${p.text.slice(0, 3000)}`).join('\n\n');

    const userPrompt = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing supplied — infer from the pages themselves)'}

You have ${pages.length} sample page${pages.length === 1 ? '' : 's'} of THIS brand's existing content. Analyse them as a set and produce the structured voice profile.

${samples}

Return the JSON only.`;

    const raw = await claudeService.callClaude({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      user: userPrompt,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let findings;
    try { findings = JSON.parse(cleaned); }
    catch { throw new Error('Claude returned malformed voice JSON: ' + cleaned.slice(0, 240)); }

    const { rows: updated } = await pool.query(
      `UPDATE brand_voice_profiles SET
         status = 'complete',
         voice_summary = $1,
         tone_descriptors = $2,
         reading_level = $3,
         avg_sentence_length_words = $4,
         avg_paragraph_length_sentences = $5,
         vocabulary_patterns = $6,
         signature_phrases = $7,
         avoid_phrases = $8,
         do_examples = $9,
         dont_examples = $10,
         completed_at = NOW()
       WHERE id = $11 RETURNING *`,
      [
        findings.voice_summary || null,
        JSON.stringify(Array.isArray(findings.tone_descriptors) ? findings.tone_descriptors : []),
        findings.reading_level || null,
        Number.isFinite(findings.avg_sentence_length_words) ? Math.round(findings.avg_sentence_length_words) : null,
        Number.isFinite(findings.avg_paragraph_length_sentences) ? Math.round(findings.avg_paragraph_length_sentences) : null,
        JSON.stringify(Array.isArray(findings.vocabulary_patterns) ? findings.vocabulary_patterns : []),
        JSON.stringify(Array.isArray(findings.signature_phrases) ? findings.signature_phrases : []),
        JSON.stringify(Array.isArray(findings.avoid_phrases) ? findings.avoid_phrases : []),
        JSON.stringify(Array.isArray(findings.do_examples) ? findings.do_examples : []),
        JSON.stringify(Array.isArray(findings.dont_examples) ? findings.dont_examples : []),
        profile.id,
      ]
    );
    return updated[0];
  } catch (err) {
    await pool.query(
      `UPDATE brand_voice_profiles SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [err.message, profile.id]
    );
    throw err;
  }
}

async function loadActiveProfile(clientId) {
  const { rows } = await pool.query(
    `SELECT * FROM brand_voice_profiles WHERE client_id = $1 AND active = TRUE AND status = 'complete' LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

// Build a tight prompt fragment that the brief / draft generators can
// inject. Empty string when no profile is set — the calling prompts
// already tell Claude what to do without it.
function renderForPrompt(profile) {
  if (!profile) return '';
  const parts = [];
  if (profile.voice_summary) parts.push(`Voice summary: ${profile.voice_summary}`);
  if (Array.isArray(profile.tone_descriptors) && profile.tone_descriptors.length) {
    parts.push(`Tone: ${profile.tone_descriptors.join(', ')}.`);
  }
  if (profile.reading_level || profile.avg_sentence_length_words || profile.avg_paragraph_length_sentences) {
    const bits = [];
    if (profile.reading_level) bits.push(`reading level ${profile.reading_level}`);
    if (profile.avg_sentence_length_words) bits.push(`~${profile.avg_sentence_length_words}-word sentences`);
    if (profile.avg_paragraph_length_sentences) bits.push(`~${profile.avg_paragraph_length_sentences}-sentence paragraphs`);
    parts.push(`Structure: ${bits.join(', ')}.`);
  }
  if (Array.isArray(profile.vocabulary_patterns) && profile.vocabulary_patterns.length) {
    parts.push(`Vocabulary: ${profile.vocabulary_patterns.map(v => '• ' + v).join('\n')}`);
  }
  if (Array.isArray(profile.signature_phrases) && profile.signature_phrases.length) {
    parts.push(`Signature phrases to lean on: ${profile.signature_phrases.map(s => `"${s}"`).join(', ')}.`);
  }
  if (Array.isArray(profile.avoid_phrases) && profile.avoid_phrases.length) {
    parts.push(`NEVER use: ${profile.avoid_phrases.map(s => `"${s}"`).join(', ')}.`);
  }
  if (Array.isArray(profile.do_examples) && profile.do_examples.length) {
    parts.push(`Sentences that sound like this brand:\n${profile.do_examples.map(s => '✓ ' + s).join('\n')}`);
  }
  if (Array.isArray(profile.dont_examples) && profile.dont_examples.length) {
    parts.push(`Sentences that would feel off-brand:\n${profile.dont_examples.map(s => '✗ ' + s).join('\n')}`);
  }
  if (!parts.length) return '';
  return '\n\nBrand voice profile — match this:\n' + parts.join('\n');
}

module.exports = { runExtraction, loadActiveProfile, renderForPrompt };
