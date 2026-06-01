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
    // In e-commerce a paid order IS a conversion — alias kept so Claude
    // can propose `conversions` for a Shopify section without leaving an
    // empty column when the AM expects parity with GA4 vocabulary.
    conversions: { label: 'Conversions', format: 'integer',  get: d => parseInt(d.summary?.total_orders || 0) },
    aov:         { label: 'AOV',         format: 'currency', get: d => parseFloat(d.summary?.avg_order_value || 0) },
    refunds:     { label: 'Refunds',     format: 'currency', get: d => parseFloat(d.summary?.total_refunds || 0) },
    net_revenue: { label: 'Net Revenue', format: 'currency', get: d => parseFloat(d.summary?.net_revenue || 0) },
  },
  woocommerce: {
    revenue:     { label: 'Revenue',     format: 'currency', get: d => parseFloat(d.summary?.total_revenue || 0) },
    orders:      { label: 'Orders',      format: 'integer',  get: d => parseInt(d.summary?.total_orders || 0) },
    conversions: { label: 'Conversions', format: 'integer',  get: d => parseInt(d.summary?.total_orders || 0) },
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
  october_forms: {
    views:              { label: 'Views',          format: 'integer', get: d => parseInt(d.summary?.views || 0) },
    starts:             { label: 'Starts',         format: 'integer', get: d => parseInt(d.summary?.starts || 0) },
    partials:           { label: 'Partials',       format: 'integer', get: d => parseInt(d.summary?.partials || 0) },
    completes:          { label: 'Completes',      format: 'integer', get: d => parseInt(d.summary?.completes || 0) },
    overall_conversion: { label: 'Conv. Rate',     format: 'percent', get: d => parseFloat(d.summary?.overall_conversion || 0) * 100 },
    view_to_start_rate: { label: 'View → Start',   format: 'percent', get: d => parseFloat(d.summary?.view_to_start_rate || 0) * 100 },
    start_to_complete:  { label: 'Start → Complete', format: 'percent', get: d => parseFloat(d.summary?.start_to_complete || 0) * 100 },
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
// Returns one of:
//   { layout: 'cells', cells: [{ label, value }, …] }
//   { layout: 'table', metricLabels: [...], rows: [{ source, values: [...] }] }
//
// "table" layout is chosen when the AM asked for a multi-source LIST mode
// (e.g. all Shopify stores, each with its own row). A 3-store × 3-metric
// table is far more legible than 9 chunked cells.
function resolveMetricsGrid(section, rawData, rawDataPrev, ctx) {
  // Time-series mode — rows = periods (most recent first), columns =
  // metrics. Takes precedence over compare:"yoy" when both are set,
  // since "last 3 months" / "last 5 years" is structurally a different
  // table from "this period vs same period one year ago".
  if (section.time_grain && ctx?.rawDataByPeriod) {
    return resolveTimeSeriesMetricsGrid(section, ctx);
  }
  const matches = matchSources(rawData, section.sources);
  if (!matches.length) return { layout: 'cells', cells: [] };

  const metricKeys = section.metrics || [];
  const compareYoy = section.compare === 'yoy' && rawDataPrev;

  // Multi-source list mode → render as a table.
  if (section.aggregate === 'list' && matches.length > 1 && metricKeys.length >= 1) {
    // Resolve column labels up-front from the metric keys themselves — using
    // the first source that has a definition for each key. This avoids a
    // bug where invalid keys later in the array caused subsequent iterations
    // to "fill in" missing label slots with the wrong labels (e.g. duplicate
    // "Revenue" columns when Claude proposed an unknown metric like
    // "total_revenue").
    const metricLabels = metricKeys.map(mk => {
      for (const m of matches) {
        const def = (METRIC_CATALOG[m.type] || {})[mk];
        if (def) return def.label;
      }
      // Unknown metric key — humanise so the column doesn't read like a
      // variable name ("total_revenue" → "Total Revenue").
      return mk.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    });
    const rows = [];
    for (const m of matches) {
      const catalog = METRIC_CATALOG[m.type] || {};
      const sourceLabel = m.storeLabel || m.type;
      const prevData = compareYoy ? rawDataPrev[m.key] : null;
      const values = metricKeys.map(mk => {
        const def = catalog[mk];
        if (!def) return '—';
        const curRaw = def.get(m.data);
        const cur = formatValue(curRaw, def.format);
        if (!compareYoy || !prevData) return cur;
        const prevRaw = def.get(prevData);
        return withComparison(cur, curRaw, prevRaw, def.format);
      });
      rows.push({ source: sourceLabel, values });
    }
    return { layout: 'table', metricLabels, rows, compare: compareYoy ? 'yoy' : null };
  }

  // Single source OR list with one metric → flat cell row.
  if (section.aggregate === 'list' || matches.length === 1) {
    const cells = [];
    for (const m of matches) {
      const catalog = METRIC_CATALOG[m.type] || {};
      const tag = m.storeLabel ? `${m.storeLabel} — ` : '';
      const prevData = compareYoy ? rawDataPrev[m.key] : null;
      for (const mk of metricKeys) {
        const def = catalog[mk];
        if (!def) continue;
        const curRaw = def.get(m.data);
        const cell = { label: `${tag}${def.label}`, value: formatValue(curRaw, def.format) };
        if (compareYoy && prevData) attachComparison(cell, curRaw, def.get(prevData), def.format);
        cells.push(cell);
      }
    }
    return { layout: 'cells', cells, compare: compareYoy ? 'yoy' : null };
  }

  // aggregate === 'sum' (default multi-source) — combine across sources, with
  // AOV recomputed from total revenue / total orders and ROAS from value /
  // spend (an average of averages would be misleading).
  const totals = sumAcrossSources(matches, metricKeys);
  const prevTotals = compareYoy ? sumAcrossSources(matchSourcesFromPrev(matches, rawDataPrev), metricKeys) : null;
  const cells = [];
  for (const mk of metricKeys) {
    if (totals[mk] == null) continue;
    const fmt = totals[`__format_${mk}`] || 'integer';
    const cell = { label: totals[`__label_${mk}`] || mk, value: formatValue(totals[mk], fmt) };
    if (prevTotals && prevTotals[mk] != null) attachComparison(cell, totals[mk], prevTotals[mk], fmt);
    cells.push(cell);
  }
  return { layout: 'cells', cells, compare: compareYoy ? 'yoy' : null };
}

// Time-series metrics_grid — emits one row per period (most recent first),
// columns = metrics. Each row pulls its own data slice from
// ctx.rawDataByPeriod[grain][offset] and runs through the same sum / list
// logic as the single-period path. Numbers / currency cells render directly;
// no embedded YoY object (time-series rows ARE the comparison).
function resolveTimeSeriesMetricsGrid(section, ctx) {
  const grain = section.time_grain;
  const n = clampPeriods(section.periods);
  const byGrain = (ctx.rawDataByPeriod || {})[grain] || {};
  const metricKeys = section.metrics || [];
  const referenceRaw = byGrain[0] || {};
  const matches = matchSources(referenceRaw, section.sources);
  // Resolve column labels from the first period that has each metric, so a
  // missing-in-period-0 metric still gets a sensible header.
  const metricLabels = metricKeys.map(mk => {
    for (let i = 0; i < n; i++) {
      const periodMatches = matchSources(byGrain[i] || {}, section.sources);
      for (const m of periodMatches) {
        const def = (METRIC_CATALOG[m.type] || {})[mk];
        if (def) return def.label;
      }
    }
    return mk.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  });
  const rows = [];
  for (let offset = 0; offset < n; offset++) {
    const periodRaw = byGrain[offset];
    if (!periodRaw) continue;
    const label = periodLabel({ ctx, grain, offset });
    const periodMatches = matchSources(periodRaw, section.sources);
    if (!periodMatches.length) {
      rows.push({ source: label, values: metricKeys.map(() => '—') });
      continue;
    }
    // "list" only makes sense for the single-period table; in a time-series
    // we always sum across sources of the same type for a given metric so
    // each (period, metric) cell is a single number.
    const totals = sumAcrossSources(periodMatches, metricKeys);
    const values = metricKeys.map(mk => {
      if (totals[mk] == null) {
        // Fall back: maybe only one source has this metric and sumAcross
        // skipped it (e.g. metric in list mode). Try first match's catalog.
        for (const m of periodMatches) {
          const def = (METRIC_CATALOG[m.type] || {})[mk];
          if (def) return formatValue(def.get(m.data), def.format);
        }
        return '—';
      }
      return formatValue(totals[mk], totals[`__format_${mk}`] || 'integer');
    });
    rows.push({ source: label, values });
  }
  return { layout: 'table', metricLabels, rows };
}

function clampPeriods(p) {
  // Hard-cap so a stray "periods: 100" doesn't trigger 100 connector
  // round-trips. 12 is enough for a year of monthly rows or a decade of
  // yearly rows.
  const n = parseInt(p, 10);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(n, 12);
}

function periodLabel({ ctx, grain, offset }) {
  const r = rangeForOffset({ periodStart: ctx.periodStart, periodEnd: ctx.periodEnd, grain, offset });
  return r.label;
}

// ─── PERIOD MATH ───────────────────────────────────────────────────────────
// Given the report's main period, return the (start, end, label) for a
// historical period at `offset` units back. offset=0 means "the current
// period" (used as a no-op so the same code path produces the top row).
function rangeForOffset({ periodStart, periodEnd, grain, offset }) {
  const startDate = parseYmd(periodStart);
  const endDate = parseYmd(periodEnd);
  if (grain === 'monthly') {
    // Anchor on the month containing periodStart, then walk backwards.
    const ref = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() - offset, 1));
    const start = ref;
    const lastDay = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0));
    // The current period may be a partial month (mid-month preview); keep
    // the user-specified end for offset 0 so the row matches the rest of
    // the report. Past months always run full calendar month.
    const end = offset === 0 ? endDate : lastDay;
    const sameYear = ref.getUTCFullYear() === startDate.getUTCFullYear();
    const label = ref.toLocaleString('en-GB', sameYear ? { month: 'short' } : { month: 'short', year: 'numeric' });
    return { start: ymd(start), end: ymd(end), label };
  }
  if (grain === 'yearly') {
    const year = startDate.getUTCFullYear() - offset;
    const start = new Date(Date.UTC(year, 0, 1));
    const end = offset === 0
      ? endDate
      : new Date(Date.UTC(year, 11, 31));
    return { start: ymd(start), end: ymd(end), label: String(year) };
  }
  if (grain === 'weekly') {
    const MS = 24 * 60 * 60 * 1000;
    const len = Math.floor((endDate - startDate) / MS) + 1;
    const start = new Date(startDate.getTime() - offset * 7 * MS);
    const end = new Date(start.getTime() + (len - 1) * MS);
    const label = `w/c ${start.toLocaleString('en-GB', { day: 'numeric', month: 'short' })}`;
    return { start: ymd(start), end: ymd(end), label };
  }
  throw new Error(`Unknown time_grain: ${grain}`);
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function ymd(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// Walks the template and returns the set of historical periods (per grain)
// that need to be fetched. reportService uses this to decide how many extra
// data-collection passes to run, and the renderer keys into the result by
// grain + offset.
function periodsForTimeSeries(template) {
  const out = { monthly: new Set(), weekly: new Set(), yearly: new Set() };
  for (const s of (template?.sections || [])) {
    if (s.type !== 'metrics_grid' || !s.time_grain) continue;
    if (!out[s.time_grain]) continue;
    const n = clampPeriods(s.periods);
    for (let i = 0; i < n; i++) out[s.time_grain].add(i);
  }
  return {
    monthly: [...out.monthly].sort((a, b) => a - b),
    weekly: [...out.weekly].sort((a, b) => a - b),
    yearly: [...out.yearly].sort((a, b) => a - b),
  };
}

// Combine current-period source data into one set of totals keyed by metric.
// AOV / ROAS are recomputed at the end from the summed inputs so an average
// of averages doesn't sneak in.
function sumAcrossSources(matches, metricKeys) {
  const totals = {};
  for (const m of matches) {
    const catalog = METRIC_CATALOG[m.type] || {};
    for (const mk of metricKeys) {
      const def = catalog[mk];
      if (!def) continue;
      if (mk === 'aov' || mk === 'roas') continue;
      totals[mk] = (totals[mk] || 0) + def.get(m.data);
      totals[`__format_${mk}`] = def.format;
      totals[`__label_${mk}`] = def.label;
    }
  }
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
  return totals;
}

// Re-construct the matches array against the year-ago raw data, using the
// same connector keys. Connectors that don't have year-ago data are skipped.
function matchSourcesFromPrev(matches, rawDataPrev) {
  return matches
    .filter(m => rawDataPrev[m.key])
    .map(m => ({ ...m, data: rawDataPrev[m.key] }));
}

function attachComparison(cell, currentRaw, previousRaw, format) {
  cell.previous = formatValue(previousRaw, format);
  if (previousRaw && previousRaw > 0) {
    const pct = ((currentRaw - previousRaw) / previousRaw) * 100;
    cell.delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    cell.deltaDirection = currentRaw > previousRaw ? 'up' : currentRaw < previousRaw ? 'down' : 'flat';
  }
}

// For the table layout, embed the previous value + delta directly into the
// rendered string so the existing table renderer doesn't need a structural
// change. Looks like "£24,674\n£18,210 (+35.5%)" once rendered with a
// line-break.
function withComparison(cur, currentRaw, previousRaw, format) {
  const prev = formatValue(previousRaw, format);
  if (!previousRaw || previousRaw <= 0) {
    return { current: cur, previous: prev };
  }
  const pct = ((currentRaw - previousRaw) / previousRaw) * 100;
  const direction = currentRaw > previousRaw ? 'up' : currentRaw < previousRaw ? 'down' : 'flat';
  return {
    current: cur,
    previous: prev,
    delta: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
    deltaDirection: direction,
  };
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
  if (has('october_forms')) {
    sections.push({ id: 'forms_metrics', title: 'Lead Form Performance', type: 'metrics_grid', sources: [{ type: 'october_forms' }], aggregate: 'sum', metrics: ['views', 'starts', 'completes', 'overall_conversion'] });
    sections.push({ id: 'forms_funnel', title: 'Lead Form Funnel', type: 'connector_table', sources: [{ type: 'october_forms' }] });
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
    if (s.compare != null && !['yoy'].includes(s.compare)) return `section[${i}].compare "${s.compare}" is invalid — only "yoy" is supported`;
    if (s.time_grain != null && !['monthly', 'weekly', 'yearly'].includes(s.time_grain)) return `section[${i}].time_grain "${s.time_grain}" is invalid — must be monthly, weekly or yearly`;
    if (s.time_grain && s.type !== 'metrics_grid') return `section[${i}].time_grain only applies to metrics_grid sections`;
    if (s.periods != null && (!Number.isFinite(s.periods) || s.periods < 1 || s.periods > 12)) return `section[${i}].periods must be a number 1–12`;
  }
  return null;
}

// Compute the same-period one year earlier, expressed as YYYY-MM-DD.
// Feb 29 rolls to Feb 28 when the prior year isn't a leap year.
function yoyDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const prevYear = y - 1;
  if (m === 2 && d === 29) {
    const isLeap = (prevYear % 4 === 0 && prevYear % 100 !== 0) || prevYear % 400 === 0;
    if (!isLeap) return `${prevYear}-02-28`;
  }
  return `${prevYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// True when at least one section in the template asks for year-over-year
// comparison. Used by reportService to decide whether to issue a second
// (year-ago) data collection pass.
function templateRequiresYoy(template) {
  return !!(template?.sections || []).some(s => s.compare === 'yoy');
}

// Older templates were authored before `compare` existed and just put
// "YoY"/"year-on-year" in the section title. Treat those as compare:"yoy"
// at load time so existing saved templates render comparisons without
// requiring the AM to re-prompt every client.
const YOY_TITLE_RE = /\b(yoy|year[-\s]on[-\s]year|year[-\s]over[-\s]year|vs\.?\s*last\s*year)\b/i;
function normaliseTemplate(template) {
  if (!template?.sections) return template;
  return {
    ...template,
    sections: template.sections.map(s => {
      if (s.type !== 'metrics_grid' || s.compare) return s;
      if (s.title && YOY_TITLE_RE.test(s.title)) return { ...s, compare: 'yoy' };
      return s;
    }),
  };
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
  yoyDate,
  templateRequiresYoy,
  normaliseTemplate,
  periodsForTimeSeries,
  rangeForOffset,
};
