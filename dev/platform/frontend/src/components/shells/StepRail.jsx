import React from 'react';

// StepRail (L4) — the ONE step indicator, merging Stepper (position-based) and
// ProcessRail (status-based). Drives every "Build" pipeline and wizard.
//   steps: [{ key, label, status?: 'done' | 'todo' }]
//   activeKey — the open step (gets the accent dot)
//   onStep(key) — navigate; omit for a display-only rail
//   numbered — show order on not-yet-done steps (✓ wins once done)
export default function StepRail({ steps = [], activeKey, onStep, numbered = true }) {
  return (
    <div className="ds-steprail" role="tablist" aria-label="Progress">
      {steps.map((s, i) => {
        const done = s.status === 'done';
        const active = s.key === activeKey;
        const cls = ['ds-steprail__step', done ? 'done' : '', active ? 'active' : '']
          .filter(Boolean).join(' ');
        return (
          <button
            type="button"
            key={s.key || i}
            className={cls}
            role="tab"
            aria-selected={active}
            onClick={onStep ? () => onStep(s.key) : undefined}
            disabled={!onStep}
          >
            {i < steps.length - 1 && <span className="ds-steprail__line" aria-hidden="true" />}
            <span className="ds-steprail__dot">{done ? '✓' : numbered ? i + 1 : ''}</span>
            <span className="ds-steprail__cap">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
