import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import { CreativeCard } from '../AdCreativePanel';

// Paid Pipeline → Render. Concept cards with the render controls open
// by default (renderMode='always-open') so AMs can fire off images +
// videos across aspect ratios without an extra click per card.
export default function PaidRenderStep({ pipeline, onNext, onBack }) {
  const { activeBatch, creatives, renderImages, deleteImage, fanOutImage, deleteCreative } = pipeline;

  return (
    <PipelineStep
      num={3} title="Render" onNext={onNext} nextLabel="Share for approval"
      tagline="Image and video renders across every aspect ratio you need. Replicate / Ideogram / Firefly for stills; Replicate (Seedance / Wan 2.2) for video. Adobe generative fan-out turns one image into every other size."
    >
      {!activeBatch ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No brief selected — pick one on <button onClick={onBack} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)', padding: 0 }}>Step 1 · Brief</button>.
        </div>
      ) : !creatives.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No concepts on this brief yet. Generate them on Step 1.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
          {creatives.map(c => (
            <CreativeCard key={c.id} creative={c}
              renderMode="always-open"
              onDelete={() => deleteCreative(c.id)}
              onRender={(payload) => renderImages(c.id, payload)}
              onDeleteImage={(imgId) => deleteImage(imgId, c.id)}
              onFanOut={(imgId) => fanOutImage(imgId, c.id)} />
          ))}
        </div>
      )}
    </PipelineStep>
  );
}
