import React from 'react';

// Horizontal step strip used as a reference indicator at the top of a
// suite's Pipeline panel. Unlike the numbered Organic Pipeline (where
// each step is its own tab), Paid + Social production lives in a
// single panel — this strip shows the AM where they are conceptually
// in the production flow without navigating.
//
// Pass an optional `currentStep` (1-based) to highlight which step the
// AM is on. Without it the whole strip just reads as a roadmap.
export default function PipelineStrip({ steps, currentStep, dense = false }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
        gap: 0, alignItems: 'stretch',
        marginBottom: dense ? 'var(--s5)' : 'var(--s6)',
        background: 'var(--surface)',
        border: 'var(--border-w) solid var(--card-border)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      {steps.map((step, i) => {
        const isCurrent = currentStep === i + 1;
        const isPast = currentStep != null && currentStep > i + 1;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 'var(--s3)',
            padding: dense ? 'var(--s3) var(--s4)' : 'var(--s4) var(--s5)',
            borderRight: i < steps.length - 1 ? '1px solid var(--card-border)' : 'none',
            background: isCurrent ? 'var(--accent-soft)' : 'transparent',
          }}>
            <div style={{
              flex: '0 0 auto',
              width: dense ? 26 : 32, height: dense ? 26 : 32, borderRadius: '50%',
              background: isPast || isCurrent ? 'var(--accent)' : 'var(--surface-sunken)',
              color: isPast || isCurrent ? 'var(--accent-on)' : 'var(--text-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: dense ? 12 : 14, fontWeight: 800,
            }}>
              {i + 1}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: dense ? 12 : 13, color: 'var(--text)', lineHeight: 1.2 }}>{step.label}</div>
              {step.detail && !dense && (
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{step.detail}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
