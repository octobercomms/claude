const express = require('express');
const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const { loadVisibleClientIds, requireClientAccess } = require('../middleware/clientAccess');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const clarity = require('../services/clarity');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
router.use(authenticate);
router.use(loadVisibleClientIds);
// All chat endpoints take :clientId as the first URL segment; the param
// middleware blocks viewers from peeking at another tenant's chat history
// or pushing messages into one.
router.use(requireClientAccess({ paramNames: ['clientId'] }));

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 6;

function getClaude() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_client_info',
    description: 'Get full client details: all connectors with their status, config, last sync, errors. Use this to understand what data sources are available and whether any have issues.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_connector_data',
    description: 'Fetch data from a specific connector for any time period — recent or historical. Use this to investigate performance, check metrics, answer questions about a channel, and make year-on-year or period-over-period comparisons.',
    input_schema: {
      type: 'object',
      properties: {
        connector_type: { type: 'string', description: 'e.g. ga4, google_ads, shopify, meta_ads, google_search_console, woocommerce, klaviyo, brevo' },
        days: { type: 'number', description: 'Number of days back from today to fetch (default 30) — for a recent window.' },
        start_date: { type: 'string', description: 'Start of an explicit period, YYYY-MM-DD. Use start_date and end_date together for historical periods or comparisons (e.g. last year, a specific quarter).' },
        end_date: { type: 'string', description: 'End of an explicit period, YYYY-MM-DD.' },
        store_label: { type: 'string', description: 'For multi-store clients (e.g. DTC, B2B). Omit to use first matching connector.' },
      },
      required: ['connector_type'],
    },
  },
  {
    name: 'get_seo_rankings',
    description: 'Get current SEO keyword rankings with position history (current, 7d ago, 30d ago, best ever). Shows improvements, declines, and top performers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_cro_findings',
    description: 'Get the latest Microsoft Clarity CRO / funnel analysis, grouped by connected site (a client may have several, e.g. "DTC" and "Trade"). Each site has a funnel-health summary plus prioritised on-page findings — page URL, the behaviour issue (citing the Clarity signal: rage clicks, dead clicks, excessive scroll, quick-backs, scroll depth, JS errors), the concrete fix, a severity (critical/high/medium), and whether the team marked it done. Use for any question about conversion, funnel leaks, on-page UX problems, or a specific page/product/site (e.g. "how are the sofa pages doing?" — match the URL; name the site when there are several). Returns available:false if no scan has been run yet.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_reports',
    description: 'List recent reports with status, period, generated/sent timestamps, and any errors.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max reports to return, default 10' },
      },
    },
  },
  {
    name: 'detect_anomalies',
    description: 'Compare this week\'s metrics vs last week across all connected sources. Flags significant changes: revenue drops, traffic spikes/drops, spend changes, ROAS shifts, connector errors.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_context_log',
    description: 'Read the persistent decisions and investigations log — confirmed decisions, open investigations, pending connections, standing observations.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'resolved', 'all'], description: 'Filter by status, default open' },
      },
    },
  },
  {
    name: 'add_context_entry',
    description: 'Add an entry to the context log. Use this to track: confirmed decisions (e.g. "exclude brand terms from GSC"), open investigations (e.g. "sessions dropped 40% w/c 5 May — investigating"), pending connections, or standing observations.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'investigation', 'pending', 'observation'] },
        content: { type: 'string', description: 'Clear, specific description of the entry' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'resolve_context_entry',
    description: 'Mark a context log entry as resolved — use when an investigation is closed or a pending item is done.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The entry UUID to resolve' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_report_sections',
    description: 'Read which sections are currently included in this client\'s weekly and monthly reports. Returns every available section (SEO plus each connected data source) with its weekly/monthly on-off state.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_report_section',
    description: 'Turn a report section on or off for the weekly and/or monthly report. Use when the account manager asks to add or remove a section from a report. The section key is "seo" or a connector type such as ga4, google_ads, shopify, meta_ads.',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Section key: "seo" or a connector type (ga4, google_ads, shopify, meta_ads, google_search_console, woocommerce, klaviyo, brevo, etc.)' },
        weekly: { type: 'boolean', description: 'true to include in the weekly report, false to exclude. Omit to leave unchanged.' },
        monthly: { type: 'boolean', description: 'true to include in the monthly report, false to exclude. Omit to leave unchanged.' },
      },
      required: ['section'],
    },
  },
];

// ── Tool implementations ───────────────────────────────────────────────────

async function toolGetClientInfo(clientId) {
  const [clientRes, connRes] = await Promise.all([
    pool.query('SELECT id, name, domain, monthly_focus, report_recipients, report_schedule FROM clients WHERE id = $1', [clientId]),
    pool.query('SELECT connector_type, store_label, status, last_checked, error_message, config FROM connectors WHERE client_id = $1 ORDER BY connector_type', [clientId]),
  ]);
  const client = clientRes.rows[0];
  return {
    name: client.name,
    domain: client.domain,
    monthly_focus: client.monthly_focus,
    report_recipients: client.report_recipients,
    report_schedule: client.report_schedule,
    connectors: connRes.rows.map(c => ({
      type: c.connector_type,
      store_label: c.store_label,
      status: c.status,
      last_checked: c.last_checked,
      error: c.error_message || null,
      config: c.config || null,
    })),
  };
}

