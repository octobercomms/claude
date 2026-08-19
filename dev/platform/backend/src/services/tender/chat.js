// Tender Agent — "Start with Claude": a per-notice chat that helps the account
// lead judge fit and outline a bid. Lightweight (no tools) — it reasons over the
// notice's own details. Messages persist in tender_chat_messages.

const pool = require('../../db');
const Anthropic = require('@anthropic-ai/sdk');
const claude = require('../claude');
const costLog = require('../costLog');

const MODEL = 'claude-sonnet-4-6';

function buildSystem(notice) {
  const val = notice.value_min ? `${notice.currency || ''} ${Number(notice.value_min).toLocaleString('en-GB')}`.trim() : 'not stated';
  const closes = notice.closing_at ? new Date(notice.closing_at).toLocaleDateString('en-GB') : 'unknown';
  return `You are a bid strategist at October Communications, a UK PR & communications agency specialising in arts, culture, design, heritage and destination marketing. The account lead is deciding whether to pursue a public-sector tender and, if so, how to approach the bid.

The tender:
- Title: ${notice.title || '—'}
- Buyer: ${notice.buyer_name || '—'}${notice.buyer_country ? ` (${notice.buyer_country})` : ''}
- Value: ${val}
- Closes: ${closes}
- Link: ${notice.url || '—'}
- Detail: ${notice.description || '(only the title is available — say so plainly if the detail is too thin to judge)'}

Help the lead: judge fit against October's niche (is it genuinely arts/culture/design/heritage/destination PR, not adjacent build/research/consultation work?); run the go/no-go test (three comparable references, deadline realistic, value vs effort); and when asked, outline a bid approach — structure, angle, and the evidence to gather. Be commercially direct, British English, no hype, no em dashes. Never invent facts about October or the buyer — if you don't have a detail, say what to check.`;
}

async function history(noticeId) {
  const { rows } = await pool.query(
    'SELECT id, role, content, created_at FROM tender_chat_messages WHERE notice_id = $1 ORDER BY created_at ASC LIMIT 80',
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
  await pool.query('INSERT INTO tender_chat_messages (notice_id, role, content) VALUES ($1, $2, $3)', [noticeId, 'user', text]);

  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  const messages = [...prior.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text }];
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: claude.cacheableSystem(buildSystem(notice)),
    messages,
  });
  try { costLog.recordClaudeCost({ model: MODEL, response: resp, feature: 'tender_chat', clientId: null }); } catch { /* best effort */ }

  const reply = resp.content.find(b => b.type === 'text')?.text || 'Sorry, I could not respond just now.';
  const { rows } = await pool.query(
    'INSERT INTO tender_chat_messages (notice_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, created_at',
    [noticeId, 'assistant', reply]
  );
  return rows[0];
}

module.exports = { send, history, buildSystem };
