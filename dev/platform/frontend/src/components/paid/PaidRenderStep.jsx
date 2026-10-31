import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import NoBriefYet from './NoBriefYet';
import { CreativeCard } from '../AdCreativePanel';
import ExampleBanner from './ExampleBanner';

// Paid Pipeline → Render. Concept cards with the render controls open
// by default (renderMode='always-open') so AMs can fire off images +
// videos across aspect ratios without an extra click per card.
export default function PaidRenderStep({ pipeline, onBack }) {
  const { activeBatch, creatives, renderImages, deleteImage, fanOutImage, deleteCreative, uploadMedia, updateCreative } = pipeline;
  const shown = (creatives || []).filter(c => c.show_to_client !== false).length;

  return (
    <PipelineStep
      num={3} title="Render"
      tagline="Image and video renders across every aspect ratio you need. Replicate / Ideogram / Firefly for stills; Replicate (Seedance / Wan 2.2) for video. Adobe generative fan-out turns one image into every other size. Untick anything the client should not see — it stays in the batch and out of the approval link."
      banner={activeBatch?.is_example ? <ExampleBanner onNewBrief={onBack} /> : null}
    >
      {!activeBatch ? (
        <NoBriefYet what="This step turns approved copy into images and video across every aspect ratio you need." onBack={onBack} />
      ) : !creatives.length ? (
        <div className="callout" style={{ fontSize: 'var(--fs-body)' }}>
          No concepts on this brief yet — generate them on the <button onClick={onBack} className="btn-inline-link">Brief</button> step.
        </div>
      ) : (
        <>
          {/* Said in one place rather than counted off the grid. The number
              that matters before sending a link is how many the client will
              actually open. */}
          <div className="body-sm text-muted" style={{ marginBottom: 'var(--s3)' }}>
            {shown === creatives.length
              ? `All ${creatives.length} concepts go to the client.`
              : `${shown} of ${creatives.length} go to the client — ${creatives.length - shown} held back.`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 'var(--s4)' }}>
            {creatives.map(c => (
              <CreativeCard key={c.id} creative={c}
                renderMode="always-open"
                copyMode="compact"
                onToggleShare={(next) => updateCreative(c.id, { show_to_client: next })}
                onDelete={() => deleteCreative(c.id)}
                onRender={(payload) => renderImages(c.id, payload)}
                onDeleteImage={(imgId) => deleteImage(imgId, c.id)}
                onFanOut={(imgId) => fanOutImage(imgId, c.id)}
                onUpload={(file, aspect) => uploadMedia(c.id, file, aspect)} />
            ))}
          </div>
        </>
      )}
    </PipelineStep>
  );
}