async function toolGetConnectorData(clientId, { connector_type, days = 30, start_date, end_date, store_label }) {
  const whereClause = store_label
    ? 'client_id = $1 AND connector_type = $2 AND store_label = $3 AND status = \'active\''
    : 'client_id = $1 AND connector_type = $2 AND status = \'active\'';
  const params = store_label ? [clientId, connector_type, store_label] : [clientId, connector_type];

  const connRes = await pool.query(`SELECT * FROM connectors WHERE ${whereClause} LIMIT 1`, params);
  if (!connRes.rows.length) return { error: `No active ${connector_type} connector found${store_label ? ` with store_label "${store_label}"` : ''}` };

  const connector = connRes.rows[0];
  let creds;
  try { creds = decrypt(connector.credentials); } catch { return { error: 'Failed to decrypt credentials' }; }

  // Date range — an explicit start/end period, otherwise `days` back from today.
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  let periodStart, periodEnd;
  if (start_date && end_date && isoDate.test(start_date) && isoDate.test(end_date)) {
    periodStart = new Date(start_date);
    periodEnd = new Date(end_date);
  } else {
    const daysNum = Math.min(Math.max(Number(days) || 30, 1), 1095);
    periodEnd = new Date();
    periodStart = new Date(periodEnd.getTime() - daysNum * 86400000);
  }
  const fmt = d => d.toISOString().split('T')[0];
  const daysSpan = Math.max(1, Math.round((periodEnd - periodStart) / 86400000));

  const config = connector.config || {};
  const configValue = config.value;
  try {
    const connModule = connectorFactory.get(connector_type);
    const raw = await connModule.fetchData(creds, {
      ...config,
      connectorType: connector_type,
      authMode: connector.auth_mode,
      propertyId: configValue,
      siteUrl: configValue,
      customerId: configValue,
      merchantId: configValue,
      adAccountId: configValue,
      accountId: configValue,
      organizationId: configValue,
      startDate: fmt(periodStart),
      endDate: fmt(periodEnd),
      periodStart: fmt(periodStart),
      periodEnd: fmt(periodEnd),
    });
    return {
      store_label: connector.store_label || null,
      config_value: configValue || null,
      period: { start: fmt(periodStart), end: fmt(periodEnd) },
      ...summariseConnectorData(connector_type, raw, daysSpan),
    };
  } catch (err) {
    return { error: err.message };
  }
}

