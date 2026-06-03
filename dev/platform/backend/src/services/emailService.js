const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const LOGO_GIF_PATH = path.join(__dirname, '../assets/october-logo.gif');
const LOGO_CID = 'october-logo@octobercomms';

function getTransporter() {
  const { buildTransporter } = require('../routes/settings');
  return buildTransporter();
}

function getSenderAddress() {
  if (process.env.EMAIL_PROVIDER === 'ses') {
    return process.env.SES_FROM_EMAIL || process.env.GMAIL_USER;
  }
  return `"October Communications" <${process.env.GMAIL_USER}>`;
}

function logoAttachment() {
  return {
    filename: 'october-logo.gif',
    path: LOGO_GIF_PATH,
    cid: LOGO_CID,
    contentDisposition: 'inline',
  };
}

async function sendMonthlyReport({ to, clientName, period, summaryHtml, pdfPath, metrics, sections }) {
  const subject = `${clientName} Monthly Report — ${period}`;
  const html = sections && sections.length
    ? buildFullReportEmailHtml({ clientName, period, sections, periodLabel: period })
    : buildMonthlyEmailHtml({ clientName, period, summaryHtml, metrics });

  const attachments = [logoAttachment()];
  if (pdfPath) {
    attachments.push({
      filename: `${clientName.replace(/\s+/g, '-')}-Monthly-Report-${period}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf',
    });
  }

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    attachments,
  });
}

async function sendWeeklyReport({ to, clientName, weekLabel, summaryText, metrics, pdfPath, sections }) {
  const subject = `${clientName} Weekly Snapshot — w/c ${weekLabel}`;
  const html = sections && sections.length
    ? buildFullReportEmailHtml({ clientName, period: `w/c ${weekLabel}`, sections, periodLabel: `Weekly Snapshot — w/c ${weekLabel}` })
    : buildWeeklyEmailHtml({ clientName, weekLabel, summaryText, metrics });

  const attachments = [logoAttachment()];
  if (pdfPath) {
    attachments.push({
      filename: `${clientName.replace(/\s+/g, '-')}-Weekly-Snapshot-${weekLabel}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf',
    });
  }

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    attachments,
  });
}

async function sendMetaTokenAlert({ clientName, connectorType, reauthoriseUrl }) {
  const subject = `Action required: Meta token expired — ${clientName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #d32f2f;">Meta Token Expired</h2>
      <p>The Meta ${connectorType === 'instagram_insights' ? 'Instagram' : 'Ads'} token for <strong>${clientName}</strong> has expired.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Client</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${clientName}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Connector</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${connectorType}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Time</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${new Date().toUTCString()}</td>
        </tr>
      </table>
      <p>
        <a href="${reauthoriseUrl}" style="display: inline-block; background: #1877F2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Reauthorise Meta Connection
        </a>
      </p>
      <p style="color: #666; font-size: 12px;">October Marketing Intelligence</p>
    </div>
  `;

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: process.env.ALERT_EMAIL,
    subject,
    html,
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]));
}

