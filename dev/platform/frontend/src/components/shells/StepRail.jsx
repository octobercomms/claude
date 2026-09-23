import React from 'react';

// StepRail (L4) — the ONE step indicator. Supersedes Stepper (position-based),
// ProcessRail (status-based) and every bespoke inline stepper. Drives every
// "Build" pipeline, wizard and readiness rail.
//
//   steps: [{ key, label|title, sub?, status?: 'done' | 'todo' | 'info' } | { groupLabel }]
//     label / title — the step name (label is the shell alias for title)
//     sub           — a one-line descriptor under the name
//     status        — 'done' (✓), 'todo' (default), or 'info' (ⓘ reference step,
//                     always reachable, never flagged "next")
//     groupLabel    — a non-clickable separator label (e.g. "Measurement")
//   activeKey — the open step (gets the active highlight)
//   onStep(key) — navigate; omit for a display-only rail
//   numbered — number the todo steps in order (a "work through these" guide);
//              ✓ still wins once done
//   wrap — let a long rail flow onto multiple rows as bordered cards
//   grouped — render each groupLabel section as its own titled bento
export default function StepRail({ steps = [], activeKey, onStep, numbered = false, wrap = false, grouped = false }) {
  // "Do this next" = the first actionable step that isn't done.
  const next = steps.find((s) => s.key && s.status !== 'done' && s.status !== 'info');
  const nextKey = next ? next.key : null;

  let seq = 0; // running order number over actionable steps, continuous across groups

  const renderStep = (s) => {
    const isDone = s.status === 'done';
    const isInfo = s.status === 'info';
    if (!isInfo) seq += 1;
    const isActive = s.key === activeKey;
    const isNext = s.key === nextKey;
    const cls = ['stepper-step', isDone ? 'done' : '', isActive ? 'active' : ''].filter(Boolean).join(' ');
    const num = isDone ? '✓'
      : isInfo ? 'ⓘ'
      : numbered ? seq
      : isNext ? '→' : '•';
    return (
      <button
        type="button"
        key={s.key}
        className={cls}
        role="tab"
        aria-selected={isActive}
        onClick={onStep ? () => onStep(s.key) : undefined}
        disabled={!onStep}
      >
        <span className="stepper-num">{num}</span>
        <span className="stepper-meta">
          <span className="stepper-t">
            {s.label || s.title}
            {isNext && !isActive && <span style={{ color: 'var(--text)', fontWeight: 700 }}> · next</span>}
          </span>
          {s.sub && <span className="stepper-s">{s.sub}</span>}
        </span>
      </button>
    );
  };

  // Grouped: split at each groupLabel into sections, each its own titled bento.
  if (grouped) {
    const sections = [];
    let cur = null;
    for (const s of steps) {
      if (s.groupLabel) { cur = { label: s.groupLabel, steps: [] }; sections.push(cur); }
      else { if (!cur) { cur = { label: null, steps: [] }; sections.push(cur); } cur.steps.push(s); }
    }
    return (
      <div className="stepper-grouped" role="tablist" aria-label="Progress">
        {sections.map((sec, i) => (
          <div className="stepper-group-card" key={sec.label || `sec-${i}`}>
            {sec.label && <div className="stepper-group-heading">{sec.label}</div>}
            <div className="stepper wrap">{sec.steps.map(renderStep)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={'stepper' + (wrap ? ' wrap' : '')} role="tablist" aria-label="Progress">
      {steps.map((s) => s.groupLabel
        ? <span key={`g-${s.groupLabel}`} className="stepper-group-label">{s.groupLabel}</span>
        : renderStep(s))}
    </div>
  );
}