function summariseConnectorData(type, raw, days) {
  if (!raw) return { note: 'No data returned' };
  try {
    if (type === 'ga4') {
      const metHeaders = (raw.metricHeaders || []).map(h => h.name);
      const dimHeaders = (raw.dimensionHeaders || []).map(h => h.name);
      const drIdx = dimHeaders.indexOf('dateRange');
      const chIdx = dimHeaders.indexOf('sessionDefaultChannelGroup');
      const sessIdx = metHeaders.indexOf('sessions');
      const usersIdx = metHeaders.indexOf('activeUsers');
      const convIdx = metHeaders.indexOf('conversions');
      let sessions = 0, users = 0, convs = 0;
      const channels = {};
      for (const row of (raw.rows || [])) {
        if (drIdx >= 0 && row.dimensionValues?.[drIdx]?.value !== 'date_range_0') continue;
        sessions += parseFloat(row.metricValues?.[sessIdx]?.value || 0);
        users += parseFloat(row.metricValues?.[usersIdx]?.value || 0);
        convs += parseFloat(row.metricValues?.[convIdx]?.value || 0);
        const ch = chIdx >= 0 ? row.dimensionValues?.[chIdx]?.value : null;
        if (ch) channels[ch] = (channels[ch] || 0) + parseFloat(row.metricValues?.[sessIdx]?.value || 0);
      }
      const topChannels = Object.entries(channels).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([ch, s]) => ({ channel: ch, sessions: Math.round(s) }));
      const result = { period_days: days, sessions: Math.round(sessions), users: Math.round(users), conversions: Math.round(convs), top_channels: topChannels };
      if (raw.source_medium?.length) {
        result.top_sources = raw.source_medium.slice(0, 10).map(r => ({
          source: r.sessionSourceMedium,
          sessions: Math.round(r.sessions || 0),
          conversions: Math.round(r.conversions || 0),
          revenue: `£${(r.totalRevenue || 0).toFixed(2)}`,
        }));
      }
      if (raw.landing_pages?.length) {
        result.top_landing_pages = raw.landing_pages.slice(0, 10).map(r => ({
          page: r.landingPagePlusQueryString,
          sessions: Math.round(r.sessions || 0),
          conversions: Math.round(r.conversions || 0),
        }));
      }
      if (raw.events?.length) {
        result.top_events = raw.events.slice(0, 15).map(r => ({
          event: r.eventName,
          count: Math.round(r.eventCount || 0),
        }));
      }
      return result;
    }
    if (type === 'google_search_console') {
      // fetchSearchConsoleData returns { totals, topQueries, topPages } — the
      // undimensioned `totals` row is the period's true clicks/impressions.
      // (This previously read raw.rows, which no longer exists after the
      // connector was refactored, so every figure came back as zero.)
      const totals = raw.totals || {};
      const topQueries = raw.topQueries || [];
      const topPages = raw.topPages || [];
      const top = topQueries.slice(0, 10).map(r => ({
        query: r.keys?.[0],
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position?.toFixed(1),
      }));
      return {
        period_days: days,
        total_clicks: Math.round(totals.clicks || 0),
        total_impressions: Math.round(totals.impressions || 0),
        avg_ctr: totals.ctr != null ? `${(totals.ctr * 100).toFixed(2)}%` : null,
        avg_position: totals.position ? totals.position.toFixed(1) : null,
        top_queries: top,
        top_pages: topPages.slice(0, 10).map(r => ({ page: r.keys?.[0], clicks: r.clicks, impressions: r.impressions })),
      };
    }
    if (type === 'google_ads') {
      // /search returns {results:[...]}; /searchStream returned [{results:[...]},...]
      const results = raw.results || (Array.isArray(raw) ? raw.flatMap(b => b.results || []) : []);
      let spend = 0, clicks = 0, convs = 0, convValue = 0;
      const campaigns = {};
      for (const r of results) {
        const s = parseInt(r.metrics?.costMicros || 0) / 1e6;
        spend += s;
        clicks += parseInt(r.metrics?.clicks || 0);
        convs += parseFloat(r.metrics?.conversions || 0);
        convValue += parseFloat(r.metrics?.conversionsValue || 0);
        const name = r.campaign?.name;
        if (name) campaigns[name] = (campaigns[name] || 0) + s;
      }
      const topCampaigns = Object.entries(campaigns).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, s]) => ({ campaign: name, spend: `£${s.toFixed(2)}` }));
      const result = {
        period_days: days,
        total_spend: `£${spend.toFixed(2)}`,
        clicks,
        conversions: convs.toFixed(1),
        conversion_value: `£${convValue.toFixed(2)}`,
        roas: spend ? +(convValue / spend).toFixed(2) : null,
        top_campaigns: topCampaigns,
      };
      if (raw.keyword_view?.length) {
        result.top_keywords = raw.keyword_view.slice(0, 20).map(r => {
          const kSpend = parseInt(r.metrics?.costMicros || 0) / 1e6;
          return {
            keyword: r.adGroupCriterion?.keyword?.text,
            match_type: r.adGroupCriterion?.keyword?.matchType,
            campaign: r.campaign?.name,
            clicks: parseInt(r.metrics?.clicks || 0),
            spend: `£${kSpend.toFixed(2)}`,
            conversions: +parseFloat(r.metrics?.conversions || 0).toFixed(1),
            conversion_value: `£${parseFloat(r.metrics?.conversionsValue || 0).toFixed(2)}`,
          };
        });
      }
      return result;
    }
    if (type === 'google_merchant_center') {
      const perf = raw.performance || [];
      const clicks = perf.reduce((s, r) => s + parseInt(r.metrics?.clicks || 0), 0);
      const impressions = perf.reduce((s, r) => s + parseInt(r.metrics?.impressions || 0), 0);
      const avgCtr = impressions ? (clicks / impressions * 100).toFixed(2) : '0.00';
      const topProducts = (raw.top_products || []).slice(0, 10).map(r => ({
        title: r.segments?.title || r.segments?.offerId,
        clicks: r.metrics?.clicks,
        impressions: r.metrics?.impressions,
      }));
      return { period_days: days, total_clicks: clicks, total_impressions: impressions, avg_ctr: `${avgCtr}%`, top_products: topProducts };
    }
    if (type === 'meta_ads') {
      const data = raw.data || [];
      const PURCHASE = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];
      const sumAction = (arr, types) => (arr || []).filter(a => types.includes(a.action_type)).reduce((s, a) => s + parseFloat(a.value || 0), 0);
      const spend = data.reduce((s, r) => s + parseFloat(r.spend || 0), 0);
      const imps = data.reduce((s, r) => s + parseInt(r.impressions || 0), 0);
      const clicks = data.reduce((s, r) => s + parseInt(r.clicks || 0), 0);
      const purchases = data.reduce((s, r) => s + sumAction(r.actions, PURCHASE), 0);
      const revenue = data.reduce((s, r) => s + sumAction(r.action_values, PURCHASE), 0);
      const top = data.sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend)).slice(0, 6).map(r => {
        const cSpend = parseFloat(r.spend || 0);
        const cRev = sumAction(r.action_values, PURCHASE);
        return {
          campaign: r.campaign_name,
          spend: `£${cSpend.toFixed(2)}`,
          purchases: Math.round(sumAction(r.actions, PURCHASE)),
          revenue: `£${cRev.toFixed(2)}`,
          roas: cSpend ? +(cRev / cSpend).toFixed(2) : null,
        };
      });
      return {
        period_days: days,
        total_spend: `£${spend.toFixed(2)}`,
        impressions: imps,
        clicks,
        purchases: Math.round(purchases),
        conversion_value: `£${revenue.toFixed(2)}`,
        roas: spend ? +(revenue / spend).toFixed(2) : null,
        cost_per_purchase: purchases ? `£${(spend / purchases).toFixed(2)}` : null,
        top_campaigns: top,
      };
    }
    if (type === 'shopify' || type === 'woocommerce') {
      const s = raw.summary || {};
      const result = {
        period_days: days,
        revenue: `£${parseFloat(s.total_revenue || 0).toFixed(2)}`,
        orders: s.total_orders,
        aov: `£${parseFloat(s.avg_order_value || 0).toFixed(2)}`,
      };
      if (s.total_refunds != null) {
        result.refunds = `£${parseFloat(s.total_refunds).toFixed(2)}`;
        result.refunded_orders = s.refunded_orders;
        result.net_revenue = `£${parseFloat(s.net_revenue || 0).toFixed(2)}`;
      }
      if (raw.top_products?.length) {
        result.top_products = raw.top_products.slice(0, 10).map(p => ({
          title: p.title,
          units: p.units,
          revenue: `£${(p.revenue || 0).toFixed(2)}`,
        }));
      }
      return result;
    }
    if (type === 'shopify_email') {
      const events = raw.marketing_events || [];
      const reports = raw.reports || [];
      const emailEvents = events.filter(e => e.marketing_channel === 'email' || e.event_type === 'email');
      const result = {
        period_days: days,
        email_campaigns: emailEvents.length,
        marketing_events_total: events.length,
        reports_found: reports.length,
        campaigns: emailEvents.slice(0, 10).map(e => ({ name: e.event_type, subject: e.description, started_at: e.started_at, budget: e.budget })),
      };
      if (raw.fetch_errors) result.fetch_errors = raw.fetch_errors;
      return result;
    }
    if (type === 'zoho_inventory') {
      const items = raw.items || [];
      const orders = raw.orders || [];
      const revenue = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const lowStock = items.filter(i => (i.available_stock || 0) <= (i.reorder_level || 0) && i.available_stock != null);
      const topLow = lowStock.slice(0, 5).map(i => ({ name: i.name, sku: i.sku, available: i.available_stock, reorder_at: i.reorder_level }));
      const result = { period_days: days, orders: orders.length, revenue: `£${revenue.toFixed(2)}`, active_skus: items.length, low_stock_count: lowStock.length, low_stock_items: topLow };
      if (raw.fetch_errors) result.fetch_errors = raw.fetch_errors;
      return result;
    }
    if (type === 'cin7') {
      const stock = raw.stock || [];
      const orders = raw.orders || [];
      const revenue = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const outOfStock = stock.filter(s => (s.available || 0) <= 0);
      const topOut = outOfStock.slice(0, 5).map(s => ({ name: s.name || s.productName, sku: s.styleCode || s.sku, available: s.available }));
      return { period_days: days, orders: orders.length, revenue: `£${revenue.toFixed(2)}`, skus_tracked: stock.length, out_of_stock_count: outOfStock.length, out_of_stock_items: topOut };
    }
    if (type === 'brevo') {
      return {
        period_days: days,
        total_campaigns: raw.total_campaigns,
        campaigns: (raw.campaigns || []).slice(0, 25).map(c => ({
          name: c.name,
          subject: c.subject,
          sent_date: c.sent_date,
          statistics: c.statistics,
        })),
        aggregated_stats: raw.aggregated_stats,
        scope: raw.scope,
      };
    }
    if (type === 'klaviyo') {
      const perf = raw.performance || [];
      const result = {
        period_days: days,
        total_campaigns: raw.total_campaigns,
        campaigns: perf.length
          ? perf.slice(0, 25).map(p => ({ name: p.name, ...p.statistics }))
          : (raw.campaigns || []).slice(0, 25),
      };
      if (raw.note) result.note = raw.note;
      return result;
    }
    if (type === 'amazon_seller') {
      const payload = raw.payload || [];
      const t = payload[0] || {};
      const money = m => (m && m.amount != null) ? `${m.currencyCode || ''} ${parseFloat(m.amount).toFixed(2)}`.trim() : null;
      const result = {
        period_days: days,
        orders: t.orderCount ?? null,
        units: t.unitCount ?? null,
        revenue: money(t.totalSales),
        avg_unit_price: money(t.averageUnitPrice),
      };
      const daily = raw.daily || [];
      if (daily.length) {
        result.daily = daily.slice(-120).map(d => ({
          date: (d.interval || '').split('T')[0],
          orders: d.orderCount,
          units: d.unitCount,
          revenue: d.totalSales ? parseFloat(d.totalSales.amount || 0).toFixed(2) : '0.00',
        }));
        if (daily.length > 120) result.daily_note = `Showing most recent 120 of ${daily.length} days.`;
      }
      return result;
    }
    return { period_days: days, raw_keys: Object.keys(raw) };
  } catch (e) {
    return { period_days: days, parse_error: e.message, raw_type: typeof raw };
  }
}

