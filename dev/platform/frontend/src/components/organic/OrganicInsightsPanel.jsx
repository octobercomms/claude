import React from 'react';

// Organic → Performance → Insights. Real data dashboard (replaces the
// previous SuitePerformanceHub launchpad which read as a sales page).
// All numbers come from the same keyword set the rest of the suite is
// looking at — no extra fetches.
//
// Layout: 6 KPI cards across the top, then a row of widgets:
//   - Top movers (up + down) — biggest position changes since last check
//   - Rank distribution      — count of keywords by position bucket
//   - Intent split           — count by intent label
//   - AI Overview coverage   — how often AIO appears, and how often the
//                              brand is cited when it does

const POS_BUCKETS = [
  { label: '#1',     test: p => p === 1 },
  { label: '#2–3',   test: p => p >= 2 && p <= 3 },
  { label: '#4–10',  test: p => p >= 4 && p <= 10 },
  { label: '#11–20', test: p => p >= 11 && p <= 20 },
  { label: '#21–50', test: p => p >= 21 && p <= 50 },
  { label: '#51+',   test: p => p > 50 },
];

const INTENT_COLOURS = {
  Informational: 'var(--accent)',
  Navigational:  'var(--text-muted)',
  Commercial:    'var(--warning)',
  Transactional: 'var(--positive)',
};

export default function OrganicInsightsPanel({ keywords = [], onOpenKeywords, onOpenAiVisibility, onOpenSiteAudit, onOpenQuickWins }) {
  const tracked = keywords.length;
  const ranking = keywords.filter(k => k.current_position).length;
  const top10 = keywords.filter(k => k.current_position && k.current_position <= 10).length;
  const top3 = keywords.filter(k => k.current_position && k.current_position <= 3).length;
  const notRanking = tracked - ranking;
  const aioPresent = keywords.filter(k => k.aio_present).length;
  const aioCited = keywords.filter(k => k.aio_brand_cited).length;
  const aioCoverage = aioPresent ? Math.round((aioCited / aioPresent) * 100) : 0;

  // Movers: change = previous - current (positive = improved rank).
  const moved = keywords
    .filter(k => k.current_position && k.previous_position && k.current_position !== k.previous_position)
    .map(k => ({ ...k, change: k.previous_position - k.current_position }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const gainers = moved.filter(k => k.change > 0).slice(0, 5);
  const droppers = moved.filter(k => k.change < 0).slice(0, 5);

  // Distribution + intent counts.
  const distribution = POS_BUCKETS.map(b => ({
    label: b.label,
    count: keywords.filter(k => k.current_position && b.test(k.current_position)).length,
  }));
  const maxDist = Math.max(1, ...distribution.map(d => d.count));
  const intentCounts = keywords.reduce((acc, k) => {
    const label = k.intent || 'Unclassified';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const intentRows = Object.entries(intentCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* KPI strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
        <Stat label="Tracked"     value={tracked} />
        <Stat label="Ranking"     value={ranking}     sub={tracked ? `${Math.round(ranking / tracked * 100)}% of tracked` : null} />
        <Stat label="Top 10"      value={top10}       sub={tracked ? `${Math.round(top10 / tracked * 100)}%` : null} tone="positive" />
        <Stat label="Top 3"       value={top3}        sub={tracked ? `${Math.round(top3 / tracked * 100)}%` : null} tone="positive" />
        <Stat label="Not ranking" value={notRanking}  sub={tracked ? `${Math.round(notRanking / tracked * 100)}%` : null} tone={notRanking > ranking ? 'negative' : 'default'} />
        <Stat label="In AI Overviews" value={aioPresent} sub={aioPresent ? `${aioCited} cited · ${aioCoverage}%` : null} tone={aioCited ? 'positive' : aioPresent ? 'warning' : 'default'} />
      </div>

      {/* Widget row */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--s4)' }}>
        {/* Top movers */}
        <div className="card">
          <div className="caption mb-3">Top movers · since last check</div>
          {!gainers.length && !droppers.length ? (
            <p className="body-sm text-subtle">No position changes since the last rank check.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
              <MoverList title="Gained" rows={gainers} tone="positive" />
              <MoverList title="Dropped" rows={droppers} tone="negative" />
            </div>
          )}
          {onOpenKeywords && (
            <button onClick={onOpenKeywords} className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--s3)', color: 'var(--accent)', padding: 0 }}>
              See all keywords →
            </button>
          )}
        </div>

        {/* Rank distribution */}
        <div className="card">
          <div className="caption mb-3">Rank distribution</div>
          {!ranking ? (
            <p className="body-sm text-subtle">No keywords are ranking in the top 100 yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {distribution.map(b => (
                <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 40px', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{b.label}</span>
                  <div style={{ height: 14, background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(b.count / maxDist) * 100}%`, background: 'var(--accent)' }} />
                  </div>
                  <span style={{ textAlign: 'right', fontWeight: 700 }}>{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Intent split */}
        <div className="card">
          <div className="caption mb-3">Intent split</div>
          {!intentRows.length ? (
            <p className="body-sm text-subtle">No keywords yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {intentRows.map(([label, count]) => {
                const pct = Math.round((count / tracked) * 100);
                return (
                  <div key={label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 60px', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                    <div style={{ height: 14, background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: INTENT_COLOURS[label] || 'var(--text-subtle)' }} />
                    </div>
                    <span style={{ textAlign: 'right', fontWeight: 700 }}>{count} · {pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Overview coverage */}
        <div className="card">
          <div className="caption mb-3">AI Overview coverage</div>
          {!aioPresent ? (
            <p className="body-sm text-subtle">No keywords have triggered an AI Overview yet. AIO checks run weekly on Monday morning.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
                <span className="metric" style={{ fontSize: 36 }}>{aioCoverage}%</span>
                <span className="body-sm text-muted">brand cited where AIO appears</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                AIO present on <strong style={{ color: 'var(--text)' }}>{aioPresent}</strong> of {tracked} tracked queries.<br />
                Brand cited on <strong style={{ color: 'var(--positive)' }}>{aioCited}</strong> of those.
              </div>
              {onOpenAiVisibility && (
                <button onClick={onOpenAiVisibility} className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--s3)', color: 'var(--accent)', padding: 0 }}>
                  See AI visibility →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const valueColour = tone === 'positive' ? 'var(--positive)'
                    : tone === 'negative' ? 'var(--negative)'
                    : tone === 'warning'  ? 'var(--warning)'
                    : 'var(--text)';
  return (
    <div className="card">
      <div className="caption">{label}</div>
      <div className="metric" style={{ color: valueColour, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function MoverList({ title, rows, tone }) {
  const arrowColour = tone === 'positive' ? 'var(--positive)' : 'var(--negative)';
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: arrowColour, marginBottom: 6 }}>{title}</div>
      {!rows.length ? (
        <p style={{ fontSize: 11, color: 'var(--text-subtle)' }}>None</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => (
            <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.keyword}>{r.keyword}</span>
              <span style={{ color: arrowColour, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {tone === 'positive' ? '↑' : '↓'} {Math.abs(r.change)} <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>(#{r.current_position})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