// Mirrors pdfService.renderResolvedSection — same section types, same data
// shapes, but with email-safe inline-styled HTML (tables instead of flexbox,
// no @page rules). The email then shows the same content the PDF does.
function renderEmailSection(s) {
  if (!s) return '';
  const title = s.title ? `<div style="font-size:14px;font-weight:700;color:#000;margin:0 0 6px;">${escapeHtml(s.title)}</div>` : '';
  const insight = s.insight
    ? `<div style="font-size:12px;color:#555;font-style:italic;line-height:1.5;margin:0 0 10px;padding:6px 10px;border-left:3px solid #E7CD41;background:#fffdf5;">${escapeHtml(s.insight)}</div>`
    : '';
  const wrap = (inner) => `<div style="margin:0 0 22px;">${title}${insight}${inner}</div>`;

  switch (s.type) {
    case 'narrative': {
      const paragraphs = (s.text || '').split('\n').filter(p => p.trim())
        .map(p => `<p style="margin:0 0 10px;font-size:13px;color:#333;line-height:1.7;">${escapeHtml(p)}</p>`).join('');
      return wrap(paragraphs);
    }
    case 'metrics_grid': {
      if (s.layout === 'table' && s.rows?.length) {
        return wrap(buildMetricsTableEmail(s.metricLabels || [], s.rows, s.compare));
      }
      const cells = s.cells || [];
      if (!cells.length) return '';
      // Chunk at 4 per row — same as PDF; in email we use a table for layout
      const PER_ROW = 4;
      const rows = [];
      for (let i = 0; i < cells.length; i += PER_ROW) rows.push(cells.slice(i, i + PER_ROW));
      const rowsHtml = rows.map(row => {
        const padCount = PER_ROW - row.length;
        const tds = row.map(c => {
          const deltaColour = c.deltaDirection === 'up' ? '#2e7d32' : c.deltaDirection === 'down' ? '#c62828' : '#808080';
          const arrow = c.deltaDirection === 'up' ? '↑' : c.deltaDirection === 'down' ? '↓' : '';
          const deltaHtml = c.delta
            ? `<div style="font-size:11px;color:${deltaColour};font-weight:600;margin-top:4px;">${arrow} ${escapeHtml(c.delta)}</div>`
            : '';
          const prevHtml = c.previous
            ? `<div style="font-size:10px;color:#808080;margin-top:2px;">vs ${escapeHtml(c.previous)}</div>`
            : '';
          return `
          <td width="${Math.floor(100 / PER_ROW)}%" style="padding:10px 12px;border:1px solid #000;vertical-align:top;">
            <div style="font-size:18px;font-weight:700;color:#000;line-height:1.2;">${escapeHtml(c.value)}</div>
            <div style="font-size:9px;color:#808080;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">${escapeHtml(c.label)}</div>
            ${deltaHtml}${prevHtml}
          </td>`;
        }).join('');
        const padding = padCount > 0
          ? Array(padCount).fill(`<td style="border:1px solid #000;background:#fafafa;"></td>`).join('')
          : '';
        return `<tr>${tds}${padding}</tr>`;
      }).join('');
      return wrap(`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:6px;">${rowsHtml}</table>`);
    }
    case 'tables': {
      if (!s.tables || !s.tables.length) return '';
      return wrap(s.tables.map(t => buildTableEmail(t)).join(''));
    }
    case 'bar_chart': {
      if (!s.chart) return '';
      return wrap(buildChartEmail(s.chart));
    }
    case 'position_distribution': {
      const rankings = (s.rankings || []).filter(k => k.current_position);
      if (!rankings.length) return '';
      return wrap(buildPositionDistributionEmail(rankings));
    }
    case 'error':
      return wrap(`<div style="background:#fff8e1;border:1px solid #e0c000;padding:10px 12px;font-size:12px;color:#5d4000;">${escapeHtml(s.message || 'Section failed to render.')}</div>`);
    default:
      return '';
  }
}

function buildTableEmail({ heading, headers = [], rows = [], highlightFirst = false }) {
  if (!rows.length) return '';
  const head = headers.length
    ? `<thead><tr>${headers.map(h => `<th style="background:#d9d9d9;font-size:11px;text-align:left;font-weight:700;padding:6px 8px;border:1px solid #000;">${escapeHtml(h)}</th>`).join('')}</tr></thead>`
    : '';
  const body = rows.map((row, i) => {
    const bg = highlightFirst && i === 0 ? 'background:#fff2cc;font-weight:700;' : (i % 2 === 1 ? 'background:#f7f7f7;' : '');
    return `<tr style="${bg}">${row.map(c => `<td style="padding:5px 8px;border:1px solid #000;font-size:12px;color:#1a1a1a;${bg}">${c == null ? '' : escapeHtml(c)}</td>`).join('')}</tr>`;
  }).join('');
  const headingHtml = heading ? `<div style="font-size:11px;font-weight:700;margin:12px 0 5px;color:#000;">${escapeHtml(heading)}</div>` : '';
  return `${headingHtml}<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px;">${head}<tbody>${body}</tbody></table>`;
}