async function toolGetSeoRankings(clientId) {
  const { rows } = await pool.query(
    `SELECT k.keyword, k.tag, k.location_name,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS current_position,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id AND checked_at <= CURRENT_DATE - 7 ORDER BY checked_at DESC LIMIT 1) AS position_7d_ago,
       (SELECT position FROM seo_rank_history WHERE keyword_id = k.id AND checked_at <= CURRENT_DATE - 30 ORDER BY checked_at DESC LIMIT 1) AS position_30d_ago,
       (SELECT MIN(position) FROM seo_rank_history WHERE keyword_id = k.id) AS best_position
     FROM seo_keywords k WHERE k.client_id = $1 AND k.active = true
     ORDER BY current_position ASC NULLS LAST`,
    [clientId]
  );
  const ranked = rows.filter(r => r.current_position);
  const top10 = ranked.slice(0, 10);
  const improved = ranked.filter(r => r.position_30d_ago && r.current_position < r.position_30d_ago)
    .sort((a, b) => (b.position_30d_ago - b.current_position) - (a.position_30d_ago - a.current_position)).slice(0, 5);
  const declined = ranked.filter(r => r.position_30d_ago && r.current_position > r.position_30d_ago)
    .sort((a, b) => (b.current_position - b.position_30d_ago) - (a.current_position - a.position_30d_ago)).slice(0, 5);
  return {
    total_tracked: rows.length,
    ranking: ranked.length,
    top_10: ranked.filter(r => r.current_position <= 10).length,
    top_3: ranked.filter(r => r.current_position <= 3).length,
    top_keywords: top10.map(r => ({ keyword: r.keyword, position: r.current_position, tag: r.tag })),
    most_improved_30d: improved.map(r => ({ keyword: r.keyword, now: r.current_position, was: r.position_30d_ago, change: r.position_30d_ago - r.current_position })),
    most_declined_30d: declined.map(r => ({ keyword: r.keyword, now: r.current_position, was: r.position_30d_ago, change: r.current_position - r.position_30d_ago })),
  };
}

