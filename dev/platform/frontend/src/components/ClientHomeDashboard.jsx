import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

// The personalised, read-only landing a client login sees instead of the
// agency all-clients dashboard. Leads with LIVE commercial data (revenue,
// orders, sessions from the client's GA4 / Shopify connectors — free calls,
// no metered credits) so it feels alive and valuable, with the content side
// demoted to a secondary strip. Everything deep-links into the read-only
// PESO + Data sections.

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('en-GB'); }
function fmtMoney(n) { return n == null ? '—' : '£' + Math.round(Number(n)).toLocaleString('en-GB'); }
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

export default function ClientHomeDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  // Live KPIs load separately (a GA4/Shopify roundtrip) so the DB-backed cards
  // paint instantly and the commercial band fills in a beat later.
  const [kpis, setKpis] = useState(null);
  const [kpiState, setKpiState] = useState('loading'); // loading | ready | none

  useEffect(() => {
    api.get('/dashboard/client-home').then(setData).catch(e => setErr(e.message));
  }, []);

  const cid = data?.client?.id;
  useEffect(() => {
    if (!cid) return;
    const end = iso(new Date());
    const start = iso(new Date(Date.now() - 29 * 86400000));
    api.get(`/sales-traffic/${cid}?start=${start}&end=${end}`)
      .then(r => {
        const k = (r && r.kpis) || {};
        setKpis(k);
        setKpiState(k && (k.revenue || k.sessions || k.users || k.orders) ? 'ready' : 'none');
      })
      .catch(() => setKpiState('none'));
  }, [cid]);

  if (err) return <div className="card text-negative" style={{ margin: 'var(--s6)', fontSize: 'var(--fs-body)' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--text-subtle)', padding: 'var(--s8)' }}>Loading…</div>;

  const { client, latest_report, recent_posts = [], tiles = {} } = data;
  const k = kpis || {};
  const aov = k.aov != null ? k.aov : (k.orders ? k.revenue / k.orders : null);

  // LIVE commercial KPIs — the headline, straight from the client's connectors.
  const liveStats = [
    { label: 'Revenue · 30d', value: fmtMoney(k.revenue), primary: true },
    { label: 'Orders · 30d', value: fmt(k.orders) },
    { label: 'Avg order value', value: fmtMoney(aov) },
    { label: 'Sessions · 30d', value: fmt(k.sessions) },
    { label: 'Users · 30d', value: fmt(k.users) },
    { label: 'Conversion rate', value: k.conversionRate != null ? (Number(k.conversionRate) || 0).toFixed(2) + '%' : '—' },
  ];

  // Secondary signals (cheap DB reads) — SEO reach + a single content pulse.
  const signals = [
    { label: 'Keywords tracked', value: fmt(tiles.keywords_tracked) },
    { label: 'Referring domains', value: fmt(tiles.referring_domains) },
    { label: 'Posts published · 30d', value: fmt(tiles.posts_published_30d) },
  ];

  const sections = [
    { label: 'Data', to: `/clients/${cid}/sales-traffic`, sub: 'Traffic & analytics' },
    { label: 'Paid', to: `/clients/${cid}/ads`, sub: 'Advertising' },
    { label: 'Earned', to: `/clients/${cid}/pr`, sub: 'PR & coverage' },
    { label: 'Shared', to: `/clients/${cid}/social`, sub: 'Social' },
    { label: 'Owned', to: `/clients/${cid}/seo`, sub: 'SEO & website' },
  ];

  return (
    <div style={{ padding: 'var(--s6) var(--s7)' }}>
      <div className="kicker"><span className="pip" /><span>{client?.name}</span></div>
      <h1 className="display mt-2" style={{ marginBottom: 'var(--s1)' }}>Your marketing at a glance</h1>
      <p className="body-sm text-muted" style={{ marginBottom: 'var(--s6)' }}>
        A live view of everything your agency is running for {client?.name} across paid, earned, shared, owned and data.
      </p>

      {/* LIVE commercial KPIs — the headline band. */}
      <div className="caption caption-muted" style={{ marginBottom: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
        <span>Live performance · last 30 days</span>
        {kpiState === 'ready' && <span className="chip chip-positive" style={{ fontSize: 'var(--fs-caption)' }}>● Live</span>}
      </div>
      {kpiState === 'none' ? (
        <div className="card" style={{ marginBottom: 'var(--s6)' }}>
          <div className="body-sm text-subtle">
            No live analytics connected yet. Once your GA4 / store connectors are live, revenue, orders and traffic appear here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
          {liveStats.map(s => (
            <div key={s.label} className="card" style={s.primary ? { borderColor: 'var(--accent)' } : undefined}>
              <div className="metric" style={s.primary ? { color: 'var(--text)' } : undefined}>
                {kpiState === 'loading' ? '…' : s.value}
              </div>
              <div className="caption">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Secondary signals — slim strip. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
        {signals.map(s => (
          <div key={s.label} className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
            <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700 }}>{s.value}</div>
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)', alignItems: 'start' }}>
        {/* Latest report */}
        <div className="card">
          <div className="caption caption-muted" style={{ marginBottom: 'var(--s3)' }}>Latest report</div>
          {latest_report ? (
            <div>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, textTransform: 'capitalize' }}>{latest_report.report_type} report</div>
              <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
                {fmtDate(latest_report.period_start)} – {fmtDate(latest_report.period_end)}
              </div>
              <a className="btn btn-primary btn-sm" style={{ marginTop: 'var(--s3)', display: 'inline-block' }}
                href={`/api/reports/${latest_report.id}/html`} target="_blank" rel="noreferrer">View report ↗</a>
            </div>
          ) : (
            <div className="body-sm text-subtle">Your first report will appear here once it's sent.</div>
          )}
        </div>

        {/* Recent published content — demoted to a compact secondary card. */}
        <div className="card">
          <div className="caption caption-muted" style={{ marginBottom: 'var(--s3)' }}>Recently published</div>
          {!recent_posts.length ? (
            <div className="body-sm text-subtle">Nothing published yet — your first posts will show here.</div>
          ) : (
            <div className="stack" style={{ gap: 'var(--s3)' }}>
              {recent_posts.slice(0, 4).map(p => (
                <div key={p.id} style={{ borderBottom: 'var(--border-w) solid var(--card-border)', paddingBottom: 'var(--s2)' }}>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, lineHeight: 1.3 }}>
                    {p.hook || (p.caption || '').slice(0, 80) || '(post)'}
                  </div>
                  <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)', display: 'flex', gap: 'var(--s2)' }}>
                    <span style={{ textTransform: 'capitalize' }}>{p.platform}</span>
                    {p.published_at && <span>· {fmtDate(p.published_at)}</span>}
                    {p.published_url && <a href={p.published_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>· view ↗</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Explore the account */}
      <div className="caption caption-muted" style={{ margin: 'var(--s6) 0 var(--s3)' }}>Explore your account</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s3)' }}>
        {sections.map(s => (
          <Link key={s.label} to={s.to} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>{s.label}</div>
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>{s.sub}</div>
            <div className="body-xs" style={{ marginTop: 'var(--s2)', color: 'var(--text)' }}>Open →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
