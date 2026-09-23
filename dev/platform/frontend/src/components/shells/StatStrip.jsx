import React from 'react';

// StatStrip (L3/L2) — the ONE metric row. Supersedes ui/MetricCard, the local
// ClientAdsPage MetricCard, the .metric-card class and ad-hoc inline tiles.
//   items: [{ label, value, delta?, dir?: 'up' | 'down' }]
// Layout only — auto-fits as many columns as fit, wraps on narrow screens.
export default function StatStrip({ items = [] }) {
  return (
    <div className="ds-stats">
      {items.map((s, i) => (
        <div className="ds-stat" key={s.key || s.label || i}>
          <div className="ds-stat__value">{s.value ?? '—'}</div>
          <div className="ds-stat__label">{s.label}</div>
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
