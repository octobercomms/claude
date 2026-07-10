import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import { BriefModal, GeneratingModal } from '../AdCreativePanel';
import ExampleBanner from './ExampleBanner';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

// Paid Pipeline → Brief. Past briefs list, "+ New brief" opens the brief
// form. Selecting a batch sets it as active across all subsequent steps
// (Concepts / Render / Approve / Launch read from the shared
// usePaidPipeline state).
//
// When a client has no real briefs yet, a persisted "worked example" batch
// is generated once (see usePaidPipeline.ensureExample) and shown here,
// badged as an example — it runs through every step so the AM can see what
// each stage produces and show a client, without it being mistaken for
// approved work.
export default function PaidBriefStep({ pipeline, onNext, clientId, clientName }) {
  const {
    batches, realBatches, exampleBatch, ensuringExample, exampleError, ensureExample,
    activeBatchId, selectBatch, deleteBatch,
    assets, showBrief, setShowBrief, generate, generating, loaded,
  } = pipeline;
  const { readOnly } = useAuth();

  const onlyExample = loaded && !realBatches.length;

  return (
    <PipelineStep
      num={1} title="Brief" onNext={onNext} nextLabel="See the concepts"
      tagline="Tell Claude what you want — the offer, the audience, anything to avoid. Each brief produces a batch of concepts grounded in the brand assets you've uploaded."
      banner={onlyExample && exampleBatch ? <ExampleBanner onNewBrief={() => setShowBrief(true)} /> : null}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div className="caption">Past briefs</div>
        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => setShowBrief(true), disabled: generating })}>
          {generating ? 'Generating…' : '+ New brief'}
        </button>
      </div>

      {!assets.length && (
        <div className="callout" style={{ background: 'var(--warning-soft)', border: '1px solid #f0d260', padding: 12, borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--warning)', marginBottom: 16 }}>
          No brand assets uploaded yet — visit the <strong>Brand</strong> tab and add logos, product photos, palette and guidelines so generations look on-brand.
        </div>
      )}

      {showBrief && !generating && (
        <BriefModal
          assets={assets}
          clientId={clientId}
          submitting={generating}
          onClose={() => setShowBrief(false)}
          onSubmit={generate}
        />
      )}
      {generating && <GeneratingModal clientName={clientName} />}

      {loaded && ensuringExample && !exampleBatch ? (
        <div className="card" style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13 }}>
          Drafting a worked example for {clientName || 'this client'} — a real batch you can walk through every step…
        </div>
      ) : loaded && !batches.length ? (
        // No briefs at all — offer to build the worked example, or write a real brief.
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, marginBottom: 12, maxWidth: 620 }}>
            No briefs yet. Generate a <strong>worked example</strong> from {clientName || 'this client'}'s profile — a real batch you can walk through every step and show a client — or write your own with <strong>+ New brief</strong>.
          </div>
          {exampleError && (
            <div className="callout callout-danger" style={{ fontSize: 12, marginBottom: 12 }}>
              Couldn't generate the example: {exampleError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" {...roWrite(readOnly, { onClick: ensureExample, disabled: ensuringExample })}>
              {ensuringExample ? 'Generating…' : '✨ Generate a worked example'}
            </button>
            <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: () => setShowBrief(true), disabled: generating })}>
              + New brief
            </button>
          </div>
        </div>
      ) : !batches.length ? null : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {batches.map(b => {
            const isExample = b.is_example;
            const isActive = b.id === activeBatchId;
            return (
              <div key={b.id} className="card"
                style={{
                  padding: 14, cursor: 'pointer',
                  background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                  borderColor: isActive || isExample ? 'var(--accent)' : 'var(--card-border)',
                }}
                onClick={() => selectBatch(b.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isExample && <span className="chip chip-accent" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>Example</span>}
                    {new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{b.creative_count} concepts · {b.platform}</div>
                </div>
                {b.brief && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                    {b.brief.slice(0, 160)}{b.brief.length > 160 ? '…' : ''}
                  </div>
                )}
                {isActive && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={(e) => { e.stopPropagation(); onNext?.(); }} className="btn btn-primary btn-sm">Open concepts →</button>
                    <button onClick={(e) => { e.stopPropagation(); deleteBatch(b.id); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PipelineStep>
  );
}
