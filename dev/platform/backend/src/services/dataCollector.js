const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const emailService = require('./emailService');

async function collectClientData(clientId, periodStart, periodEnd) {
  const { rows: connectors } = await pool.query(
    `SELECT c.*, cl.name as client_name
     FROM connectors c
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.client_id = $1 AND c.status = 'active'`,
    [clientId]
  );

  const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientRows[0];

  const results = {};
  const errors = {};

  for (const connector of connectors) {
    const key = connector.store_label
      ? `${connector.connector_type}:${connector.store_label}`
      : connector.connector_type;

    try {
      const creds = decrypt(connector.credentials);
      if (!creds) {
        errors[key] = 'No credentials configured';
        continue;
      }

      // Special handling for Meta: check validity and alert if expired
      if (['meta_ads', 'instagram_insights'].includes(connector.connector_type)) {
        try {
          const metaConnector = connectorFactory.get(connector.connector_type);
          await metaConnector.checkTokenValidity(creds);
        } catch (tokenErr) {
          await pool.query(
            'UPDATE connectors SET status = $1, error_message = $2 WHERE id = $3',
            ['expired', tokenErr.message, connector.id]
          );

          // Send alert email
          const reauthUrl = `${process.env.PLATFORM_URL}/auth/meta/reauth?client_id=${clientId}`;
          await emailService.sendMetaTokenAlert({
            clientName: client.name,
            connectorType: connector.connector_type,
            reauthoriseUrl: reauthUrl,
          }).catch(err => console.error('Alert email failed:', err.message));

          errors[key] = `Meta token expired: ${tokenErr.message}`;
          continue;
        }
      }

      const connectorModule = connectorFactory.get(connector.connector_type);
      const config = connector.config || {};
      const data = await connectorModule.fetchData(creds, {
        connectorType: connector.connector_type,
        startDate: periodStart,
        endDate: periodEnd,
        storeLabel: connector.store_label,
        // Pass saved account/property selections
        propertyId: config.value,       // GA4
        siteUrl: config.value,          // Google Search Console
        customerId: config.value,       // Google Ads
        merchantId: config.value,       // Google Merchant Center
        adAccountId: config.value,      // Meta Ads
        accountId: config.value,        // Instagram
        organizationId: config.value,   // Zoho Inventory
        brevoListId: config.list_id,        // Brevo — per-client list scope
        brevoAutomation: config.automation, // Brevo — automation label
        formId: config.value,               // October Forms — selected form ID
      });

      results[key] = data;

      // Successful fetch — promote status to 'active' as well as clearing
      // last_checked / error_message. Without the status flip a connector
      // that errored once (e.g. transient 400, expired token) keeps its
      // red badge in the UI forever even after the underlying issue is
      // resolved and subsequent fetches succeed.
      await pool.query(
        'UPDATE connectors SET status = $1, last_checked = NOW(), error_message = NULL WHERE id = $2',
        ['active', connector.id]
      );
    } catch (err) {
      console.error(`Data collection failed for ${key}:`, err.message);
      errors[key] = err.message;

      // Only flap the badge to 'error' on credential / auth failures —
      // the things an AM actually needs to act on (re-auth, regenerate
      // key, fix permissions). Rate limits, 5xx, network blips and other
      // transient issues happen frequently during multi-period
      // time-series fetches and shouldn't toggle the badge red and back
      // every few minutes. Record the error message either way so the
      // diagnose panel still surfaces what went wrong.
      const isAuthFailure = looksLikeAuthFailure(err);
      if (isAuthFailure) {
        await pool.query(
          'UPDATE connectors SET status = $1, error_message = $2 WHERE id = $3',
          ['error', err.message, connector.id]
        );
      } else {
        await pool.query(
          'UPDATE connectors SET error_message = $1 WHERE id = $2',
          [err.message, connector.id]
        );
      }
    }
  }

  return { data: results, errors };
}

