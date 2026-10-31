import React, { useEffect, useState } from 'react';
import PillarMeasure from '../components/PillarMeasure';
import AdResizePanel from '../components/AdResizePanel';
import AudiencesPanel from '../components/AudiencesPanel';
import ICPIntelligencePanel from '../components/ICPIntelligencePanel';
import CompetitorAdsPanel from '../components/CompetitorAdsPanel';
import GoogleAdsPlaybookQuick from '../components/GoogleAdsPlaybookQuick';
import PaidPipelinePanel from '../components/paid/PaidPipelinePanel';
import ApprovalLinkModal from '../components/paid/ApprovalLinkModal';
import AdAccountSection from '../components/paid/AdAccountSection';
import { useParams, useNavigate } from 'react-router-dom';
import PageShell from '../components/shells/PageShell';
import StatStrip from '../components/shells/StatStrip';
import SideDrawer from '../components/ui/SideDrawer';
import { useScreen } from '../hooks/useScreen';
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
  // `screen` is the raw slug out of the URL. The redirect below needs it
  // rather than the resolved tab — see the note on that effect.
  const { id, screen: rawScreen } = useParams();
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
  const [tab, setTab] = useScreen('paid');
  const navigate = useNavigate();
  const PIPELINE_STEPS = ['brief', 'concepts', 'render', 'launch'];
  // Shared Stepper metadata for the Build pipeline (mirrors Shared's Builder).
  const PIPELINE_META = [
    { title: 'Brief', sub: 'One-line ask' },
    { title: 'Draft', sub: 'Angles & copy' },
    { title: 'Render', sub: 'On-brand creative' },
    { title: 'Launch', sub: 'Export & build' },
  ];
  const isPipelineStep = PIPELINE_STEPS.includes(tab);
  // 'pipeline' and 'creative' were group keys from the tab-strip era. No row
  // sets either, and a slug with no row never resolves, so they could only
  // ever read as reachable.
  const isPipelineGroup = isPipelineStep;
  const pipelineStep = isPipelineStep ? tab : 'brief';
  // Build's non-step tabs. They are not stages of a batch, which is exactly
  // why they are not steps: Audiences is standing client data, Competitors is
  // research, and the library is everything already made.
  const BUILD_TABS = ['resize', 'icp', 'audiences', 'customers', 'competitor_ads'];
  const currentGroup = (isPipelineGroup || BUILD_TABS.includes(tab)) ? 'build' : 'measure';
  // The playbook: reference, in a drawer, one job.
  const [playbookOpen, setPlaybookOpen] = useState(false);
  // Minting a client approval link. It was step 4 of the Build pipeline,
  // which made a URL look like a stage of production. Here it is reachable
  // from anywhere in Paid, including Measure, which is where you are when a
  // client asks to see the work.
  const [approvalOpen, setApprovalOpen] = useState(false);

  // Old links keep working. 'health' and 'performance' were both the numbers,
  // so both land on Measure; 'playbook' opens the drawer over it rather than
  // 404-ing a tab that no longer exists; 'resize' starts at the library,
  // which is where you now pick the thing to resize.
  //
  // The raw slug, not `tab`. This read `resolvePaidTab(tab)`, and `tab` comes
  // from useScreen, which maps an unknown slug to the section default before
  // anything here runs. So every alias arrived as 'measure', the table
  // matched nothing, and not one of these redirects had ever fired:
  // /ads/playbook showed Measure with no drawer — precisely the silent
  // breakage the table was written to prevent — /ads/resize never reached
  // the library, and the address bar kept the dead slug in all cases.
  //
  // The unit tests passed throughout, because they called resolvePaidTab
  // with the alias directly. They were testing the table and nothing was
  // testing the wiring.
  useEffect(() => {
    const to = resolvePaidTab(rawScreen);
    if (!to) return;
    setTab(to.tab);
    if (to.openPlaybook) setPlaybookOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawScreen]);

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
  // Measure. Revenue leads every strip: spend is the input, revenue is the
  // outcome, and the outcome is what the account lead is asked about. Spend
  // sits second because it is the thing you control.
  //
  // Not profit, though it is the only figure that says whether the ads made
  // money: it is revenue × a margin typed into the box above, so leading with
  // it would put an assumption in the largest type on the page.
  const strip = (items) => <StatStrip items={items.filter(Boolean)} />;

  // A roll-up across accounts (Google + Meta, or every Google account).
  const totalStrip = (t, currency, extra = []) => strip([
    { label: 'Revenue', value: t.revenue > 0 ? money(t.revenue, currency) : '—', feature: true },
    { label: 'Spend', value: money(t.spend, currency) },
    { label: 'ROAS', value: t.spend > 0 && t.revenue > 0 ? `${(t.revenue / t.spend).toFixed(2)}x` : '—' },
    t.revenue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(t.revenue * adsMargin - t.spend, currency), sub: 'Revenue × margin − Spend' },
    { label: 'Clicks', value: fmt(t.clicks) },
    ...extra,
  ]);

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
        const blended = {
          spend:   (googleTotal?.spend   || 0) + (metaTotal?.spend   || 0),
          revenue: (googleTotal?.revenue || 0) + (metaTotal?.revenue || 0),
          clicks:  (googleTotal?.clicks  || 0) + (metaTotal?.clicks  || 0),
        };
        const showBlended = showCombined(googleTotal, metaTotal);
        // The same currency note was printed under the Combined strip and
        // again under the Google roll-up, word for word, because both mixes
        // are the same mix. One explanation per page: a sentence repeated
        // three inches below itself reads as two different warnings.
        const seenNotes = new Set();
        const onceOnly = (note) => {
          if (!note || seenNotes.has(note)) return null;
          seenNotes.add(note);
          return note;
        };
        const multiGoogle = googleEntries.filter(g => !g.error).length > 1;
        const multiMeta = metaEntries.filter(m => !m.error).length > 1;
        return (
        <>
          {/* Where these numbers come from, said once, above them.
              The panel at the top of the page and this section disagree —
              7,645 against 8,540 on Falcon — and both are right. GA4
              attributes last-click from the store; the ad platforms count
              their own conversions, including view-through, over a longer
              window. They are different measurements of the same month, and
              a page that prints both without saying so invites the account
              lead to go looking for a bug that is not there. */}
          <div className="callout ads-source-note">
            <strong>Reported by the ad platforms.</strong> These are each
            platform's own conversion figures. The contribution panel above is
            your store's revenue through GA4, attributed last-click, so the two
            will not match: ad platforms claim view-through conversions and
            attribute over a longer window, which usually makes their revenue
            the higher of the two.
          </div>

          {showBlended && (
            <AdAccountSection
              label="Combined · Google + Meta"
              currency={curBlended}
              note={onceOnly(cur.blended?.note)}
              stats={totalStrip(blended, curBlended)}
            />
          )}

          {showGoogleTab && (
            <div className="ads-platform">
              <h2 className="h2" style={{ marginBottom: 'var(--s4)' }}>Google Ads</h2>
              {multiGoogle && (
                <AdAccountSection
                  label="All accounts"
                  currency={curGoogle}
                  note={onceOnly(cur.google?.note)}
                  stats={totalStrip(googleTotal, curGoogle, [{ label: 'Conversions', value: fmt(googleTotal.convs) }])}
                />
              )}
              {googleEntries.map((g, i) => (
                <AdAccountSection
                  key={i}
                  label={g.store_label || 'Google Ads account'}
                  currency={g.currency}
                  // The only account there is opens by itself. With several,
                  // the roll-up above is the headline and each account is
                  // detail you ask for.
                  defaultOpen={!multiGoogle && googleEntries.length === 1 && !g.error}
                  stats={g.error
                    ? <div className="text-negative" style={{ fontSize: 'var(--fs-body)' }}>{g.error}</div>
                    : strip([
                      { label: 'Revenue', value: g.convValue > 0 ? money(g.convValue, g.currency) : '—', feature: true },
                      { label: 'Spend', value: money(g.spend, g.currency) },
                      { label: 'ROAS', value: g.roas ? `${g.roas.toFixed(2)}x` : '—' },
                      g.convValue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(g.convValue * adsMargin - g.spend, g.currency), sub: 'Revenue × margin − Spend' },
                      { label: 'Clicks', value: fmt(g.clicks) },
                      { label: 'Conv.', value: fmt(g.convs) },
                      { label: 'CPC', value: money(g.avgCpc, g.currency), sub: 'avg' },
                    ])}
                >
                  {!g.error && g.campaigns?.length > 0 && (
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
                            const roas = c.spend > 0 && c.convValue > 0 ? c.convValue / c.spend : null;
                            const profit = c.convValue > 0 ? c.convValue * adsMargin - c.spend : null;
                            return (
                              <tr key={j}>
                                <td>{c.name}</td>
                                <td className="num">{money(c.spend, g.currency)}</td>
                                <td className="num">{c.convValue > 0 ? money(c.convValue, g.currency) : '—'}</td>
                                <td className="num">{profit != null ? <Pill positive={profit >= 0}>{money(profit, g.currency)}</Pill> : '—'}</td>
                                <td className="num">{roas != null ? <Pill positive={roas >= 1}>{roas.toFixed(2)}x</Pill> : '—'}</td>
                                <td className="num">{fmt(c.clicks)}</td>
                                <td className="num">{fmt(c.conversions)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </AdAccountSection>
              ))}
            </div>
          )}

          {showMetaTab && (
            <div className="ads-platform">
              <h2 className="h2" style={{ marginBottom: 'var(--s4)' }}>Meta Ads</h2>
              {multiMeta && (
                <AdAccountSection
                  label="All accounts"
                  currency={curMeta}
                  note={onceOnly(cur.meta?.note)}
                  stats={totalStrip(metaTotal, curMeta, [{ label: 'Impressions', value: fmt(metaTotal.imps) }])}
                />
              )}
              {metaEntries.map((m, i) => (
                <AdAccountSection
                  key={i}
                  label={m.store_label || 'Meta Ads account'}
                  currency={m.currency}
                  defaultOpen={!multiMeta && metaEntries.length === 1 && !m.error}
                  stats={m.error
                    ? <div className="text-negative" style={{ fontSize: 'var(--fs-body)' }}>{m.error}</div>
                    : strip([
                      { label: 'Revenue', value: m.purchaseValue > 0 ? money(m.purchaseValue, m.currency) : '—', feature: true },
                      { label: 'Spend', value: money(m.spend, m.currency) },
                      { label: 'ROAS', value: m.roas ? `${m.roas.toFixed(2)}x` : '—' },
                      m.purchaseValue > 0 && { label: `Profit (${Math.round(adsMargin * 100)}%)`, value: money(m.purchaseValue * adsMargin - m.spend, m.currency), sub: 'Revenue × margin − Spend' },
                      { label: 'Impressions', value: fmt(m.imps) },
                      { label: 'Clicks', value: fmt(m.clicks) },
                      { label: 'CTR', value: m.ctr ? `${(m.ctr * 100).toFixed(2)}%` : '—' },
                    ])}
                >
                  {!m.error && m.campaigns?.length > 0 && (
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
                </AdAccountSection>
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
          /* Named, not a ⋮. A kebab means "several things" and hides what
             they are; two named buttons are shorter to read than the menu
             that would hold them. */
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setApprovalOpen(true)}>
              Approval link
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlaybookOpen(true)}>
              Playbook
            </button>
          </div>
        )}
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

      {/* Resize is its own screen again. It hung off the Paid library, which
          Daniel removed, and a tool whose only door is a deleted page is not
          a tool. It takes an upload: finished creative now lives with the
          batch that produced it and in the Launch export. */}
      {tab === 'resize' && (
        <AdResizePanel clientId={id} clientName={client?.name || ''} />
      )}

      {/* Three screens over the audience work, where there was one page
          stacking ICP on top of segments on top of a postcode table. Each
          answers a different question and only one of them produces
          something you paste into Ads Manager. */}
      {tab === 'icp' && <ICPIntelligencePanel clientId={id} />}
      {tab === 'audiences' && <AudiencesPanel clientId={id} view="segments" />}
      {tab === 'customers' && <AudiencesPanel clientId={id} view="customers" />}

      {tab === 'competitor_ads' && (
        <CompetitorAdsPanel
          clientId={id}
          /* Research that ends in a brief, rather than a dead end beside the
             numbers. Reading a rival's ads and then retyping what you learned
             into a brief by hand was the whole reason this felt like filing. */
          onUseInBrief={(seedText) => {
            setTab('brief');
            navigate(`/clients/${id}/ads/brief`, { replace: true, state: { briefSeed: seedText } });
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

      {approvalOpen && (
        <ApprovalLinkModal
          clientId={id}
          clientName={client?.name || ''}
          onClose={() => setApprovalOpen(false)}
        />
      )}
      </PageShell>
    </div>
  );
}
