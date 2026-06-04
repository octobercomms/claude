// Big-number metric tile. Used on suite overview pages to surface
// the headline number for that suite (reach, sessions, replies, etc).
// Optional delta + sparkline. Accent colour matches the parent suite.

import React from 'react';
import Card from './Card';
import { palette, space, type } from '../../styles/tokens';

export default function MetricCard({
  label, value, delta = null, deltaPositive = null, accent = palette.suite.social,
  sparkline = null, raised = false,
}) {
  const deltaColour = deltaPositive == null
    ? palette.textSubtle
    : deltaPositive ? palette.success : palette.danger;
  return (
    <Card raised={raised} padding={space[5]}>
      <div style={{ ...type.caption, color: palette.textSubtle }}>{label}</div>
      <div style={{ marginTop: space[3], display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space[3] }}>
        <div style={{ ...type.metric, color: palette.text }}>{value ?? '—'}</div>
        {sparkline && <div style={{ opacity: 0.85 }}>{sparkline}</div>}
      </div>
      {delta != null && (
        <div style={{ ...type.bodyXs, color: deltaColour, marginTop: space[2], fontWeight: 600 }}>
          {deltaPositive === true ? '↑' : deltaPositive === false ? '↓' : '•'} {delta}
        </div>
      )}
    </Card>
  );
}