// Heuristic: does this error look like an auth/credential problem the
// AM needs to action, vs a transient API hiccup? Checks both the HTTP
// status (when surfaced via axios) and the message text.
function looksLikeAuthFailure(err) {
  const status = err?.response?.status;
  if (status === 401 || status === 403) return true;
  const msg = (err?.message || '').toLowerCase();
  return /\b(unauthori[sz]ed|forbidden|invalid[_ ]?(?:token|api[_ ]?key|grant|client)|token[_ ]?expired|expired[_ ]?token|access[_ ]?denied|permission[_ ]?denied|insufficient[_ ]?scope|not[_ ]?authori[sz]ed)\b/.test(msg);
}

async function collectSEOData(clientId) {
  const result = {};

  // Rank movements — always from DB, no API cost
  try {
    const { rows: keywords } = await pool.query(
      `SELECT k.id, k.keyword, k.tag, k.device, k.location_name,
         (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as current_position,
         (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1 OFFSET 6) as position_7d_ago,
         (SELECT position FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1 OFFSET 29) as position_30d_ago,
         (SELECT MIN(position) FROM seo_rank_history WHERE keyword_id = k.id AND position IS NOT NULL) as best_position,
         (SELECT checked_at FROM seo_rank_history WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) as last_checked
       FROM seo_keywords k
       WHERE k.client_id = $1 AND k.active = true
       ORDER BY k.keyword`,
      [clientId]
    );
    result.rankings = keywords;
  } catch (err) {
    console.error('[SEO] Failed to fetch rank data:', err.message);
    result.rankings = [];
  }

  return result;
}

function buildReportSections(collectedData, connectorErrors) {
  const CONNECTOR_LABELS = {
    ga4: 'Google Analytics 4',
    google_search_console: 'Google Search Console',
    google_ads: 'Google Ads',
    google_merchant_center: 'Google Merchant Center',
    meta_ads: 'Meta Ads',
    instagram_insights: 'Instagram Insights',
    shopify: 'Shopify',
    shopify_email: 'Shopify Email',
    woocommerce: 'WooCommerce',
    klaviyo: 'Klaviyo',
    brevo: 'Brevo',
    amazon_seller: 'Amazon Seller',
    zoho_inventory: 'Zoho Inventory',
    cin7: 'Cin7',
    october_forms: 'October Forms',
  };

  const sections = [];

  for (const [key, data] of Object.entries(collectedData.data)) {
    const [type, storeLabel] = key.split(':');
    sections.push({
      title: CONNECTOR_LABELS[type] || type,
      type,
      storeLabel: storeLabel || null,
      data,
      metrics: extractKeyMetrics(type, data),
      tables: extractTables(type, data),
      charts: extractCharts(type, data),
      unavailable: false,
    });
  }

  // Add unavailable sections for errors
  for (const [key, errorMsg] of Object.entries(collectedData.errors)) {
    const [type, storeLabel] = key.split(':');
    sections.push({
      title: CONNECTOR_LABELS[type] || type,
      type,
      storeLabel: storeLabel || null,
      data: null,
      unavailable: true,
      errorMessage: errorMsg,
    });
  }

  return sections;
}

