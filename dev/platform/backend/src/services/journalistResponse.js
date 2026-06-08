// Journalist response drafter — Promote → Digital PR tactic.
//
// AM pastes a journalist query (from Featured.com, Qwoted, Source of
// Sources or anywhere else), Claude drafts a response in the client's
// voice grounded in their brand briefing + assets. AM edits, sends from
// their own inbox, then records the outcome.
//
// Same anti-AI-tells filtering as contentDraft so the response sounds
// like a real spokesperson rather than a chatbot.

const pool = require('../db');
const claudeService = require('./claude');
const { sanitizeUnicode } = require('./contentDraft');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are drafting a journalist-pitch response on behalf of a real expert at the client's company. The journalist will likely receive 50+ responses to the same query — yours has to be tight, specific, quotable, and grounded in genuine expertise the client actually has.

NEVER use these AI tells: "delve into", "navigate the landscape", "in today's fast-paced world", "it's worth noting", "moreover", "furthermore", "comprehensive", "robust", "leverage", "unlock the power of", "in the realm of". No em-dashes as breath marks. No bullet-and-bold mannerism. No hedging chains.

Structure for a good response:
1. One-sentence direct answer to the journalist's question (lead with the answer, not preamble).
2. 2-3 sentences of specific detail, ideally with a number, year, name, or example the journalist can quote verbatim.
3. One sentence of credentialing — who you are, why your perspective matters.
4. Sign-off with the expert's name + title + company + a contactable link.

Plain prose. No markdown headings, no bullet points. British English unless the journalist is clearly US-based. Keep it under 200 words — journalists hate walls of text.`;

async function loadBrandContext(clientId) {
  const { rows: clientRows } = await pool.query(
    'SELECT name, briefing_field, domain FROM clients WHERE id = $1', [clientId]
  );
  if (!clientRows.length) throw new Error('Client not found');
  const client = clientRows[0];
  const { rows: assets } = await pool.query(
    `SELECT kind, name, metadata FROM brand_assets WHERE client_id = $1 LIMIT 30`,
    [clientId]
  );
  return { client, assets };
}

async function generateResponse({ clientId, source = 'manual', queryText, journalistName, outlet, deadline, context }) {
  const text = String(queryText || '').trim();
  if (!text) throw new Error('queryText required');

  const { client, assets } = await loadBrandContext(clientId);
  const assetSummary = assets.length
    ? assets.map(a => {
        const meta = a.metadata && Object.keys(a.metadata).length ? ` — ${JSON.stringify(a.metadata)}` : '';
        return `[${a.kind}] ${a.name}${meta}`;
      }).join('\n')
    : '(no brand assets uploaded)';

  const userPrompt = `Client: ${client.name}
Domain: ${client.domain || '(not set)'}
Brand briefing / what the client is expert at:
${client.briefing_field || '(no briefing supplied — infer from brand assets)'}

Brand assets / proof points:
${assetSummary}

${context ? `Additional context the AM has supplied for this response:\n${context}\n` : ''}
Source: ${source}${journalistName ? ` — ${journalistName}` : ''}${outlet ? ` (${outlet})` : ''}
${deadline ? `Deadline: ${new Date(deadline).toISOString()}` : ''}

Journalist's query:
"""
${text}
"""

Write the response now. Lead with the direct answer. Pick a SPECIFIC angle the client can credibly own — don't try to cover everything. If the client clearly doesn't have expertise on this topic, write a tight one-sentence response saying so rather than padding.`;

  const draft = await claudeService.callClaude({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM,
    user: userPrompt,
  });
  const cleaned = sanitizeUnicode(draft).trim();

  const { rows } = await pool.query(
    `INSERT INTO journalist_responses
     (client_id, source, query_text, journalist_name, outlet, deadline, response_md, claude_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [clientId, source, text, journalistName || null, outlet || null, deadline || null, cleaned, MODEL]
  );
  return rows[0];
}

module.exports = { generateResponse };
