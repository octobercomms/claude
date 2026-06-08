import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import { CreativeCard, ExampleConcept } from '../AdCreativePanel';

// Paid Pipeline → Concepts. Read-only review of the copy: headline,
// body, CTA, framework, visual direction. Render controls are hidden
// here so AMs can focus on whether the angles are right before
// committing to render spend in the next step.
export default function PaidConceptsStep({ pipeline, clientName, onNext, onBack }) {
  const { activeBatch, creatives, deleteCreative } = pipeline;

  return (
    <PipelineStep
      num={2} title="Concepts" onNext={onNext} nextLabel="Render images & video"
      tagline="Review the copy first. Edit, delete weak ones, then render the keepers. No image cost yet."
    >
      {!activeBatch ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No brief selected — pick one on <button onClick={onBack} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)', padding: 0 }}>Step 1 · Brief</button>.
        </div>
      ) : !creatives.length ? (
        <ExampleConcept clientName={clientName} onDismiss={() => {}} />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="caption">{creatives.length} concepts · brief from {new Date(activeBatch.created_at).toLocaleDateString('en-GB')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {creatives.map(c => (
              <CreativeCard key={c.id} creative={c}
                renderMode="hidden"
                onDelete={() => deleteCreative(c.id)} />
            ))}
          </div>
        </>
      )}
    </PipelineStep>
  );
}