function extractKeyMetrics(connectorType, data) {
  if (!data) return [];

  switch (connectorType) {
    case 'shopify':
    case 'woocommerce': {
      const s = data.summary || {};
      return [
        { label: 'Total Revenue', value: formatCurrency(s.total_revenue) },
        { label: 'Orders', value: (s.total_orders || 0).toLocaleString() },
        { label: 'Avg Order Value', value: formatCurrency(s.avg_order_value) },
      ];
    }
    case 'meta_ads': {
      const rows = data.data || [];
      const totals = rows.reduce((acc, r) => {
        acc.spend += parseFloat(r.spend || 0);
        acc.clicks += parseInt(r.clicks || 0);
        acc.impressions += parseInt(r.impressions || 0);
        // `actions` counts purchases, `action_values` carries the £ value
        acc.purchases += parseFloat(r.actions?.find(a => a.action_type === 'purchase')?.value || 0);
        acc.purchaseValue += parseFloat(r.action_values?.find(a => a.action_type === 'purchase')?.value || 0);
        return acc;
      }, { spend: 0, clicks: 0, impressions: 0, purchases: 0, purchaseValue: 0 });
      const roas = totals.spend > 0 ? (totals.purchaseValue / totals.spend).toFixed(2) : null;
      return [
        { label: 'Ad Spend', value: formatCurrency(totals.spend) },
        { label: 'Purchase Value', value: formatCurrency(totals.purchaseValue) },
        { label: 'ROAS', value: roas ? `${roas}×` : '—' },
        { label: 'Net', value: formatCurrency(totals.purchaseValue - totals.spend) },
      ];
    }
    case 'ga4': {
      // GA4 main report runs with two dateRanges (current + previous-period),
      // so we can show period-on-period deltas without fetching twice.
      const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
      const metHeaders = (data.metricHeaders || []).map(h => h.name);
      const dateRangeIdx = dimHeaders.indexOf('dateRange');

      const cur = { sessions: 0, users: 0, conversions: 0, revenue: 0 };
      const prev = { sessions: 0, users: 0, conversions: 0, revenue: 0 };

      for (const row of (data.rows || [])) {
        const which = dateRangeIdx >= 0 && row.dimensionValues?.[dateRangeIdx]?.value === 'date_range_1' ? prev : cur;
        const mv = row.metricValues || [];
        const get = name => parseFloat(mv[metHeaders.indexOf(name)]?.value || 0);
        which.sessions += get('sessions');
        which.users += get('activeUsers');
        which.conversions += get('conversions');
        which.revenue += get('totalRevenue');
      }

      const metrics = [
        makeMetric('Sessions', cur.sessions, prev.sessions, n => Math.round(n).toLocaleString()),
        makeMetric('Users', cur.users, prev.users, n => Math.round(n).toLocaleString()),
        makeMetric('Conversions', cur.conversions, prev.conversions, n => Math.round(n).toLocaleString()),
      ];
      if (cur.revenue > 0) metrics.push(makeMetric('Revenue (GA4)', cur.revenue, prev.revenue, formatCurrency));
      return metrics;
    }
    case 'google_search_console': {
      // Use the undimensioned totals returned by the connector — the
      // pre-PR fallback (summing rows and averaging CTR/position) used
      // a top-100 multi-dimension sample that drastically under-counted.
      const t = data.totals;
      if (!t) return [];
      return [
        { label: 'Organic Clicks', value: (t.clicks || 0).toLocaleString() },
        { label: 'Impressions', value: (t.impressions || 0).toLocaleString() },
        { label: 'Avg CTR', value: `${((t.ctr || 0) * 100).toFixed(2)}%` },
        { label: 'Avg Position', value: (t.position || 0).toFixed(1) },
      ];
    }
    case 'google_ads': {
      // /search returns {results:[...]}; handle legacy searchStream [{results:[...]},...]
      const results = data.results || (Array.isArray(data) ? data.flatMap(b => b.results || []) : []);
      let spend = 0, clicks = 0, impressions = 0, conversions = 0, convValue = 0;
      for (const result of results) {
        const m = result.metrics || {};
        spend += parseInt(m.costMicros || 0) / 1_000_000;
        clicks += parseInt(m.clicks || 0);
        impressions += parseInt(m.impressions || 0);
        conversions += parseFloat(m.conversions || 0);
        convValue += parseFloat(m.conversionsValue || 0);
      }
      const roas = spend > 0 ? (convValue / spend).toFixed(2) : null;
      return [
        { label: 'Ad Spend', value: formatCurrency(spend) },
        { label: 'Conv. Value', value: formatCurrency(convValue) },
        { label: 'ROAS', value: roas ? `${roas}×` : '—' },
        { label: 'Net', value: formatCurrency(convValue - spend) },
      ];
    }
    case 'klaviyo': {
      const campaigns = data.campaigns || [];
      return [
        { label: 'Campaigns Sent', value: campaigns.length.toString() },
      ];
    }
    case 'brevo': {
      const stats = data.aggregated_stats || {};
      const campaigns = data.campaigns || [];
      const metrics = [
        { label: 'Campaigns Sent', value: campaigns.length.toString() },
      ];
      if (stats.delivered) metrics.push({ label: 'Delivered', value: parseInt(stats.delivered || 0).toLocaleString() });
      if (stats.opens) metrics.push({ label: 'Opens', value: parseInt(stats.opens || 0).toLocaleString() });
      if (stats.clicks) metrics.push({ label: 'Clicks', value: parseInt(stats.clicks || 0).toLocaleString() });
      return metrics;
    }
    case 'zoho_inventory': {
      const items = data.items || [];
      const orders = data.orders || [];
      const revenue = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const lowStock = items.filter(i => (i.available_stock || 0) <= (i.reorder_level || 0) && i.available_stock != null);
      return [
        { label: 'Orders', value: orders.length.toLocaleString() },
        { label: 'Revenue', value: formatCurrency(revenue) },
        { label: 'Active SKUs', value: items.length.toLocaleString() },
        { label: 'Low Stock Items', value: lowStock.length.toLocaleString() },
      ];
    }
    case 'cin7': {
      const stock = data.stock || [];
      const orders = data.orders || [];
      const revenue = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
      const lowStock = stock.filter(s => (s.available || 0) <= 0);
      return [
        { label: 'Orders', value: orders.length.toLocaleString() },
        { label: 'Revenue', value: formatCurrency(revenue) },
        { label: 'SKUs Tracked', value: stock.length.toLocaleString() },
        { label: 'Out of Stock', value: lowStock.length.toLocaleString() },
      ];
    }
    case 'october_forms': {
      const s = data.summary || {};
      const pct = v => `${(parseFloat(v || 0) * 100).toFixed(1)}%`;
      return [
        { label: 'Views', value: (s.views || 0).toLocaleString() },
        { label: 'Starts', value: (s.starts || 0).toLocaleString() },
        { label: 'Completes', value: (s.completes || 0).toLocaleString() },
        { label: 'Conversion', value: pct(s.overall_conversion) },
      ];
    }
    default:
      return [];
  }
}

