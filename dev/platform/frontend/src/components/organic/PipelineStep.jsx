import React from 'react';

// Step header used by every Pipeline step panel — a section title, an optional
// one-line subtitle, and an optional "Next step →" hand-off button. The step
// number/navigation now lives in the shared <StepRail> above the panel, so we no
// longer draw a competing numbered badge here. `num` is accepted (and ignored)
// for backwards-compatible call sites.
// `nextDisabled` turns the hand-off off until the step has produced the thing
// the next step reads. A live "See the concepts" on an empty Brief step is a
// button to an empty page, which teaches you to distrust the rail.
export default function PipelineStep({ num, title, tagline, onNext, nextLabel, nextDisabled, banner, children }) {
  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="h2">{title}</h2>
          {tagline && <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>{tagline}</p>}
        </div>
        {onNext && (
          <button onClick={onNext} className="btn btn-secondary btn-sm" disabled={!!nextDisabled}
            style={{ flex: '0 0 auto' }}>
            {nextLabel || 'Next step'}</button>
        )}
      </div>
      {banner}
      {children}
    </div>
  );
}
