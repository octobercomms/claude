/**
 * Public PR coverage portal — token-gated, NO auth (clients open it without
 * logging in). Shows Published + positive pipeline only; never internal notes.
 */
const express = require('express');
const router = express.Router();
const pr = require('../services/pr');
const prPress = require('../services/prPress');
const pdfService = require('../services/pdfService');
const fs = require('fs');
const path = require('path');

// October wordmark, base64-inlined so puppeteer renders it with no network
// fetch. It's an animated GIF; print renders its first frame — a clean static
// logo on the PDF cover. Cached after first read; null if the file is missing,
// in which case the cover/header fall back to the text mark.
let _coverageLogo;
function coverageLogoDataUri() {
  if (_coverageLogo !== undefined) return _coverageLogo;
  try {
    const b = fs.readFileSync(path.join(__dirname, '../../../frontend/public/coverage-logo.gif'));
    _coverageLogo = `data:image/gif;base64,${b.toString('base64')}`;
  } catch { _coverageLogo = null; }
  return _coverageLogo;
}

// Public press-release approval (token-gated, no login). Defined before the
// catch-all /:token coverage route so the two-segment paths match first.
router.get('/review/:token', async (req, res) => {
  try {
    const data = await prPress.getByReviewToken(req.params.token);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/review/:token/approve', async (req, res) => {
  try {
    const data = await prPress.approveByToken(req.params.token, (req.body || {}).approver);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:token', async (req, res) => {
  try {
    const data = await pr.getCoverageByToken(req.params.token);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:token/download', async (req, res) => {
  try {
    const data = await pr.getCoverageByToken(req.params.token);
    if (!data) return res.status(404).send('Not found');
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const origin = `${req.protocol}://${req.get('host')}`;
    const fullAttachment = (u) => (u ? (u.startsWith('http') ? u : `${origin}${u}`) : '');
    const rows = [['Publication', 'Story', 'Journalist', 'Country', 'Status', 'Issue Date', 'Link', 'Attachment']];
    data.items.forEach((i) => rows.push([
      i.outlet, i.story_title || '', i.journalist, i.country,
      i.status_label, i.issue_date || '', i.story_url || '', fullAttachment(i.attachment_url),
    ]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="coverage-${(data.client_name || 'client').replace(/\W+/g, '-').toLowerCase()}.csv"`);
    res.send(rows.map((r) => r.map(esc).join(',')).join('\n'));
  } catch (err) { res.status(500).send('Error'); }
});

// PDF export of the coverage table. Same data as the public page, rendered
// server-side via puppeteer (same engine the reports module uses). No
// authentication — the token in the URL is the access control. We keep the
// HTML inline + self-contained so the PDF renders identically wherever it's
// downloaded; brand palette mirrors the public page.
router.get('/:token/pdf', async (req, res) => {
  try {
    const data = await pr.getCoverageByToken(req.params.token);
    if (!data) return res.status(404).send('Not found');
    const html = renderCoveragePdfHtml(data);
    const buf = await pdfService.generatePDFBuffer(html, { printFooter: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="coverage-${(data.client_name || 'client').replace(/\W+/g, '-').toLowerCase()}.pdf"`);
    res.send(buf);
  } catch (err) { res.status(500).send('Error generating PDF: ' + err.message); }
});

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
const STATUS_PILL_CSS = {
  published:      'background:#e6f4ea;color:#1f7a3d;border-color:#9bcfa8',
  download:       'background:#e6f4ea;color:#1f7a3d;border-color:#9bcfa8',
  confirmed:      'background:#fff1d6;color:#8c5a00;border-color:#f0c98a',
  pending:        'background:#fff1d6;color:#8c5a00;border-color:#f0c98a',
  interview_prep: 'background:#fff1d6;color:#8c5a00;border-color:#f0c98a',
  declined:       'background:#fde7e7;color:#a32020;border-color:#f0b3b3',
  no_response:    'background:#fde7e7;color:#a32020;border-color:#f0b3b3',
};
function renderCoveragePdfHtml(data) {
  const logo = coverageLogoDataUri();
  const published = data.items.filter((i) => i.published).length;
  const rows = data.items
    .slice()
    .sort((a, b) => new Date(b.issue_date || 0) - new Date(a.issue_date || 0))
    .map((i) => `
      <tr>
        <td class="strong">${escapeHtml(i.outlet || '—')}</td>
        <td>${escapeHtml(i.journalist || '—')}</td>
        <td>${escapeHtml(i.country || '')}</td>
        <td><span class="pill" style="${STATUS_PILL_CSS[i.status] || 'background:#fff;color:#0a0a0a;border-color:#0a0a0a'}">${escapeHtml(i.status_label || i.status)}</span></td>
        <td class="nowrap">${escapeHtml(fmtDate(i.issue_date))}</td>
        <td>
          ${i.story_title ? `<div class="strong">${escapeHtml(i.story_title)}</div>` : ''}
          ${i.story_url ? `<div class="url">${escapeHtml(i.story_url)}</div>` : ''}
        </td>
      </tr>
    `).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.client_name)} — Press coverage</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #0a0a0a; background: #FAFAF7; }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 28px 48px; }
      .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
      .o-mark { width: 26px; height: 26px; border-radius: 50%; background: #FFD600; color: #0a0a0a; font-weight: 800; font-size: 15px; display: inline-flex; align-items: center; justify-content: center; }
      .brand-name { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
      .brand img { height: 30px; display: block; }
      /* Cover — a static first frame: logo centred on the page surface, then a
         page break into the report. */
      .cover { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; padding: 40px; }
      .cover img { width: 320px; max-width: 70%; height: auto; margin-bottom: 28px; }
      .cover .o-mark { width: 64px; height: 64px; font-size: 34px; border-radius: 50%; background: #FFD600; color: #0a0a0a; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 24px; }
      .cover-h1 { font-size: 40px; font-weight: 800; letter-spacing: -0.01em; }
      .cover-sub { font-size: 14px; color: #6b7280; margin-top: 8px; }
      .card { background: #fff; border: 1px solid #e5e3dc; border-radius: 12px; padding: 26px; }
      h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: -0.01em; }
      .sub { color: #6b7280; font-size: 13px; margin: 0 0 14px; }
      .stats { display: flex; gap: 22px; margin-bottom: 18px; }
      .stat-n { font-size: 24px; font-weight: 800; }
      .stat-l { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; color: #6b7280; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; padding: 10px 10px; border-bottom: 2px solid #e5e3dc; }
      td { padding: 10px; border-bottom: 1px solid #e5e3dc; font-size: 12px; vertical-align: top; page-break-inside: avoid; }
      .strong { font-weight: 700; }
      .url { font-size: 10px; color: #6b7280; word-break: break-all; margin-top: 2px; }
      .nowrap { white-space: nowrap; }
      .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; border-width: 1px; border-style: solid; white-space: nowrap; }
      .footer { text-align: center; color: #6b7280; font-size: 11px; margin-top: 18px; }
    </style></head><body>
      <div class="cover">
        ${logo ? `<img src="${logo}" alt="October">` : '<div class="o-mark">O</div>'}
        <div class="cover-h1">${escapeHtml(data.client_name)}</div>
        <div class="cover-sub">Press coverage report &middot; ${escapeHtml(fmtDate(new Date()))}</div>
      </div>
      <div class="wrap">
        <div class="brand">${logo ? `<img src="${logo}" alt="October">` : '<span class="o-mark">O</span><span class="brand-name">October Marketing Intelligence</span>'}</div>
        <div class="card">
          <h1>${escapeHtml(data.client_name)}</h1>
          <p class="sub">Press coverage report · ${escapeHtml(fmtDate(new Date()))}</p>
          <div class="stats">
            <div><div class="stat-n">${published}</div><div class="stat-l">Published</div></div>
            <div><div class="stat-n">${data.items.length}</div><div class="stat-l">Tracked</div></div>
          </div>
          <table>
            <thead><tr>
              <th>Publication</th><th>Journalist</th><th>Country</th><th>Status</th><th>Date</th><th>Story</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="6" style="color:#6b7280;padding:24px;text-align:center;">No coverage to show yet.</td></tr>`}</tbody>
          </table>
        </div>
        <p class="footer">Coverage tracked by October Communications · octobercomms.com</p>
      </div>
    </body></html>`;
}

module.exports = router;
