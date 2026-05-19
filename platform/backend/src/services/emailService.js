const nodemailer = require('nodemailer');
const path = require('path');

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

async function sendMonthlyReport({ to, clientName, period, summaryHtml, pdfPath, metrics }) {
  const subject = `${clientName} Monthly Report — ${period}`;
  const html = buildMonthlyEmailHtml({ clientName, period, summaryHtml, metrics });

  const mailOptions = {
    from: getSenderAddress(),
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
    attachments: pdfPath ? [{
      filename: `${clientName.replace(/\s+/g, '-')}-Monthly-Report-${period}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf',
    }] : [],
  };

  return getTransporter().sendMail(mailOptions);
}

async function sendWeeklyReport({ to, clientName, weekLabel, summaryText, metrics }) {
  const subject = `${clientName} Weekly Snapshot — w/c ${weekLabel}`;
  const html = buildWeeklyEmailHtml({ clientName, weekLabel, summaryText, metrics });

  const mailOptions = {
    from: getSenderAddress(),
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html,
  };

  return getTransporter().sendMail(mailOptions);
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
  const metricTiles = metrics.slice(0, 6).map(m => `
    <td style="width: 33%; padding: 16px; text-align: center; border: 1px solid #e0e0e0; border-radius: 4px;">
      <div style="font-size: 24px; font-weight: bold; color: #1a1a1a;">${m.value}</div>
      <div style="font-size: 12px; color: #666; margin-top: 4px;">${m.label}</div>
      ${m.change ? `<div style="font-size: 12px; color: ${m.change > 0 ? '#2e7d32' : '#c62828'}; margin-top: 2px;">${m.change > 0 ? '↑' : '↓'} ${Math.abs(m.change)}%</div>` : ''}
    </td>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: #1a1a1a; padding: 32px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">OCTOBER COMMUNICATIONS</h1>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td style="padding: 32px; border-bottom: 2px solid #f0f0f0;">
              <h2 style="margin: 0; color: #1a1a1a; font-size: 20px;">${clientName}</h2>
              <p style="margin: 8px 0 0; color: #666;">Monthly Performance Report — ${period}</p>
            </td>
          </tr>
          <!-- Summary -->
          <tr>
            <td style="padding: 24px 32px; border-bottom: 1px solid #f0f0f0;">
              <div style="color: #333; line-height: 1.6;">${summaryHtml}</div>
            </td>
          </tr>
          <!-- Metrics -->
          ${metrics.length ? `
          <tr>
            <td style="padding: 24px 32px; border-bottom: 1px solid #f0f0f0;">
              <h3 style="margin: 0 0 16px; color: #1a1a1a; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Key Metrics</h3>
              <table width="100%" cellpadding="8" cellspacing="4">
                <tr>${metricTiles}</tr>
              </table>
            </td>
          </tr>
          ` : ''}
          <!-- Footer -->
          <tr>
            <td style="background: #f9f9f9; padding: 20px 32px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">Full report attached as PDF</p>
              <p style="margin: 8px 0 0; color: #999; font-size: 12px;">© October Communications</p>
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
  const metricTiles = metrics.slice(0, 8).map(m => `
    <tr>
      <td style="padding: 10px 16px; border-bottom: 1px solid #f0f0f0;">
        <span style="color: #666; font-size: 13px;">${m.label}</span>
      </td>
      <td style="padding: 10px 16px; border-bottom: 1px solid #f0f0f0; text-align: right;">
        <strong style="color: #1a1a1a;">${m.value}</strong>
        ${m.change !== undefined ? `<span style="margin-left: 8px; font-size: 12px; color: ${m.change > 0 ? '#2e7d32' : '#c62828'};">${m.change > 0 ? '↑' : '↓'} ${Math.abs(m.change)}% WoW</span>` : ''}
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="background: #1a1a1a; padding: 24px 32px;">
              <h1 style="color: white; margin: 0; font-size: 18px; letter-spacing: 2px;">OCTOBER COMMUNICATIONS</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px; border-bottom: 1px solid #f0f0f0;">
              <h2 style="margin: 0; color: #1a1a1a;">${clientName} — Weekly Snapshot</h2>
              <p style="margin: 6px 0 0; color: #666; font-size: 14px;">w/c ${weekLabel}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; border-bottom: 1px solid #f0f0f0;">
              <p style="margin: 0; color: #333; line-height: 1.7;">${summaryText}</p>
            </td>
          </tr>
          ${metrics.length ? `
          <tr>
            <td style="padding: 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${metricTiles}
              </table>
            </td>
          </tr>
          ` : ''}
          <tr>
            <td style="background: #f9f9f9; padding: 16px 32px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">© October Communications</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { sendMonthlyReport, sendWeeklyReport, sendMetaTokenAlert };
