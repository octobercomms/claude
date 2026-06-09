/**
 * Journalist thank-you engine (assisted) — Claude drafts a fresh, never-
 * repeating thank-you for a published piece; the team reviews and sends.
 */
const db = require('../db');
const email = require('./emailService');
let claude;
try { claude = require('./claude'); } catch (e) { claude = null; }

function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

/** Draft a thank-you for an editorial-log entry. Returns { to, subject, body, tone, confidence } or {error}. */
async function draftForEntry(entryId) {
  const row = (await db.query(
    `SELECT l.story_title, cl.name AS client, o.name AS outlet,
            c.id AS contact_id, c.first_name, c.last_name, c.email
     FROM pr_editorial_log l
     LEFT JOIN clients cl ON cl.id = l.client_id
     LEFT JOIN pr_outlets o ON o.id = l.outlet_id
     LEFT JOIN pr_contacts c ON c.id = l.contact_id
     WHERE l.id = $1`, [entryId]
  )).rows[0];
  if (!row || !row.contact_id) return { error: 'No journalist linked to this entry.' };
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };

  const prior = (await db.query('SELECT body_excerpt FROM pr_sent_thanks WHERE contact_id = $1 ORDER BY sent_at DESC LIMIT 5', [row.contact_id])).rows.map((r) => r.body_excerpt);
  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
  const first = (name.split(/\s+/)[0] || '').trim();

  const system = 'You write short, warm, genuine thank-you emails from a PR professional to a journalist who has just featured their client. British English, 2–4 sentences, specific not gushing. No "I hope this finds you well", no hard ask. Vary tone/opening each time. Respond as JSON only.';
  let prompt = `Write a thank-you email.\nJournalist: ${name}${first ? ` (use first name "${first}")` : ''}\n`;
  if (row.outlet) prompt += `Publication: ${row.outlet}\n`;
  if (row.story_title) prompt += `Article: ${row.story_title}\n`;
  if (row.client) prompt += `Client featured: ${row.client}\n`;
  if (prior.length) { prompt += `\nYou've thanked this journalist before — write something clearly DIFFERENT from:\n`; prior.forEach((p) => { prompt += `- "${String(p).slice(0, 140)}"\n`; }); }
  prompt += '\nAlso judge confidence (0–1) that a thank-you is appropriate and well-grounded.\nReturn JSON: {"tone":"…","subject":"…","body":"… with first-name greeting","confidence":0.0-1.0}';

  try {
    const text = await claude.callClaude({ max_tokens: 700, system, user: prompt });
    const m = text.match(/\{[\s\S]*\}/);
    const d = m ? JSON.parse(m[0]) : {};
    const realEmail = row.email && !/@import\.local$/.test(row.email);
    return { to: realEmail ? row.email : '', subject: d.subject || 'Thank you', body: d.body || '', tone: d.tone || '', confidence: typeof d.confidence === 'number' ? d.confidence : 0 };
  } catch (e) { return { error: e.message }; }
}

/** Send a thank-you and record it (no-repeat memory + feedback). */
async function deliver({ entryId, contactId, to, name, subject, body, tone, confidence, decision, userId }) {
  if (!to) return { error: 'No journalist email on file.' };
  if (!subject || !body) return { error: 'Subject and body required.' };
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6">${esc(body).replace(/\n/g, '<br>')}</div>`;
  await email.sendPrEmail({ to, subject, html });
  await db.query(
    'INSERT INTO pr_sent_thanks (contact_id, editorial_log_id, tone, body_excerpt, confidence, sent_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [contactId, entryId, tone || '', String(body).slice(0, 240), confidence || 0, userId || null]
  );
  await db.query(
    'INSERT INTO pr_thank_feedback (editorial_log_id, contact_id, claude_confidence, decision, decided_by) VALUES ($1,$2,$3,$4,$5)',
    [entryId, contactId, confidence || 0, decision || 'approved', userId || null]
  );
  return { sent: true };
}

async function skip({ entryId, contactId, userId }) {
  await db.query(
    "INSERT INTO pr_thank_feedback (editorial_log_id, contact_id, decision, decided_by) VALUES ($1,$2,'rejected',$3)",
    [entryId, contactId, userId || null]
  );
  return { skipped: true };
}

module.exports = { draftForEntry, deliver, skip };
