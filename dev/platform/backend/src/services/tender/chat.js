// Tender Agent — "Start / Continue with Claude": the per-tender bid workspace
// chat. It reasons over the notice, the uploaded files (RFP pack, past bids,
// capability decks), and the shared October bid profile — so it can judge fit,
// plan the bid, and draft the actual deliverables. Messages persist in
// tender_chat_messages; the profile + cross-bid context make it sharper each
// time.

const pool = require('../../db');
const Anthropic = require('@anthropic-ai/sdk');
const claude = require('../claude');
const costLog = require('../costLog');
const profile = require('./profile');
const bidFiles = require('./bidFiles');

const MODEL = 'claude-sonnet-4-6';

// A short digest of the other tenders in the pipeline, so the agent has
// cross-bid context ("we're also chasing X for buyer Y") without loading every
// chat. Excludes the current notice and dismissed ones.
async function crossBidContext(noticeId) {
  const { rows } = await pool.query(
    `SELECT n.title, n.buyer_name, n.buyer_country, n.closing_at,
            EXISTS (SELECT 1 FROM tender_chat_messages c WHERE c.notice_id = n.id) AS worked
     FROM tender_notices n
     WHERE n.id <> $1 AND n.dismissed = false AND (n.closing_at IS NULL OR n.closing_at >= NOW())
     ORDER BY worked DESC, n.first_seen_at DESC
     LIMIT 20`,
    [noticeId]
  );
  if (!rows.length) return '';
  const line = r => `- ${r.title || '—'} — ${r.buyer_name || 'buyer unknown'}${r.buyer_country ? ` (${r.buyer_country})` : ''}${r.worked ? ' [in progress]' : ''}`;
  return rows.map(line).join('\n');
}

