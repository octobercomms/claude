// MetricCard — caption + big-number + optional sparkline / delta. The
// headline-number tile on every suite landing page. Class-based.

import React from 'react';

export default function MetricCard({
  label, value, accent = false, sparkline = null, delta = null, deltaPositive = null,
}) {
  const cls = ['metric-card', accent ? 'accent' : ''].filter(Boolean).join(' ');
  const deltaClass = deltaPositive == null ? 'text-subtle' : deltaPositive ? 'text-accent' : 'text-muted';
  return (
    <div className={cls}>
      <div className="caption">{label}</div>
      <div className="metric-row">
        <div className="metric">{value ?? '—'}</div>
        {sparkline}
      </div>
      {delta != null && (
        <div className={`body-xs mt-2 ${deltaClass}`}>
          {deltaPositive === true ? '↑' : deltaPositive === false ? '↓' : '•'} {delta}
        </div>
      )}
    </div>
  );
}
