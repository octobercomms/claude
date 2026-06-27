// Instagram discovery → manual-outreach queue.
//
// Compliance is the whole point of this design: discovery uses PUBLIC sources
// (web search via Serper), and the AM does the actual outreach BY HAND — the app
// only surfaces an Open-DM deep link, a copy-paste draft, and (optionally) a
// public email for the mailing list. No credential bot, no automated sending,
// no bulk blasting. A client keeps several named SEARCHES, each with its own
// daily autopilot; every prospect remembers which search found it.

const pool = require('../db');
const claudeService = require('./claude');
const serper = require('./serper');
const { fetchRenderedHtml } = require('../utils/fetchHtml');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

const STATUSES = ['new', 'queued', 'messaged', 'replied', 'skipped'];
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// ── Saved searches ───────────────────────────────────────────────────────────
async function listSearches(clientId) {
  const { rows } = await pool.query(
    `SELECT s.*, (SELECT count(*)::int FROM ig_outreach_prospects p WHERE p.search_id = s.id) AS prospect_count
       FROM ig_outreach_searches s WHERE s.client_id = $1 ORDER BY s.created_at`,
    [clientId]
  );
  return rows;
}

async function createSearch(clientId, { name, icp, location, hashtags, enabled } = {}) {
  if (!String(icp || '').trim() && !String(hashtags || '').trim()) { const e = new Error('Enter an ICP or some hashtags.'); e.status = 400; throw e; }
  const nm = String(name || '').trim() || [String(icp || '').trim(), String(location || '').trim()].filter(Boolean).join(' · ').slice(0, 80) || 'Search';
  const { rows } = await pool.query(
    `INSERT INTO ig_outreach_searches (client_id, name, icp, location, hashtags, enabled)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [clientId, nm, icp || null, location || null, hashtags || null, !!enabled]
  );
  return rows[0];
}

async function updateSearch(clientId, id, patch = {}) {
  const sets = [], vals = [clientId, id];
  for (const f of ['name', 'icp', 'location', 'hashtags', 'enabled']) {
    if (patch[f] !== undefined) { sets.push(`${f} = $${vals.length + 1}`); vals.push(f === 'enabled' ? !!patch[f] : (patch[f] || null)); }
  }
  if (!sets.length) { const e = new Error('Nothing to update.'); e.status = 400; throw e; }
  const { rows } = await pool.query(`UPDATE ig_outreach_searches SET ${sets.join(', ')} WHERE client_id = $1 AND id = $2 RETURNING *`, vals);
  if (!rows[0]) { const e = new Error('Search not found.'); e.status = 404; throw e; }
  return rows[0];
}

async function deleteSearch(clientId, id) {
  await pool.query('DELETE FROM ig_outreach_searches WHERE client_id = $1 AND id = $2', [clientId, id]);
}

// ── Prospects ────────────────────────────────────────────────────────────────
async function listProspects(clientId, searchId) {
  const params = [clientId];
  let where = 'client_id = $1';
  if (searchId) { params.push(searchId); where += ` AND search_id = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM ig_outreach_prospects WHERE ${where}
      ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'queued' THEN 1 WHEN 'messaged' THEN 2 WHEN 'replied' THEN 3 ELSE 4 END, found_at DESC`,
    params
  );
  return rows;
}

// Run one search's query and insert any profiles not already in the client's
// queue (deduped across ALL searches), tagging them to this search.
async function runDiscovery(search) {
  const { rows: existing } = await pool.query('SELECT username FROM ig_outreach_prospects WHERE client_id = $1', [search.client_id]);
  const seen = existing.map(r => r.username.toLowerCase());
  const hashtags = String(search.hashtags || '').split(',').map(s => s.trim()).filter(Boolean);
  const found = await serper.searchInstagramProfiles({ icp: search.icp || '', location: search.location || '', hashtags }, seen);
  const inserted = [];
  for (const p of found) {
    const r = await pool.query(
      `INSERT INTO ig_outreach_prospects (client_id, search_id, username, source, display_name, bio, profile_url)
       VALUES ($1, $2, $3, 'serper', $4, $5, $6)
       ON CONFLICT (client_id, lower(username)) DO NOTHING RETURNING *`,
      [search.client_id, search.id, p.username, p.display_name || null, p.bio || null, p.profile_url || null]
    );
    if (r.rows[0]) inserted.push(r.rows[0]);
  }
  await pool.query('UPDATE ig_outreach_searches SET last_run_at = NOW() WHERE id = $1', [search.id]);
  return inserted;
}

async function runSearch(clientId, searchId) {
  const { rows } = await pool.query('SELECT * FROM ig_outreach_searches WHERE client_id = $1 AND id = $2', [clientId, searchId]);
  const s = rows[0];
  if (!s) { const e = new Error('Search not found.'); e.status = 404; throw e; }
  const added = await runDiscovery(s);
  return { added: added.length, prospects: await listProspects(clientId, searchId) };
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
  const { rows } = await pool.query(`UPDATE ig_outreach_prospects SET ${sets.join(', ')} WHERE client_id = $1 AND id = $2 RETURNING *`, vals);
  if (!rows[0]) { const e = new Error('Prospect not found.'); e.status = 404; throw e; }
  return rows[0];
}

// Draft a short, personalised opening DM using the client's DM-bot persona.
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

  const { rows: upd } = await pool.query('UPDATE ig_outreach_prospects SET draft = $3 WHERE client_id = $1 AND id = $2 RETURNING *', [clientId, id, draft]);
  return upd[0];
}

// Best-effort public email: the profile bio, else their website's contact page.
// Honest by design — many profiles won't have a discoverable email.
async function enrichEmail(clientId, id) {
  const { rows } = await pool.query('SELECT * FROM ig_outreach_prospects WHERE client_id = $1 AND id = $2', [clientId, id]);
  const p = rows[0];
  if (!p) { const e = new Error('Prospect not found.'); e.status = 404; throw e; }
  if (p.email) return p;

  let email = (p.bio && (p.bio.match(EMAIL_RE) || [])[0]) || null;
  if (!email) {
    try {
      const domains = await serper.findBusinessDomains({ industry: p.display_name || p.username }, []);
      const domain = domains[0]?.domain;
      if (domain) {
        for (const path of ['', '/contact', '/contact-us', '/about']) {
          try {
            const url = `https://${domain}${path}`;
            assertPublicHttpUrl(url);
            const html = await fetchRenderedHtml(url);
            const m = String(html || '').replace(/&#64;|\(at\)|\[at\]/gi, '@').match(EMAIL_RE);
            if (m && !/\.(png|jpe?g|gif|svg|webp)$/i.test(m[0]) && !/sentry|wixpress|example\.com|@2x/i.test(m[0])) { email = m[0].toLowerCase(); break; }
          } catch { /* try next path */ }
        }
      }
    } catch { /* no domain / serper off */ }
  }
  if (!email) { const e = new Error('No public email found for this profile.'); e.status = 404; throw e; }
  const { rows: upd } = await pool.query('UPDATE ig_outreach_prospects SET email = $3 WHERE client_id = $1 AND id = $2 RETURNING *', [clientId, id, email]);
  return upd[0];
}

// ── Autopilot (scheduler) — re-run every enabled search, digest the new finds ──
async function runAutopilot() {
  const { rows: searches } = await pool.query(
    `SELECT s.*, c.name AS client_name FROM ig_outreach_searches s
       JOIN clients c ON c.id = s.client_id WHERE s.enabled = TRUE`
  );
  const out = [];
  for (const s of searches) {
    try {
      const added = await runDiscovery(s);
      if (added.length) out.push({ clientName: s.client_name, searchName: s.name, newProspects: added });
    } catch (e) { console.error('[ig-autopilot]', s.id, e.message); }
  }
  return out;
}

module.exports = {
  listSearches, createSearch, updateSearch, deleteSearch,
  listProspects, runSearch, setStatus, draftMessage, enrichEmail, runAutopilot,
};