function buildSystem(notice, { profileMd, company, others, skippedFiles }) {
  const val = notice.value_min ? `${notice.currency || ''} ${Number(notice.value_min).toLocaleString('en-GB')}`.trim() : 'not stated';
  const closes = notice.closing_at ? new Date(notice.closing_at).toLocaleDateString('en-GB') : 'unknown';
  return `You are a bid strategist and writer at October Communications, a UK PR & communications agency specialising in arts, culture, design, architecture, heritage and destination marketing. You help the account lead run a public-sector tender end to end: judge fit, plan the bid, and PRODUCE the deliverables (capability statement, draft responses to the buyer's questions, cover letter, case-study selection).

This tender:
- Title: ${notice.title || '—'}
- Buyer: ${notice.buyer_name || '—'}${notice.buyer_country ? ` (${notice.buyer_country})` : ''}
- Value: ${val}
- Closes: ${closes}
- Link: ${notice.url || '—'}
- Detail: ${notice.description || '(thin — say so plainly if there is too little to judge, and use any uploaded documents)'}

## October — company details (the SQ facts a tender needs; use these VERBATIM, never invent one)
${profile.companyBlock(company)}

## October's bid profile (shared across every bid — use it, and suggest additions when you learn something reusable)
${profileMd ? profileMd.slice(0, 8000) : '(empty — ask the lead for October\'s services, sectors and reference projects, and offer to draft a profile)'}

## Other tenders in October's pipeline (for cross-bid awareness)
${others || '(none)'}

How you work:
- Judge fit against October's niche (genuinely arts/culture/design/heritage/destination PR, not adjacent build/research/consultation work) and run the go/no-go test (three comparable references, deadline realistic, value vs effort).
- Read the uploaded documents (RFP pack, past bids, capability decks) and ground your drafts in them. ${skippedFiles && skippedFiles.length ? `Note: these attachments couldn't be read (unsupported type) — ask the lead to paste their key text: ${skippedFiles.join(', ')}.` : ''}
- When asked to produce a deliverable, write the full thing in clean markdown (headings, short paragraphs, no em dashes) so it can be exported to Word/PDF as-is. Don't summarise when asked to draft — produce the actual document.
- Never invent facts about October, its past work, or the buyer. If a detail is missing, say exactly what to confirm.

British English. Commercially direct. No hype.`;
}

async function history(noticeId) {
  const { rows } = await pool.query(
    'SELECT id, role, content, created_at FROM tender_chat_messages WHERE notice_id = $1 ORDER BY created_at ASC LIMIT 120',
    [noticeId]
  );
  return rows;
}

async function send(noticeId, message) {
  const text = (message || '').trim();
  if (!text) { const e = new Error('message required'); e.status = 400; throw e; }
  const { rows: nrows } = await pool.query('SELECT * FROM tender_notices WHERE id = $1', [noticeId]);
  if (!nrows.length) { const e = new Error('Notice not found'); e.status = 404; throw e; }
  const notice = nrows[0];

  const prior = await history(noticeId);
  const [{ profile_md, company }, others, files] = await Promise.all([
    profile.get(), crossBidContext(noticeId), bidFiles.contentBlocks(noticeId),
  ]);
  await pool.query('INSERT INTO tender_chat_messages (notice_id, role, content) VALUES ($1, $2, $3)', [noticeId, 'user', text]);

  // Attach the workspace files to this turn so the agent can read them.
  const userContent = files.blocks.length
    ? [...files.blocks, { type: 'text', text }]
    : text;

  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const messages = [...prior.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userContent }];
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: claude.cacheableSystem(buildSystem(notice, { profileMd: profile_md, company, others, skippedFiles: files.skipped })),
    messages,
  });
  try { costLog.recordClaudeCost({ model: MODEL, response: resp, feature: 'tender_chat', clientId: null }); } catch { /* best effort */ }

  const reply = resp.content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n').trim() || 'Sorry, I could not respond just now.';
  const { rows } = await pool.query(
    'INSERT INTO tender_chat_messages (notice_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, created_at',
    [noticeId, 'assistant', reply]
  );
  return rows[0];
}

// "Learn from this bid" — read the conversation and propose durable, reusable
// additions to October's shared bid profile (services, sectors, references,
// boilerplate, win/loss lessons), skipping anything one-off or already known.
// Returns { suggestion } — empty string when there's nothing worth keeping.
async function suggestProfileUpdate(noticeId) {
  const prior = await history(noticeId);
  if (!prior.length) { const e = new Error('Nothing to learn from yet — work the bid first.'); e.status = 400; throw e; }
  const { rows: nrows } = await pool.query('SELECT * FROM tender_notices WHERE id = $1', [noticeId]);
  const notice = nrows[0] || {};
  const { profile_md } = await profile.get();

  const sys = `You maintain October Communications' shared bid profile — the durable, reusable facts that help win FUTURE public-sector PR bids: services, sectors, named reference projects and clients, boilerplate lines, pricing norms, and win/loss lessons. You are given the current profile and one bid conversation.

Propose ONLY new, durable additions genuinely learned from the conversation. Exclude anything specific to this single tender, anything already in the profile, and anything invented or unconfirmed. If there is nothing genuinely reusable to add, reply with exactly "NOTHING TO ADD". Otherwise output a short markdown snippet (a heading and a few bullets) ready to append to the profile. British English, factual, no preamble.`;
  const convo = prior.map(m => `${m.role === 'user' ? 'Lead' : 'Claude'}: ${m.content}`).join('\n\n').slice(0, 24000);
  const user = `## Current profile\n${profile_md || '(empty)'}\n\n## This bid\n${notice.title || '—'} — ${notice.buyer_name || 'buyer unknown'}\n\n## Conversation\n${convo}`;

  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1200,
    system: claude.cacheableSystem(sys),
    messages: [{ role: 'user', content: user }],
  });
  try { costLog.recordClaudeCost({ model: MODEL, response: resp, feature: 'tender_profile_learn', clientId: null }); } catch { /* best effort */ }
  const text = resp.content.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n').trim();
  return { suggestion: /^\s*NOTHING TO ADD\s*$/i.test(text) ? '' : text };
}

module.exports = { send, history, buildSystem, crossBidContext, suggestProfileUpdate };
