/**
 * Journalist thank-you engine (assisted) — Claude drafts a fresh, never-
 * repeating thank-you for a published piece; the team reviews and sends.
 */
const db = require('../db');
const email = require('./emailService');
let claude;
try { claude = require('./claude'); } catch (e) { claude = null; }

function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

// Graduated autonomy. Per-client thank_stage controls how far automation goes.
const STAGES = {
  assist: 'Assisted — I approve every send',
  supervised: 'Supervised — auto-send only very confident ones',
  auto: 'Auto — send confident ones automatically',
};
const MAX_PER_CLIENT_PER_RUN = 10;
function threshold(stage) {
  if (stage === 'auto') return 0.70;
  if (stage === 'supervised') return 0.85;
  return 2.0; // assist → never auto-sends
}

/** Ask Claude for a fresh, never-repeating thank-you. Returns {subject,body,tone,confidence} or {error}. */
async function composeDraft({ name, outlet, story_title, client }, prior) {
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };
  const first = (String(name || '').split(/\s+/)[0] || '').trim();
  const system = 'You write short, warm, genuine thank-you emails from a PR professional to a journalist who has just featured their client. British English, 2–4 sentences, specific not gushing. No "I hope this finds you well", no hard ask. Vary tone/opening each time. Respond as JSON only.';
  let prompt = `Write a thank-you email.\nJournalist: ${name}${first ? ` (use first name "${first}")` : ''}\n`;
  if (outlet) prompt += `Publication: ${outlet}\n`;
  if (story_title) prompt += `Article: ${story_title}\n`;
  if (client) prompt += `Client featured: ${client}\n`;
  if (prior && prior.length) { prompt += `\nYou've thanked this journalist before — write something clearly DIFFERENT from:\n`; prior.forEach((p) => { prompt += `- "${String(p).slice(0, 140)}"\n`; }); }
  prompt += '\nAlso judge confidence (0–1) that a thank-you is appropriate and well-grounded.\nReturn JSON: {"tone":"…","subject":"…","body":"… with first-name greeting","confidence":0.0-1.0}';
  try {
    const text = await claude.callClaude({ max_tokens: 700, system, user: prompt });
    const m = text.match(/\{[\s\S]*\}/);
    const d = m ? JSON.parse(m[0]) : {};
    return { subject: d.subject || 'Thank you', body: d.body || '', tone: d.tone || '', confidence: typeof d.confidence === 'number' ? d.confidence : 0 };
  } catch (e) { return { error: e.message }; }
}

async function priorExcerpts(contactId) {
  return (await db.query('SELECT body_excerpt FROM pr_sent_thanks WHERE contact_id = $1 ORDER BY sent_at DESC LIMIT 5', [contactId])).rows.map((r) => r.body_excerpt);
}

/** Draft a thank-you for an editorial-log entry. Returns { to, subject, body, tone, confidence } or {error}. */
async function draftForEntry(entryId) {
  const row = (await db.query(
    `SELECT l.story_title, cl.name AS client, o.name AS outlet,
            c.id AS contact_id, c.first_name, c.last_name, c.email
     FROM pr_editorial_log l
     LEFT JOIN clients cl ON cl.id = l.client_id
     LEFT JOIN pr_outlets o ON o.id = l.outlet_id
     LEFT JOIN outreach_contacts c ON c.id = l.contact_id
     WHERE l.id = $1`, [entryId]
  )).rows[0];
  if (!row || !row.contact_id) return { error: 'No journalist linked to this entry.' };

  const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
  const d = await composeDraft({ name, outlet: row.outlet, story_title: row.story_title, client: row.client }, await priorExcerpts(row.contact_id));
  if (d.error) return d;
  const realEmail = row.email && !/@import\.local$/.test(row.email);
  return { to: realEmail ? row.email : '', subject: d.subject, body: d.body, tone: d.tone, confidence: d.confidence };
}

/** Approve/edit/reject/auto counts for a client (its coverage's thank-yous). */
async function trackRecord(clientId) {
  const rows = (await db.query(
    `SELECT f.decision, COUNT(*)::int AS n
     FROM pr_thank_feedback f JOIN pr_editorial_log l ON l.id = f.editorial_log_id
     WHERE l.client_id = $1 GROUP BY f.decision`, [clientId]
  )).rows;
  const out = { approved: 0, edited: 0, rejected: 0, auto: 0 };
  rows.forEach((r) => { if (r.decision in out) out[r.decision] = r.n; });
  return out;
}

/** Scheduled tick: auto-send confident thank-yous for opted-in clients. */
async function runAuto() {
  if (!claude || !claude.callClaude) return { sent: 0, skipped: 'claude-not-configured' };
  const clients = (await db.query(
    "SELECT client_id, thank_stage FROM pr_client_settings WHERE thank_stage IN ('supervised','auto')"
  )).rows;
  let sent = 0;
  for (const c of clients) {
    const min = threshold(c.thank_stage);
    const rows = (await db.query(
      `SELECT l.id, l.story_title, cl.name AS client, c.id AS contact_id, c.first_name, c.last_name, c.email, o.name AS outlet
       FROM pr_editorial_log l
       JOIN outreach_contacts c ON c.id = l.contact_id
       LEFT JOIN clients cl ON cl.id = l.client_id
       LEFT JOIN pr_outlets o ON o.id = l.outlet_id
       WHERE l.client_id = $1 AND l.status = 'published'
         AND c.email <> '' AND c.email NOT LIKE '%@import.local'
         AND c.availability_status = 'active'
         AND NOT EXISTS (SELECT 1 FROM pr_sent_thanks s WHERE s.editorial_log_id = l.id)
         AND NOT EXISTS (SELECT 1 FROM pr_thank_feedback f WHERE f.editorial_log_id = l.id)
       ORDER BY COALESCE(l.issue_date, l.created_at) DESC LIMIT $2`,
      [c.client_id, MAX_PER_CLIENT_PER_RUN]
    )).rows;
    for (const r of rows) {
      const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
      const d = await composeDraft({ name, outlet: r.outlet, story_title: r.story_title, client: r.client }, await priorExcerpts(r.contact_id));
      if (d.error || (d.confidence || 0) < min) continue; // leave for the human queue
      const result = await deliver({ entryId: r.id, contactId: r.contact_id, to: r.email, name, subject: d.subject, body: d.body, tone: d.tone, confidence: d.confidence, decision: 'auto' });
      if (result.sent) sent += 1;
    }
  }
  return { sent };
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

module.exports = { draftForEntry, deliver, skip, runAuto, trackRecord, STAGES };
