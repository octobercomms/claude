// ProcessRail — a status-driven sibling of Stepper. Where Stepper marks steps
// done by POSITION (a linear pipeline), ProcessRail marks each step done from
// real data, so a later step can be complete while an earlier one isn't. It
// makes a flat group of sub-tabs read as a process: what's done (✓), what to do
// next (· next / →), and what's still open. See docs/omi/process-rails-plan.md.
//
// steps: [{ key, title, sub, status: 'done' | 'todo' | 'info' } | { groupLabel }]
//   info       — a reference step with no completion (always reachable, never "next")
//   groupLabel — a non-clickable separator label (e.g. "Measurement")
// activeKey — the currently-open step (gets the active highlight)
// onStep(key) — navigate to a step
// numbered — show the step's order number on todo steps (a "work through these
//   in order" guide); ✓ still wins once done.
// wrap — allow a long rail to flow onto multiple rows as bordered cards instead
//   of squashing into one cramped row.
// grouped — render each groupLabel section as its own titled bento (the label
//   sits above that section's steps) instead of as an inline separator.

import React from 'react';

export default function ProcessRail({ steps, activeKey, onStep, numbered = false, wrap = false, grouped = false }) {
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
        onClick={() => onStep && onStep(s.key)}
      >
        <span className="stepper-num">{num}</span>
        <span className="stepper-meta">
          <span className="stepper-t">
            {s.title}
            {isNext && !isActive && <span style={{ color: 'var(--accent)', fontWeight: 700 }}> · next</span>}
          </span>
          {s.sub && <span className="stepper-s">{s.sub}</span>}
        </span>
      </button>
    );
  };

  // Grouped: split at each groupLabel into sections, and render each as its own
  // titled bento (label above the steps) within one rail.
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
