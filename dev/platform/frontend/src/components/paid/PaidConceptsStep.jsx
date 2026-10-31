import React, { useState } from 'react';
import PipelineStep from '../organic/PipelineStep';
import NoBriefYet from './NoBriefYet';
import { CreativeCard, ExampleConcept } from '../AdCreativePanel';
import ExampleBanner from './ExampleBanner';
import ConceptEditModal from './ConceptEditModal';

// Paid Pipeline → Draft. Review the copy before anything costs a render.
//
// Editing used to replace the whole grid with a two-column focus view:
// the one concept on the left, a Claude chat on the right, and no field you
// could type into. Three problems in one. You lost sight of the other seven
// concepts, which is the thing Draft is for; the only way to change a word
// was an API call; and "Refine with Claude" named the mechanism rather than
// the job, so the button for fixing a typo did not look like one.
//
// It is a modal now, opened from a button inside the card it edits, with
// plain fields and the chat as an option beside them.
export default function PaidConceptsStep({ pipeline, clientName, clientId, onBack }) {
  const { activeBatch, creatives, deleteCreative, updateCreative } = pipeline;
  const [editingId, setEditingId] = useState(null);

  const editing = editingId ? creatives.find(c => c.id === editingId) : null;

  return (
    <PipelineStep
      num={2} title="Draft"
      tagline="Review the copy first. Edit it yourself or hand it back to Claude, delete the weak ones, then render the keepers. No image cost yet."
      banner={activeBatch?.is_example ? <ExampleBanner onNewBrief={onBack} /> : null}
    >
      {!activeBatch ? (
        <NoBriefYet what="This step shows the copy Claude wrote — headline, body, CTA and visual direction — for you to edit before anything is rendered." onBack={onBack} />
      ) : !creatives.length ? (
        <ExampleConcept clientName={clientName} onDismiss={() => {}} />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
            <div className="caption">{creatives.length} concepts · brief from {new Date(activeBatch.created_at).toLocaleDateString('en-GB')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 'var(--s4)' }}>
            {creatives.map(c => (
              <CreativeCard key={c.id} creative={c}
                renderMode="hidden"
                onEdit={() => setEditingId(c.id)}
                onDelete={() => deleteCreative(c.id)} />
            ))}
          </div>
        </>
      )}

      {editing && (
        <ConceptEditModal
          creative={editing}
          clientId={clientId}
          onSave={partial => updateCreative(editing.id, partial)}
          onClose={() => setEditingId(null)}
        />
      )}
    </PipelineStep>
  );
}
