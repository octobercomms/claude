// Tender Agent — email digest. After a scan, if the digest is enabled and an
// address is set, email the account lead the NEW creative-sector-PR matches
// first seen since the last digest. Runs from the scheduler right after ingest.

const pool = require('../../db');
const emailService = require('../emailService');
const { prefilter } = require('./classify');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(d) {
  if (!d) return 'unknown';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return 'unknown'; }
}
function fmtValue(n, currency) {
  if (n == null) return 'not stated';
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'CAD' ? 'C$' : '';
  return `${sym}${Math.round(Number(n)).toLocaleString('en-GB')}`;
}

function renderHtml(matches, appUrl) {
  const rows = matches.map(n => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;">
        <a href="${esc(n.url || appUrl + '/tenders')}" style="color:#111;font-weight:600;text-decoration:none;">${esc(n.title || n.external_ref)}</a>
        <div style="color:#888;font-size:12px;margin-top:2px;">${esc(n.buyer_name || '—')}${n.market ? ' · ' + esc(String(n.market).toUpperCase()) : ''}</div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${esc(fmtValue(n.value_min, n.currency))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap;">${esc(fmtDate(n.closing_at))}</td>
    </tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#111;max-width:640px;">
    <h2 style="margin:0 0 4px;">OMI tender scan</h2>
    <p style="color:#555;margin:0 0 16px;">${matches.length} new creative-sector PR tender${matches.length === 1 ? '' : 's'} to review.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111;font-size:12px;text-transform:uppercase;color:#888;">Tender</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111;font-size:12px;text-transform:uppercase;color:#888;">Value</th>
        <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #111;font-size:12px;text-transform:uppercase;color:#888;">Closes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:18px 0 0;"><a href="${esc(appUrl)}/tenders" style="color:#111;">Open the Tenders list in OMI →</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px;">October Marketing Intelligence · you're receiving this because tender email alerts are on in Settings → Templates &amp; tools → Tenders.</p>
  </div>`;
}

// force: send even if disabled (for a "send test" button), and ignore the
// last-digest window (look back 7 days) so there's something to show.
async function runDigest({ force = false, log = () => {} } = {}) {
  const { rows: srows } = await pool.query('SELECT * FROM tender_settings WHERE id = 1');
  const s = srows[0] || {};
  if (!force && !s.digest_enabled) { log('tender digest: disabled'); return { sent: false, reason: 'disabled' }; }
  const email = (s.digest_email || '').trim();
  if (!email) { log('tender digest: no email set'); return { sent: false, reason: 'no email' }; }

  const since = force ? new Date(Date.now() - 7 * 86400000) : (s.last_digest_at || new Date(Date.now() - 7 * 86400000));
  const { rows } = await pool.query(
    `SELECT n.*, src.market FROM tender_notices n LEFT JOIN tender_sources src ON src.id = n.source_id
     WHERE n.dismissed = false AND n.first_seen_at > $1 AND (n.closing_at IS NULL OR n.closing_at >= NOW())
     ORDER BY n.first_seen_at DESC LIMIT 300`,
    [since]
  );
  const matches = rows.filter(r => prefilter(r).tier === 'match');

  if (!matches.length) {
    await pool.query('UPDATE tender_settings SET last_digest_at = NOW() WHERE id = 1');
    log('tender digest: no new matches');
    return { sent: false, reason: 'no new matches' };
  }

  const appUrl = process.env.PLATFORM_URL || 'https://platform.octobercomms.com';
  const subject = `OMI tender scan: ${matches.length} to review`;
  try {
    await emailService.sendTenderDigest({ to: email, subject, html: renderHtml(matches, appUrl) });
  } catch (e) {
    log(`tender digest: send failed: ${e.message}`);
    return { sent: false, reason: e.message };
  }

  await pool.query('UPDATE tender_settings SET last_digest_at = NOW() WHERE id = 1');
  log(`tender digest: emailed ${matches.length} match(es) to ${email}`);
  return { sent: true, count: matches.length, to: email };
}

module.exports = { runDigest, renderHtml };
