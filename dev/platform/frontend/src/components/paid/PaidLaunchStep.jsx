import React from 'react';
import PipelineStep from '../organic/PipelineStep';

// Paid Pipeline → Launch. End of the production arc — hand-off to the
// ad platform. Today this is a manual export (download images, paste
// copy into Meta Ads Manager). A future iteration will push directly to
// Meta via the Marketing API; until then the AM gets a structured
// pre-launch checklist + a download bundle.
const CHECKLIST = [
  { label: 'Client has approved the batch',                   automatic: false },
  { label: 'Headlines fit Meta\'s 27-char primary text limit', automatic: false },
  { label: 'Final images are sized 1:1, 4:5 and 9:16',        automatic: false },
  { label: 'Tracking pixel + UTM scheme confirmed for the campaign', automatic: false },
  { label: 'Daily budget + bid strategy agreed with client',  automatic: false },
];

export default function PaidLaunchStep({ pipeline, onBack }) {
  const { activeBatch, creatives } = pipeline;
  const totalImages = (creatives || []).reduce((sum, c) => sum + ((c.images || []).length), 0);

  return (
    <PipelineStep
      num={5} title="Launch"
      tagline="Hand the approved batch off to Meta Ads Manager or Google. Direct API launch is on the roadmap — for now it's a manual export with the pre-launch checklist."
    >
      {!activeBatch ? (
        <div className="callout" style={{ fontSize: 13 }}>
          No brief selected — pick one on the <button onClick={onBack} className="btn-inline-link">Brief</button> step.
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="caption mb-2">Ready to ship</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              {creatives.length} concepts · {totalImages} rendered assets
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="caption mb-3">Pre-launch checklist</div>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.8 }}>
              {CHECKLIST.map((c, i) => (
                <li key={i} style={{ color: 'var(--text)' }}>
                  {c.label}
                  {c.automatic && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-subtle)' }}>(auto-verified)</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="card" style={{ background: 'var(--surface-raised)' }}>
            <div className="caption mb-2">Direct launch — coming</div>
            <p className="body-sm text-muted">
              Push the batch straight into Meta Ads Manager (ad set drafts with creative + copy + audience pre-filled). Google Ads will follow once the Performance Max creative API is more permissive. Until then the AM downloads the assets and copy-pastes into the platform manually.
            </p>
          </div>
        </>
      )}
    </PipelineStep>
  );
}
