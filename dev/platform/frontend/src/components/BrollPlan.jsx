import React, { useState } from 'react';
import { api } from '../utils/api';
import AssetLibrary from './AssetLibrary';

/**
 * Where this talking head wants something else on screen, and what goes there.
 *
 * The split is the point. The plan proposes moments, from the transcript
 * alone, with the reason each one is a moment; the operator chooses the
 * footage. Nothing in OMI knows what is inside a b-roll clip, and a panel that
 * guessed would place the wrong shot confidently and be caught only on
 * playback. Saying "here is where a cutaway helps, you pick" is the honest
 * version and it is still most of the work.
 *
 * Nothing renders until the operator presses go, and what renders is exactly
 * the list on screen.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function BrollPlan({ asset, clientId, words = null, onRendered = null }) {
  const [plan, setPlan] = useState(null);
  const [chosen, setChosen] = useState({});      // span index → asset
  const [picking, setPicking] = useState(null);  // span index being filled
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const filled = Object.entries(chosen).filter(([, a]) => a);

  async function propose() {
    setBusy('propose'); setError(null); setDone(null);
    try {
      const r = await api.post(`/assets/${asset.id}/broll-proposal`, { words });
      setPlan(r); setChosen({}); setPicking(null);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function render() {
    setBusy('render'); setError(null);
    try {
      const placements = filled.map(([i, a]) => ({
        from: plan.spans[i].from, to: plan.spans[i].to, asset_id: a.id }));
      const r = await api.post(`/assets/${asset.id}/broll-apply`, { placements });
      if (!r.asset) {
        setError(`The clip rendered to ${r.seconds}s but could not be added to the library. `
          + 'It is on the server; tell someone before you make another.');
        return;
      }
      // Any cutaway shortened because its clip ran out is said plainly: the
      // operator asked for five seconds and got two, and finding that out by
      // watching is worse than being told.
      const short = (r.placements || []).filter((p) => p.clipped);
      setDone({ seconds: r.seconds, short });
      onRendered?.(r.asset);
      setPlan(null); setChosen({});
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Plan the b-roll</span>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={propose}>
          {busy === 'propose' ? 'Reading the transcript…'
            : plan ? 'Plan again' : 'Find the moments'}
        </button>
      </div>

      {error && <div style={{ ...CAP, color: 'var(--negative)', marginTop: 'var(--s2)' }}>{error}</div>}

      {done && (
        <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5 }}>
          Rendered {clock(done.seconds)} beside the original.
          {done.short.length > 0 && (
            <> {done.short.length} cutaway{done.short.length === 1 ? '' : 's'} ran shorter than
              planned because the clip ended: {done.short.map((p) => `${clock(p.from)}`).join(', ')}.</>
          )}
        </div>
      )}

      {plan && !plan.spans.length && (
        <div style={{ ...CAP, marginTop: 'var(--s3)', lineHeight: 1.5 }}>
          Nothing to propose. Either the clip is too short to cut away from, or it already
          changes often enough. The longest the viewer goes on one shot is {plan.held_s}s.
        </div>
      )}

      {plan && plan.spans.length > 0 && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <div style={{ fontSize: 'var(--fs-body)' }}>
            {plan.spans.length} moment{plan.spans.length === 1 ? '' : 's'}
            <span style={CAP}> · longest stretch on one shot, {plan.held_s}s</span>
          </div>

          <div style={{ marginTop: 'var(--s2)', border: LINE, borderRadius: 'var(--r-sm)' }}>
            {plan.spans.map((s, i) => {
              const pick = chosen[i];
              return (
                <div key={`${s.from}-${s.to}`} style={{ padding: 'var(--s2)', borderBottom: LINE }}>
                  <div className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline',
                    justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700 }}>
                        {clock(s.from)}–{clock(s.to)}
                      </span>
                      <span style={{ ...CAP, marginLeft: 6 }}>{s.reason}</span>
                      <span style={{ ...CAP, display: 'block', lineHeight: 1.4, fontStyle: 'italic' }}>
                        &ldquo;{s.text}&rdquo;
                      </span>
                    </span>
                    <span className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline' }}>
                      {pick && <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700 }}>
                        {pick.title || 'Untitled'}
                      </span>}
                      <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => setPicking(picking === i ? null : i)}>
                        {picking === i ? 'Close' : pick ? 'Change' : 'Choose a clip'}
                      </button>
                      {pick && (
                        <button type="button" className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--text-subtle)' }}
                          onClick={() => setChosen({ ...chosen, [i]: null })}>Leave it</button>
                      )}
                    </span>
                  </div>

                  {picking === i && (
                    <div style={{ marginTop: 'var(--s2)', paddingTop: 'var(--s2)', borderTop: LINE }}>
                      <AssetLibrary clientId={clientId} kind="video" compact
                        title="Pick from this client's footage"
                        onPick={(a) => { setChosen({ ...chosen, [i]: a }); setPicking(null); }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" disabled={!!busy || !filled.length}
              onClick={render}>
              {busy === 'render' ? 'Rendering…'
                : `Lay in ${filled.length} cutaway${filled.length === 1 ? '' : 's'}`}
            </button>
            <span style={CAP}>
              {filled.length ? `${plan.spans.length - filled.length} left empty` : 'Nothing chosen yet'}
            </span>
          </div>

          <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5 }}>
            A moment you leave empty stays on your face, which is a perfectly good answer.
            The speaker keeps talking under every cutaway; only the picture changes. A clip
            shorter than its moment is cut short rather than looped, and the panel says which.
          </div>
        </div>
      )}
    </div>
  );
}