async function toolGetCroFindings(clientId) {
  const reports = await clarity.latestReports(clientId);
  if (!reports.length) return { available: false, note: 'No Microsoft Clarity CRO scan has been run for this client yet (Sales & Traffic → CRO / Funnel).' };
  return {
    available: true,
    sites: reports.map(report => {
      const findings = Array.isArray(report.findings) ? report.findings : [];
      return {
        site: report.site_label || 'Main site',
        generated_at: report.generated_at,
        summary: report.summary,
        counts: {
          total: findings.length,
          critical: findings.filter(f => f.priority === 'critical').length,
          high: findings.filter(f => f.priority === 'high').length,
          medium: findings.filter(f => f.priority === 'medium').length,
          done: findings.filter(f => f.done).length,
        },
        findings: findings.map(f => ({ priority: f.priority, url: f.url, issue: f.issue, fix: f.fix, done: !!f.done })),
      };
    }),
  };
}

async function toolGetReports(clientId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT report_type, period_start, period_end, status, generated_at, sent_at, error_log
     FROM reports WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [clientId, Math.min(limit, 25)]
  );
  return rows.map(r => ({
    type: r.report_type,
    period: `${r.period_start?.toISOString().split('T')[0]} – ${r.period_end?.toISOString().split('T')[0]}`,
    status: r.status,
    generated_at: r.generated_at,
    sent_at: r.sent_at,
    error: r.error_log || null,
  }));
}