function extractTables(connectorType, data) {
  if (!data) return [];

  switch (connectorType) {
    case 'shopify':
    case 'woocommerce': {
      const orders = (data.orders || []).slice(0, 20);
      if (!orders.length) return [];
      return [{
        heading: 'Recent Orders',
        headers: ['Order ID', 'Date', 'Status', 'Total'],
        rows: orders.map(o => [
          o.order_number || o.id,
          new Date(o.created_at).toLocaleDateString('en-GB'),
          o.financial_status || o.status,
          formatCurrency(o.total_price || o.total),
        ]),
      }];
    }
    case 'meta_ads': {
      const campaigns = (data.data || []).slice(0, 20);
      if (!campaigns.length) return [];
      return [{
        heading: 'Campaign Performance',
        headers: ['Campaign', 'Spend', 'Purchase Value', 'ROAS', 'Net', 'CTR'],
        rows: campaigns.map(c => {
          const spend = parseFloat(c.spend || 0);
          const pv = parseFloat(c.action_values?.find(a => a.action_type === 'purchase')?.value || 0);
          return [
            c.campaign_name,
            formatCurrency(spend),
            formatCurrency(pv),
            spend > 0 ? `${(pv / spend).toFixed(2)}×` : '—',
            formatCurrency(pv - spend),
            `${parseFloat(c.ctr || 0).toFixed(2)}%`,
          ];
        }),
      }];
    }
    case 'ga4': {
      const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
      const metHeaders = (data.metricHeaders || []).map(h => h.name);
      const dateRangeIdx = dimHeaders.indexOf('dateRange');
      const channelIdx = dimHeaders.indexOf('sessionDefaultChannelGroup');
      if (channelIdx < 0) return [];

      // Aggregate sessions per channel for current period
      const channelMap = {};
      for (const row of (data.rows || [])) {
        if (dateRangeIdx >= 0 && row.dimensionValues?.[dateRangeIdx]?.value !== 'date_range_0') continue;
        const channel = row.dimensionValues?.[channelIdx]?.value || 'Unknown';
        const mv = row.metricValues || [];
        const get = name => parseFloat(mv[metHeaders.indexOf(name)]?.value || 0);
        if (!channelMap[channel]) channelMap[channel] = { sessions: 0, users: 0, conversions: 0 };
        channelMap[channel].sessions += get('sessions');
        channelMap[channel].users += get('activeUsers');
        channelMap[channel].conversions += get('conversions');
      }

      const sorted = Object.entries(channelMap).sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 10);
      if (!sorted.length) return [];
      return [{
        heading: 'Sessions by Channel',
        headers: ['Channel', 'Sessions', 'Users', 'Conversions'],
        rows: sorted.map(([channel, m]) => [
          channel,
          Math.round(m.sessions).toLocaleString(),
          Math.round(m.users).toLocaleString(),
          Math.round(m.conversions).toLocaleString(),
        ]),
      }];
    }
    case 'google_search_console': {
      // GSC connector now returns topQueries / topPages as single-dimension
      // rows from the API — each row's clicks/impressions/ctr/position is
      // the true total for that query/page across all sub-dimensions, so
      // we just sort and render without any local aggregation.
      const tables = [];
      const queryRows = (data.topQueries || []).slice().sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 15);
      const pageRows = (data.topPages || []).slice().sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 15);
      if (queryRows.length) tables.push({
        heading: 'Top Organic Queries',
        headers: ['Query', 'Clicks', 'Impressions', 'CTR', 'Position'],
        rows: queryRows.map(r => [
          r.keys?.[0] || '',
          (r.clicks || 0).toLocaleString(),
          (r.impressions || 0).toLocaleString(),
          `${((r.ctr || 0) * 100).toFixed(2)}%`,
          (r.position || 0).toFixed(1),
        ]),
      });
      if (pageRows.length) tables.push({
        heading: 'Top Landing Pages',
        headers: ['Page', 'Clicks', 'Impressions', 'CTR', 'Position'],
        rows: pageRows.map(r => {
          const page = r.keys?.[0] || '';
          const shortPage = page.length > 60 ? '…' + page.slice(-58) : page;
          return [
            shortPage,
            (r.clicks || 0).toLocaleString(),
            (r.impressions || 0).toLocaleString(),
            `${((r.ctr || 0) * 100).toFixed(2)}%`,
            (r.position || 0).toFixed(1),
          ];
        }),
      });
      return tables;
    }
    case 'google_ads': {
      const results = data.results || (Array.isArray(data) ? data.flatMap(b => b.results || []) : []);
      const campaignMap = {};
      for (const result of results) {
        const name = result.campaign?.name || 'Unknown';
        const m = result.metrics || {};
        if (!campaignMap[name]) campaignMap[name] = { spend: 0, clicks: 0, impressions: 0, conversions: 0, convValue: 0 };
        campaignMap[name].spend += parseInt(m.costMicros || 0) / 1_000_000;
        campaignMap[name].clicks += parseInt(m.clicks || 0);
        campaignMap[name].impressions += parseInt(m.impressions || 0);
        campaignMap[name].conversions += parseFloat(m.conversions || 0);
        campaignMap[name].convValue += parseFloat(m.conversionsValue || 0);
      }
      const sorted = Object.entries(campaignMap).sort((a, b) => b[1].spend - a[1].spend).slice(0, 20);
      if (!sorted.length) return [];
      return [{
        heading: 'Campaign Performance',
        headers: ['Campaign', 'Spend', 'Conv. Value', 'ROAS', 'Net', 'CPA'],
        rows: sorted.map(([name, m]) => [
          name,
          formatCurrency(m.spend),
          formatCurrency(m.convValue),
          m.spend > 0 ? `${(m.convValue / m.spend).toFixed(2)}×` : '—',
          formatCurrency(m.convValue - m.spend),
          m.conversions > 0 ? formatCurrency(m.spend / m.conversions) : '—',
        ]),
      }];
    }
    case 'klaviyo': {
      const campaigns = (data.campaigns || []).slice(0, 20);
      if (!campaigns.length) return [];
      return [{
        heading: 'Email Campaigns',
        headers: ['Campaign', 'Status', 'Sent Date'],
        rows: campaigns.map(c => [
          c.name,
          c.status || '—',
          c.scheduled_at ? new Date(c.scheduled_at).toLocaleDateString('en-GB') : '—',
        ]),
      }];
    }
    case 'brevo': {
      const campaigns = (data.campaigns || []).slice(0, 20);
      if (!campaigns.length) return [];
      return [{
        heading: 'Email Campaigns',
        headers: ['Campaign', 'Subject', 'Sent Date', 'Opens', 'Clicks'],
        rows: campaigns.map(c => [
          c.name,
          c.subject || '—',
          c.sent_date ? new Date(c.sent_date).toLocaleDateString('en-GB') : '—',
          c.statistics?.opened?.count?.toLocaleString() || '—',
          c.statistics?.clicked?.count?.toLocaleString() || '—',
        ]),
      }];
    }
    case 'zoho_inventory': {
      const items = (data.items || []).slice(0, 20);
      if (!items.length) return [];
      return [{
        heading: 'Stock Levels',
        headers: ['Product', 'SKU', 'Available', 'On Hand', 'Reorder Level'],
        rows: items.map(i => [
          i.name || '—',
          i.sku || '—',
          (i.available_stock ?? '—').toLocaleString ? (i.available_stock ?? 0).toLocaleString() : '—',
          (i.actual_available_stock ?? '—').toLocaleString ? (i.actual_available_stock ?? 0).toLocaleString() : '—',
          i.reorder_level != null ? i.reorder_level : '—',
        ]),
      }];
    }
    case 'cin7': {
      const stock = (data.stock || []).slice(0, 20);
      if (!stock.length) return [];
      return [{
        heading: 'Stock on Hand',
        headers: ['Product', 'SKU', 'Available', 'On Hand'],
        rows: stock.map(s => [
          s.name || s.productName || '—',
          s.styleCode || s.sku || '—',
          (s.available ?? 0).toLocaleString(),
          (s.onHand ?? 0).toLocaleString(),
        ]),
      }];
    }
    case 'october_forms': {
      // Funnel steps make a more useful table than re-stating the headline
      // metrics — they show where visitors drop out.
      const steps = data.funnel?.steps || [];
      if (!steps.length) return [];
      const total = steps[0]?.reached || 1;
      return [{
        heading: 'Funnel — Step Drop-off',
        headers: ['Step', 'Title', 'Reached', '% of start'],
        rows: steps.map(s => [
          s.step_index ?? '—',
          s.title || s.step_id || '—',
          (s.reached || 0).toLocaleString(),
          `${((s.reached / total) * 100).toFixed(1)}%`,
        ]),
        highlightFirst: false,
      }];
    }
    default:
      return [];
  }
}

