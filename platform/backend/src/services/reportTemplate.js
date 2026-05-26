// Report template engine — describes a report as an ordered list of typed
// sections instead of via per-section checkboxes + freeform instructions.
//
// Each section is one of:
//
//   { id, title, type: 'narrative',
//     prompt: 'Write 2-3 sentences …',
//     sources: ['*'] | [{ type, storeLabel? }, …] }
//
//   { id, title, type: 'metrics_grid',
//     sources: [{ type, storeLabel? }, …],
//     aggregate: 'sum' | 'list',     // sum = combine sources, list = separate cells
//     metrics: ['revenue', 'orders', 'aov', …] }   // see METRIC_CATALOG below
//
//   { id, title, type: 'connector_table',
//     sources: [{ type, storeLabel? }, …] }   // one table per source, headings auto
//
//   { id, title, type: 'bar_chart',
//     sources: [{ type: 'ga4', storeLabel? }],
//     dimension: 'channel' | 'source_medium',
//     metric: 'sessions' | 'users' | 'revenue' }
//
//   { id, title, type: 'position_distribution' }   // SEO rankings buckets
//
// The renderer (templateRenderer.js) walks the sections in order and emits
// one section block per entry. Pages break automatically inside puppeteer.

const dataCollector = require('./dataCollector');

// ─── METRIC CATALOG ─────────────────────────────────────────────────────────
// For each connector, the set of named metrics a `metrics_grid` section can
// pull from its data. Used both for rendering and for telling Claude (in the
// template builder chat) what's available.
const METRIC_CATALOG = {
  shopify: {
    revenue:     { label: 'Revenue',     format: 'currency', get: d => parseFloat(d.summary?.total_revenue || 0) },
    orders:      { label: 'Orders',      format: 'integer',  get: d => parseInt(d.summary?.total_orders || 0) },
    aov:         { label: 'AOV',         format: 'currency', get: d => parseFloat(d.summary?.avg_order_value || 0) },
    refunds:     { label: 'Refunds',     format: 'currency', get: d => parseFloat(d.summary?.total_refunds || 0) },
    net_revenue: { label: 'Net Revenue', format: 'currency', get: d => parseFloat(d.summary?.net_revenue || 0) },
  },
  woocommerce: {
    revenue:     { label: 'Revenue',     format: 'currency', get: d => parseFloat(d.summary?.total_revenue || 0) },
    orders:      { label: 'Orders',      format: 'integer',  get: d => parseInt(d.summary?.total_orders || 0) },
    aov:         { label: 'AOV',         format: 'currency', get: d => parseFloat(d.summary?.avg_order_value || 0) },
  },
  google_ads: {
    spend:       { label: 'Ad Spend',     format: 'currency', get: d => sumGoogleAds(d, 'costMicros') / 1_000_000 },
    conv_value:  { label: 'Conv. Value',  format: 'currency', get: d => sumGoogleAds(d, 'conversionsValue') },
    roas:        { label: 'ROAS',         format: 'multiple', get: d => { const s = sumGoogleAds(d, 'costMicros') / 1_000_000; return s > 0 ? sumGoogleAds(d, 'conversionsValue') / s : 0; } },
    net:         { label: 'Net',          format: 'currency', get: d => sumGoogleAds(d, 'conversionsValue') - sumGoogleAds(d, 'costMicros') / 1_000_000 },
    clicks:      { label: 'Clicks',       format: 'integer',  get: d => sumGoogleAds(d, 'clicks') },
    conversions: { label: 'Conversions',  format: 'integer',  get: d => sumGoogleAds(d, 'conversions') },
  },
  meta_ads: {
    spend:          { label: 'Ad Spend',       format: 'currency', get: d => sumMeta(d, 'spend') },
    purchase_value: { label: 'Purchase Value', format: 'currency', get: d => sumMetaAction(d, 'purchase', 'action_values') },
    roas:           { label: 'ROAS',           format: 'multiple', get: d => { const s = sumMeta(d, 'spend'); return s > 0 ? sumMetaAction(d, 'purchase', 'action_values') / s : 0; } },
    clicks:         { label: 'Clicks',         format: 'integer',  get: d => sumMeta(d, 'clicks') },
    impressions:    { label: 'Impressions',    format: 'integer',  get: d => sumMeta(d, 'impressions') },
  },
  ga4: {
    sessions:    { label: 'Sessions',    format: 'integer',  get: d => sumGA4(d, 'sessions') },
    users:       { label: 'Users',       format: 'integer',  get: d => sumGA4(d, 'activeUsers') },
    conversions: { label: 'Conversions', format: 'integer',  get: d => sumGA4(d, 'conversions') },
    revenue:     { label: 'Revenue',     format: 'currency', get: d => sumGA4(d, 'totalRevenue') },
  },
  google_search_console: {
    clicks:      { label: 'Organic Clicks', format: 'integer', get: d => (d.rows || []).reduce((s, r) => s + (r.clicks || 0), 0) },
    impressions: { label: 'Impressions',    format: 'integer', get: d => (d.rows || []).reduce((s, r) => s + (r.impressions || 0), 0) },
  },
  amazon_seller: {
    revenue: { label: 'Revenue', format: 'currency', get: d => parseFloat(d.summary?.total_revenue || 0) },
    orders:  { label: 'Orders',  format: 'integer',  get: d => parseInt(d.summary?.total_orders || 0) },
  },
};

