import React, { useEffect, useState } from 'react';
import AdCreativePanel from '../components/AdCreativePanel';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Live ads dashboards from Google Ads and Meta Ads. The chat sidebar that
// used to live here was retired in favour of the AI Data Analyst — open
// questions about performance, budgets and creative strategy live there now,
// against the same underlying connector data.
export default function ClientAdsPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [adsData, setAdsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [adsMargin, setAdsMargin] = useState(0.46);
  const [adsMarginInput, setAdsMarginInput] = useState('46');
  const [tab, setTab] = useState('performance');

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

  function MetricCard({ label, value, sub }) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: '16px 20px', minWidth: 140 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a' }}>{value ?? '—'}</div>
        {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
      </div>
    );
  }

  const googleEntries = (adsData?.google_ads || []).map(parseGoogleAds);
  const metaEntries = (adsData?.meta_ads || []).map(parseMetaAds);
  const hasGoogle = googleEntries.filter(g => !g.error).length > 0;
  const hasMeta = metaEntries.filter(m => !m.error).length > 0;
  const noConnectors = !loading && !hasGoogle && !hasMeta;

  const tabs = [...(hasGoogle ? ['google'] : []), ...(hasMeta ? ['meta'] : [])];
  const [adsTab, setAdsTab] = useState('google');
  const activeAdsTab = tabs.includes(adsTab) ? adsTab : (tabs[0] || 'google');

  const googleTotal = googleEntries.filter(g => !g.error).reduce(
    (acc, g) => ({ spend: acc.spend + g.spend, revenue: acc.revenue + g.convValue, clicks: acc.clicks + g.clicks, convs: acc.convs + g.convs }),
    { spend: 0, revenue: 0, clicks: 0, convs: 0 }
  );
  const metaTotal = metaEntries.filter(m => !m.error).reduce(
    (acc, m) => ({ spend: acc.spend + m.spend, revenue: acc.revenue + m.purchaseValue, clicks: acc.clicks + m.clicks, imps: acc.imps + m.imps }),
    { spend: 0, revenue: 0, clicks: 0, imps: 0 }
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8e8e8', marginBottom: 18 }}>
        {[['performance', 'Performance'], ['creative', 'Creative']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14,
            fontWeight: tab === k ? 700 : 400, color: tab === k ? '#1a1a1a' : '#888',
            borderBottom: tab === k ? '2px solid #1a1a1a' : '2px solid transparent', marginBottom: -2,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'creative' && <AdCreativePanel clientId={id} clientName={client?.name || ''} />}
      {tab !== 'creative' && <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Ads Performance — {client?.name}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
            Live spend, ROAS, and campaign data from Google Ads and Meta Ads.{' '}
            <Link to={`/clients/${id}/chat`} style={{ color: '#1a1a1a', fontWeight: 600 }}>Ask the AI Data Analyst →</Link>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 6 }}>
            <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>Gross Margin</span>
            <input type="number" min="0" max="100" step="1" value={adsMarginInput}
              onChange={e => setAdsMarginInput(e.target.value)} onBlur={handleMarginBlur}
              style={{ width: 48, padding: '4px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, textAlign: 'right' }} />
            <span style={{ fontSize: 12, color: '#666' }}>%</span>
          </div>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => handlePeriodChange(d)}
              style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid #ddd', background: days === d ? '#E7CD41' : '#fff', color: '#1a1a1a', fontSize: 13, fontWeight: days === d ? 700 : 600, cursor: 'pointer' }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!loading && !noConnectors && (
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8e8e8', marginTop: 16, marginBottom: 24 }}>
          {hasGoogle && (
            <button onClick={() => setAdsTab('google')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14, fontWeight: activeAdsTab === 'google' ? 700 : 400, color: activeAdsTab === 'google' ? '#1a1a1a' : '#888', borderBottom: activeAdsTab === 'google' ? '2px solid #4285f4' : '2px solid transparent', marginBottom: -2 }}>
              Google Ads
            </button>
          )}
          {hasMeta && (
            <button onClick={() => setAdsTab('meta')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14, fontWeight: activeAdsTab === 'meta' ? 700 : 400, color: activeAdsTab === 'meta' ? '#1a1a1a' : '#888', borderBottom: activeAdsTab === 'meta' ? '2px solid #1877f2' : '2px solid transparent', marginBottom: -2 }}>
              Meta Ads
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading ads data…</div>
      ) : adsData?.error ? (
        <div style={{ color: '#c62828', padding: 20, fontSize: 14 }}>Error: {adsData.error}</div>
      ) : noConnectors ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 14 }}>
          No active Google Ads or Meta Ads connectors found for this client.<br />
          <span style={{ fontSize: 12, color: '#aaa' }}>Connect them on the client's Connectors tab, then return here.</span>
        </div>
      ) : (
        <>
          {activeAdsTab === 'google' && hasGoogle && (
            <div>
              {googleEntries.filter(g => !g.error).length > 1 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>All Countries — Combined</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <MetricCard label="Total Spend" value={fmtCurrency(googleTotal.spend)} />
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
                  {g.store_label && <div style={{ fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 10 }}>{g.store_label}</div>}
                  {g.error ? <div style={{ color: '#c62828', fontSize: 13, marginBottom: 8 }}>{g.error}</div> : (
                    <>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                        <MetricCard label="Spend" value={fmtCurrency(g.spend)} />
                        <MetricCard label="Revenue" value={g.convValue > 0 ? fmtCurrency(g.convValue) : '—'} />
                        <MetricCard label="ROAS" value={g.roas ? `${g.roas.toFixed(2)}x` : '—'} />
                        {g.convValue > 0 && <MetricCard label={`Profit (${Math.round(adsMargin * 100)}%)`} value={fmtCurrency(g.convValue * adsMargin - g.spend)} sub="Revenue × margin − Spend" />}
                        <MetricCard label="Clicks" value={fmt(g.clicks)} />
                        <MetricCard label="Conv." value={fmt(g.convs)} />
                        <MetricCard label="CPC" value={fmtCurrency(g.avgCpc)} sub="avg" />
                      </div>
                      {g.campaigns?.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr style={{ background: '#f5f5f5' }}>
                              {['Campaign', 'Spend', 'Revenue', 'Profit', 'ROAS', 'Clicks', 'Conv.'].map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#555', borderBottom: '1px solid #e8e8e8' }}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {g.campaigns.map((c, j) => {
                                const roas = c.spend > 0 && c.convValue > 0 ? (c.convValue / c.spend).toFixed(2) : null;
                                const profit = c.convValue > 0 ? c.convValue * adsMargin - c.spend : null;
                                return (
                                  <tr key={j} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                    <td style={{ padding: '8px 12px' }}>{c.name}</td>
                                    <td style={{ padding: '8px 12px' }}>{fmtCurrency(c.spend)}</td>
                                    <td style={{ padding: '8px 12px' }}>{c.convValue > 0 ? fmtCurrency(c.convValue) : '—'}</td>
                                    <td style={{ padding: '8px 12px', color: profit != null ? (profit >= 0 ? '#2e7d32' : '#c62828') : undefined, fontWeight: profit != null ? 600 : undefined }}>{profit != null ? fmtCurrency(profit) : '—'}</td>
                                    <td style={{ padding: '8px 12px' }}>{roas ? `${roas}x` : '—'}</td>
                                    <td style={{ padding: '8px 12px' }}>{fmt(c.clicks)}</td>
                                    <td style={{ padding: '8px 12px' }}>{fmt(c.conversions)}</td>
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

          {activeAdsTab === 'meta' && hasMeta && (
            <div>
              {metaEntries.filter(m => !m.error).length > 1 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>All Countries — Combined</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <MetricCard label="Total Spend" value={fmtCurrency(metaTotal.spend)} />
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
                  {m.store_label && <div style={{ fontSize: 13, fontWeight: 700, color: '#444', marginBottom: 10 }}>{m.store_label}</div>}
                  {m.error ? <div style={{ color: '#c62828', fontSize: 13, marginBottom: 8 }}>{m.error}</div> : (
                    <>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                        <MetricCard label="Spend" value={fmtCurrency(m.spend)} />
                        <MetricCard label="Revenue" value={m.purchaseValue > 0 ? fmtCurrency(m.purchaseValue) : '—'} />
                        <MetricCard label="ROAS" value={m.roas ? `${m.roas.toFixed(2)}x` : '—'} />
                        {m.purchaseValue > 0 && <MetricCard label={`Profit (${Math.round(adsMargin * 100)}%)`} value={fmtCurrency(m.purchaseValue * adsMargin - m.spend)} sub="Revenue × margin − Spend" />}
                        <MetricCard label="Impressions" value={fmt(m.imps)} />
                        <MetricCard label="Clicks" value={fmt(m.clicks)} />
                        <MetricCard label="CTR" value={m.ctr ? `${(m.ctr * 100).toFixed(2)}%` : '—'} />
                      </div>
                      {m.campaigns?.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr style={{ background: '#f5f5f5' }}>
                              {['Campaign', 'Spend', 'Clicks', 'Impressions'].map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#555', borderBottom: '1px solid #e8e8e8' }}>{h}</th>
                              ))}
                            </tr></thead>
                            <tbody>
                              {m.campaigns.map((c, j) => (
                                <tr key={j} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                  <td style={{ padding: '8px 12px' }}>{c.name}</td>
                                  <td style={{ padding: '8px 12px' }}>{fmtCurrency(c.spend)}</td>
                                  <td style={{ padding: '8px 12px' }}>{fmt(c.clicks)}</td>
                                  <td style={{ padding: '8px 12px' }}>{fmt(c.impressions)}</td>
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
