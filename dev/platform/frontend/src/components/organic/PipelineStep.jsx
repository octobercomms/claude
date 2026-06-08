import React from 'react';

// Numbered step header used by every Pipeline step panel. Renders a
// section title, the step number badge, an optional one-line subtitle,
// and an optional "Next step →" hand-off button so the wizard reads as
// a flow even though each step is its own tab.
export default function PipelineStep({ num, title, tagline, onNext, nextLabel, children }) {
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div
          style={{
            flex: '0 0 auto',
            width: 44, height: 44,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--accent-on)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 800,
          }}
        >
          {num}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="h2">{title}</h2>
          {tagline && <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>{tagline}</p>}
        </div>
        {onNext && (
          <button onClick={onNext} className="btn btn-secondary btn-sm">
            {nextLabel || 'Next step'} →
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