function sumGoogleAds(data, field) {
  const results = data.results || (Array.isArray(data) ? data.flatMap(b => b.results || []) : []);
  let total = 0;
  for (const r of results) total += parseFloat(r.metrics?.[field] || 0);
  return total;
}
function sumMeta(data, field) {
  return (data.data || []).reduce((s, r) => s + parseFloat(r[field] || 0), 0);
}
function sumMetaAction(data, actionType, fieldGroup) {
  return (data.data || []).reduce((s, r) => {
    const entry = (r[fieldGroup] || []).find(a => a.action_type === actionType);
    return s + parseFloat(entry?.value || 0);
  }, 0);
}
function sumGA4(data, metric) {
  const metHeaders = (data.metricHeaders || []).map(h => h.name);
  const dimHeaders = (data.dimensionHeaders || []).map(h => h.name);
  const dateRangeIdx = dimHeaders.indexOf('dateRange');
  const idx = metHeaders.indexOf(metric);
  if (idx < 0) return 0;
  let total = 0;
  for (const row of (data.rows || [])) {
    if (dateRangeIdx >= 0 && row.dimensionValues?.[dateRangeIdx]?.value !== 'date_range_0') continue;
    total += parseFloat(row.metricValues?.[idx]?.value || 0);
  }
  return total;
}

// ─── FORMATTING ────────────────────────────────────────────────────────────
function formatValue(value, format) {
  if (value == null || (typeof value === 'number' && !isFinite(value))) return '—';
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
    case 'integer':
      return Math.round(value).toLocaleString('en-GB');
    case 'multiple':
      return `${value.toFixed(2)}×`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    default:
      return String(value);
  }
}

// ─── SOURCE MATCHING ───────────────────────────────────────────────────────
// Given a source spec ({ type, storeLabel? } or '*'), pick matching entries
// from collectedData.data. The data is keyed `type` or `type:storeLabel`.
function matchSources(rawData, sources) {
  if (!sources || sources.length === 0) return [];
  if (sources.includes('*') || sources[0] === '*') {
    return Object.entries(rawData).map(([key, data]) => {
      const [type, storeLabel] = key.split(':');
      return { key, type, storeLabel: storeLabel || null, data };
    });
  }
  const out = [];
  for (const spec of sources) {
    if (!spec || typeof spec !== 'object') continue;
    for (const [key, data] of Object.entries(rawData)) {
      const [type, storeLabel] = key.split(':');
      if (spec.type !== type) continue;
      if (spec.storeLabel != null && spec.storeLabel !== storeLabel) continue;
      out.push({ key, type, storeLabel: storeLabel || null, data });
    }
  }
  return out;
}

