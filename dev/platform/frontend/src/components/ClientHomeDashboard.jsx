import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

// The personalised, read-only landing a client login sees instead of the
// agency all-clients dashboard. Reads only our DB (via /dashboard/client-home),
// so it's cheap and never triggers a paid call. "Your marketing at a glance"
// across PESO + Data, with deep links into each read-only section.

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('en-GB'); }
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

export default function ClientHomeDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/dashboard/client-home').then(setData).catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="card text-negative" style={{ margin: 24, fontSize: 13 }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>;

  const { client, latest_report, recent_posts = [], tiles = {} } = data;
  const cid = client?.id;
  const stats = [
    { label: 'Posts published (30 days)', value: tiles.posts_published_30d },
    { label: 'Scheduled & coming up', value: tiles.upcoming_scheduled },
    { label: 'Keywords tracked', value: tiles.keywords_tracked },
    { label: 'Referring domains', value: tiles.referring_domains },
  ];
  const sections = [
    { label: 'Data', to: `/clients/${cid}/sales-traffic`, sub: 'Traffic & analytics' },
    { label: 'Paid', to: `/clients/${cid}/ads`, sub: 'Advertising' },
    { label: 'Earned', to: `/clients/${cid}/pr`, sub: 'PR & coverage' },
    { label: 'Shared', to: `/clients/${cid}/social`, sub: 'Social' },
    { label: 'Owned', to: `/clients/${cid}/seo`, sub: 'SEO & website' },
  ];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div className="kicker"><span className="pip" /><span>{client?.name}</span></div>
      <h1 className="display mt-2" style={{ marginBottom: 4 }}>Your marketing at a glance</h1>
      <p className="body-sm text-muted" style={{ marginBottom: 22 }}>
        A live view of everything your agency is running for {client?.name} across paid, earned, shared, owned and data.
      </p>

      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} className="card">
            <div className="metric">{fmt(s.value)}</div>
            <div className="caption">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Recent published content */}
        <div className="card">
          <div className="caption caption-muted" style={{ marginBottom: 12 }}>Recently published</div>
          {!recent_posts.length ? (
            <div className="body-sm text-subtle">Nothing published yet — your first posts will show here.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {recent_posts.map(p => (
                <div key={p.id} style={{ borderBottom: 'var(--border-w) solid var(--card-border)', paddingBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                    {p.hook || (p.caption || '').slice(0, 80) || '(post)'}
                  </div>
                  <div className="body-xs text-subtle" style={{ marginTop: 2, display: 'flex', gap: 8 }}>
                    <span style={{ textTransform: 'capitalize' }}>{p.platform}</span>
                    {p.published_at && <span>· {fmtDate(p.published_at)}</span>}
                    {p.published_url && <a href={p.published_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>· view ↗</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Latest report */}
        <div className="card">
          <div className="caption caption-muted" style={{ marginBottom: 12 }}>Latest report</div>
          {latest_report ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, textTransform: 'capitalize' }}>{latest_report.report_type} report</div>
              <div className="body-xs text-subtle" style={{ marginTop: 4 }}>
                {fmtDate(latest_report.period_start)} – {fmtDate(latest_report.period_end)}
              </div>
              <a className="btn btn-primary btn-sm" style={{ marginTop: 12, display: 'inline-block' }}
                href={`/api/reports/${latest_report.id}/html`} target="_blank" rel="noreferrer">View report ↗</a>
            </div>
          ) : (
            <div className="body-sm text-subtle">Your first report will appear here once it's sent.</div>
          )}
        </div>
      </div>

      {/* Explore the account */}
      <div className="caption caption-muted" style={{ margin: '26px 0 12px' }}>Explore your account</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {sections.map(s => (
          <Link key={s.label} to={s.to} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{s.label}</div>
            <div className="body-xs text-subtle" style={{ marginTop: 2 }}>{s.sub}</div>
            <div className="body-xs" style={{ marginTop: 8, color: 'var(--accent)' }}>Open →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
