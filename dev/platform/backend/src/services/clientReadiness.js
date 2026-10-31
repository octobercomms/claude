// Per-client setup readiness — one place that checks what's configured vs.
// still needed for the platform's features to light up (brand kit, connectors,
// competitors, Clarity, the DM bot, report recipients). Read-only: it just
// inspects existing rows and returns a checklist the Setup overview renders,
// each item linking to where it's fixed.

const pool = require('../db');
const { recipientsFor } = require('./reportService');

// link encodes where in the app the item is fixed, relative to the client.
const item = (id, area, label, ok, detail, link) => ({ id, area, label, status: ok ? 'ok' : 'todo', detail, link });

async function getReadiness(clientId) {
  const [{ rows: cr }, { rows: assets }, { rows: conn }, { rows: clarity }, { rows: dm }] = await Promise.all([
    pool.query('SELECT briefing_field, domain, social_competitors, report_recipients FROM clients WHERE id = $1', [clientId]),
    pool.query(`SELECT kind, COUNT(*)::int AS n,
                       COUNT(*) FILTER (WHERE kind = 'font' AND metadata->>'role' IS NOT NULL AND metadata->>'role' <> '')::int AS fonts_with_role
                  FROM brand_assets WHERE client_id = $1 GROUP BY kind`, [clientId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM connectors WHERE client_id = $1 AND status = 'active'`, [clientId]),
    pool.query('SELECT 1 FROM client_clarity WHERE client_id = $1', [clientId]),
    pool.query('SELECT persona, enabled FROM social_dm_bot WHERE client_id = $1', [clientId]),
  ]);
  if (!cr.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  const c = cr[0];
  const byKind = Object.fromEntries(assets.map(a => [a.kind, a]));
  const fontRow = byKind.font;
  // Per report type, through the same reader the scheduler and sendReport use.
  // Summing the two lists (the old check) marked a client "ok" when it had
  // monthly recipients and no weekly ones — while every weekly report it
  // generated was still being binned, which is the state this item exists to
  // catch. Weekly is the one that matters most: runScheduledReports defaults
  // weekly_day to Monday, so an active client is due one whether or not
  // anybody chose that.
  const weeklyTo = recipientsFor(c.report_recipients, 'weekly');
  const monthlyTo = recipientsFor(c.report_recipients, 'monthly');
  const hasRecipients = weeklyTo.length > 0;
  const persona = dm[0]?.persona || {};

  const checks = [
    item('brief', 'Brief', 'Client brief written', !!(c.briefing_field && c.briefing_field.trim()),
      'Powers on-brand generation across Social, Ads, SEO and the DM bot.', '/dashboard/setup'),
    item('domain', 'Brief', 'Website domain set', !!(c.domain && c.domain.trim()),
      'Needed for SEO lookups and competitor analysis.', '/dashboard/setup'),
    item('connectors', 'Data', 'A data connector is active', (conn[0]?.n || 0) > 0,
      'Connect GA4 / Shopify / Meta / Search Console so dashboards and reports pull live data.', '/dashboard/connectors'),
    item('logo', 'Brand kit', 'Logo uploaded', (byKind.logo?.n || 0) > 0,
      'Used as overlay/watermark reference in generated creative.', '/brand'),
    item('palette', 'Brand kit', 'Colour palette added', (byKind.palette?.n || 0) > 0,
      'Brand colours drive image generation and video caption styling.', '/brand'),
    item('font_roles', 'Brand kit', 'Brand fonts have usage roles',
      !!(fontRow && fontRow.fonts_with_role > 0),
      fontRow ? 'Set each font\'s role (headings / body) so Video & creative apply typography deterministically.'
              : 'Upload the brand fonts and tag their roles for deterministic video/creative typography.', '/brand'),
    item('competitors', 'Social', 'Social competitors configured', !!(c.social_competitors && c.social_competitors.length),
      'Feeds the weekly scrape, the AI Social Audit and the GBP/AI-SEO competitor analyses.', '/social/compare'),
    item('clarity', 'CRO', 'Microsoft Clarity connected', clarity.length > 0,
      'Connect Clarity to get the AI funnel-leak scan.', '/convert/optimise'),
    item('dm_persona', 'DM bot', 'DM bot persona configured', !!(persona.system_prompt || persona.faqs),
      'Set the persona so the Instagram DM autoresponder speaks for the brand.', '/social/swipe?drawer=dm-bot'),
    item('recipients', 'Reports', 'Weekly report recipients set', hasRecipients,
      hasRecipients
        ? `Weekly reports go to ${weeklyTo.length} recipient${weeklyTo.length === 1 ? '' : 's'}${monthlyTo.length ? `; monthly to ${monthlyTo.length}` : '; no monthly recipients'}.`
        : 'Weekly reports run every Monday by default. With no recipients the scheduler records them as not sent and skips generating them, so this client receives nothing.',
      '/dashboard/setup'),
  ];

  const done = checks.filter(c => c.status === 'ok').length;
  return { score: { done, total: checks.length }, checks };
}

module.exports = { getReadiness };
