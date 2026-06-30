import React from 'react';
import PipelineStep from '../organic/PipelineStep';

// Paid Pipeline → Approve. Mint a public approval link the client can
// open without a login and approve / request changes on. Reuses the
// existing /api/approvals scheme — same as content drafts and other
// approval flows so the client gets a consistent review UX.
export default function PaidApproveStep({ pipeline, onNext, onBack }) {
  const { activeBatch, creatives, shareUrl, setShareUrl, shareBatchForApproval } = pipeline;
  const totalImages = (creatives || []).reduce((sum, c) => sum + ((c.images || []).length), 0);
  const conceptsWithImages = (creatives || []).filter(c => (c.images || []).length).length;

  return (
    <PipelineStep
      num={4} title="Approve" onNext={onNext} nextLabel="Launch"
      tagline="Generate a public link to share with the client. They review, approve, or request changes — no login required. Link expires after 14 days."
    >
      {!activeBatch ? (
        <div className="callout" style={{ fontSize: 13 }}>
          No brief selected — pick one on the <button onClick={onBack} className="btn-inline-link">Brief</button> step.
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="caption mb-2">Batch summary</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              {creatives.length} concepts · {conceptsWithImages} with rendered assets · {totalImages} total images / videos
            </div>
            {totalImages === 0 && (
              <p className="body-sm text-muted mt-2">
                Nothing rendered yet — clients usually need at least one rendered asset per concept to approve.
                Go back to <button onClick={() => window.history.back()} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)', padding: 0 }}>Step 3 · Render</button> first.
              </p>
            )}
          </div>

          <button onClick={shareBatchForApproval} className="btn btn-primary">
            {shareUrl ? 'Regenerate approval link' : 'Generate approval link'}
          </button>

          {shareUrl && (
            <div style={{ background: 'var(--positive-soft)', border: '1px solid #2e7d32', padding: '12px 16px', borderRadius: 'var(--r-sm)', marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ fontSize: 12, color: 'var(--positive)' }}>Link ready —</strong>
              <input value={shareUrl} readOnly onFocus={e => e.target.select()}
                style={{ flex: 1, padding: '5px 10px', fontSize: 12, border: '1px solid #aac9b0', borderRadius: 'var(--r-sm)', background: 'var(--surface)', fontFamily: 'monospace' }} />
              <button onClick={() => navigator.clipboard.writeText(shareUrl)} className="btn btn-primary btn-sm">Copy</button>
              <button onClick={() => setShareUrl(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--positive)' }}>×</button>
            </div>
          )}
        </>
      )}
    </PipelineStep>
  );
}
