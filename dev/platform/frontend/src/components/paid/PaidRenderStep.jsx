import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import { CreativeCard } from '../AdCreativePanel';
import ExampleBanner from './ExampleBanner';

// Paid Pipeline → Render. Concept cards with the render controls open
// by default (renderMode='always-open') so AMs can fire off images +
// videos across aspect ratios without an extra click per card.
export default function PaidRenderStep({ pipeline, onNext, onBack }) {
  const { activeBatch, creatives, renderImages, deleteImage, fanOutImage, deleteCreative } = pipeline;

  return (
    <PipelineStep
      num={3} title="Render" onNext={onNext} nextLabel="Share for approval"
      tagline="Image and video renders across every aspect ratio you need. Replicate / Ideogram / Firefly for stills; Replicate (Seedance / Wan 2.2) for video. Adobe generative fan-out turns one image into every other size."
      banner={activeBatch?.is_example ? <ExampleBanner onNewBrief={onBack} /> : null}
    >
      {!activeBatch ? (
        <div className="callout" style={{ fontSize: 13 }}>
          No brief selected — pick one on the <button onClick={onBack} className="btn-inline-link">Brief</button> step.
        </div>
      ) : !creatives.length ? (
        <div className="callout" style={{ fontSize: 13 }}>
          No concepts on this brief yet — generate them on the <button onClick={onBack} className="btn-inline-link">Brief</button> step.
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
