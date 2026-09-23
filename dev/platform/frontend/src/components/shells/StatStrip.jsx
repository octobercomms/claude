import React from 'react';
import Sparkline from '../Sparkline';

// StatStrip (L3/L2) — the ONE metric row. Supersedes ui/MetricCard, the local
// ClientAdsPage MetricCard, the .metric-card / .stat-strip classes and ad-hoc
// inline tiles.
//   items: [{ label, value, sub?, delta?, dir?, spark?, sparkReverse?, feature? }]
//     sub          — a muted descriptor line under the value (e.g. "75% healthy")
//     delta        — a change figure; dir gives it the ▲ green / ▼ red treatment
//     spark        — an array of numbers → an inline trend sparkline
//     sparkReverse — flip the sparkline's green/red (lower-is-better metrics)
//     feature      — one highlighted tile (dark fill, white ink) for the headline
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
          {Array.isArray(s.spark) && s.spark.length > 1 && (
            <div className="ds-stat__spark"><Sparkline values={s.spark} width={104} height={22} reverse={!!s.sparkReverse} /></div>
          )}
        </div>
      ))}
    </div>
  );
}
