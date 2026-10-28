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

  if (state === 'loading' || state === 'error') return null;

  if (state === 'none') {
    return (
      <div style={{ ...CAP, lineHeight: 1.5 }}>
        There is no worked example yet. Upload a sample clip under Produce and one is built
        from it: a reel that has been captioned, tightened and had a cutaway laid in, so the
        output is visible before you commit your own footage.
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={reveal}>
          See a finished example
        </button>
      ) : (
        <div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
            gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>A finished example</span>
            <button type="button" onClick={() => setOpen(false)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer',
                ...CAP, textDecoration: 'underline' }}>Hide</button>
          </div>

          {info?.error ? (
            <div style={{ ...CAP, color: 'var(--negative)', marginTop: 'var(--s2)' }}>
              {info.error}
            </div>
          ) : (
            <div className="row" style={{ gap: 'var(--s4)', marginTop: 'var(--s2)',
              alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <video src="/api/video/example-reel.mp4" controls muted playsInline
                style={{ width: 220, borderRadius: 'var(--r-sm)',
                  border: 'var(--border-w) solid var(--card-border)' }} />
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                {!info ? (
                  <div style={CAP}>Building it…</div>
                ) : (
                  <>
                    <div style={{ ...CAP, lineHeight: 1.5 }}>What was done to it:</div>
                    <ul style={{ ...CAP, margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                      {info.steps?.length
                        ? info.steps.map((s) => <li key={s}>{s}</li>)
                        : <li>Nothing yet; see below.</li>}
                    </ul>
                    {info.missing?.length > 0 && (
                      <>
                        <div style={{ ...CAP, lineHeight: 1.5, marginTop: 'var(--s2)' }}>
                          What this example cannot show, and why:
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
