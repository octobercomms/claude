import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';

/**
 * One finished reel, always on the first screen, so what the studio does is
 * visible before anybody commits footage to it.
 *
 * Built once from the house sample clip and cached, like the caption examples.
 * It lists what was done to it, because an example nobody can decode is
 * decoration, and it lists what it could NOT show and why. That second list is
 * the one that earns its place: an example that silently leaves out the
 * cutaway teaches an operator that cutaways are not a thing this does.
 *
 * Collapsed by default after the first look is not worth building until
 * somebody complains: it is one short video at the top of a screen you only
 * see when starting something new.
 */

const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

export default function ExampleReel() {
  const [state, setState] = useState('loading');   // loading | ready | none | error
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    // Status first: it is a stat() rather than a render, so the screen does
    // not pay for an example nobody opened.
    api.get('/video/example-reel-status')
      .then((s) => { if (live) setState(s.available ? 'ready' : 'none'); })
      .catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, []);

  async function reveal() {
    setOpen(true);
    if (info) return;
    try {
      setInfo(await api.get('/video/example-reel.json'));
    } catch (e) {
      setInfo({ error: e.message });
    }
  }

  // Loading renders nothing, because it resolves in a moment and a flash of
  // disabled control is worse than a beat of nothing.
  if (state === 'loading') return null;

  // An error used to render nothing too, which means a failed status check
  // made the whole feature disappear with no trace — the same "a tool nobody
  // can see is a tool nobody has" fault the Library tools had. The control
  // stays, disabled, saying what happened.
  if (state === 'error') {
    return (
      <div>
        <button type="button" className="btn btn-secondary btn-sm" disabled>
          See the same reel in six styles
        </button>
        <div style={{ ...CAP, lineHeight: 1.5, marginTop: 'var(--s2)' }}>
          Could not check for worked examples just now. Reload to try again.
        </div>
      </div>
    );
  }

  // No examples yet: the control still shows, disabled, with the reason under
  // it. It used to be replaced by prose, which hides the feature from anyone
  // who has not seen it working — the same way the Library's tools went unused
  // because nothing on screen said they were there. A disabled button with no
  // reason is the other failure, so it carries one.
  if (state === 'none') {
    return (
      <div>
        <button type="button" className="btn btn-secondary btn-sm" disabled
          title="Upload a clip and the worked examples are built from it">
          See the same reel in six styles
        </button>
        <div style={{ ...CAP, lineHeight: 1.5, marginTop: 'var(--s2)' }}>
          Add a clip first and the examples are built from it: one reel, tightened and with a
          cutaway laid in, captioned six ways, so the output is visible before you commit your
          own footage. Twenty seconds or more of someone talking, transcribed, shows every step.
        </div>
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={reveal}>
          See the same reel in six styles
        </button>
      ) : (
        <div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
            gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>The same reel, six ways</span>
            <button type="button" onClick={() => setOpen(false)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
                ...CAP, textDecoration: 'underline' }}>Hide</button>
          </div>

          {info?.error ? (
            <div style={{ ...CAP, color: 'var(--negative)', marginTop: 'var(--s2)' }}>
              {info.error}
            </div>
          ) : !info ? (
            <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
              Building it. Six styles render the first time and are cached after, so this
              wait happens once.
            </div>
          ) : (
            <>
              <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.6 }}>
                The same clip, edited once and then captioned six ways. Every one of these
                had {info.steps?.length
                  ? info.steps.join(', ')
                  : 'nothing done to it yet, for the reasons below'}.
              </div>

              {/* One player per style. A browser plays six small videos side by
                  side and cannot play one video six ways, and seeing them
                  together is the entire point of the comparison. */}
              <div style={{ display: 'grid', marginTop: 'var(--s3)', gap: 'var(--s3)',
                gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {(info.styles || []).map((st) => (
                  <div key={st.template}>
                    {st.error ? (
                      <div style={{ ...CAP, color: 'var(--negative)', lineHeight: 1.4 }}>
                        {st.name || st.template}: {st.error}
                      </div>
                    ) : (
                      <>
                        {/* Not muted. The point of an example is the finished
                            thing, and a reel with its sound off is not it. */}
                        <video src={`/api/video/example-reel.mp4?style=${st.template}`}
                          controls playsInline preload="metadata"
                          style={{ width: '100%', borderRadius: 'var(--r-sm)',
                            border: 'var(--border-w) solid var(--card-border)',
                            background: '#000' }} />
                        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700,
                          marginTop: 4 }}>{st.name || st.template}</div>
                        <div style={CAP}>
                          {/* A pending style has not been rendered yet; its
                              video element is what triggers the render, so the
                              tile fills in on its own. Saying so beats a
                              spinner that never explains itself. */}
                          {st.pending ? 'renders when you play it'
                            : st.captioned ? `${st.seconds}s` : 'no captions on this one'}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {info.missing?.length > 0 && (
                <>
                  <div style={{ ...CAP, lineHeight: 1.5, marginTop: 'var(--s3)' }}>
                    What these examples cannot show, and why:
                  </div>
                  <ul style={{ ...CAP, margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                    {info.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </>
              )}
              {info.note && (
                <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5,
                  fontStyle: 'italic' }}>{info.note}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
