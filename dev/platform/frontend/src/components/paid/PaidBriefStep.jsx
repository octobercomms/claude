import React, { useEffect, useState } from 'react';
import PipelineStep from '../organic/PipelineStep';
import { BriefModal } from '../AdCreativePanel';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';
import { api } from '../../utils/api';

// Paid Pipeline → Brief. Past batches list on the left, "+ New batch"
// opens the brief form. Selecting a batch sets it as active across all
// subsequent steps (Concepts / Render / Approve / Launch read from
// the shared usePaidPipeline state).
export default function PaidBriefStep({ pipeline, onNext, clientId, clientName }) {
  const {
    batches, activeBatchId, selectBatch, deleteBatch,
    assets, showBrief, setShowBrief, generate, generating, loaded,
  } = pipeline;
  const { readOnly } = useAuth();

  return (
    <PipelineStep
      num={1} title="Brief" onNext={onNext} nextLabel="See the concepts"
      tagline="Tell Claude what you want — the offer, the audience, anything to avoid. Each brief produces a batch of concepts grounded in the brand assets you've uploaded."
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

      {showBrief && (
        <BriefModal
          assets={assets}
          clientId={clientId}
          submitting={generating}
          onClose={() => setShowBrief(false)}
          onSubmit={generate}
        />
      )}

      {loaded && !batches.length ? (
        <ExampleAdCard clientId={clientId} clientName={clientName} />
      ) : !batches.length ? null : (
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

// Empty-state example. Instead of a bare "no briefs yet" line, draft one
// real concept from THIS client's own profile (the briefing + monthly focus
// captured at quick-setup) so the AM can see the output — and show a client
// a tangible example — before generating a paid batch. Clearly badged as an
// example so it's never mistaken for approved creative. Regenerable; the
// underlying /sample call is a throwaway (nothing is persisted).
function ExampleAdCard({ clientId, clientName }) {
  const [sample, setSample] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  async function draft() {
    setLoading(true); setErr(null);
    try {
      const { sample: s } = await api.post(`/ad-creatives/clients/${clientId}/sample`, { platform: 'meta' });
      setSample(s);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { draft(); /* eslint-disable-line */ }, [clientId]);

  return (
    <div>
      <div className="callout" style={{ background: 'var(--accent-soft)', border: 'var(--border-w) solid var(--accent)', borderRadius: 'var(--r-sm)', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, minWidth: 0 }}>
          No briefs yet — here's an <strong>example</strong> drafted from {clientName || 'this client'}'s profile so you can see the output (and show a client). Click <strong>+ New brief</strong> to generate real, editable concepts.
        </div>
        <button className="btn btn-secondary btn-sm" onClick={draft} disabled={loading} style={{ whiteSpace: 'nowrap' }}>
          {loading ? 'Drafting…' : '↻ Regenerate'}
        </button>
      </div>

      {err ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          Couldn't draft an example ({err}). Click <strong>+ New brief</strong> to generate concepts directly.
        </div>
      ) : loading && !sample ? (
        <div className="card" style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13 }}>
          Drafting an example ad for {clientName || 'this client'}…
        </div>
      ) : sample ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
          <div className="card" style={{ position: 'relative', opacity: loading ? 0.6 : 1 }}>
            <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-subtle)', background: 'var(--surface-sunken)', padding: '2px 8px', borderRadius: 'var(--r-sm)' }}>Example</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sample.framework && <span className="chip chip-accent" style={{ fontSize: 10 }}>{sample.framework}</span>}
              {sample.angle && <span className="chip chip-outline" style={{ fontSize: 10 }}>{sample.angle}</span>}
            </div>
            {sample.headline && (
              <div style={{ marginTop: 10 }}>
                <div className="field">HEADLINE</div>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{sample.headline}</div>
              </div>
            )}
            {sample.body && (
              <div style={{ marginTop: 8 }}>
                <div className="field">BODY</div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{sample.body}</div>
              </div>
            )}
            {sample.cta && (
              <div style={{ marginTop: 8 }}>
                <div className="field">CTA</div>
                <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{sample.cta}</div>
              </div>
            )}
            {sample.visual_concept && (
              <div style={{ marginTop: 10 }}>
                <div className="field">VISUAL CONCEPT</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{sample.visual_concept}</div>
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic', lineHeight: 1.4 }}>
              Illustrative example — not approved creative. Generate a brief for real concepts you can render and export.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
