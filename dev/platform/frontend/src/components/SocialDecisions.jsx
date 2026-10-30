import React from 'react';
import { decisionsFrom, whyNothing } from '../utils/socialDecisions';

// What to do next, at the top of Measure.
//
// Measure was four read-only dashboards and no action: you read that a post
// did well, went to Create, and started from an empty brief. This is the
// bridge. Each decision carries the brief that acts on it, so "this worked"
// and "write more of it" are one click apart rather than one navigation and a
// retype.
//
// The thing that makes it trustworthy is the empty state. Where the numbers do
// not support a decision it says which number is missing, rather than filling
// the space with a recommendation nobody can stand behind. The rules live in
// utils/socialDecisions.js and are tested there.
export default function SocialDecisions({ winners, frameworks, onUseAsBrief }) {
  const { doMore, doLess, accountAverage } = decisionsFrom({ winners, frameworks });
  const nothing = !doMore.length && !doLess.length;

  return (
    <section className="stack-lg">
      <div>
        <div className="caption">Measure</div>
        <div className="h2 mt-2">What to do next</div>
      </div>

      {nothing ? (
        <div className="card">
          <p className="body" style={{ padding: 'var(--s6)', margin: 0, maxWidth: 640 }}>
            {whyNothing({ winners, frameworks })}
          </p>
        </div>
      ) : (
        <div className="grid grid-2">
          {doMore.length > 0 && (
            <div className="card">
              <div className="caption caption-muted mb-3">Do more of this</div>
              <div className="stack">
                {doMore.map(d => (
                  <div key={d.id} className="readout">
                    <div className="h3">{d.title}</div>
                    <div className="readout-sub">{d.detail}</div>
                    {d.caveat && <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>{d.caveat}</div>}
                    {/* The whole point. The brief is written from the thing
                        that worked, so Create opens with it rather than
                        empty. */}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 'var(--s3)' }}
                      onClick={() => onUseAsBrief(d.brief)}
                    >
                      Brief a batch from this
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {doLess.length > 0 && (
            <div className="card">
              <div className="caption caption-muted mb-3">Stop doing this</div>
              <div className="stack">
                {doLess.map(d => (
                  <div key={d.id} className="readout">
                    <div className="h3">{d.title}</div>
                    <div className="readout-sub">{d.detail}</div>
                  </div>
                ))}
              </div>
              {/* No button. "Stop" is not a thing you brief, and a button here
                  would only be there for symmetry. */}
              <p className="body-xs text-subtle" style={{ marginTop: 'var(--s4)' }}>
                Measured against {accountAverage}% average engagement across everything published in the last 90 days.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
