// Brand-aware long-form content drafter. Pipeline → Draft step 3.
//
// Takes a content brief from PlanningTab (or supplied inline) plus the
// client's brand assets + briefing_field, and asks Claude to write a
// full blog post in the client's voice. Output is markdown (source of
// truth, editable) plus rendered HTML (for HTML-native publishing).
//
// Anti-AI-tells: the prompt explicitly forbids the standard Claude
// signatures — em-dashes used as breath marks, "delve into", "navigate
// the landscape", "leverage", "robust", "moreover", "in conclusion",
// "it's worth noting", etc. Post-filter normalises invisible Unicode
// and fancy punctuation so the output reads as a human wrote it.

const crypto = require('crypto');
const pool = require('../db');
const claudeService = require('./claude');
const brandVoice = require('./brandVoice');
const playbooks = require('./playbooks');

const DRAFT_MODEL = 'claude-sonnet-4-6';

// Banned phrases / mannerisms the prompt explicitly tells Claude to
// avoid. Caught in the post-filter as a backstop if any slip through.
const AI_TELLS = [
  /\bdelve into\b/gi,
  /\bnavigate the landscape\b/gi,
  /\bin today's (?:fast-paced|digital|modern) world\b/gi,
  /\bit's worth noting that\b/gi,
  /\bit's important to note that\b/gi,
  /\bin conclusion\b/gi,
  /\bmoreover\b/gi,
  /\bfurthermore\b/gi,
  /\badditionally\b/gi,
  /\bcomprehensive\b/gi,
  /\brobust\b/gi,
  /\bleverage\b/gi,
  /\bunlock the power of\b/gi,
  /\bin the realm of\b/gi,
];

// Strip invisible / weird-spacing unicode that AI detectors flag, then
// normalise fancy quotes to ASCII so the post copy-pastes cleanly.
function sanitizeUnicode(s) {
  return (s || '')
    .replace(/​|‌|‍|﻿/g, '')      // zero-width spaces
    .replace(/ | /g, ' ')                    // narrow / non-breaking space → regular space
    .replace(/[‘’]/g, "'")                    // smart single → straight
    .replace(/[“”]/g, '"')                    // smart double → straight
    .replace(/…/g, '...')                          // ellipsis → three dots
    .replace(/ +— +/g, ' — ')                           // normalise em-dash spacing
    .replace(/[ \t]+$/gm, '');                          // trailing whitespace on every line
}

