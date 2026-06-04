// Inline SVG sparkline — no charting library, no JS dependencies, just
// a polyline scaled to the container. Renders a one-line trend chip on
// the Winners panel + Analytics summary so the AM sees momentum at a
// glance without opening the full chart view.

import React from 'react';

export default function Sparkline({ values, width = 120, height = 28, stroke = '#1a56db', strokeWidth = 1.5, fill = null }) {
  if (!Array.isArray(values) || values.length < 2) {
    return <span style={{ display: 'inline-block', width, height, color: '#bbb', fontSize: 10 }}>—</span>;
  }
  const nums = values.map(v => Number(v) || 0);
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const range = Math.max(max - min, 1);
  const stepX = width / (nums.length - 1);
  const points = nums.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Compute trend direction for a quick visual cue: tail vs head.
  const head = nums[0];
  const tail = nums[nums.length - 1];
  const dirColour = tail > head * 1.1 ? '#2e7d32' : tail < head * 0.9 ? '#c62828' : stroke;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ verticalAlign: 'middle', overflow: 'visible' }}>
      <polyline points={points} fill={fill || 'none'} stroke={dirColour} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
