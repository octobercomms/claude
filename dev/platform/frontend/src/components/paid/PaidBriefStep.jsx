import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import { BriefModal } from '../AdCreativePanel';

// Paid Pipeline → Brief. Past batches list on the left, "+ New batch"
// opens the brief form. Selecting a batch sets it as active across all
// subsequent steps (Concepts / Render / Approve / Launch read from
// the shared usePaidPipeline state).
export default function PaidBriefStep({ pipeline, onNext }) {
  const {
    batches, activeBatchId, selectBatch, deleteBatch,
    assets, showBrief, setShowBrief, generate, generating,
  } = pipeline;

  return (
    <PipelineStep
      num={1} title="Brief" onNext={onNext} nextLabel="See the concepts"
      tagline="Tell Claude what you want — the offer, the audience, anything to avoid. Each brief produces a batch of concepts grounded in the brand assets you've uploaded."
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div className="caption">Past briefs</div>
        <button onClick={() => setShowBrief(true)} className="btn btn-primary" disabled={generating}>
          {generating ? 'Generating…' : '+ New brief'}
        </button>
      </div>

      {!assets.length && (
        <div className="callout" style={{ background: 'var(--warning-soft)', border: '1px solid #f0d260', padding: 12, borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--warning)', marginBottom: 16 }}>
          No brand assets uploaded yet — visit the <strong>Brand</strong> tab and add logos, product photos, palette and guidelines so generations look on-brand.
        </div>
      )}

      {showBrief && (
        <BriefModal
          assets={assets}
          submitting={generating}
          onClose={() => setShowBrief(false)}
          onSubmit={generate}
        />
      )}

      {!batches.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No briefs yet. Click <strong>+ New brief</strong> to generate the first batch — Claude will return 4–16 ad concepts grounded in the brand kit.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {batches.map(b => (
            <div key={b.id} className="card"
              style={{
                padding: 14, cursor: 'pointer',
                background: b.id === activeBatchId ? 'var(--accent-soft)' : 'var(--surface)',
                borderColor: b.id === activeBatchId ? 'var(--accent)' : 'var(--card-border)',
              }}
              onClick={() => selectBatch(b.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{b.creative_count} concepts · {b.platform}</div>
              </div>
              {b.brief && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  {b.brief.slice(0, 160)}{b.brief.length > 160 ? '…' : ''}
                </div>
              )}
              {b.id === activeBatchId && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={(e) => { e.stopPropagation(); onNext?.(); }} className="btn btn-primary btn-sm">Open concepts →</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteBatch(b.id); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PipelineStep>
  );
}
