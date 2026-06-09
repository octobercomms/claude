/**
 * Automated PR client reports + "you've been featured" alerts (native).
 * A daily cron sends each opted-in client their weekly/monthly coverage digest;
 * alerts fire when a single entry is set to Published.
 */
const db = require('../db');
const email = require('./emailService');
const { ensureClientToken } = require('./pr');
let claude;
try { claude = require('./claude'); } catch (e) { claude = null; }

const PORTAL_PATH = '/coverage/';
const windowDays = (cadence) => (cadence === 'monthly' ? 30 : 7);

async function gatherPublished(clientId, sinceIso) {
  const params = [clientId];
  let sql = `SELECT l.story_title, l.issue_date, l.story_url, o.name AS outlet,
                    TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
             FROM pr_editorial_log l
             LEFT JOIN pr_outlets o ON o.id = l.outlet_id
             LEFT JOIN pr_contacts c ON c.id = l.contact_id
             WHERE l.client_id = $1 AND l.status IN ('published','download')`;
  if (sinceIso) { sql += ' AND COALESCE(l.issue_date, l.created_at) >= $2'; params.push(sinceIso); }
  sql += ' ORDER BY COALESCE(l.issue_date, l.created_at) DESC';
  return (await db.query(sql, params)).rows;
}

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://platform.octobercomms.com').replace(/\/$/, '');
}

function reportHtml(clientName, summary, items, portalUrl) {
  const li = items.map((i) => {
    const date = i.issue_date ? new Date(i.issue_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    let line = `<strong>${esc(i.outlet || '')}</strong>${i.story_title ? ' — ' + esc(i.story_title) : ''}${date ? ` <span style="color:#6b7280">(${date})</span>` : ''}`;
    if (i.story_url) line = `<a href="${esc(i.story_url)}" style="color:#111">${line}</a>`;
    return `<li style="margin-bottom:6px">${line}</li>`;
  }).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6;max-width:640px">
    <h2 style="margin:0 0 4px">${esc(clientName)}</h2>
    <p style="color:#6b7280;margin:0 0 16px">Press coverage update</p>
    <p>${esc(summary).replace(/\n/g, '<br>')}</p>
    ${items.length ? `<ul style="padding-left:18px">${li}</ul>` : ''}
    <p style="margin-top:18px"><a href="${esc(portalUrl)}" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">View your live coverage page →</a></p>
  </div>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

async function writeSummary(clientName, items, periodLabel) {
  if (!claude || !claude.callClaude || !items.length) {
    return `${items.length} piece(s) of coverage to share for ${periodLabel}.`;
  }
  const list = items.slice(0, 30).map((i) => `${i.outlet || ''}${i.journalist ? ` (${i.journalist})` : ''}${i.story_title ? ` — ${i.story_title}` : ''}`).join('\n');
  const system = 'You write concise, warm PR coverage summaries for clients. Plain prose, British English, 2–4 sentences. No greeting/sign-off, no invented facts.';
  try {
    return (await claude.callClaude({ max_tokens: 400, system, user: `Summarise the press coverage for "${clientName}" for ${periodLabel}, in 2–4 sentences (volume, standout publications, notable journalists).\n\nCoverage:\n${list}` })).trim();
  } catch (e) { return `${items.length} piece(s) of coverage to share for ${periodLabel}.`; }
}

/** Send a client's report. manual=true sends a full snapshot even if nothing's new. */
async function sendClientReport(clientId, manual = false) {
  const cs = await db.query(
    `SELECT cs.*, cl.name FROM pr_client_settings cs JOIN clients cl ON cl.id = cs.client_id WHERE cs.client_id = $1`, [clientId]
  );
  if (!cs.rows.length || !cs.rows[0].alert_email) return { error: 'No report email set for this client.' };
  const s = cs.rows[0];
  const cadence = s.report_cadence === 'off' ? 'weekly' : s.report_cadence;
  const periodLabel = manual ? 'to date' : (cadence === 'monthly' ? 'the past month' : 'the past week');
  const since = manual ? null : new Date(Date.now() - windowDays(cadence) * 86400000).toISOString();

  const items = await gatherPublished(clientId, since);
  if (!manual && !items.length) return { skipped: 'nothing new' };

  const summary = await writeSummary(s.name, items, periodLabel);
  const portalUrl = `${baseUrl()}${PORTAL_PATH}${s.portal_token}`;
  await email.sendPrEmail({ to: s.alert_email, subject: `${s.name} — press coverage (${periodLabel})`, html: reportHtml(s.name, summary, items, portalUrl) });
  await db.query('UPDATE pr_client_settings SET last_report_at = NOW() WHERE client_id = $1', [clientId]);
  return { sent: true, count: items.length };
}

/** Daily tick — send due weekly/monthly reports. */
async function runDueReports() {
  const { rows } = await db.query("SELECT client_id, report_cadence, last_report_at FROM pr_client_settings WHERE report_cadence <> 'off' AND alert_email <> ''");
  for (const r of rows) {
    const win = windowDays(r.report_cadence);
    const due = !r.last_report_at || (Date.now() - new Date(r.last_report_at).getTime()) >= (win - 0.1) * 86400000;
    if (due) { try { await sendClientReport(r.client_id, false); } catch (e) { /* keep going */ } }
  }
}

/** Fire a "you've been featured" alert for a newly-published entry. */
async function sendFeaturedAlert(clientId, { outlet, title, url }) {
  const cs = await db.query(
    `SELECT cs.alert_email, cs.portal_token, cl.name FROM pr_client_settings cs JOIN clients cl ON cl.id = cs.client_id WHERE cs.client_id = $1`, [clientId]
  );
  if (!cs.rows.length || !cs.rows[0].alert_email) return;
  const s = cs.rows[0];
  const portalUrl = `${baseUrl()}${PORTAL_PATH}${s.portal_token}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;line-height:1.6">
    <p>Good news — new coverage for <strong>${esc(s.name)}</strong>:</p>
    <p style="font-size:16px"><strong>${esc(outlet || '')}</strong>${title ? ' — ' + esc(title) : ''}</p>
    ${url ? `<p><a href="${esc(url)}">Read the piece →</a></p>` : ''}
    <p><a href="${esc(portalUrl)}">View all your coverage →</a></p></div>`;
  try { await email.sendPrEmail({ to: s.alert_email, subject: `🎉 You've been featured${outlet ? ' in ' + outlet : ''}`, html }); } catch (e) { /* non-fatal */ }
}

module.exports = { sendClientReport, runDueReports, sendFeaturedAlert };