function buildMetricsTableEmail(metricLabels, rows, compare) {
  const cellHtml = (v) => {
    if (v == null) return '<td style="padding:5px 8px;border:0.5px solid #eee;text-align:right;font-size:12px;">—</td>';
    if (typeof v === 'string' || typeof v === 'number') return `<td style="padding:5px 8px;border:0.5px solid #eee;text-align:right;font-size:12px;">${escapeHtml(v)}</td>`;
    const deltaColour = v.deltaDirection === 'up' ? '#2e7d32' : v.deltaDirection === 'down' ? '#c62828' : '#808080';
    const arrow = v.deltaDirection === 'up' ? '↑' : v.deltaDirection === 'down' ? '↓' : '';
    const deltaHtml = v.delta ? `<span style="color:${deltaColour};font-weight:600;">${arrow} ${escapeHtml(v.delta)}</span>` : '';
    const prevHtml = v.previous
      ? `<div style="font-size:10px;color:#808080;margin-top:2px;">vs ${escapeHtml(v.previous)} ${deltaHtml}</div>`
      : '';
    return `<td style="padding:5px 8px;border:0.5px solid #eee;text-align:right;font-size:12px;"><div>${escapeHtml(v.current)}</div>${prevHtml}</td>`;
  };
  const head = `<thead><tr><th style="background:#f3f3f3;font-weight:700;padding:6px 8px;border:0.5px solid #ccc;font-size:11px;text-align:left;"></th>${metricLabels.map(l => `<th style="background:#f3f3f3;font-weight:700;padding:6px 8px;border:0.5px solid #ccc;font-size:11px;text-align:right;">${escapeHtml(l)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((r, i) => `<tr style="${i % 2 === 1 ? 'background:#f7f7f7;' : ''}">
    <td style="padding:5px 8px;border:0.5px solid #eee;font-weight:700;font-size:12px;">${escapeHtml(r.source)}</td>
    ${(r.values || []).map(cellHtml).join('')}
  </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px;">${head}<tbody>${body}</tbody></table>`;
}

// Inline SVG horizontal bar chart — same renderer as the PDF. Modern email
// clients (Gmail web/iOS/Android, Apple Mail, Outlook.com) render inline SVG.
// Outlook desktop (Word engine) does not — those readers see alt text only.
function buildChartEmail(chart) {
  if (chart.type !== 'hbar' || !chart.data?.length) return '';
  const total = chart.data.reduce((s, d) => s + (d.value || 0), 0);
  const max = Math.max(...chart.data.map(d => d.value || 0));
  if (max <= 0) return '';
  const width = 560;
  const rowHeight = 22;
  const labelWidth = 160;
  const valueWidth = 130;
  const barAreaWidth = width - labelWidth - valueWidth - 8;
  const height = chart.data.length * rowHeight + 8;
  const valueX = labelWidth + barAreaWidth + 6;
  const bars = chart.data.map((d, i) => {
    const y = i * rowHeight + 4;
    const bw = (d.value / max) * barAreaWidth;
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0';
    return `
      <text x="0" y="${y + 13}" font-size="10" fill="#1a1a1a">${escapeHtml(d.label)}</text>
      <rect x="${labelWidth}" y="${y + 3}" width="${bw}" height="${rowHeight - 8}" fill="#E7CD41" />
      <text x="${valueX}" y="${y + 13}" font-size="10" fill="#1a1a1a">${d.value.toLocaleString()} (${pct}%)</text>`;
  }).join('');

  // Text-only fallback in a hidden table for clients that strip SVG. We use
  // mso-hide:all so Outlook ignores the SVG and shows the table instead.
  const fallbackRows = chart.data.map(d => {
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0';
    return `<tr><td style="padding:4px 8px;border:1px solid #000;font-size:11px;">${escapeHtml(d.label)}</td><td style="padding:4px 8px;border:1px solid #000;font-size:11px;text-align:right;">${d.value.toLocaleString()} (${pct}%)</td></tr>`;
  }).join('');

  return `
    <!--[if !mso]><!-->
    <div style="margin:0 0 6px;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;display:block;">
        ${bars}
      </svg>
    </div>
    <!--<![endif]-->
    <!--[if mso]>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:6px;">${fallbackRows}</table>
    <![endif]-->`;
}

function buildPositionDistributionEmail(rankings) {
  const buckets = [
    { label: 'Top 3', min: 1, max: 3 },
    { label: '4 — 10', min: 4, max: 10 },
    { label: '11 — 20', min: 11, max: 20 },
    { label: '21 — 50', min: 21, max: 50 },
    { label: '51 — 100', min: 51, max: 100 },
    { label: '100+', min: 101, max: Infinity },
  ];
  const counts = buckets.map(b => rankings.filter(k => {
    const p = parseInt(k.current_position);
    return p >= b.min && p <= b.max;
  }).length);
  const cells = buckets.map((b, i) => `
    <td width="${Math.floor(100 / buckets.length)}%" style="padding:8px 6px;border:1px solid #000;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#000;line-height:1.2;">${counts[i]}</div>
      <div style="font-size:9px;color:#808080;text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">${b.label}</div>
    </td>`).join('');
  return `
    <div style="font-size:11px;font-weight:700;margin:0 0 6px;color:#000;">Positions in Search Results</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px;">
      <tr>${cells}</tr>
    </table>`;
}

// Full-report email body — header, every resolved section, footer. Used when
// the report path supplies `sections`; falls back to the legacy summary-only
// builders if not.
function buildFullReportEmailHtml({ clientName, period, periodLabel, sections }) {
  const sectionsHtml = sections.map(renderEmailSection).filter(Boolean).join('');
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;">
  <tr>
    <td style="padding:24px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:white;max-width:680px;margin:0 auto;">

        <tr>
          <td style="padding:28px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:bottom;width:120px;">
                  <img src="cid:${LOGO_CID}" height="55" alt="October" style="display:block;">
                </td>
                <td style="vertical-align:bottom;text-align:right;">
                  <div style="font-size:15px;font-weight:700;color:#000;">Report for ${escapeHtml(clientName)}</div>
                  <div style="font-size:13px;color:#808080;margin-top:2px;">${escapeHtml(periodLabel || period)}</div>
                </td>
              </tr>
            </table>
            <div style="border-top:1px solid #000;margin:12px 0 18px;"></div>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 8px;">
            ${sectionsHtml}
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 20px;">
            <div style="border-top:1px solid #e0e0e0;padding-top:14px;font-size:12px;color:#808080;">
              The full report is also attached as a PDF.
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 32px;border-top:1px solid #e0e0e0;">
            <div style="font-size:10px;color:#808080;">Private &amp; Confidential. October Communications Ltd. Company No. 8816416. VAT Registration No. GB 176 6335 82. Registered in England and Wales. Registered address: 85 Great Portland Street, First Floor, London, W1W 7LT. www.octobercomms.com</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildMonthlyEmailHtml({ clientName, period, summaryHtml, metrics = [] }) {
  const metricRows = metrics.slice(0, 8).map((m, i) => `
    <tr style="${i === 0 ? 'background:#fff2cc;' : i % 2 === 1 ? 'background:#f7f7f7;' : ''}">
      <td style="padding:6px 10px;border:1px solid #000;font-size:13px;color:#666;">${m.label}</td>
      <td style="padding:6px 10px;border:1px solid #000;font-size:${i === 0 ? '16px' : '13px'};font-weight:${i === 0 ? '700' : '400'};text-align:right;">${m.value}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;">
  <tr>
    <td style="padding:24px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:white;">

        <!-- Header: logo left, client right -->
        <tr>
          <td style="padding:28px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:bottom;width:120px;">
                  <img src="cid:${LOGO_CID}" height="55" alt="October" style="display:block;">
                </td>
                <td style="vertical-align:bottom;text-align:right;">
                  <div style="font-size:15px;font-weight:700;color:#000;">Report for ${clientName}</div>
                  <div style="font-size:13px;color:#808080;margin-top:2px;">${period}</div>
                </td>
              </tr>
            </table>
            <div style="border-top:1px solid #000;margin:12px 0 0;"></div>
          </td>
        </tr>

        <!-- Summary -->
        <tr>
          <td style="padding:20px 32px 16px;">
            <div style="font-size:13px;font-weight:700;color:#000;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">Executive Summary</div>
            <div style="font-size:13px;color:#333;line-height:1.7;">${summaryHtml}</div>
          </td>
        </tr>

        <!-- Metrics table -->
        ${metrics.length ? `
        <tr>
          <td style="padding:0 32px 20px;">
            <div style="font-size:13px;font-weight:700;color:#000;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Key Metrics</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <th style="padding:6px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:left;font-weight:700;">Metric</th>
                <th style="padding:6px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:right;font-weight:700;">Value</th>
              </tr>
              ${metricRows}
            </table>
          </td>
        </tr>` : ''}

        <!-- PDF note -->
        <tr>
          <td style="padding:0 32px 20px;">
            <div style="border-top:1px solid #e0e0e0;padding-top:14px;font-size:12px;color:#808080;">
              The full report is attached as a PDF.
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:14px 32px;border-top:1px solid #e0e0e0;">
            <div style="font-size:10px;color:#808080;">Private &amp; Confidential. October Communications Ltd. Company No. 8816416. VAT Registration No. GB 176 6335 82. Registered in England and Wales. Registered address: 85 Great Portland Street, First Floor, London, W1W 7LT. www.octobercomms.com</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function buildWeeklyEmailHtml({ clientName, weekLabel, summaryText, metrics = [] }) {
  const metricRows = metrics.slice(0, 8).map((m, i) => `
    <tr style="${i === 0 ? 'background:#fff2cc;' : i % 2 === 1 ? 'background:#f7f7f7;' : ''}">
      <td style="padding:6px 10px;border:1px solid #000;font-size:13px;color:#333;">${m.label}</td>
      <td style="padding:6px 10px;border:1px solid #000;font-size:${i === 0 ? '16px' : '13px'};font-weight:${i === 0 ? '700' : '400'};text-align:right;">${m.value}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;">
  <tr>
    <td style="padding:24px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:white;">

        <!-- Header -->
        <tr>
          <td style="padding:28px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:bottom;width:120px;">
                  <img src="cid:${LOGO_CID}" height="55" alt="October" style="display:block;">
                </td>
                <td style="vertical-align:bottom;text-align:right;">
                  <div style="font-size:15px;font-weight:700;color:#000;">${clientName} — Weekly Snapshot</div>
                  <div style="font-size:13px;color:#808080;margin-top:2px;">w/c ${weekLabel}</div>
                </td>
              </tr>
            </table>
            <div style="border-top:1px solid #000;margin:12px 0 0;"></div>
          </td>
        </tr>

        <!-- Summary -->
        <tr>
          <td style="padding:20px 32px ${metrics.length ? '16px' : '20px'};">
            <div style="font-size:13px;color:#333;line-height:1.7;">${summaryText.split('\n').filter(p => p.trim()).map(p => `<p style="margin:0 0 10px;">${p}</p>`).join('')}</div>
          </td>
        </tr>

        <!-- Metrics -->
        ${metrics.length ? `
        <tr>
          <td style="padding:0 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <th style="padding:6px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:left;font-weight:700;">Metric</th>
                <th style="padding:6px 10px;border:1px solid #000;background:#d9d9d9;font-size:11px;text-align:right;font-weight:700;">This Week</th>
              </tr>
              ${metricRows}
            </table>
          </td>
        </tr>` : ''}

        <!-- Footer -->
        <tr>
          <td style="padding:14px 32px;border-top:1px solid #e0e0e0;">
            <div style="font-size:10px;color:#808080;">Private &amp; Confidential. October Communications Ltd. Company No. 8816416. VAT Registration No. GB 176 6335 82. Registered in England and Wales. www.octobercomms.com</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

async function sendConnectorHealthAlert(issues) {
  if (!process.env.ALERT_EMAIL) return;

  const rows = issues.map(i => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">${i.clientName}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">${i.connectorType}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; color: #c62828; font-weight: 600;">${i.status}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; color: #666; font-size: 12px;">${i.errorMessage || '—'}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1a1a1a;">Connector Health Alert</h2>
      <p style="color: #666;">${issues.length} connector${issues.length !== 1 ? 's' : ''} need attention.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666; text-transform: uppercase;">Client</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666; text-transform: uppercase;">Connector</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666; text-transform: uppercase;">Status</th>
            <th style="text-align: left; padding: 8px 12px; font-size: 12px; color: #666; text-transform: uppercase;">Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top: 24px; color: #666; font-size: 13px;">
        Log in to the platform to reauthorise any expired connectors.
      </p>
      <p style="color: #aaa; font-size: 11px; margin-top: 32px;">October Marketing Intelligence — daily health check</p>
    </div>`;

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: process.env.ALERT_EMAIL,
    subject: `Platform alert: ${issues.length} connector${issues.length !== 1 ? 's' : ''} need attention`,
    html,
  });
}

async function sendReportReminderEmail(client) {
  if (!process.env.ALERT_EMAIL) return;

  const schedule = client.report_schedule || {};
  const monthlyDay = schedule.monthly_day || 1;
  const now = new Date();
  // Next report date: if today is before monthly_day this month, use this month; else next month
  let reportDate = new Date(now.getFullYear(), now.getMonth(), monthlyDay);
  if (reportDate <= now) {
    reportDate = new Date(now.getFullYear(), now.getMonth() + 1, monthlyDay);
  }
  const dateStr = reportDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const subject = `Reminder: ${client.name} monthly report due in 48 hours`;
  const text = `The monthly report for ${client.name} is scheduled to run on ${dateStr}.\n\nPlease log in to update any manual SEO metrics before the report runs: https://platform.octobercomms.com/clients/${client.id}/seo\n\nOctober Marketing Intelligence`;

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: process.env.ALERT_EMAIL,
    subject,
    text,
  });
}

async function sendWaitlistSignup(email) {
  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: 'octobercomms@gmail.com',
    subject: `New waitlist signup: ${email}`,
    text: `${email} joined the October Marketing Intelligence waitlist on ${new Date().toUTCString()}.`,
    html: `<p><strong>${email}</strong> joined the October Marketing Intelligence waitlist.</p><p style="color:#888">${new Date().toUTCString()}</p>`,
  });
}

module.exports = { sendMonthlyReport, sendWeeklyReport, sendMetaTokenAlert, sendConnectorHealthAlert, sendReportReminderEmail, sendWaitlistSignup };