// ─── METRICS_GRID RESOLUTION ──────────────────────────────────────────────
// Returns [{ label, value }, …] cells for a metrics_grid section.
function resolveMetricsGrid(section, rawData) {
  const matches = matchSources(rawData, section.sources);
  if (!matches.length) return [];

  const metricKeys = section.metrics || [];
  const cells = [];

  if (section.aggregate === 'list' || matches.length === 1) {
    for (const m of matches) {
      const catalog = METRIC_CATALOG[m.type] || {};
      const tag = m.storeLabel ? `${m.storeLabel} — ` : '';
      for (const mk of metricKeys) {
        const def = catalog[mk];
        if (!def) continue;
        cells.push({ label: `${tag}${def.label}`, value: formatValue(def.get(m.data), def.format) });
      }
    }
  } else {
    // aggregate === 'sum' (default for multi-source) — combine across sources.
    // AOV is special: avg-of-avg is misleading, so we recompute as total
    // revenue / total orders when both are pulled from the same connector.
    const totals = {};
    for (const m of matches) {
      const catalog = METRIC_CATALOG[m.type] || {};
      for (const mk of metricKeys) {
        const def = catalog[mk];
        if (!def) continue;
        if (mk === 'aov') continue;   // handled below
        if (mk === 'roas') continue;  // handled below
        totals[mk] = (totals[mk] || 0) + def.get(m.data);
        totals[`__format_${mk}`] = def.format;
        totals[`__label_${mk}`] = def.label;
      }
    }
    // Derived: AOV from summed revenue / orders, ROAS from value / spend
    if (metricKeys.includes('aov') && totals.orders) {
      totals.aov = totals.revenue / totals.orders;
      totals.__format_aov = 'currency';
      totals.__label_aov = 'AOV';
    }
    if (metricKeys.includes('roas') && totals.spend) {
      totals.roas = totals.conv_value / totals.spend;
      totals.__format_roas = 'multiple';
      totals.__label_roas = 'ROAS';
    }
    for (const mk of metricKeys) {
      if (totals[mk] == null) continue;
      cells.push({ label: totals[`__label_${mk}`] || mk, value: formatValue(totals[mk], totals[`__format_${mk}`] || 'integer') });
    }
  }
  return cells;
}

// ─── CONNECTOR_TABLE RESOLUTION ───────────────────────────────────────────
// Returns one table object per source (re-using the connector-specific
// table extractors that already exist in dataCollector).
function resolveConnectorTables(section, rawData) {
  const matches = matchSources(rawData, section.sources);
  const tables = [];
  for (const m of matches) {
    const innerTables = dataCollector.extractTables ? dataCollector.extractTables(m.type, m.data) : [];
    for (const t of innerTables) {
      tables.push({
        heading: m.storeLabel ? `${t.heading || ''} — ${m.storeLabel}`.replace(/^ — /, '') : t.heading,
        headers: t.headers,
        rows: t.rows,
        highlightFirst: t.highlightFirst,
      });
    }
  }
  return tables;
}

// ─── BAR CHART RESOLUTION ─────────────────────────────────────────────────
function resolveBarChart(section, rawData) {
  const matches = matchSources(rawData, section.sources);
  if (!matches.length) return null;
  const m = matches[0];
  if (m.type !== 'ga4') return null;
  const dimHeaders = (m.data.dimensionHeaders || []).map(h => h.name);
  const metHeaders = (m.data.metricHeaders || []).map(h => h.name);
  const dateRangeIdx = dimHeaders.indexOf('dateRange');
  const channelIdx = dimHeaders.indexOf('sessionDefaultChannelGroup');
  if (channelIdx < 0) return null;
  const metricName = section.metric === 'users' ? 'activeUsers'
                   : section.metric === 'revenue' ? 'totalRevenue'
                   : 'sessions';
  const map = {};
  for (const row of (m.data.rows || [])) {
    if (dateRangeIdx >= 0 && row.dimensionValues?.[dateRangeIdx]?.value !== 'date_range_0') continue;
    const channel = row.dimensionValues?.[channelIdx]?.value || 'Unknown';
    const v = parseFloat(row.metricValues?.[metHeaders.indexOf(metricName)]?.value || 0);
    map[channel] = (map[channel] || 0) + v;
  }
  const sorted = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { type: 'hbar', title: section.title, data: sorted.map(([label, value]) => ({ label, value: Math.round(value) })) };
}

