// Instagram DM autoresponder — phase 1 (the ManyChat + Claude play).
//
// This is the "brain + drafts" half, owned inside OMI: configure a per-client
// bot persona (brand voice, FAQs, behaviour) once, then (a) generate a library
// of on-brand reply templates for the common triggers, and (b) draft a live
// reply to any pasted incoming DM/comment so the AM can see exactly how the bot
// would respond. The live Meta-messaging webhook (auto-sending) is a separate,
// infra-heavy phase — this gives the value (the replies) without it.

const pool = require('../db');
const claudeService = require('./claude');

const TRIGGERS = ['comment_to_dm', 'keyword_dm', 'story_reply', 'faq', 'other'];

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('DM bot returned malformed JSON.'); }
}

async function loadClient(clientId) {
  const { rows } = await pool.query('SELECT name, briefing_field, monthly_focus FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  return rows[0];
}

// ── persona ──────────────────────────────────────────────────────────────────
async function getPersona(clientId) {
  const { rows } = await pool.query('SELECT persona, updated_at FROM social_dm_bot WHERE client_id = $1', [clientId]);
  return rows[0] || { persona: {}, updated_at: null };
}

async function savePersona(clientId, persona) {
  const clean = {
    system_prompt: String(persona?.system_prompt || '').slice(0, 4000),
    faqs: String(persona?.faqs || '').slice(0, 6000),
    tone: ['warm', 'professional', 'playful', 'concise'].includes(persona?.tone) ? persona.tone : 'warm',
    max_words: Math.max(15, Math.min(120, Number(persona?.max_words) || 45)),
    escalation: String(persona?.escalation || '').slice(0, 1000),
  };
  await pool.query(
    `INSERT INTO social_dm_bot (client_id, persona) VALUES ($1, $2)
     ON CONFLICT (client_id) DO UPDATE SET persona = $2, updated_at = NOW()`,
    [clientId, JSON.stringify(clean)]
  );
  return getPersona(clientId);
}

// Build the system prompt the bot replies under — the AM's persona plus
// guard-rails that keep DMs short, on-platform and safe.
function botSystem(client, persona) {
  const p = persona || {};
  return `You are the Instagram DM assistant for ${client.name}. Reply to direct messages and comment-reply DMs in the brand's voice.
${p.system_prompt ? `Brand instructions: ${p.system_prompt}` : ''}
${client.briefing_field ? `About the brand: ${client.briefing_field}` : ''}
${p.faqs ? `Known facts / FAQs you can answer from:\n${p.faqs}` : ''}
Tone: ${p.tone || 'warm'}. Keep replies under ${p.max_words || 45} words, natural and on-platform — no email-style sign-offs, no markdown.
If you are unsure or the request needs a human (pricing you don't know, complaints, anything risky): ${p.escalation || 'say you\'ll have a team member follow up, and ask for the best way to reach them.'}
Never invent facts, prices, or availability that aren't given. British English.`;
}

// ── reply templates ──────────────────────────────────────────────────────────
const GEN_SYSTEM =
  'You write short, on-brand Instagram DM reply templates for an automated responder. Natural, specific, never robotic or generic. JSON only — no prose, no fences.';

async function generateTemplates(clientId, { scenario = '', count = 6 } = {}) {
  const client = await loadClient(clientId);
  const { persona } = await getPersona(clientId);
  const n = Math.max(3, Math.min(10, Number(count) || 6));
  const raw = await claudeService.callClaude({
    max_tokens: 2500,
    system: GEN_SYSTEM,
    user: `${botSystem(client, persona)}

Draft ${n} ready-to-use DM reply templates covering the common ways people reach out to this account${scenario ? `, focused on: ${scenario}` : ''}.
Cover a spread of triggers: comment-to-DM (someone commented a keyword on a post/Reel), keyword DM, story reply, and FAQ-style questions.
Return ONLY:
{"templates":[{"trigger":"comment_to_dm|keyword_dm|story_reply|faq|other","scenario":"the situation this reply handles","reply":"the message text"}]}
Each reply must obey the word limit and tone above, sound human, and move the conversation toward a clear next step (link, booking, or a question back).`,
    feature: 'dm_bot_templates',
    clientId,
  });
  const list = Array.isArray(parseJson(raw)?.templates) ? parseJson(raw).templates : [];
  const saved = [];
  for (const t of list.slice(0, n)) {
    const reply = String(t.reply || '').trim();
    if (!reply) continue;
    const { rows } = await pool.query(
      `INSERT INTO social_dm_templates (client_id, trigger, scenario, reply)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [clientId, TRIGGERS.includes(t.trigger) ? t.trigger : 'other', t.scenario || null, reply]
    );
    saved.push(rows[0]);
  }
  if (!saved.length) throw new Error('No templates were generated — try a more specific scenario.');
  return saved;
}

async function listTemplates(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM social_dm_templates WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100', [clientId]
  );
  return rows;
}

async function deleteTemplate(clientId, id) {
  await pool.query('DELETE FROM social_dm_templates WHERE id = $1 AND client_id = $2', [id, clientId]);
}

// ── live draft (the tester) ──────────────────────────────────────────────────
// Paste an incoming DM/comment → get the reply the bot would send, under the
// current persona. Lets the AM sanity-check the bot before any live wiring.
async function draftReply(clientId, incoming) {
  const msg = String(incoming || '').trim();
  if (!msg) { const e = new Error('Paste the incoming message to draft a reply.'); e.status = 400; throw e; }
  const client = await loadClient(clientId);
  const { persona } = await getPersona(clientId);
  const reply = await claudeService.callClaude({
    max_tokens: 400,
    system: botSystem(client, persona),
    user: `Incoming Instagram message from a follower:\n"""${msg.slice(0, 2000)}"""\n\nWrite the reply you would send. Output only the reply text — no quotes, no preamble.`,
    feature: 'dm_bot_draft',
    clientId,
  });
  return { reply: String(reply || '').trim() };
}

module.exports = { TRIGGERS, getPersona, savePersona, generateTemplates, listTemplates, deleteTemplate, draftReply };
