import React, { useEffect, useState } from 'react';
import PillarMeasure from '../components/PillarMeasure';
import AdResizePanel from '../components/AdResizePanel';
import AudiencesPanel from '../components/AudiencesPanel';
import ICPIntelligencePanel from '../components/ICPIntelligencePanel';
import CompetitorAdsPanel from '../components/CompetitorAdsPanel';
import GoogleAdsPlaybookQuick from '../components/GoogleAdsPlaybookQuick';
import PaidPipelinePanel from '../components/paid/PaidPipelinePanel';
import PaidLibraryPanel from '../components/paid/PaidLibraryPanel';
import { useParams, useNavigate } from 'react-router-dom';
import PageShell from '../components/shells/PageShell';
import StatStrip from '../components/shells/StatStrip';
import SideDrawer from '../components/ui/SideDrawer';
import { useTabParam } from '../hooks/useTabParam';
import { api } from '../utils/api';
import { formatMoney } from '../utils/money';
import { showCombined } from '../utils/adsTotals';
import { resolvePaidTab } from '../utils/paidTabs';
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
  // Two groups: Measure and Build.
  //
  // "Health" was a container holding Measure, Competitors and Playbook, and
  // everyone opened Measure. A tab whose only job is to hold the tab you
  // wanted is a tax, so Measure is the landing and the page says what it is.
  // Competitors moved into Build (it is research that feeds a brief, and it
  // was a dead end sitting beside the numbers), and the Playbook is reference
  // rather than a section, so it opens in a drawer off the ⋮ with its full
  // diagram living in Guide.
  //
  // Build takes the Produce shape: the guided route first, with the things
  // that are not steps as peer tabs rather than an accordion of "tools".
  const [tab, setTab] = useTabParam('measure', [
    'measure',
    // legacy aliases, kept because links to them exist in emails and reports
    'health', 'performance', 'playbook', 'resize', 'pipeline', 'creative',
    // Build
    'brief', 'concepts', 'render', 'approve', 'launch',
    'library', 'audiences', 'competitor_ads',
  ]);
  const navigate = useNavigate();
  const PIPELINE_STEPS = ['brief', 'concepts', 'render', 'approve', 'launch'];
  // Shared Stepper metadata for the Build pipeline (mirrors Shared's Builder).
  const PIPELINE_META = [
    { title: 'Brief', sub: 'One-line ask' },
    { title: 'Draft', sub: 'Angles & copy' },
    { title: 'Render', sub: 'On-brand creative' },
    { title: 'Approve', sub: 'Sign-off' },
    { title: 'Launch', sub: 'Push live' },
  ];
  const isPipelineStep = PIPELINE_STEPS.includes(tab);
  const isPipelineGroup = isPipelineStep || tab === 'pipeline' || tab === 'creative';
  const pipelineStep = isPipelineStep ? tab : 'brief';
  // Build's non-step tabs. They are not stages of a batch, which is exactly
  // why they are not steps: Audiences is standing client data, Competitors is
  // research, and the library is everything already made.
  const BUILD_TABS = ['library', 'audiences', 'competitor_ads'];
  const currentGroup = (isPipelineGroup || BUILD_TABS.includes(tab)) ? 'build' : 'measure';
  // The playbook: reference, in a drawer, one job.
  const [playbookOpen, setPlaybookOpen] = useState(false);
  // A creative sent from the library to Resize, which is where resizing
  // starts now. It used to be a tab asking you to upload the file you had
  // already made twenty feet away.
  const [resizeSeed, setResizeSeed] = useState(null);

  // Old links keep working. 'health' and 'performance' were both the numbers,
  // so both land on Measure; 'playbook' opens the drawer over it rather than
  // 404-ing a tab that no longer exists; 'resize' starts at the library,
  // which is where you now pick the thing to resize.
  useEffect(() => {
    const to = resolvePaidTab(tab);
    if (!to) return;
    setTab(to.tab);
    if (to.openPlaybook) setPlaybookOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
  // Ad spend to the penny, in whichever currency the figure is actually in.
  // Every one of these used to be a hardcoded pound sign, which is wrong for
  // any account billing in USD or EUR — and a Google Ads setup with a UK and
  // a US account is normal, so it was wrong on screen rather than in theory.
  // `currency` is null when nothing reported one, and the number then shows
  // unlabelled rather than claiming a unit.
  function money(n, currency) {
    return formatMoney(n, currency, { dp: 2 });
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
    return { spend, clicks, convs, convValue, imps, roas, avgCpc, campaigns, currency: raw.currency || null, store_label: entry.store_label };
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
    return { spend, imps, clicks, purchaseValue, roas, ctr, campaigns, currency: raw.currency || null, store_label: entry.store_label };
  }

  // Green / red pill for table figures (profit, ROAS) — matches the
  // dashboard's delta chips.
  function Pill({ positive, children }) {
    return (
      <span style={{ display: 'inline-block', padding: 'var(--s1) var(--s2)', borderRadius: 'var(--r-sm)', fontWeight: 700, fontSize: 'var(--fs-caption)', background: positive ? 'var(--positive-soft)' : 'var(--negative-soft)', color: positive ? 'var(--positive)' : 'var(--negative)' }}>{children}</span>
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

  // What each sum is denominated in, decided by the backend so this page and
  // the client dashboard cannot disagree: the client's reporting currency when
  // one is set, the accounts' own when they agree, and a note when they do not.
  const cur = adsData?.currency || {};
  const curGoogle = cur.google?.currency || null;
  const curMeta = cur.meta?.currency || null;
  const curBlended = cur.blended?.currency || null;

  const googleTotal = googleEntries.filter(g => !g.error).reduce(
    (acc, g) => ({ spend: acc.spend + g.spend, revenue: acc.revenue + g.convValue, clicks: acc.clicks + g.clicks, convs: acc.convs + g.convs }),
    { spend: 0, revenue: 0, clicks: 0, convs: 0 }
  );
  const metaTotal = metaEntries.filter(m => !m.error).reduce(
    (acc, m) => ({ spend: acc.spend + m.spend, revenue: acc.revenue + m.purchaseValue, clicks: acc.clicks + m.clicks, imps: acc.imps + m.imps }),
    { spend: 0, revenue: 0, clicks: 0, imps: 0 }
  );

  // Measure — the paid performance read-out. Extracted verbatim from the
  // former Measure tab so the Health dashboard can compose it as a panel.
  const renderMeasure = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)', marginBottom: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => handlePeriodChange(d)}
            className={`tab ${days === d ? 'active' : ''}`}>
            {d}d
          </button>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', padding: 'var(--s1) var(--s3)', background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)' }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>Margin</span>
          <input type="number" min="0" max="100" step="1" value={adsMarginInput}
            onChange={e => setAdsMarginInput(e.target.value)} onBlur={handleMarginBlur}
            style={{ width: 42, padding: 'var(--s1) var(--s1)', border: 'none', fontSize: 'var(--fs-body)', textAlign: 'right', background: 'transparent', fontFamily: 'inherit' }} />
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>%</span>
        </div>
        {/* The "Ask the AI Analyst →" button stood here. It navigated to a
            separate chat page, which meant leaving the table you wanted to
            ask about. The chat icon in the client bar opens the same analyst
            in a panel over this page, and it already knows which page you are
            on (Layout passes the pathname, analystContextFor picks the
            persona from it), so the button was the worse of two routes to one
            place. */}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--s9)', color: 'var(--text-subtle)' }}>Loading ads data…</div>
      ) : adsData?.error ? (
        <div className="text-negative" style={{ padding: 'var(--s5)', fontSize: 'var(--fs-body)' }}>Error: {adsData.error}</div>
      ) : noConnectors ? (
        <div style={{ textAlign: 'center', padding: 'var(--s9)', color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>
          No active Google Ads or Meta Ads connectors found for this client.<br />
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>Connect them on the client's Connectors tab, then return here.</span>
        </div>
      ) : (() => {
        // Blended totals across Google + Meta when both are connected,
        // so the AM can see one number for the period without summing in
        // their head. Each platform's own breakdown still renders below.
        const blended = {
          spend:   (googleTotal?.spend   || 0) + (metaTotal?.spend   || 0),
          revenue: (googleTotal?.revenue || 0) + (metaTotal?.revenue || 0),
          clicks:  (googleTotal?.clicks  || 0) + (metaTotal?.clicks  || 0),
        };
        blended.roas = blended.spend > 0 && blended.revenue > 0 ? blended.revenue / blended.spend : null;
        blended.profit = blended.revenue > 0 ? blended.revenue * adsMargin - blended.spend : null;
        const showBlended = showCombined(googleTotal, metaTotal);
        return (
        <>
          {showBlended && (
            <div style={{ marginBottom: 'var(--s7)' }}>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s3)' }}>
                Combined · Google + Meta
              </div>
              <StatStrip items={[
                { label: 'Total Spend', value: money(blended.spend, curBlended), feature: true },
                { label: 'Total Revenue', value: blended.revenue > 0 ? money(blended.revenue, curBlended) : '—' },
                { label: 'Blended ROAS', value: blended.roas != null ? `${blended.roas.toFixed(2)}x` : '—' },
                blended.profit != null && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(blended.profit, curBlended), sub: 'Revenue × margin − Spend' },
                { label: 'Clicks', value: fmt(blended.clicks) },
              ].filter(Boolean)} />
              {cur.blended?.note && <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>{cur.blended.note}</p>}
              <hr style={{ border: 'none', borderTop: '1px solid var(--card-border)', margin: 'var(--s6) 0 0' }} />
            </div>
          )}
          {showGoogleTab && (
            <div>
              <h2 className="h2" style={{ marginBottom: 'var(--s4)' }}>Google Ads</h2>
              {googleEntries.filter(g => !g.error).length > 1 && (
                <div style={{ marginBottom: 'var(--s7)' }}>
                  <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s3)' }}>All Countries — Combined</div>
                  <StatStrip items={[
                    { label: 'Total Spend', value: money(googleTotal.spend, curGoogle), feature: true },
                    { label: 'Total Revenue', value: googleTotal.revenue > 0 ? money(googleTotal.revenue, curGoogle) : '—' },
                    { label: 'Blended ROAS', value: googleTotal.spend > 0 && googleTotal.revenue > 0 ? `${(googleTotal.revenue / googleTotal.spend).toFixed(2)}x` : '—' },
                    googleTotal.revenue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(googleTotal.revenue * adsMargin - googleTotal.spend, curGoogle), sub: 'Revenue × margin − Spend' },
                    { label: 'Clicks', value: fmt(googleTotal.clicks) },
                    { label: 'Conversions', value: fmt(googleTotal.convs) },
                  ].filter(Boolean)} />
                  {cur.google?.note && <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>{cur.google.note}</p>}
                  <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: 'var(--s5) 0 var(--s2)' }} />
                </div>
              )}
              {googleEntries.map((g, i) => (
                <div key={i} style={{ marginBottom: 'var(--s7)' }}>
                  {g.store_label && <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--s3)' }}>{g.store_label}</div>}
                  {g.error ? <div className="text-negative" style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>{g.error}</div> : (
                    <>
                      <div style={{ marginBottom: 'var(--s4)' }}>
                        <StatStrip items={[
                          { label: 'Spend', value: money(g.spend, g.currency), feature: true },
                          { label: 'Revenue', value: g.convValue > 0 ? money(g.convValue, g.currency) : '—' },
                          { label: 'ROAS', value: g.roas ? `${g.roas.toFixed(2)}x` : '—' },
                          g.convValue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(g.convValue * adsMargin - g.spend, g.currency), sub: 'Revenue × margin − Spend' },
                          { label: 'Clicks', value: fmt(g.clicks) },
                          { label: 'Conv.', value: fmt(g.convs) },
                          { label: 'CPC', value: money(g.avgCpc, g.currency), sub: 'avg' },
                        ].filter(Boolean)} />
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
                                    <td className="num">{money(c.spend, g.currency)}</td>
                                    <td className="num">{c.convValue > 0 ? money(c.convValue, g.currency) : '—'}</td>
                                    <td className="num">{profit != null ? <Pill positive={profit >= 0}>{money(profit, g.currency)}</Pill> : '—'}</td>
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
                <div style={{ marginBottom: 'var(--s7)' }}>
                  <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s3)' }}>All Countries — Combined</div>
                  <StatStrip items={[
                    { label: 'Total Spend', value: money(metaTotal.spend, curMeta), feature: true },
                    { label: 'Total Revenue', value: metaTotal.revenue > 0 ? money(metaTotal.revenue, curMeta) : '—' },
                    { label: 'Blended ROAS', value: metaTotal.spend > 0 && metaTotal.revenue > 0 ? `${(metaTotal.revenue / metaTotal.spend).toFixed(2)}x` : '—' },
                    metaTotal.revenue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(metaTotal.revenue * adsMargin - metaTotal.spend, curMeta), sub: 'Revenue × margin − Spend' },
                    { label: 'Clicks', value: fmt(metaTotal.clicks) },
                    { label: 'Impressions', value: fmt(metaTotal.imps) },
                  ].filter(Boolean)} />
                  {cur.meta?.note && <p className="body-xs text-subtle" style={{ marginTop: 'var(--s3)' }}>{cur.meta.note}</p>}
                  <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: 'var(--s5) 0 var(--s2)' }} />
                </div>
              )}
              {metaEntries.map((m, i) => (
                <div key={i} style={{ marginBottom: 'var(--s7)' }}>
                  {m.store_label && <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--s3)' }}>{m.store_label}</div>}
                  {m.error ? <div className="text-negative" style={{ fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>{m.error}</div> : (
                    <>
                      <div style={{ marginBottom: 'var(--s4)' }}>
                        <StatStrip items={[
                          { label: 'Spend', value: money(m.spend, m.currency), feature: true },
                          { label: 'Revenue', value: m.purchaseValue > 0 ? money(m.purchaseValue, m.currency) : '—' },
                          { label: 'ROAS', value: m.roas ? `${m.roas.toFixed(2)}x` : '—' },
                          m.purchaseValue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(m.purchaseValue * adsMargin - m.spend, m.currency), sub: 'Revenue × margin − Spend' },
                          { label: 'Impressions', value: fmt(m.imps) },
                          { label: 'Clicks', value: fmt(m.clicks) },
                          { label: 'CTR', value: m.ctr ? `${(m.ctr * 100).toFixed(2)}%` : '—' },
                        ].filter(Boolean)} />
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
                                  <td className="num">{money(c.spend, m.currency)}</td>
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
        );
      })()}
    </>
  );

  return (
    <div className="suite-paid">
      <PageShell
        title="Paid"
        subtitle={client?.name}
        tabActions={(
          /* Not a cog. A cog promises settings; this holds reference. Same
             ⋮ and the same 34px circle as the Strategist's, so the two read
             as one control rather than two inventions. On the tab row rather
             than the hero, because in the hero it landed under the client
             bar's three circles and read as a fourth that missed its row. */
          <button type="button" className="icon-circle" onClick={() => setPlaybookOpen(true)}
            aria-label="Google Ads playbook" title="Google Ads playbook">
            ⋮
          </button>
        )}
        tabs={[
          { key: 'measure', label: 'Measure', fn: 'measure', active: currentGroup === 'measure', onClick: () => setTab('measure') },
          { key: 'build',   label: 'Build',   fn: 'create',  active: currentGroup === 'build',   onClick: () => setTab('brief') },
        ]}
        subTabs={currentGroup === 'build' ? [
          /* The guided route first, then the things that are not steps of a
             batch. Produce's shape: one path through for an operator who
             wants the path, and direct tabs for whoever wants one section. */
          { key: 'batch',         label: 'Make a batch', fn: 'create',   active: isPipelineGroup,          onClick: () => setTab('brief') },
          { key: 'library',       label: 'Creative',     fn: 'create',   active: tab === 'library',        onClick: () => setTab('library') },
          { key: 'audiences',     label: 'Audiences',    fn: 'research', active: tab === 'audiences',      onClick: () => setTab('audiences') },
          { key: 'competitor_ads', label: 'Competitors', fn: 'research', active: tab === 'competitor_ads', onClick: () => setTab('competitor_ads') },
        ] : undefined}
      >
      {/* What this pillar actually drove, and its share of the account —
          on Measure only. Above Build it put "27% of the account" over a
          production line, which is the duplication this redesign was for:
          a number you cannot act on, in the place where you make things. */}
      {currentGroup === 'measure' && (
        <>
          <PillarMeasure clientId={id} pillar="paid" />
          {renderMeasure()}
        </>
      )}

      {currentGroup === 'build' && isPipelineGroup && (
        <PaidPipelinePanel
          clientId={id}
          clientName={client?.name || ''}
          step={pipelineStep}
          steps={PIPELINE_STEPS}
          meta={PIPELINE_META}
          onNavigate={setTab}
        />
      )}

      {tab === 'library' && (
        <>
          <PaidLibraryPanel clientId={id} onResize={setResizeSeed} />
          {/* Resize stopped being a tab. It is what you do to a thing, and a
              tab made you upload the file you had already made here. The
              panel opens underneath with that creative in hand. */}
          {resizeSeed && (
            <div style={{ marginTop: 'var(--s6)' }}>
              <div className="oview-grplabel">Resize</div>
              <AdResizePanel clientId={id} clientName={client?.name || ''} seed={resizeSeed} onClearSeed={() => setResizeSeed(null)} />
            </div>
          )}
        </>
      )}

      {tab === 'audiences' && (
        <div className="stack stack-lg">
          <ICPIntelligencePanel clientId={id} />
          <AudiencesPanel clientId={id} />
        </div>
      )}

      {tab === 'competitor_ads' && (
        <CompetitorAdsPanel
          clientId={id}
          /* Research that ends in a brief, rather than a dead end beside the
             numbers. Reading a rival's ads and then retyping what you learned
             into a brief by hand was the whole reason this felt like filing. */
          onUseInBrief={(seedText) => {
            setTab('brief');
            navigate(`/clients/${id}/ads?tab=brief`, { replace: true, state: { briefSeed: seedText } });
          }}
        />
      )}

      <SideDrawer
        open={playbookOpen}
        onClose={() => setPlaybookOpen(false)}
        kicker="Paid"
        title="Google Ads playbook"
        width={720}
      >
        <GoogleAdsPlaybookQuick onOpenFull={() => { setPlaybookOpen(false); navigate('/guide?open=paid-playbook'); }} />
      </SideDrawer>
      </PageShell>
    </div>
  );
}
