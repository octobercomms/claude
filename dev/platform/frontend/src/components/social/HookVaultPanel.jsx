import React from 'react';
import { HookVaultList } from './HookVaultList';
import { HOOK_EXAMPLES, examplesByFramework } from './hookExamples';

// The Hook vault, as a page that explains itself.
//
// "Hook vault — i've never understood this." Fair: it was a searchable list of
// sentences with a framework chip beside each one, reachable from a button on
// the Learn step, and nothing on it said what a hook was, where these came
// from, or why you would reuse one. The only explanation lived in the empty
// state, which you stop seeing the moment the thing starts working.
//
// So the page says all four:
//
//   what a hook is        — the first line, the one that decides whether the
//                           rest gets read
//   where these came from — every hook written for this client, deduplicated
//   what the numbers mean — the best reach any post using it got, and how many
//                           times it has been used, which are different claims
//   why reuse one         — you are reusing the shape of an opening, not the
//                           post; an opening that earned attention once
//                           usually earns it again on another subject
//
// And when a client has no hooks yet, worked examples rather than an apology.
// Badged, because an example that cannot be told apart from real work is worse
// than no example.
export default function HookVaultPanel({ clientId, clientName, onUse }) {
  const { groups } = examplesByFramework();

  return (
    <div>
      {/* 75/25: the vault on the left, the explanation beside it.
          All four paragraphs sat above the list, so the thing the page is
          for started below the fold and the explanation was read once and
          scrolled past for ever after. As a column beside it, it is there
          when you want it and out of the way when you do not. */}
      <div className="hookvault">
      <div className="hookvault__main">
        <div className="caption">Hook vault</div>
        <h2 className="h2 mt-2">Every opening line you have written, and how it did</h2>


      <HookVaultList
        clientId={clientId}
        onUse={onUse}
        onEmpty={({ filtered }) => (
          <div>
            {filtered ? (
              <p className="body-sm text-subtle" style={{ padding: 'var(--s4) 0' }}>
                Nothing in the vault matches that. Clear the search or the framework to see
                everything {clientName || 'this client'} has used.
              </p>
            ) : (
              <p className="body-sm text-subtle" style={{ padding: 'var(--s4) 0' }}>
                Nothing here yet. Every hook you write in Ideas lands in this vault once its
                post has run, with whatever reach it earned. Until then, here is the shape of
                each framework&apos;s opening.
              </p>
            )}

            {/* The examples show regardless of the filter, because a filtered
                empty vault is still an empty vault and still the moment to
                show what a good opening looks like. */}
            <div style={{ display: 'grid', gap: 'var(--s4)' }}>
              {[...groups.entries()].map(([framework, items]) => (
                <div key={framework}>
                  <div className="caption caption-muted mb-2">{framework}</div>
                  <div style={{ display: 'grid', gap: 'var(--s2)' }}>
                    {items.map(e => (
                      <div key={e.hook} className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
                        <div className="row between center" style={{ gap: 'var(--s3)', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                              {/* Badged wherever it appears. Somebody eventually
                                  ships an example they thought was their own. */}
                              <span className="chip chip-accent">Example</span>
                              <span className="body-sm" style={{ fontWeight: 700 }}>{e.hook}</span>
                            </div>
                            <p className="body-xs text-muted" style={{ margin: 'var(--s2) 0 0', lineHeight: 1.5 }}>
                              {e.why}
                            </p>
                          </div>
                          {onUse && (
                            <button type="button" className="btn btn-secondary btn-sm"
                              style={{ whiteSpace: 'nowrap', flex: '0 0 auto' }}
                              onClick={() => onUse(e.hook)}>
                              Start from this
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="body-xs text-subtle" style={{ marginTop: 'var(--s4)' }}>
              {HOOK_EXAMPLES.length} worked examples. These are not {clientName || 'this client'}&apos;s
              hooks and never count toward the numbers above.
            </p>
          </div>
        )}
      />
      </div>

      <aside className="hookvault__rail">
        <div className="card">
          <div className="caption mb-2">What this is</div>
          <p className="body-sm text-muted" style={{ lineHeight: 1.6 }}>
            A hook is the first line of a post, the one that decides whether the rest gets
            read. This is every hook written for {clientName || 'this client'}, deduplicated,
            with the best reach any post using it achieved and how many times you have used it.
          </p>
          <p className="body-sm text-muted mt-3" style={{ lineHeight: 1.6 }}>
            Those two numbers are different claims. A hook that reached 40k once might have
            been the subject rather than the opening; one that worked three times is the
            opening.
          </p>
          <p className="body-sm text-muted mt-3" style={{ lineHeight: 1.6 }}>
            Reusing a hook is not reusing the post. It is reusing the shape of an opening that
            earned attention, on a subject that has not had it yet. &quot;Use this&quot; drops
            it into the planner so you can write the rest against it.
          </p>
        </div>
      </aside>
      </div>
    </div>
  );
}
