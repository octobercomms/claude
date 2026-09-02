/**
 * Engagement nudges — "read this, send a warm note".
 *
 * Discovery (weekly, overnight): for your PRIORITY journalists (tier 1 or a
 * strong relationship, active, real email), find a fresh byline via Serper and
 * surface it. Cheap — one Serper call per priority journalist, staggered, no LLM.
 *
 * The note is drafted on demand (one Claude call that actually READS the article
 * so it's specific, not templated) and is HUMAN-APPROVED — never auto-sent. It
 * keeps no-repeat memory like the thank-you engine. Doing this badly (generic,
 * automated) backfires, so v1 is assisted-only and article-grounded.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');
const email = require('./emailService');
const serper = require('./serper');
const prArchive = require('./prArchive');
const { getSetting } = require('../utils/settings');
const { assertPublicHttpUrl } = require('../utils/urlSafety');
let claude; try { claude = require('./claude'); } catch (e) { claude = null; }

const REAL_EMAIL = (e) => e && !/@import\.local$/i.test(e);
function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

async function fetchArticle(url) {
  await assertPublicHttpUrl(url);
  const { data: html } = await axios.get(url, {
    timeout: 15000, maxRedirects: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OctoberPlatform/1.0; +https://platform.octobercomms.com)' },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, header, footer, nav').remove();
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000);
}

/** Priority journalists: tier-1 outlet OR a real relationship, active, contactable. */
async function priorityJournalists(limit = 60) {
  const { rows } = await db.query(
    `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.email, o.name AS outlet,
            COUNT(*) FILTER (WHERE l.status IN ('published','download')) AS published
       FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
       LEFT JOIN pr_editorial_log l ON l.contact_id = c.id
      WHERE c.kind = 'media' AND c.availability_status = 'active'
        AND c.email <> '' AND c.email NOT LIKE '%@import.local'
      GROUP BY c.id, o.name, o.tier
      HAVING o.tier = '1' OR COUNT(*) FILTER (WHERE l.status IN ('published','download')) >= 2
        -- skip anyone already surfaced recently
        AND NOT EXISTS (SELECT 1 FROM pr_engagement e WHERE e.contact_id = c.id AND (e.status = 'new' OR e.created_at > NOW() - INTERVAL '21 days'))
      ORDER BY (o.tier = '1') DESC, published DESC
      LIMIT $1`, [limit]
  );
  return rows;
}

/** Weekly: surface a fresh byline per priority journalist. */
async function runDiscovery({ limit = 50 } = {}) {
  const key = await getSetting('SERPER_API_KEY');
  if (!key) return { skipped: 'no-serper-key' };
  const journos = await priorityJournalists(limit);
  let surfaced = 0;
  for (const j of journos) {
    let res = [];
    try { res = await serper.searchNews(key, `"${j.name}"${j.outlet ? ` ${j.outlet}` : ''}`, 10); } catch { continue; }
    const fresh = res.filter((r) => r.link && prArchive.isRecent(r.date));
    const pick = fresh[0];
    if (!pick) continue;
    try {
      const ins = await db.query(
        `INSERT INTO pr_engagement (contact_id, article_url, article_title, article_date)
         VALUES ($1,$2,$3,$4) ON CONFLICT (contact_id, article_url) DO NOTHING RETURNING id`,
        [j.id, pick.link, (pick.title || '').slice(0, 600), pick.date || '']
      );
      if (ins.rows.length) surfaced += 1;
    } catch { /* ignore dupes */ }
  }
  return { surfaced, considered: journos.length };
}

/** Draft a short, specific warm note for a surfaced article. */
async function draftNote(nudgeId) {
  if (!claude || !claude.callClaude) return { error: 'Claude not configured.' };
  const n = (await db.query(
    `SELECT e.article_url, e.article_title, c.id AS contact_id, c.email,
            TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, c.first_name
       FROM pr_engagement e JOIN outreach_contacts c ON c.id = e.contact_id WHERE e.id = $1`, [nudgeId]
  )).rows[0];
  if (!n) return { error: 'Nudge not found.' };
  const to = REAL_EMAIL(n.email) ? n.email : '';
  let article = '';
  try { article = await fetchArticle(n.article_url); } catch { article = ''; }
  const prior = (await db.query("SELECT body_excerpt FROM pr_engagement WHERE contact_id = $1 AND status = 'sent' ORDER BY sent_at DESC LIMIT 5", [n.contact_id])).rows.map((r) => r.body_excerpt).filter(Boolean);

  const system = 'You write a SHORT, genuine note from a PR professional to a journalist whose recent article they enjoyed — purely relationship-building, no pitch, no ask. British English, 2–3 sentences, specific to something concrete in the article (so it cannot read as templated). No "I hope this finds you well". Vary phrasing each time. JSON only.';
  let prompt = `Journalist: ${n.name}${n.first_name ? ` (use first name "${n.first_name}")` : ''}\nArticle: ${n.article_title}\nURL: ${n.article_url}\n`;
  if (article) prompt += `\nArticle text (reference something specific from it):\n${article}\n`;
  else prompt += `\n(Could not fetch the article body — reference the headline specifically and keep it brief.)\n`;
  if (prior.length) { prompt += `\nYou've written to them before — make this clearly DIFFERENT from:\n`; prior.forEach((p) => { prompt += `- "${String(p).slice(0, 140)}"\n`; }); }
  prompt += '\nReturn JSON: {"subject":"…","body":"… with first-name greeting, no sign-off block"}';
  try {
    const text = await claude.callClaude({ max_tokens: 500, system, user: prompt });
    const m = text.match(/\{[\s\S]*\}/);
    const d = m ? JSON.parse(m[0]) : {};
    return { to, subject: d.subject || 'Enjoyed your piece', body: d.body || '' };
  } catch (e) { return { error: e.message }; }
}

async function send(nudgeId, { subject, body }) {
  const n = (await db.query('SELECT e.contact_id, c.email FROM pr_engagement e JOIN outreach_contacts c ON c.id = e.contact_id WHERE e.id = $1', [nudgeId])).rows[0];
  if (!n) return { error: 'Nudge not found.' };
  if (!REAL_EMAIL(n.email)) return { error: 'No real email on file.' };
  if (!subject || !body) return { error: 'Subject and body required.' };
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6">${esc(body).replace(/\n/g, '<br>')}</div>`;
  await email.sendPrEmail({ to: n.email, subject, html });
  await db.query("UPDATE pr_engagement SET status = 'sent', sent_at = NOW(), body_excerpt = $1 WHERE id = $2", [String(body).slice(0, 240), nudgeId]);
  return { sent: true };
}

async function dismiss(nudgeId) {
  await db.query("UPDATE pr_engagement SET status = 'dismissed' WHERE id = $1", [nudgeId]);
  return { dismissed: true };
}

module.exports = { runDiscovery, draftNote, send, dismiss, priorityJournalists };
