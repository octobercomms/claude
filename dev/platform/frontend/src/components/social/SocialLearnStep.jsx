import React from 'react';
import PipelineStep from '../organic/PipelineStep';

// Social Pipeline → Learn. The feedback step that closes the loop —
// winners feed back into the next brainstorm's prompt context, so what
// works gets reinforced. Same data as Performance → Winners but framed
// as production feedback rather than measurement.
//
// Children = an existing WinnersPanel (or equivalent) rendered by the
// parent, so we don't duplicate component logic.
export default function SocialLearnStep({ children, onBack, onOpenHookVault }) {
  return (
    <PipelineStep
      num={4} title="Learn"
      tagline="Heater posts (2× the 30-day median reach) feed back into the next brainstorm's prompt context. The loop closes here — what works gets reinforced."
    >
      {onOpenHookVault && (
        <div className="row end mb-3">
          <button onClick={onOpenHookVault} className="btn btn-secondary">✦ Open Hook Vault</button>
        </div>
      )}
      {children}
    </PipelineStep>
  );
}