async function toolDetectAnomalies(clientId) {
  const connRes = await pool.query(
    `SELECT * FROM connectors WHERE client_id = $1 AND status = 'active'`,
    [clientId]
  );
  const anomalies = [];
  const now = new Date();
  const thisStart = new Date(now - 7 * 86400000);
  const prevStart = new Date(now - 14 * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  for (const connector of connRes.rows) {
    let creds;
    try { creds = decrypt(connector.credentials); } catch { continue; }
    const config = connector.config || {};
    try {
      const connModule = connectorFactory.get(connector.connector_type);
      const cv = config.value;
      const configMapped = { propertyId: cv, siteUrl: cv, customerId: cv, merchantId: cv, adAccountId: cv, accountId: cv, organizationId: cv };
      const [curr, prev] = await Promise.all([
        connModule.fetchData(creds, { ...config, ...configMapped, connectorType: connector.connector_type, authMode: connector.auth_mode, startDate: fmt(thisStart), endDate: fmt(now), periodStart: fmt(thisStart), periodEnd: fmt(now) }),
        connModule.fetchData(creds, { ...config, ...configMapped, connectorType: connector.connector_type, authMode: connector.auth_mode, startDate: fmt(prevStart), endDate: fmt(thisStart), periodStart: fmt(prevStart), periodEnd: fmt(thisStart) }),
      ]);
      const currSummary = summariseConnectorData(connector.connector_type, curr, 7);
      const prevSummary = summariseConnectorData(connector.connector_type, prev, 7);
      const label = connector.store_label ? `${connector.connector_type} (${connector.store_label})` : connector.connector_type;
      checkMetricAnomaly(anomalies, label, 'sessions', currSummary.sessions, prevSummary.sessions, 25);
      checkMetricAnomaly(anomalies, label, 'total_clicks', currSummary.total_clicks, prevSummary.total_clicks, 30);
      checkMetricAnomaly(anomalies, label, 'revenue', currSummary.revenue, prevSummary.revenue, 20, true);
      checkMetricAnomaly(anomalies, label, 'total_spend', currSummary.total_spend, prevSummary.total_spend, 40, true);
    } catch { /* connector might not support this period */ }
  }

  // Flag errored connectors
  const errored = await pool.query(
    `SELECT connector_type, store_label, error_message FROM connectors WHERE client_id = $1 AND status IN ('error','expired','disconnected')`,
    [clientId]
  );
  for (const c of errored.rows) {
    anomalies.push({ source: c.connector_type, type: 'connector_error', severity: 'high', message: `${c.connector_type}${c.store_label ? ` (${c.store_label})` : ''} is ${c.status}: ${c.error_message || 'no detail'}` });
  }

  return { anomalies, checked_at: new Date().toISOString(), total_flagged: anomalies.length };
}

function checkMetricAnomaly(anomalies, source, metric, curr, prev, thresholdPct, isCurrencyStr = false) {
  if (curr == null || prev == null) return;
  const parseVal = v => typeof v === 'string' ? parseFloat(v.replace(/[^0-9.-]/g, '')) : v;
  const c = parseVal(curr), p = parseVal(prev);
  if (!p || !c) return;
  const changePct = ((c - p) / p) * 100;
  if (Math.abs(changePct) >= thresholdPct) {
    anomalies.push({
      source,
      metric,
      current: curr,
      previous: prev,
      change_pct: changePct.toFixed(1),
      direction: changePct > 0 ? 'up' : 'down',
      severity: Math.abs(changePct) >= thresholdPct * 2 ? 'high' : 'medium',
    });
  }
}

async function toolGetContextLog(clientId, status = 'open') {
  // Parameterise so the status filter can never be a SQL-injection sink
  // — input comes from Claude tool args via the LLM, so it's not
  // trusted even if validated upstream.
  const normalized = ['resolved', 'open'].includes(status) ? status : null;
  const { rows } = await pool.query(
    `SELECT id, type, content, status, created_at, resolved_at
     FROM client_context_log
     WHERE client_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY created_at DESC`,
    [clientId, normalized]
  );
  return rows;
}

async function toolAddContextEntry(clientId, { type, content }) {
  const { rows } = await pool.query(
    `INSERT INTO client_context_log (client_id, type, content) VALUES ($1, $2, $3) RETURNING id, type, content, status, created_at`,
    [clientId, type, content]
  );
  return { success: true, entry: rows[0] };
}

async function toolResolveContextEntry(entryId) {
  const { rows } = await pool.query(
    `UPDATE client_context_log SET status = 'resolved', resolved_at = NOW() WHERE id = $1 RETURNING id, type, content`,
    [entryId]
  );
  if (!rows.length) return { error: 'Entry not found' };
  return { success: true, resolved: rows[0] };
}

async function toolGetReportSections(clientId) {
  const { rows } = await pool.query('SELECT report_sections FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) return { error: 'Client not found' };
  const config = rows[0].report_sections || {};
  const { rows: conns } = await pool.query(
    'SELECT DISTINCT connector_type FROM connectors WHERE client_id = $1', [clientId]
  );
  const keys = ['seo', ...conns.map(c => c.connector_type)];
  return {
    sections: keys.map(key => ({
      section: key,
      weekly: config[key]?.weekly !== false,
      monthly: config[key]?.monthly !== false,
    })),
    note: 'A section is included in a report unless explicitly disabled for it.',
  };
}

async function toolSetReportSection(clientId, { section, weekly, monthly }) {
  if (!section) return { error: 'section is required' };
  const { rows } = await pool.query('SELECT report_sections FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) return { error: 'Client not found' };
  const config = rows[0].report_sections || {};
  const cur = { ...(config[section] || {}) };
  if (typeof weekly === 'boolean') cur.weekly = weekly;
  if (typeof monthly === 'boolean') cur.monthly = monthly;
  config[section] = cur;
  await pool.query('UPDATE clients SET report_sections = $1 WHERE id = $2', [JSON.stringify(config), clientId]);
  return {
    success: true,
    section,
    weekly: cur.weekly !== false,
    monthly: cur.monthly !== false,
  };
}

async function executeTool(name, input, clientId) {
  switch (name) {
    case 'get_client_info':       return toolGetClientInfo(clientId);
    case 'get_connector_data':    return toolGetConnectorData(clientId, input);
    case 'get_seo_rankings':      return toolGetSeoRankings(clientId);
    case 'get_cro_findings':      return toolGetCroFindings(clientId);
    case 'get_reports':           return toolGetReports(clientId, input.limit);
    case 'detect_anomalies':      return toolDetectAnomalies(clientId);
    case 'get_context_log':       return toolGetContextLog(clientId, input.status);
    case 'add_context_entry':     return toolAddContextEntry(clientId, input);
    case 'resolve_context_entry': return toolResolveContextEntry(input.id);
    case 'get_report_sections':   return toolGetReportSections(clientId);
    case 'set_report_section':    return toolSetReportSection(clientId, input);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(client, connectors) {
  const connectorList = connectors.length
    ? connectors.map(c => `${c.connector_type}${c.store_label ? ` (${c.store_label})` : ''} [${c.status}]`).join(', ')
    : 'none configured';

  return `You are a performance marketing analyst working directly with October Communications on the ${client.name} account.

You have tools to read live data, check SEO rankings, read the Microsoft Clarity CRO / funnel analysis (on-page conversion issues per page), view reports, detect anomalies, and maintain a persistent context log. Use them proactively — don't wait to be asked to check data if it would make your answer more useful.

Your responsibilities:
1. Investigate performance questions by pulling actual data, not estimating
2. Flag anomalies — significant metric changes, connector errors, unusual patterns
3. Help decide which sections belong in their reports — use get_report_sections and set_report_section to add or remove sections when asked
4. Maintain the context log: add decisions, open investigations, pending items; close them when resolved
5. Suggest angles the account manager might not have considered
6. Give concrete, specific advice grounded in the actual data you've pulled

Connected data sources: ${connectorList}

Data limits to know: the Shopify connector only returns orders from roughly the last 60 days unless that store's Shopify app has the read_all_orders scope; Google Search Console retains about 16 months; Google Ads returns historical metrics for any date range with no retention cap. Empty Google Ads data for an older period usually means the account had no spend in that window, not a provider limit. The Google Ads Reporting API also has a 3–24h delay finalising data vs. the live UI — newly-created campaigns serving today often show up with zero impressions until reporting catches up. If a user says "campaign X is live but I don't see it", check whether it's there with zero metrics (data still pending) before assuming the connector is broken. For other providers, empty data for an older period is most often one of the limits above — explain it that way rather than guessing about connection dates.

get_connector_data returns rich detail you should use: GA4 includes traffic source/medium, top landing pages and key events; Google Ads includes spend, ROAS, conversion value and top keywords; Meta Ads includes purchases, ROAS and cost-per-purchase; Shopify includes refunds, net revenue and best-selling products; Brevo and Klaviyo include per-campaign open/click/revenue stats; Amazon includes a daily sales breakdown.

Client: ${client.name} | Domain: ${client.domain || 'not set'} | Monthly focus: ${client.monthly_focus || 'not set'}

British English. Commercially minded. When you use tools, briefly mention what you checked so the account manager can see your reasoning.`;
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get('/:clientId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role, content, tools_used, created_at
       FROM client_chat_messages WHERE client_id = $1
       ORDER BY created_at ASC LIMIT 200`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:clientId', async (req, res) => {
  const { message, image, start_date, end_date } = req.body;
  if (!message?.trim() && !image) return res.status(400).json({ error: 'message required' });

  // Optional analysis window selected in the chat box. When both dates are
  // present we instruct the analyst to use exactly this range for every data
  // pull — replacing its own default window. Dates are normalised to
  // YYYY-MM-DD; anything malformed is ignored (analyst picks its own window).
  const dateRe = /^\d{4}-\d{2}-\d{2}/;
  const win = (typeof start_date === 'string' && dateRe.test(start_date) && typeof end_date === 'string' && dateRe.test(end_date))
    ? { start: start_date.slice(0, 10), end: end_date.slice(0, 10) }
    : null;

  const clientId = req.params.clientId;
  try {
    const [clientRes, connectorsRes, historyRes] = await Promise.all([
      pool.query('SELECT * FROM clients WHERE id = $1', [clientId]),
      pool.query('SELECT connector_type, store_label, status FROM connectors WHERE client_id = $1', [clientId]),
      pool.query(
        `SELECT role, content FROM client_chat_messages WHERE client_id = $1 ORDER BY created_at DESC LIMIT 40`,
        [clientId]
      ),
    ]);

    if (!clientRes.rows.length) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];
    const history = historyRes.rows.reverse();

    const userText = message?.trim() || '';
    // /report prefix marks this turn as a structured-report request:
    // the AM wants a downloadable PDF/Word artefact at the end, not
    // a conversational reply. We strip the prefix before sending to
    // Claude and append a per-turn system nudge to format the
    // response as a proper short report (title, sections, data
    // tables) rather than a chat answer.
    const reportRequested = /^\/report(\s|$)/i.test(userText);
    const cleanedUserText = reportRequested ? userText.replace(/^\/report\s*/i, '').trim() : userText;
    await pool.query(
      'INSERT INTO client_chat_messages (client_id, role, content) VALUES ($1, $2, $3)',
      [clientId, 'user', userText + (image ? ` [image: ${image.name}]` : '')]
    );

    // Build user message content — support image and PDF attachments
    const userContent = image
      ? [
          image.mediaType === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image.base64 } }
            : { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          ...(cleanedUserText ? [{ type: 'text', text: cleanedUserText }] : []),
        ]
      : cleanedUserText;

    // Agentic loop with tool use
    let messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];
    const toolsUsed = [];
    let finalText = '';

    // Per-turn system prompt suffix when /report was requested:
    // instruct Claude to format the reply as a self-contained short
    // report — title (H1), 1-3 sections (H2), inline data tables,
    // brief executive summary at the top, no chat-style preamble.
    const reportSuffix = reportRequested
      ? '\n\nThis turn is a /report request. Format your reply as a self-contained short report ready to be exported as a PDF / Word document:\n- Start with a Markdown H1 title that names what the report covers.\n- A short Executive Summary paragraph (2-4 sentences) directly under the title.\n- 2-5 H2 sections with the analysis and supporting data.\n- Use GFM tables for data — they render cleanly in both PDF and Word.\n- No chat preamble like "Here you go" or "Let me know if you need anything else". The reply IS the report body.'
      : '';

    // Per-turn window directive: when the AM has pinned a date range in the
    // chat box, the analyst must use it for every data pull rather than its
    // own default window.
    const windowSuffix = win
      ? `\n\nDATA WINDOW (set by the account manager): ${win.start} to ${win.end}. Every get_connector_data result this turn is already constrained to exactly this period — the figures you receive cover ${win.start} to ${win.end} and nothing else. Report on this period and refer to it by these exact dates. Do NOT describe the data as "90 days", "the last quarter", or any window other than ${win.start} to ${win.end}.`
      : '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await getClaude().messages.create({
        model: MODEL,
        // Generous output budget so long analyses and multi-section /report
        // replies aren't truncated. You're billed per token generated, so a
        // high cap only bites when the answer genuinely needs the room; both
        // values sit well within the model's output limit.
        max_tokens: reportRequested ? 32000 : 16000,
        // Cache the (stable) system prompt so each tool-loop round reuses it at
        // ~10% input cost instead of re-sending the full analyst context.
        system: require('../services/claude').cacheableSystem(buildSystemPrompt(client, connectorsRes.rows) + reportSuffix + windowSuffix),
        tools: TOOLS,
        messages,
      });
      // Cost log per round — chat sessions can be tool-heavy and the multi-
      // round shape means a single "what happened last week?" question
      // easily fires 3-6 Claude calls.
      require('../services/costLog').recordClaudeCost({ model: MODEL, response, feature: 'ai_data_analyst_chat', clientId });

      if (response.stop_reason === 'end_turn') {
        finalText = response.content.find(b => b.type === 'text')?.text || '';
        break;
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
            let result;
            try {
              // When the AM has pinned a data window, hard-enforce it on every
              // connector pull — overriding whatever range the model chose — so
              // the figures (and the period_days the model narrates from) always
              // match the selected window rather than the model's default habit.
              let toolInput = block.input;
              if (win && block.name === 'get_connector_data') {
                toolInput = { ...toolInput, start_date: win.start, end_date: win.end, days: undefined };
              }
              result = await executeTool(block.name, toolInput, clientId);
            } catch (err) {
              result = { error: err.message };
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        messages.push({ role: 'user', content: toolResults });
      } else {
        // Unexpected stop reason — grab any text and exit
        finalText = response.content.find(b => b.type === 'text')?.text || '';
        break;
      }
    }

    if (!finalText) finalText = 'I wasn\'t able to complete that. Please try again.';

    const { rows } = await pool.query(
      `INSERT INTO client_chat_messages (client_id, role, content, tools_used)
       VALUES ($1, 'assistant', $2, $3) RETURNING id, role, content, tools_used, created_at`,
      [clientId, finalText, JSON.stringify(toolsUsed)]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Export an assistant message as a downloadable PDF or DOCX.
// Reads the message from client_chat_messages, runs it through
// services/chatExport, and streams the bytes back with a sensible
// filename. Available on any assistant message — the /report
// command just nudges the formatting, doesn't change the export
// surface.
router.get('/:clientId/messages/:msgId/export.:format(pdf|docx)', async (req, res) => {
  const { clientId, msgId, format } = req.params;
  try {
    const [msgRes, clientRes] = await Promise.all([
      pool.query(
        `SELECT id, role, content, created_at FROM client_chat_messages
         WHERE id = $1 AND client_id = $2`,
        [msgId, clientId]
      ),
      pool.query('SELECT name FROM clients WHERE id = $1', [clientId]),
    ]);
    if (!msgRes.rows.length) return res.status(404).json({ error: 'Message not found' });
    const msg = msgRes.rows[0];
    if (msg.role !== 'assistant') return res.status(400).json({ error: 'Only assistant messages can be exported' });
    const clientName = clientRes.rows[0]?.name || 'Client';
    const chatExport = require('../services/chatExport');
    // Derive a title from the first H1 in the markdown, falling back
    // to "AI Data Analyst — Report".
    const titleMatch = (msg.content || '').match(/^#\s+(.+?)\s*$/m);
    const title = titleMatch ? titleMatch[1] : 'AI Data Analyst — Report';
    const generatedAt = new Date(msg.created_at);
    const safeSlug = (clientName + '-' + title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    const filename = `${safeSlug}.${format}`;

    if (format === 'pdf') {
      const buf = await chatExport.markdownToPdfBuffer(msg.content || '', { title, clientName, generatedAt });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buf);
    }
    const buf = await chatExport.markdownToDocxBuffer(msg.content || '', { title, clientName, generatedAt });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (err) {
    console.error('[Chat export] failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:clientId', async (req, res) => {
  try {
    await pool.query('DELETE FROM client_chat_messages WHERE client_id = $1', [req.params.clientId]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Context log endpoints
router.get('/:clientId/context', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, content, status, created_at, resolved_at
       FROM client_context_log WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.params.clientId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:clientId/context/:entryId', async (req, res) => {
  try {
    await pool.query('DELETE FROM client_context_log WHERE id = $1 AND client_id = $2', [req.params.entryId, req.params.clientId]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
