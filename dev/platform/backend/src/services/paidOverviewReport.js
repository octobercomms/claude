// Paid Overview PDF — gathers the headline of the Paid (Ads) pillar into one
// branded, client-ready document: connected ad accounts, blended spend / revenue
// / ROAS with a top-campaign breakdown, and the audience intelligence picture
// (top revenue postcodes + saved segments).
//
// Ad performance is a LIVE connector read (there is no stored snapshot), so it is
// best-effort and time-boxed: if a connector is slow or errors, the report still
// renders with whatever came back plus the audience section. Audience data is
// read from the cache table only — the report never recomputes it.

const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const connectorFactory = require('../connectors');
const R = require('./overviewReport');

const FETCH_BUDGET_MS = 25000;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Parse a Google Ads connector payload → totals + campaigns (mirrors the Paid
// page's parseGoogleAds so the PDF matches what the AM sees on screen).
function parseGoogle(entry) {
  if (!entry || entry.error) return null;
  const raw = entry.data || {};
  const results = raw.results || (Array.isArray(raw) ? raw.flatMap(b => b.results || []) : []);
  let spend = 0, clicks = 0, convs = 0, convValue = 0, imps = 0;
  const map = {};
  for (const r of results) {
    const s = parseInt(r.metrics?.costMicros || 0) / 1e6;
    const c = parseInt(r.metrics?.clicks || 0);
    const cv = parseFloat(r.metrics?.conversions || 0);
    const cvv = parseFloat(r.metrics?.conversionsValue || 0);
    const imp = parseInt(r.metrics?.impressions || 0);
    spend += s; clicks += c; convs += cv; convValue += cvv; imps += imp;
    const name = r.campaign?.name;
    if (name) { (map[name] ||= { name, spend: 0, clicks: 0, conversions: 0, revenue: 0 }); map[name].spend += s; map[name].clicks += c; map[name].conversions += cv; map[name].revenue += cvv; }
  }
  return { platform: 'Google', spend, clicks, convs, revenue: convValue, imps, campaigns: Object.values(map).sort((a, b) => b.spend - a.spend) };
}

function parseMeta(entry) {
  if (!entry || entry.error) return null;
  const raw = entry.data || {};
  const data = raw.data || [];
  let spend = 0, imps = 0, clicks = 0, revenue = 0;
  const map = {};
  for (const r of data) {
    const s = parseFloat(r.spend || 0);
    spend += s; imps += parseInt(r.impressions || 0); clicks += parseInt(r.clicks || 0);
    const purchase = (r.action_values || []).find(a => a.action_type === 'purchase');
    revenue += parseFloat(purchase?.value || 0);
    const name = r.campaign_name;
    if (name) { (map[name] ||= { name, spend: 0, clicks: 0, conversions: 0, revenue: 0 }); map[name].spend += s; map[name].clicks += parseInt(r.clicks || 0); }
  }
  return { platform: 'Meta', spend, clicks, convs: 0, revenue, imps, campaigns: Object.values(map).sort((a, b) => b.spend - a.spend) };
}

async function fetchConnector(row, startDate, endDate) {
  const creds = decrypt(row.credentials);
  const config = row.config || {};
  const mod = connectorFactory.get(row.connector_type);
  const raw = await mod.fetchData(creds, {
    ...config, connectorType: row.connector_type, authMode: row.auth_mode,
    customerId: config.value, adAccountId: config.value, startDate, endDate,
  });
  return { store_label: row.store_label, data: raw };
}

async function reportData(clientId, { days = 30 } = {}) {
  const end = new Date();
  const start = new Date(end - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];
  const startDate = fmt(start), endDate = fmt(end);

  const { rows: conns } = await pool.query(
    `SELECT id, connector_type, store_label, credentials, config, auth_mode
       FROM connectors
      WHERE client_id = $1 AND connector_type IN ('google_ads','meta_ads') AND status <> 'disconnected'`,
    [clientId]
  );
  const googleConns = conns.filter(c => c.connector_type === 'google_ads');
  const metaConns = conns.filter(c => c.connector_type === 'meta_ads');

  // Best-effort, time-boxed live fetch across every connected ad account.
  const parsed = await withTimeout(
    Promise.all(conns.map(async row => {
      try {
        const entry = await fetchConnector(row, startDate, endDate);
        return row.connector_type === 'google_ads' ? parseGoogle(entry) : parseMeta(entry);
      } catch { return null; }
    })).then(list => list.filter(Boolean)),
    FETCH_BUDGET_MS, []
  );

  const totals = parsed.reduce((a, p) => ({
    spend: a.spend + p.spend, revenue: a.revenue + p.revenue,
    clicks: a.clicks + p.clicks, imps: a.imps + p.imps, convs: a.convs + p.convs,
  }), { spend: 0, revenue: 0, clicks: 0, imps: 0, convs: 0 });
  totals.roas = totals.spend > 0 && totals.revenue > 0 ? totals.revenue / totals.spend : null;

  const campaigns = parsed.flatMap(p => p.campaigns.map(c => ({ ...c, platform: p.platform })))
    .sort((a, b) => b.spend - a.spend).slice(0, 10);

  const ads = {
    google_accounts: googleConns.length,
    meta_accounts: metaConns.length,
    performance_available: parsed.length > 0,
    totals, campaigns,
  };

  // Audience intelligence — read the cache only (never recompute here).
  let audience = null;
  const { rows: ac } = await pool.query(
    `SELECT postcodes, total_orders, total_revenue, source, computed_at
       FROM audience_postcode_cache WHERE client_id = $1`,
    [clientId]
  );
  const { rows: segCount } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM audience_segments WHERE client_id = $1`,
    [clientId]
  );
  if (ac.length) {
    const c = ac[0];
    const postcodes = Array.isArray(c.postcodes) ? c.postcodes : [];
    audience = {
      total_orders: c.total_orders || 0,
      total_revenue: Number(c.total_revenue) || 0,
      source: c.source, computed_at: c.computed_at,
      segments: segCount[0]?.n || 0,
      top_postcodes: postcodes.slice(0, 12),
    };
  } else {
    audience = { total_orders: 0, total_revenue: 0, source: null, computed_at: null, segments: segCount[0]?.n || 0, top_postcodes: [] };
  }

  return { days, startDate, endDate, ads, audience, has_data: conns.length > 0 || audience.total_orders > 0 };
}

function buildSummaryPrompt({ client, data }) {
  const t = data.ads.totals;
  return {
    system: 'You are a senior paid-media consultant at October Communications writing the opening summary of a Paid Ads Overview report for a client. British English. 2–3 short sentences, plain and confident, no jargon or lists. Say how paid media is performing overall and the ONE thing to focus on next. Do not invent numbers beyond those given.',
    user: `Client: ${client.name || ''} (${client.domain || ''})
Connected ad accounts: ${data.ads.google_accounts} Google, ${data.ads.meta_accounts} Meta.
Last ${data.days} days: spend ${Math.round(t.spend)}, revenue ${Math.round(t.revenue)}, blended ROAS ${t.roas ? t.roas.toFixed(2) + 'x' : 'n/a'}.
Audience: ${data.audience.total_orders} mapped orders, ${data.audience.segments} saved segments.`,
  };
}

function roasColour(roas) {
  if (roas == null) return null;
  return roas >= 3 ? R.GREEN : roas >= 1.5 ? R.AMBER : R.RED;
}

function buildHtml({ client, data, aiSummary = null }) {
  const ads = data.ads;
  const t = ads.totals;
  const aud = data.audience;

  const perfBlock = ads.performance_available ? `
    <div class="metrics">
      ${R.metric('Spend', R.gbp(t.spend))}
      ${R.metric('Revenue', t.revenue > 0 ? R.gbp(t.revenue) : '—')}
      ${R.metric('Blended ROAS', t.roas ? `${t.roas.toFixed(2)}x` : '—', roasColour(t.roas))}
      ${R.metric('Clicks', R.fmtInt(t.clicks))}
    </div>
    <div class="note">Blended paid performance across every connected Google and Meta account for the last ${data.days} days. ROAS is revenue divided by spend where conversion value is tracked.</div>
    ${ads.campaigns.length ? `<h2 class="sec">Top campaigns by spend</h2>
      <table><thead><tr><th>Campaign</th><th>Platform</th><th class="num">Spend</th><th class="num">Revenue</th><th class="num">Clicks</th></tr></thead><tbody>
        ${ads.campaigns.map(c => `<tr>
          <td class="q">${R.esc(c.name)}</td>
          <td>${R.esc(c.platform)}</td>
          <td class="num">${R.gbp(c.spend)}</td>
          <td class="num">${c.revenue > 0 ? R.gbp(c.revenue) : '—'}</td>
          <td class="num">${R.fmtInt(c.clicks)}</td></tr>`).join('')}
      </tbody></table>` : ''}` : `
    <div class="note">${(ads.google_accounts + ads.meta_accounts) > 0
      ? 'Live campaign performance could not be loaded at export time — the connected accounts are listed above; open the Paid → Measure tab for the live figures.'
      : 'No ad accounts are connected yet. Connect Google Ads or Meta Ads from Setup → Connectors to include performance here.'}</div>`;

  const pcMax = Math.max(1, ...aud.top_postcodes.map(p => Number(p.revenue) || 0));
  const pcBars = aud.top_postcodes.map(p => R.barRow(p.postcode_district || '—', R.gbp(p.revenue), pcMax, '#6b7cff')).join('');

  const audBlock = `
    <h2 class="sec">Audience intelligence ${aud.computed_at ? `<span class="src">mapped ${R.esc(R.fmtDate(aud.computed_at))}</span>` : ''}</h2>
    <div class="metrics" style="margin-bottom:10px">
      ${R.metric('Mapped orders', R.fmtInt(aud.total_orders))}
      ${R.metric('Order revenue', aud.total_revenue > 0 ? R.gbp(aud.total_revenue) : '—')}
      ${R.metric('Saved segments', R.fmtInt(aud.segments))}
    </div>
    ${aud.top_postcodes.length
      ? `<div class="note">Where the brand's customers are — the postcode districts driving the most order revenue. These feed lookalike and geo-targeted ad audiences.</div>${pcBars}`
      : '<div class="empty">No customer postcode data yet — connect a Shopify or WooCommerce store, or upload a customer list, on the Paid → Audiences tab.</div>'}`;

  const body = `
    <div class="metrics">
      ${R.metric('Google Ads', R.fmtInt(ads.google_accounts), ads.google_accounts ? R.GREEN : null, ads.google_accounts === 1 ? 'account' : 'accounts')}
      ${R.metric('Meta Ads', R.fmtInt(ads.meta_accounts), ads.meta_accounts ? R.GREEN : null, ads.meta_accounts === 1 ? 'account' : 'accounts')}
      ${R.metric('Spend · last ' + data.days + 'd', ads.performance_available ? R.gbp(t.spend) : '—')}
    </div>
    <h2 class="sec">Performance</h2>
    ${perfBlock}
    ${audBlock}`;

  return R.renderShell({
    client, wordmark: 'Paid Overview', title: client.name || 'Paid Overview',
    metaBits: [client.domain, R.fmtDate(new Date().toISOString()), `last ${data.days} days`],
    aiSummary, bodyHtml: body,
  });
}

module.exports = { reportData, buildHtml, buildSummaryPrompt };
