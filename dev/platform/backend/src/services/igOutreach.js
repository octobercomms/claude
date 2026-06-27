// Instagram discovery → manual-outreach queue.
//
// Compliance is the whole point of this design: discovery uses PUBLIC / official
// sources (web search via Serper today; IG Graph hashtag + the Apollo/PDL
// finders as pluggable sources), and the AM does the actual outreach BY HAND —
// the app only surfaces an Open-DM deep link and a copy-paste draft. No
// credential bot, no automated sending, no bulk blasting. Keep volume low and
// messages personalised; this finds a few good prospects a day, not hundreds.

const pool = require('../db');
const claudeService = require('./claude');
const serper = require('./serper');

const STATUSES = ['new', 'queued', 'messaged', 'replied', 'skipped'];

async function listProspects(clientId) {
  const { rows } = await pool.query(
    `SELECT * FROM ig_outreach_prospects WHERE client_id = $1
      ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'queued' THEN 1 WHEN 'messaged' THEN 2 WHEN 'replied' THEN 3 ELSE 4 END,
               found_at DESC`,
    [clientId]
  );
  return rows;
}

// Find new public profiles and insert any we haven't seen for this client.
async function discover(clientId, { source = 'serper', icp, location, hashtags } = {}) {
  const { rows: existing } = await pool.query('SELECT username FROM ig_outreach_prospects WHERE client_id = $1', [clientId]);
  const seen = existing.map(r => r.username.toLowerCase());

  let found = [];
  if (source === 'serper') {
    found = await serper.searchInstagramProfiles({ icp, location, hashtags }, seen);
  } else if (source === 'hashtag') {
    const e = new Error('Instagram Graph hashtag discovery needs a connected IG Professional account + Meta app review for the hashtag permission. Use web search for now.');
    e.status = 400; throw e;
  } else if (source === 'apollo') {
    const e = new Error('Apollo/PDL discovery for IG handles is not wired up yet — use web search for now.');
    e.status = 400; throw e;
  } else {
    const e = new Error('Unknown discovery source.'); e.status = 400; throw e;
  }

  let added = 0;
  for (const p of found) {
    const r = await pool.query(
      `INSERT INTO ig_outreach_prospects (client_id, username, source, display_name, bio, profile_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, lower(username)) DO NOTHING`,
      [clientId, p.username, source, p.display_name || null, p.bio || null, p.profile_url || null]
    );
    added += r.rowCount;
  }
  return { added, found: found.length, prospects: await listProspects(clientId) };
}

async function setStatus(clientId, id, { status, notes }) {
  if (status && !STATUSES.includes(status)) { const e = new Error('Invalid status.'); e.status = 400; throw e; }
  const sets = [], vals = [clientId, id];
  if (status) {
    sets.push(`status = $${vals.length + 1}`); vals.push(status);
    if (status === 'messaged') sets.push('messaged_at = COALESCE(messaged_at, NOW())');
    if (status === 'replied') sets.push('replied_at = COALESCE(replied_at, NOW())');
  }
  if (notes !== undefined) { sets.push(`notes = $${vals.length + 1}`); vals.push(String(notes).slice(0, 2000)); }
  if (!sets.length) { const e = new Error('Nothing to update.'); e.status = 400; throw e; }
  const { rows } = await pool.query(
    `UPDATE ig_outreach_prospects SET ${sets.join(', ')} WHERE client_id = $1 AND id = $2 RETURNING *`, vals
  );
  if (!rows[0]) { const e = new Error('Prospect not found.'); e.status = 404; throw e; }
  return rows[0];
}

// Draft a short, personalised opening DM for one prospect — using the client's
// existing DM-bot persona (so it sounds on-brand) plus what we know about the
// prospect. The AM copies, tweaks and sends it themselves.
async function draftMessage(clientId, id) {
  const { rows } = await pool.query('SELECT * FROM ig_outreach_prospects WHERE client_id = $1 AND id = $2', [clientId, id]);
  const p = rows[0];
  if (!p) { const e = new Error('Prospect not found.'); e.status = 404; throw e; }
  const { rows: cr } = await pool.query('SELECT name, briefing_field FROM clients WHERE id = $1', [clientId]);
  const c = cr[0] || {};
  const { rows: pr } = await pool.query('SELECT persona FROM social_dm_bot WHERE client_id = $1', [clientId]);
  const persona = pr[0]?.persona || '';

  const draft = (await claudeService.callClaude({
    max_tokens: 400,
    system: 'You write a single, short opening Instagram DM for a brand reaching out to a prospect by hand. Warm, specific, human — reference something real about the prospect. Never salesy, never a template, no links, under 45 words, no emoji spam. Output ONLY the message text, nothing else.',
    user: `Brand: ${c.name}${c.briefing_field ? ` — ${c.briefing_field}` : ''}
${persona ? `Brand DM voice/persona: ${persona}\n` : ''}Prospect: @${p.username}${p.display_name ? ` (${p.display_name})` : ''}
What we know about them: ${p.bio || '(only their handle)'}

Write one genuine opening DM that could start a real conversation.`,
    feature: 'ig_outreach_draft',
    clientId,
  })).trim();

  const { rows: upd } = await pool.query(
    'UPDATE ig_outreach_prospects SET draft = $3 WHERE client_id = $1 AND id = $2 RETURNING *',
    [clientId, id, draft]
  );
  return upd[0];
}

module.exports = { listProspects, discover, setStatus, draftMessage };
