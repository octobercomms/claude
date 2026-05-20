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

async function sendMonthlyReport({ to, clientName, period, summaryHtml, pdfPath, metrics }) {
  const subject = `${clientName} Monthly Report — ${period}`;
  const html = buildMonthlyEmailHtml({ clientName, period, summaryHtml, metrics });

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

async function sendWeeklyReport({ to, clientName, weekLabel, summaryText, metrics, pdfPath }) {
  const subject = `${clientName} Weekly Snapshot — w/c ${weekLabel}`;
  const html = buildWeeklyEmailHtml({ clientName, weekLabel, summaryText, metrics });

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
      <p style="color: #666; font-size: 12px;">October Performance Marketing Platform</p>
    </div>
  `;

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: process.env.ALERT_EMAIL,
    subject,
    html,
  });
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
      <p style="color: #aaa; font-size: 11px; margin-top: 32px;">October Performance Marketing Platform — daily health check</p>
    </div>`;

  return getTransporter().sendMail({
    from: getSenderAddress(),
    to: process.env.ALERT_EMAIL,
    subject: `Platform alert: ${issues.length} connector${issues.length !== 1 ? 's' : ''} need attention`,
    html,
  });
}

module.exports = { sendMonthlyReport, sendWeeklyReport, sendMetaTokenAlert, sendConnectorHealthAlert };
