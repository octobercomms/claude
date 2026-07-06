// Swipe file — "reel to ideas". The AM pastes a reel/video URL; the video
// worker (which has yt-dlp + ffmpeg + Whisper) downloads and transcribes it,
// then this service turns the transcript into a Claude idea card, stores it, and
// emails it back. The swipe_items table doubles as the worker queue.

const pool = require('../db');
const { callClaude } = require('./claude');
const emailService = require('./emailService');

function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
  return 'other';
}

function isHttpUrl(url) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// ── AM-facing CRUD ──
async function list(clientId) {
  const { rows } = await pool.query(
    'SELECT * FROM swipe_items WHERE client_id = $1 ORDER BY created_at DESC',
    [clientId]
  );
  return rows;
}

async function get(clientId, id) {
  const { rows } = await pool.query('SELECT * FROM swipe_items WHERE client_id = $1 AND id = $2', [clientId, id]);
  return rows[0] || null;
}

async function create(clientId, { url, notes, email_to }, userId) {
  if (!isHttpUrl(url)) { const e = new Error('Enter a valid video URL (http/https).'); e.status = 400; throw e; }
  const defaultTo = process.env.ALERT_EMAIL || process.env.STRATEGIST_RECIPIENTS || process.env.GMAIL_USER || null;
  const to = (email_to && String(email_to).trim()) || defaultTo;
  const { rows } = await pool.query(
    `INSERT INTO swipe_items (client_id, url, platform, notes, email_to, requested_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING *`,
    [clientId, url.trim(), detectPlatform(url), notes ? String(notes).trim() : null, to, userId || null]
  );
  return rows[0];
}

async function update(clientId, id, { notes, tags, title }) {
  const sets = [], vals = [clientId, id];
  if (notes !== undefined) { sets.push(`notes = $${vals.length + 1}`); vals.push(notes ? String(notes).trim() : null); }
  if (tags !== undefined) { sets.push(`tags = $${vals.length + 1}`); vals.push(Array.isArray(tags) ? tags.slice(0, 20) : []); }
  if (title !== undefined) { sets.push(`title = $${vals.length + 1}`); vals.push(title ? String(title).trim().slice(0, 200) : null); }
  if (!sets.length) { const e = new Error('Nothing to update.'); e.status = 400; throw e; }
  const { rows } = await pool.query(`UPDATE swipe_items SET ${sets.join(', ')} WHERE client_id = $1 AND id = $2 RETURNING *`, vals);
  if (!rows[0]) { const e = new Error('Item not found.'); e.status = 404; throw e; }
  return rows[0];
}

async function remove(clientId, id) {
  await pool.query('DELETE FROM swipe_items WHERE client_id = $1 AND id = $2', [clientId, id]);
}

async function retry(clientId, id) {
  const { rows } = await pool.query(
    `UPDATE swipe_items SET status = 'queued', error = NULL, claimed_by = NULL, claimed_at = NULL
       WHERE client_id = $1 AND id = $2 AND status = 'failed' RETURNING *`,
    [clientId, id]
  );
  if (!rows[0]) { const e = new Error('Only failed items can be retried.'); e.status = 400; throw e; }
  return rows[0];
}

// ── Worker queue ──
async function claimNext(workerId) {
  const { rows } = await pool.query(
    `UPDATE swipe_items SET status = 'processing', claimed_by = $1, claimed_at = NOW()
       WHERE id = (SELECT id FROM swipe_items WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, url, platform, client_id`,
    [workerId]
  );
  return rows[0] || null;
}

async function failItem(id, error) {
  await pool.query(
    `UPDATE swipe_items SET status = 'failed', error = $2 WHERE id = $1`,
    [id, String(error || 'Processing failed').slice(0, 1900)]
  );
}

// Worker posts the transcript; we generate the idea card, store everything,
// mark done, and email the result if a recipient is set.
async function saveTranscript(id, { transcript, title }) {
  const text = String(transcript || '').trim();
  const { rows: cur } = await pool.query('SELECT * FROM swipe_items WHERE id = $1', [id]);
  const item = cur[0];
  if (!item) { const e = new Error('Item not found.'); e.status = 404; throw e; }

  if (!text) {
    await pool.query(`UPDATE swipe_items SET status = 'done', title = COALESCE($2, title) WHERE id = $1`, [id, title || null]);
    return;
  }

  let card = null;
  try { card = await generateIdeaCard({ transcript: text, platform: item.platform, title, clientId: item.client_id }); }
  catch (e) { console.error('[swipe] idea card failed:', e.message); }

  // Prefer Claude's plain-English label over the scraped metadata title
  // ("Video by @handle"), so the swipe list is scannable at a glance.
  const displayTitle = (card && card.title) || title || null;
  await pool.query(
    `UPDATE swipe_items SET status = 'done', transcript = $2, idea_card = $3, title = COALESCE($4, title) WHERE id = $1`,
    [id, text, card ? JSON.stringify(card) : null, displayTitle]
  );

  if (item.email_to) {
    try {
      const { rows: c } = await pool.query('SELECT name FROM clients WHERE id = $1', [item.client_id]);
      await emailService.sendSwipeIdea({
        to: item.email_to,
        clientName: c[0]?.name || '',
        url: item.url,
        platform: item.platform,
        title: title || item.title,
        transcript: text,
        card,
      });
      await pool.query(`UPDATE swipe_items SET emailed_at = NOW() WHERE id = $1`, [id]);
    } catch (e) { console.error('[swipe] email failed:', e.message); }
  }
}

// Turn a transcript into a structured, reusable idea card via Claude.
async function generateIdeaCard({ transcript, platform, title, clientId }) {
  const system = `You analyse short-form social videos and turn their transcript into a reusable content idea for a marketing team. Be concrete and concise. Respond with ONLY a JSON object, no prose, in this exact shape:
{"title": "a plain-English 4-8 word label for what this video is about, so it can be found at a glance (describe the content, NOT the uploader/handle)", "hook": "the opening hook/first line, paraphrased", "summary": "2-3 sentence summary of what the video does", "why_it_works": "1-2 sentences on why this format/angle is effective", "angles": ["3-5 specific ways the team could adapt this idea for their own brand"], "format": "e.g. talking-head, listicle, skit, tutorial, b-roll voiceover", "tags": ["3-6 short topical tags"]}`;
  const user = `Platform: ${platform || 'unknown'}${title ? `\nTitle: ${title}` : ''}\n\nTranscript:\n"""\n${transcript.slice(0, 8000)}\n"""`;
  const raw = await callClaude({ system, user, max_tokens: 900, feature: 'swipe_idea_card', clientId });
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  const card = JSON.parse(match[0]);
  if (!Array.isArray(card.angles)) card.angles = card.angles ? [String(card.angles)] : [];
  if (!Array.isArray(card.tags)) card.tags = [];
  return card;
}

module.exports = { list, get, create, update, remove, retry, claimNext, failItem, saveTranscript, detectPlatform };
