// SuiteReadiness — a compact "N of M set up" rail for a suite's Overview.
// Shows the suite's major stages (not every tool) with derived ✓, flags the
// next step, and each stage links into the relevant tab. The "what do I do
// next?" answer at the level the overwhelm lives. See
// docs/omi/process-rails-plan.md.
//
// steps: [{ key, title, sub, onClick }] — status is fetched per key.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import ProcessRail from './ProcessRail';

export default function SuiteReadiness({ clientId, suite, steps, title = 'Setup progress' }) {
  const [status, setStatus] = useState({});

  useEffect(() => {
    let alive = true;
    api.get(`/clients/${clientId}/suite-progress/${suite}`)
      .then(r => { if (alive) setStatus(r.steps || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [clientId, suite]);

  const railSteps = steps.map(s => ({ ...s, status: status[s.key] || 'todo' }));
  const done = railSteps.filter(s => s.status === 'done').length;
  const total = railSteps.length;
  const complete = done === total;

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div className="caption">{title}</div>
        <span className="body-sm text-muted">
          <strong style={{ color: complete ? 'var(--positive)' : 'var(--text)' }}>{done}</strong> of {total} set up
          {complete && ' ✓'}
        </span>
      </div>
      <ProcessRail
        steps={railSteps}
        onStep={(key) => { const st = steps.find(s => s.key === key); if (st && st.onClick) st.onClick(); }}
      />
    </div>
  );
}
