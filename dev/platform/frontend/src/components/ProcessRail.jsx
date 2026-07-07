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

import React from 'react';

export default function ProcessRail({ steps, activeKey, onStep, numbered = false, wrap = false }) {
  // "Do this next" = the first actionable step that isn't done.
  const next = steps.find((s) => s.key && s.status !== 'done' && s.status !== 'info');
  const nextKey = next ? next.key : null;

  let seq = 0; // running order number over actionable steps
  return (
    <div className={'stepper' + (wrap ? ' wrap' : '')} role="tablist" aria-label="Progress">
      {steps.map((s) => {
        if (s.groupLabel) {
          return <span key={`g-${s.groupLabel}`} className="stepper-group-label">{s.groupLabel}</span>;
        }
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
      })}
    </div>
  );
}
