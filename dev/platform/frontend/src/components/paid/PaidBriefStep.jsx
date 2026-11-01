import React from 'react';
import PipelineStep from '../organic/PipelineStep';
import { BriefForm, GeneratingModal } from '../AdCreativePanel';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

// Paid Pipeline → Brief.
//
// The form is the page. It used to be behind a "+ New brief" button behind a
// modal, under a tagline reading "Tell Claude what you want" — a page that
// asked a question and gave you nowhere to answer it. Writing a brief is the
// entire job of this step, so it is what the step shows.
//
// Past briefs sit underneath: a record, not the main event.
export default function PaidBriefStep({ pipeline, clientId, clientName, briefSeed, onOpenBatch }) {
  const {
    batches, realBatches, exampleBatch, ensuringExample, exampleError, ensureExample,
    activeBatchId, selectBatch, deleteBatch,
    assets, generate, generateMatrix, generating, loaded,
  } = pipeline;
  const { readOnly } = useAuth();

  // Open a brief: select it, and go where the effect of selecting it shows.
  // Falls back to selecting alone if no opener was passed, so the component
  // still behaves if it is ever mounted somewhere with no step rail.
  const open = (id) => (onOpenBatch ? onOpenBatch(id) : selectBatch(id));

  const onlyExample = loaded && !realBatches.length;

  return (
    <PipelineStep
      num={1} title="Brief"
      tagline="Describe the campaign and Claude writes the ad copy: a headline, body, CTA and a visual direction for each concept, grounded in the brand assets you've uploaded. Text only at this stage — images are rendered on step 3, so nothing here costs image spend."
    >
      {!assets.length && (
        <div className="callout" style={{ background: 'var(--warning-soft)', border: '1px solid #f0d260', padding: 'var(--s3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-caption)', color: 'var(--warning)', marginBottom: 'var(--s4)' }}>
          No brand assets uploaded yet — visit the <strong>Brand</strong> tab and add logos, product photos, palette and guidelines so generations look on-brand.
        </div>
      )}

      {/* `key` on the seed, so research handed over from Competitors arrives
          in a form that has actually reset to it. Without it the field keeps
          whatever was typed before, and the hand-off silently does nothing. */}
      <div className="card" style={{ marginBottom: 'var(--s7)' }}>
        <BriefForm
          inline
          key={briefSeed || 'blank'}
          assets={assets}
          clientId={clientId}
          initialBrief={briefSeed || ''}
          submitting={generating}
          onSubmit={generate}
          onSubmitMatrix={generateMatrix}
        />
      </div>

      {generating && <GeneratingModal clientName={clientName} />}

      {onlyExample && exampleBatch && (
        <p className="body-sm text-muted" style={{ marginBottom: 'var(--s3)', lineHeight: 1.6, maxWidth: 680 }}>
          The batch below is a <strong>worked example</strong> drawn from{' '}
          {clientName || 'this client'}&apos;s profile, badged so it is never mistaken
          for approved work. Walk it through every step to see what each one
          produces, or write your own brief above.
        </p>
      )}

      {/* "The past briefs doesnt seem to do anything", then, after a round
          of explanatory copy, "i click it and nothing happens".
          
          Both true. Clicking selected the batch, and selecting changed only
          what the LATER steps work on, so on the screen where the click
          happened nothing moved except a border colour. The first fix added
          a sentence explaining that, which explains a problem rather than
          removing it. An action whose entire effect is on another screen
          should take you to that screen, so a click now opens Draft with
          that brief loaded. */}
      <div className="row between center" style={{ marginBottom: 'var(--s3)', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div className="caption">Past briefs</div>
        {batches.length > 1 && (
          <div className="body-xs text-subtle">Click one to open it in Draft. Render and Launch follow it too.</div>
        )}
      </div>

      {loaded && ensuringExample && !exampleBatch ? (
        <div className="card" style={{ padding: 'var(--s5)', color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>
          Drafting a worked example for {clientName || 'this client'}…
        </div>
      ) : loaded && !batches.length ? (
        <div className="card" style={{ padding: 'var(--s5)' }}>
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 'var(--s3)', maxWidth: 620 }}>
            Nothing generated yet. Write a brief above, or build a worked
            example from {clientName || 'this client'}&apos;s profile to see what
            each step produces.
          </div>
          {exampleError && (
            <div className="callout callout-danger" style={{ fontSize: 'var(--fs-caption)', marginBottom: 'var(--s3)' }}>
              Couldn&apos;t generate the example: {exampleError}
            </div>
          )}
          <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: ensureExample, disabled: ensuringExample })}>
            {ensuringExample ? 'Generating…' : 'Generate a worked example'}
          </button>
        </div>
      ) : !batches.length ? null : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--s3)' }}>
          {batches.map(b => {
            const isExample = b.is_example;
            const isActive = b.id === activeBatchId;
            return (
              <div key={b.id} className={`card brief-card${isActive ? ' is-active' : ''}`}
                role="button" tabIndex={0}
                title={isActive ? 'Open this brief in Draft. It is the one the other steps are working on.' : 'Open this brief in Draft'}
                style={{
                  padding: 'var(--s4)',
                  background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                  borderColor: isActive || isExample ? 'var(--accent)' : 'var(--card-border)',
                }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(b.id); } }}
                onClick={() => open(b.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    {isExample && <span className="chip chip-accent" style={{ fontSize: 'var(--fs-caption)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Example</span>}
                    {new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{b.creative_count} concepts · {b.platform}</div>
                </div>
                {b.brief && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 'var(--s2)' }}>
                    {b.brief.slice(0, 160)}{b.brief.length > 160 ? '…' : ''}
                  </div>
                )}
                {/* "Open concepts" went with the rest of the hand-off buttons:
                    the step rail above is the navigation, and a second way to
                    do what it already does is a second thing to read. What a
                    card still needs is a way to pick it and a way to bin it. */}
                {isActive ? (
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <span className="chip chip-accent">Working on this</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteBatch(b.id); }} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                  </div>
                ) : (
                  <span className="body-xs text-subtle brief-card-hint">Click to work on this brief</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PipelineStep>
  );
}
