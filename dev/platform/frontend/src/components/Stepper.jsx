// Stepper — a reusable horizontal step indicator + navigator. Each step shows
// a number (✓ once passed), a title and an optional subtitle; the current step
// is highlighted and passed steps go green. Clicking a step calls onStep(n)
// (1-based) — the parent decides which steps are reachable. Collapses to
// compact number+title chips on narrow screens (see .stepper rules in CSS).
import React from 'react';

export default function Stepper({ steps, current, onStep }) {
  return (
    <div className="stepper" role="tablist" aria-label="Progress">
      {steps.map((s, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <button
            type="button"
            key={n}
            className={`stepper-step ${state}`.trim()}
            role="tab"
            aria-selected={n === current}
            onClick={() => onStep && onStep(n)}
          >
            <span className="stepper-num">{n < current ? '✓' : n}</span>
            <span className="stepper-meta">
              <span className="stepper-t">{s.title}</span>
              {s.sub && <span className="stepper-s">{s.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