// ─── DEFAULT TEMPLATE ─────────────────────────────────────────────────────
// Used when a client has no saved template. Produces a sensible starting
// point that mirrors the old hard-coded report layout, so reports keep
// rendering even before the AM opens the template builder.
function defaultTemplate(reportType, availableTypes = []) {
  const has = t => availableTypes.includes(t);
  const sections = [
    {
      id: 'exec_summary',
      title: reportType === 'monthly' ? 'Executive Summary' : 'Weekly Snapshot',
      type: 'narrative',
      sources: ['*'],
      prompt: reportType === 'monthly'
        ? 'Write a 300-400 word executive summary of the month. Highlight the most significant movements, call out anything that needs attention, end with one forward-looking sentence about next month.'
        : 'Write 2-3 sentences summarising this week\'s performance across the data below. Reference notable movements. Be direct. British English.',
    },
  ];
  if (has('ga4')) {
    sections.push({ id: 'ga4_metrics', title: 'Traffic Overview', type: 'metrics_grid', sources: [{ type: 'ga4' }], aggregate: 'sum', metrics: ['sessions', 'users', 'conversions', 'revenue'] });
    sections.push({ id: 'ga4_channels', title: 'Traffic Sources', type: 'bar_chart', sources: [{ type: 'ga4' }], dimension: 'channel', metric: 'sessions' });
  }
  if (has('shopify') || has('woocommerce')) {
    const ecomType = has('shopify') ? 'shopify' : 'woocommerce';
    sections.push({ id: 'ecom_summary', title: 'E-commerce Summary', type: 'metrics_grid', sources: [{ type: ecomType }], aggregate: 'sum', metrics: ['revenue', 'orders', 'aov'] });
    sections.push({ id: 'ecom_stores', title: 'By Store', type: 'metrics_grid', sources: [{ type: ecomType }], aggregate: 'list', metrics: ['revenue', 'orders', 'aov'] });
  }
  if (has('google_ads')) {
    sections.push({ id: 'google_ads_summary', title: 'Google Ads', type: 'metrics_grid', sources: [{ type: 'google_ads' }], aggregate: 'sum', metrics: ['spend', 'conv_value', 'roas', 'net'] });
    if (reportType === 'monthly') sections.push({ id: 'google_ads_table', title: 'Google Ads Campaigns', type: 'connector_table', sources: [{ type: 'google_ads' }] });
  }
  if (has('meta_ads')) {
    sections.push({ id: 'meta_ads_summary', title: 'Meta Ads', type: 'metrics_grid', sources: [{ type: 'meta_ads' }], aggregate: 'sum', metrics: ['spend', 'purchase_value', 'roas'] });
  }
  if (has('google_search_console') && reportType === 'monthly') {
    sections.push({ id: 'gsc_metrics', title: 'Google Search Console', type: 'metrics_grid', sources: [{ type: 'google_search_console' }], aggregate: 'sum', metrics: ['clicks', 'impressions'] });
    sections.push({ id: 'gsc_table', title: 'Top Organic Queries & Pages', type: 'connector_table', sources: [{ type: 'google_search_console' }] });
  }
  if (reportType === 'monthly') {
    sections.push({ id: 'seo_positions', title: 'Positions in Search Results', type: 'position_distribution' });
  }
  return { version: 1, sections };
}

function validate(template) {
  if (!template || typeof template !== 'object') return 'template must be an object';
  if (!Array.isArray(template.sections)) return 'template.sections must be an array';
  const ids = new Set();
  for (const [i, s] of template.sections.entries()) {
    if (!s.id) return `section[${i}].id is required`;
    if (ids.has(s.id)) return `section[${i}].id "${s.id}" is duplicated`;
    ids.add(s.id);
    if (!s.type) return `section[${i}].type is required`;
    if (!['narrative', 'metrics_grid', 'connector_table', 'bar_chart', 'position_distribution'].includes(s.type)) return `section[${i}].type "${s.type}" is invalid`;
  }
  return null;
}

module.exports = {
  METRIC_CATALOG,
  matchSources,
  resolveMetricsGrid,
  resolveConnectorTables,
  resolveBarChart,
  defaultTemplate,
  validate,
  formatValue,
};
