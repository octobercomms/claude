import React from 'react';

// Step header used by every Pipeline step panel — a section title, an optional
// one-line subtitle, and an optional "Next step →" hand-off button. The step
// number/navigation now lives in the shared <Stepper> above the panel, so we no
// longer draw a competing numbered badge here. `num` is accepted (and ignored)
// for backwards-compatible call sites.
export default function PipelineStep({ num, title, tagline, onNext, nextLabel, children }) {
  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="h2">{title}</h2>
          {tagline && <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>{tagline}</p>}
        </div>
        {onNext && (
          <button onClick={onNext} className="btn btn-secondary btn-sm" style={{ flex: '0 0 auto' }}>
            {nextLabel || 'Next step'} →
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
