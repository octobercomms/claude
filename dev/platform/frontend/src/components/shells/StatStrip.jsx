import React from 'react';

// StatStrip (L3/L2) — the ONE metric row. Supersedes ui/MetricCard, the local
// ClientAdsPage MetricCard, the .metric-card / .stat-strip classes and ad-hoc
// inline tiles.
//   items: [{ label, value, sub?, delta?, dir?: 'up' | 'down', feature? }]
//     sub      — a muted descriptor line under the value (e.g. "75% healthy")
//     delta    — a change figure; dir gives it the ▲ green / ▼ red treatment
//     feature  — one highlighted tile (dark fill, white ink) for the headline
// Layout only — auto-fits as many columns as fit, wraps on narrow screens.
export default function StatStrip({ items = [] }) {
  return (
    <div className="ds-stats">
      {items.map((s, i) => (
        <div className={`ds-stat ${s.feature ? 'ds-stat--feature' : ''}`} key={s.key || s.label || i}>
          <div className="ds-stat__value">{s.value ?? '—'}</div>
          <div className="ds-stat__label">{s.label}</div>
          {s.sub != null && <div className="ds-stat__sub">{s.sub}</div>}
          {s.delta != null && (
            <div className={`ds-stat__delta ${s.dir || ''}`}>
              {s.dir === 'up' ? '▲ ' : s.dir === 'down' ? '▼ ' : ''}{s.delta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