// Markdown → HTML using the existing markdown-it via reactMarkdown
// isn't accessible server-side; instead use a tiny markdown rendering
// that covers what blog posts need: headings, paragraphs, lists, bold,
// italic, links, and code. Good enough for WordPress / Shopify.
function renderMarkdownToHtml(md) {
  let html = (md || '').trim();
  // Headings h1–h3
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^## (.+)$/gm, '<h2>$1</h2>')
             .replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold / italic / inline code
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
             .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
             .replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Lists — group consecutive `- ` lines into <ul>
  html = html.replace(/(^|\n)((?:- [^\n]+\n?)+)/g, (m, lead, block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^- /, '').trim());
    return `${lead}<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  });
  // Paragraphs — wrap remaining bare-text blocks
  html = html.split(/\n{2,}/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (/^<(h\d|ul|ol|pre|blockquote)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

async function loadBrandContext(clientId) {
  const { rows } = await pool.query(
    `SELECT id, kind, name, metadata FROM brand_assets WHERE client_id = $1`,
    [clientId]
  );
  if (!rows.length) return '(no brand assets uploaded — write in a clear, neutral commercial voice)';
  // Group by kind so the prompt reads cleanly.
  const byKind = {};
  for (const a of rows) {
    if (!byKind[a.kind]) byKind[a.kind] = [];
    const meta = a.metadata && Object.keys(a.metadata).length ? ` — ${JSON.stringify(a.metadata)}` : '';
    byKind[a.kind].push(`${a.name}${meta}`);
  }
  return Object.entries(byKind).map(([kind, items]) => `[${kind}]\n${items.map(i => '- ' + i).join('\n')}`).join('\n\n');
}

function brandVoiceHash(briefingField, brandSummary) {
  return crypto.createHash('sha256')
    .update(`${briefingField || ''}|${brandSummary || ''}`)
    .digest('hex')
    .slice(0, 32);
}

const SYSTEM = `You are a senior content writer at October Communications writing long-form blog posts that sound like a thoughtful expert at the client's own company wrote them. You are NOT writing for an AI to read; you're writing for the client's customers.

NEVER use these AI tells: "delve into", "navigate the landscape", "in today's fast-paced world", "it's worth noting", "moreover", "furthermore", "additionally", "comprehensive", "robust", "leverage", "unlock the power of", "in the realm of", "in conclusion". No em-dashes as breath marks (use them only for genuine parenthetical asides). No bullet-and-bold mannerism. No hedging chains.

Write British English. Concrete examples, specific numbers, opinions where warranted. One unique POV per piece. Vary sentence length. If you don't have specific information, write a tight paragraph and move on rather than padding with generic statements.

Format: pure markdown. # for title (you'll add one), ## for sections, ### for sub-sections. No frontmatter, no preamble like "Here's your draft", no closing summary.`;

async function generateDraft({ clientId, brief, targetKeyword }) {
  if (!brief) throw new Error('brief required');

  const { rows: clientRows } = await pool.query(
    'SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!clientRows.length) throw new Error('Client not found');
  const client = clientRows[0];

  const brandSummary = await loadBrandContext(clientId);
  // Brand voice profile — extracted from real existing brand pages.
  // Injected as a structured rubric so the draft inherits the client's
  // voice rather than reading like generic AI prose.
  const voiceProfile = await brandVoice.loadActiveProfile(clientId);
  const voiceContext = brandVoice.renderForPrompt(voiceProfile);

  const userPrompt = `Client: ${client.name}
Domain: ${client.domain || '(not set)'}${voiceContext}
Brand briefing / tone-of-voice:
${client.briefing_field || '(no briefing supplied — infer voice from brand assets)'}

Brand assets:
${brandSummary}

Content brief (from the strategist):
${typeof brief === 'string' ? brief : JSON.stringify(brief, null, 2)}

${targetKeyword ? `Primary target keyword: ${targetKeyword}` : ''}

Write the full blog post now in markdown. Hit the word count from the brief. Lead with the strongest hook the brief allows. Include the target keyword naturally in the H1, first paragraph, and at least one H2. Vary sentence length. Drop in at least one specific example, one number / statistic, and one opinionated take. Internal links can be placeholders like [the X page](/x) — the AM will swap them.`;

  const md = await claudeService.callClaude({
    model: DRAFT_MODEL,
    max_tokens: 8000,
    system: SYSTEM + playbooks.systemSuffix(['copywriting', 'content-strategy']),
    user: userPrompt,
  });
  let cleaned = sanitizeUnicode(md);
  // Soft strip of any AI tells that slipped past the prompt — leave the
  // surrounding sentence intact, just remove the offending phrase so the
  // AM doesn't have to spot them.
  for (const re of AI_TELLS) cleaned = cleaned.replace(re, '');
  cleaned = cleaned.replace(/  +/g, ' ').trim();

  // Pull the H1 as title and infer meta description from first paragraph.
  const titleMatch = cleaned.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `Draft for ${targetKeyword || client.name}`;
  const firstPara = cleaned.split(/\n{2,}/).find(p => p.trim() && !p.startsWith('#'));
  const metaDescription = firstPara ? firstPara.replace(/[#*`_]/g, '').trim().slice(0, 155) : null;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  const html = renderMarkdownToHtml(cleaned);

  const { rows: draftRow } = await pool.query(
    `INSERT INTO content_drafts
     (client_id, target_keyword, brief_json, title, meta_description, body_markdown, body_html, word_count, brand_voice_hash, claude_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      clientId, targetKeyword || null,
      typeof brief === 'string' ? { text: brief } : brief,
      title, metaDescription, cleaned, html, wordCount,
      brandVoiceHash(client.briefing_field, brandSummary), DRAFT_MODEL,
    ]
  );
  return draftRow[0];
}

module.exports = { generateDraft, sanitizeUnicode, renderMarkdownToHtml };
