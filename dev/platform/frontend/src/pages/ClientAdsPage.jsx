import React, { useEffect, useState } from 'react';
import AdCreativePanel from '../components/AdCreativePanel';
import StrategistPanel from '../components/StrategistPanel';
import AudiencesPanel from '../components/AudiencesPanel';
import SuiteOverview from '../components/SuiteOverview';
import GoogleAdsPlaybook from '../components/GoogleAdsPlaybook';
import { useParams, useNavigate, Link } from 'react-router-dom';
import SuiteTabs from '../components/SuiteTabs';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Live ads dashboards from Google Ads and Meta Ads. The chat sidebar that
// used to live here was retired in favour of the AI Data Analyst — open
// questions about performance, budgets and creative strategy live there now,
// against the same underlying connector data.
export default function ClientAdsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [adsData, setAdsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [adsMargin, setAdsMargin] = useState(0.46);
  const [adsMarginInput, setAdsMarginInput] = useState('46');
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    return ['overview','performance','strategist','creative','audiences'].includes(q) ? q : 'overview';
  });

  useEffect(() => {
    api.get(`/clients/${id}`).then(c => {
      setClient(c);
      if (c?.ads_margin != null) {
        setAdsMargin(parseFloat(c.ads_margin));
        setAdsMarginInput(String(Math.round(parseFloat(c.ads_margin) * 100)));
      }
    }).catch(() => {});
    loadAdsData(30);
  }, [id]);

  async function loadAdsData(d) {
    setLoading(true);
    try {
      const result = await api.get(`/connectors/client/${id}/ads-data?days=${d}`);
      setAdsData(result);
    } catch (err) {
      setAdsData({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  function handlePeriodChange(d) {
    setDays(d);
    loadAdsData(d);
  }

  async function handleMarginBlur() {
    const val = parseFloat(adsMarginInput);
    if (isNaN(val) || val < 0 || val > 100) return;
    const decimal = val / 100;
    setAdsMargin(decimal);
    try {
      await api.patch(`/clients/${id}/ads-margin`, { ads_margin: decimal });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function fmt(n, prefix = '') {
    if (n == null || isNaN(n)) return '—';
    return `${prefix}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  }
  function fmtCurrency(n) {
    if (n == null || isNaN(n)) return '—';
    return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function parseGoogleAds(entry) {
    if (entry.error) return { error: entry.error };
    const raw = entry.data || {};
    const results = raw.results || (Array.isArray(raw) ? raw.flatMap(b => b.results || []) : []);
    let spend = 0, clicks = 0, convs = 0, convValue = 0, imps = 0;
    const campaignMap = {};
    for (const r of results) {
      const s = parseInt(r.metrics?.costMicros || 0) / 1e6;
      const c = parseInt(r.metrics?.clicks || 0);
      const cv = parseFloat(r.metrics?.conversions || 0);
      const cvv = parseFloat(r.metrics?.conversionsValue || 0);
      const imp = parseInt(r.metrics?.impressions || 0);
      spend += s; clicks += c; convs += cv; convValue += cvv; imps += imp;
      const name = r.campaign?.name;
      if (name) {
        if (!campaignMap[name]) campaignMap[name] = { name, spend: 0, clicks: 0, conversions: 0, convValue: 0 };
        campaignMap[name].spend += s;
        campaignMap[name].clicks += c;
        campaignMap[name].conversions += cv;
        campaignMap[name].convValue += cvv;
      }
    }
    const roas = spend > 0 && convValue > 0 ? convValue / spend : null;
    const avgCpc = clicks > 0 ? spend / clicks : null;
    const campaigns = Object.values(campaignMap).sort((a, b) => b.spend - a.spend);
    return { spend, clicks, convs, convValue, imps, roas, avgCpc, campaigns, store_label: entry.store_label };
  }

  function parseMetaAds(entry) {
    if (entry.error) return { error: entry.error };
    const raw = entry.data || {};
    const data = raw.data || [];
    let spend = 0, imps = 0, clicks = 0, purchaseValue = 0;
    const campaignMap = {};
    for (const r of data) {
      const s = parseFloat(r.spend || 0);
      spend += s;
      imps += parseInt(r.impressions || 0);
      clicks += parseInt(r.clicks || 0);
      const actions = r.action_values || [];
      const purchaseAction = actions.find(a => a.action_type === 'purchase');
      purchaseValue += parseFloat(purchaseAction?.value || 0);
      const name = r.campaign_name;
      if (name) {
        if (!campaignMap[name]) campaignMap[name] = { name, spend: 0, clicks: 0, impressions: 0 };
        campaignMap[name].spend += s;
        campaignMap[name].clicks += parseInt(r.clicks || 0);
        campaignMap[name].impressions += parseInt(r.impressions || 0);
      }
    }
    const roas = spend > 0 && purchaseValue > 0 ? purchaseValue / spend : null;
    const ctr = imps > 0 ? (clicks / imps) : null;
    const campaigns = Object.values(campaignMap).sort((a, b) => b.spend - a.spend);
    return { spend, imps, clicks, purchaseValue, roas, ctr, campaigns, store_label: entry.store_label };
  }

  function MetricCard({ label, value, sub, feature }) {
    return (
      <div className={'stat' + (feature ? ' feature' : '')} style={{ flex: '1 1 150px', minHeight: 0, padding: 'var(--s4)' }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={{ fontSize: 30, marginTop: 'var(--s2)', letterSpacing: '-1px' }}>{value ?? '—'}</div>
        {sub && <div className="stat-sub" style={{ marginTop: 'var(--s1)' }}>{sub}</div>}
      </div>
    );
  }

  // Green / red pill for table figures (profit, ROAS) — matches the
  // dashboard's delta chips.
  function Pill({ positive, children }) {
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--r-sm)', fontWeight: 700, fontSize: 12, background: positive ? 'var(--positive-soft)' : 'var(--negative-soft)', color: positive ? 'var(--positive)' : 'var(--negative)' }}>{children}</span>
    );
  }

  const googleEntries = (adsData?.google_ads || []).map(parseGoogleAds);
  const metaEntries = (adsData?.meta_ads || []).map(parseMetaAds);
  const hasGoogle = googleEntries.filter(g => !g.error).length > 0;
  const hasMeta = metaEntries.filter(m => !m.error).length > 0;
  // Show the tab even when every account returned an error, so the AM can
  // see the underlying API message instead of the whole platform silently
  // disappearing. Without this you have to open DevTools → Network just to
  // find out a developer token is missing or a customer ID is wrong.
  const showGoogleTab = hasGoogle || googleEntries.length > 0;
  const showMetaTab = hasMeta || metaEntries.length > 0;
  const noConnectors = !loading && !googleEntries.length && !metaEntries.length;

  const googleTotal = googleEntries.filter(g => !g.error).reduce(
    (acc, g) => ({ spend: acc.spend + g.spend, revenue: acc.revenue + g.convValue, clicks: acc.clicks + g.clicks, convs: acc.convs + g.convs }),
    { spend: 0, revenue: 0, clicks: 0, convs: 0 }
  );
  const metaTotal = metaEntries.filter(m => !m.error).reduce(
    (acc, m) => ({ spend: acc.spend + m.spend, revenue: acc.revenue + m.purchaseValue, clicks: acc.clicks + m.clicks, imps: acc.imps + m.imps }),
    { spend: 0, revenue: 0, clicks: 0, imps: 0 }
  );

  return (
    <div className="suite-paid">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Paid media · Google Ads + Meta</span></div>
      <header className="hero">
        <div>
          <h1 className="display mt-2">Paid</h1>
        </div>
      </header>
      <SuiteTabs tabs={[
        { key: 'overview',    label: 'Overview',    active: tab === 'overview',    onClick: () => setTab('overview') },
        { key: 'performance', label: 'Performance', active: tab === 'performance', onClick: () => setTab('performance') },
        { key: 'strategist',  label: 'Strategist',  active: tab === 'strategist',  onClick: () => setTab('strategist') },
        { key: 'creative',    label: 'Creative',    active: tab === 'creative',    onClick: () => setTab('creative') },
        { key: 'audiences',   label: 'Audiences',   active: tab === 'audiences',   onClick: () => setTab('audiences') },
      ]} />

      {tab === 'overview' && (
        <div className="stack stack-lg">
        <SuiteOverview
          tagline="Live ads, AI strategy, on-brand creative."
          description="Google + Meta dashboards, weekly Claude briefings on what to action next, AI-generated ad creative, and audience segments built from your Shopify data."
          ctaLabel="View live performance"
          onCta={() => setTab('performance')}
          flow={[
            { label: 'Connect',  detail: 'Google Ads + Meta Ads' },
            { label: 'Monitor',  detail: 'Live spend, ROAS, profit' },
            { label: 'Strategise', detail: 'Weekly Claude briefings' },
            { label: 'Generate', detail: 'Creative + audiences' },
          ]}
          capabilities={[
            { tag: 'Performance', title: 'Live dashboards',          body: 'Spend, revenue, ROAS, profit (margin-aware), and per-campaign breakdown — across every Google + Meta ad account.' },
            { tag: 'Strategist',  title: 'Weekly Manus-style brief',  body: 'Claude reads the last period vs. the previous one and writes an analyst note telling you what to action next.' },
            { tag: 'Creative',    title: 'AI ad creative',           body: 'Generate static ads across multiple aspect ratios via Replicate, Ideogram, ChatGPT Image, and Adobe Firefly — grounded in the brand kit.' },
            { tag: 'Audiences',   title: 'First-party segments',     body: 'Build targetable segments from Shopify postcode data and export them as Meta Custom Audience CSVs.' },
          ]}
        />
        <GoogleAdsPlaybook />
        </div>
      )}

      {tab === 'creative' && <AdCreativePanel clientId={id} clientName={client?.name || ''} />}
      {tab === 'strategist' && <StrategistPanel clientId={id} hasMeta={hasMeta} hasGoogle={hasGoogle} />}
      {tab === 'audiences' && <AudiencesPanel clientId={id} />}
      {tab === 'performance' && <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => handlePeriodChange(d)}
            style={{ padding: '6px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: days === d ? 'var(--accent)' : 'var(--surface)', color: days === d ? 'var(--accent-on)' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {d}d
          </button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>Margin</span>
          <input type="number" min="0" max="100" step="1" value={adsMarginInput}
            onChange={e => setAdsMarginInput(e.target.value)} onBlur={handleMarginBlur}
            style={{ width: 42, padding: '2px 4px', border: 'none', fontSize: 13, textAlign: 'right', background: 'transparent', fontFamily: 'inherit' }} />
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>%</span>
        </div>
        <Link to={`/clients/${id}/chat`} className="btn btn-secondary btn-sm">Ask the AI Analyst →</Link>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)' }}>Loading ads data…</div>
      ) : adsData?.error ? (
        <div className="text-negative" style={{ padding: 20, fontSize: 14 }}>Error: {adsData.error}</div>
      ) : noConnectors ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-subtle)', fontSize: 14 }}>
          No active Google Ads or Meta Ads connectors found for this client.<br />
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Connect them on the client's Connectors tab, then return here.</span>
        </div>
      ) : (
        <>
          {showGoogleTab && (
            <div>
              <h2 className="h2" style={{ marginBottom: 'var(--s4)' }}>Google Ads</h2>
              {googleEntries.filter(g => !g.error).length > 1 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>All Countries — Combined</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <MetricCard label="Total Spend" value={fmtCurrency(googleTotal.spend)} feature />
                    <MetricCard label="Total Revenue" value={googleTotal.revenue > 0 ? fmtCurrency(googleTotal.revenue) : '—'} />
                    <MetricCard label="Blended ROAS" value={googleTotal.spend > 0 && googleTotal.revenue > 0 ? `${(googleTotal.revenue / googleTotal.spend).toFixed(2)}x` : '—'} />
                    {googleTotal.revenue > 0 && <MetricCard label={`Profit (${Math.round(adsMargin * 100)}%)`} value={fmtCurrency(googleTotal.revenue * adsMargin - googleTotal.spend)} sub="Revenue × margin − Spend" />}
                    <MetricCard label="Clicks" value={fmt(googleTotal.clicks)} />
                    <MetricCard label="Conversions" value={fmt(googleTotal.convs)} />
                  </div>
                  <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '20px 0 8px' }} />
                </div>
              )}
              {googleEntries.map((g, i) => (
                <div key={i} style={{ marginBottom: 28 }}>
                  {g.store_label && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>{g.store_label}</div>}
                  {g.error ? <div className="text-negative" style={{ fontSize: 13, marginBottom: 8 }}>{g.error}</div> : (
                    <>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                        <MetricCard label="Spend" value={fmtCurrency(g.spend)} feature />
                        <MetricCard label="Revenue" value={g.convValue > 0 ? fmtCurrency(g.convValue) : '—'} />
                        <MetricCard label="ROAS" value={g.roas ? `${g.roas.toFixed(2)}x` : '—'} />
                        {g.convValue > 0 && <MetricCard label={`Profit (${Math.round(adsMargin * 100)}%)`} value={fmtCurrency(g.convValue * adsMargin - g.spend)} sub="Revenue × margin − Spend" />}
                        <MetricCard label="Clicks" value={fmt(g.clicks)} />
                        <MetricCard label="Conv." value={fmt(g.convs)} />
                        <MetricCard label="CPC" value={fmtCurrency(g.avgCpc)} sub="avg" />
                      </div>
                      {g.campaigns?.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Campaign</th>
                                <th className="num">Spend</th>
                                <th className="num">Revenue</th>
                                <th className="num">Profit</th>
                                <th className="num">ROAS</th>
                                <th className="num">Clicks</th>
                                <th className="num">Conv.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.campaigns.map((c, j) => {
                                const roas = c.spend > 0 && c.convValue > 0 ? (c.convValue / c.spend) : null;
                                const profit = c.convValue > 0 ? c.convValue * adsMargin - c.spend : null;
                                return (
                                  <tr key={j}>
                                    <td>{c.name}</td>
                                    <td className="num">{fmtCurrency(c.spend)}</td>
                                    <td className="num">{c.convValue > 0 ? fmtCurrency(c.convValue) : '—'}</td>
                                    <td className="num">{profit != null ? <Pill positive={profit >= 0}>{fmtCurrency(profit)}</Pill> : '—'}</td>
                                    <td className="num">{roas != null ? <Pill positive={profit == null || profit >= 0}>{roas.toFixed(2)}x</Pill> : '—'}</td>
                                    <td className="num">{fmt(c.clicks)}</td>
                                    <td className="num">{fmt(c.conversions)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {showMetaTab && (
            <div style={{ marginTop: showGoogleTab ? 'var(--s8)' : 0 }}>
              <h2 className="h2" style={{ marginBottom: 'var(--s4)' }}>Meta Ads</h2>
              {metaEntries.filter(m => !m.error).length > 1 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>All Countries — Combined</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <MetricCard label="Total Spend" value={fmtCurrency(metaTotal.spend)} feature />
                    <MetricCard label="Total Revenue" value={metaTotal.revenue > 0 ? fmtCurrency(metaTotal.revenue) : '—'} />
                    <MetricCard label="Blended ROAS" value={metaTotal.spend > 0 && metaTotal.revenue > 0 ? `${(metaTotal.revenue / metaTotal.spend).toFixed(2)}x` : '—'} />
                    {metaTotal.revenue > 0 && <MetricCard label={`Profit (${Math.round(adsMargin * 100)}%)`} value={fmtCurrency(metaTotal.revenue * adsMargin - metaTotal.spend)} sub="Revenue × margin − Spend" />}
                    <MetricCard label="Clicks" value={fmt(metaTotal.clicks)} />
                    <MetricCard label="Impressions" value={fmt(metaTotal.imps)} />
                  </div>
                  <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: '20px 0 8px' }} />
                </div>
              )}
              {metaEntries.map((m, i) => (
                <div key={i} style={{ marginBottom: 28 }}>
                  {m.store_label && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>{m.store_label}</div>}
                  {m.error ? <div className="text-negative" style={{ fontSize: 13, marginBottom: 8 }}>{m.error}</div> : (
                    <>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                        <MetricCard label="Spend" value={fmtCurrency(m.spend)} feature />
                        <MetricCard label="Revenue" value={m.purchaseValue > 0 ? fmtCurrency(m.purchaseValue) : '—'} />
                        <MetricCard label="ROAS" value={m.roas ? `${m.roas.toFixed(2)}x` : '—'} />
                        {m.purchaseValue > 0 && <MetricCard label={`Profit (${Math.round(adsMargin * 100)}%)`} value={fmtCurrency(m.purchaseValue * adsMargin - m.spend)} sub="Revenue × margin − Spend" />}
                        <MetricCard label="Impressions" value={fmt(m.imps)} />
                        <MetricCard label="Clicks" value={fmt(m.clicks)} />
                        <MetricCard label="CTR" value={m.ctr ? `${(m.ctr * 100).toFixed(2)}%` : '—'} />
                      </div>
                      {m.campaigns?.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Campaign</th>
                                <th className="num">Spend</th>
                                <th className="num">Clicks</th>
                                <th className="num">Impressions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.campaigns.map((c, j) => (
                                <tr key={j}>
                                  <td>{c.name}</td>
                                  <td className="num">{fmtCurrency(c.spend)}</td>
                                  <td className="num">{fmt(c.clicks)}</td>
                                  <td className="num">{fmt(c.impressions)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </>}
    </div>
  );
}