// Per-section chart data. Each chart is rendered as inline SVG by pdfService.
// Only adds charts where we already have the underlying data — no extra fetches.
function extractCharts(connectorType, data) {
  if (!data) return [];
  switch (connectorType) {
    case 'ga4': {
      const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
      const metHeaders = (data.metricHeaders || []).map(h => h.name);
      const dateRangeIdx = dimHeaders.indexOf('dateRange');
      const channelIdx = dimHeaders.indexOf('sessionDefaultChannelGroup');
      if (channelIdx < 0) return [];

      const channelMap = {};
      for (const row of (data.rows || [])) {
        if (dateRangeIdx >= 0 && row.dimensionValues?.[dateRangeIdx]?.value !== 'date_range_0') continue;
        const channel = row.dimensionValues?.[channelIdx]?.value || 'Unknown';
        const mv = row.metricValues || [];
        const sessions = parseFloat(mv[metHeaders.indexOf('sessions')]?.value || 0);
        channelMap[channel] = (channelMap[channel] || 0) + sessions;
      }
      const sorted = Object.entries(channelMap)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      if (!sorted.length) return [];
      return [{
        title: 'Traffic Sources — Sessions by Channel',
        type: 'hbar',
        data: sorted.map(([label, value]) => ({ label, value: Math.round(value) })),
      }];
    }
    default:
      return [];
  }
}

function formatCurrency(val) {
  const n = parseFloat(val || 0);
  if (isNaN(n)) return '£0.00';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
}

// Build a metric with a period-on-period delta. `previous` is undefined when
// no comparison is available; the delta string is omitted when prev is zero
// (can't divide) or when both values are zero.
function makeMetric(label, current, previous, format) {
  const m = { label, value: format(current) };
  if (previous == null) return m;
  m.previous = format(previous);
  if (previous > 0) {
    const pct = ((current - previous) / previous) * 100;
    m.delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    m.deltaDirection = current > previous ? 'up' : current < previous ? 'down' : 'flat';
  }
  return m;
}

module.exports = { collectClientData, collectSEOData, buildReportSections, extractTables, extractKeyMetrics, extractCharts };
