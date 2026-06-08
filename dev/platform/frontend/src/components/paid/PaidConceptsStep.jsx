import React, { useState } from 'react';
import PipelineStep from '../organic/PipelineStep';
import { CreativeCard, ExampleConcept } from '../AdCreativePanel';
import RefineChat from '../RefineChat';

// Paid Pipeline → Concepts. Read-only review of the copy: headline,
// body, CTA, framework, visual direction. Render controls are hidden
// here so AMs can focus on whether the angles are right before
// committing to render spend in the next step.
//
// Per-concept "Refine with Claude" toggle lifts a single concept into
// a 2-column focus view (concept on the left, refine chat on the right)
// so the AM can iterate on copy without round-tripping to a draft.
// Applied revisions PUT the parsed fields back onto the concept.
export default function PaidConceptsStep({ pipeline, clientName, clientId, onNext, onBack }) {
  const { activeBatch, creatives, deleteCreative, updateCreative } = pipeline;
  const [refiningId, setRefiningId] = useState(null);
  const [refineErr, setRefineErr] = useState(null);

  const refining = refiningId ? creatives.find(c => c.id === refiningId) : null;

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
      ) : refining ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <button onClick={() => { setRefiningId(null); setRefineErr(null); }} className="btn btn-ghost btn-sm">
              ← Back to all {creatives.length} concepts
            </button>
            <div className="caption">Refining: {refining.framework} · {refining.angle}</div>
          </div>
          {refineErr && <div className="callout callout-danger mb-3">{refineErr}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 'var(--s4)' }}>
            <div>
              <CreativeCard creative={refining} renderMode="hidden" onDelete={() => {}} />
            </div>
            <RefineChat
              clientId={clientId}
              kind="ad_concepts"
              artifact={renderConceptForArtifact(refining)}
              artifactMeta={`framework: ${refining.framework}, angle: ${refining.angle}`}
              onApplyRevision={(content) => {
                const partial = parseConceptFields(content);
                if (!partial) {
                  setRefineErr('Could not parse revised concept. Ask Claude to use the HEADLINE/BODY/CTA labels.');
                  return;
                }
                setRefineErr(null);
                updateCreative(refining.id, partial);
              }}
              onClose={() => setRefiningId(null)}
              compact
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="caption">{creatives.length} concepts · brief from {new Date(activeBatch.created_at).toLocaleDateString('en-GB')}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {creatives.map(c => (
              <div key={c.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <CreativeCard creative={c}
                  renderMode="hidden"
                  onDelete={() => deleteCreative(c.id)} />
                <button onClick={() => setRefiningId(c.id)}
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  ✦ Refine with Claude
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </PipelineStep>
  );
}

// Render the concept fields as a labelled text block so Claude sees the
// same structure the AM is editing. Mirrors the field labels used in
// the rendered card so Claude's revisions echo the same labels back.
function renderConceptForArtifact(c) {
  const lines = [
    `FRAMEWORK: ${c.framework || ''}`,
    `ANGLE: ${c.angle || ''}`,
    `HEADLINE: ${c.headline || ''}`,
    `BODY: ${c.body || ''}`,
    `CTA: ${c.cta || ''}`,
    `VISUAL CONCEPT: ${c.visual_concept || ''}`,
  ];
  if (c.notes) lines.push(`NOTES: ${c.notes}`);
  return lines.join('\n\n');
}

// Pull headline/body/cta/visual/notes/angle back out of Claude's
// revision block. The system prompt asks Claude to keep the same
// labels, so we match on field name then take everything up to the
// next field label. Tolerant of stray markdown bold (**HEADLINE**) and
// case variation.
function parseConceptFields(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/\*\*/g, '').trim();
  const labels = ['headline', 'body', 'cta', 'visual concept', 'visual', 'notes', 'angle'];
  const out = {};
  // For each label, find "<label>:" and capture until the next label.
  for (const label of labels) {
    const labelRe = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${labels.join('|')})\\s*:|$)`, 'i');
    const m = cleaned.match(labelRe);
    if (!m) continue;
    const value = m[1].trim();
    if (!value) continue;
    const key = label === 'visual' || label === 'visual concept' ? 'visual_concept' : label;
    if (!out[key]) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}
