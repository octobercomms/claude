import React, { useState } from 'react';
import { api } from '../utils/api';

/**
 * Take the dead air and the fillers out of a talking head.
 *
 * Two steps, deliberately. The proposal changes nothing and lists every removal
 * with the words around it; the render happens only when the operator presses
 * go. An automatic cut that takes out a deliberate pause is worse than no cut,
 * because it is harder to notice than it is to fix.
 *
 * Every cut is listed rather than summarised. "Saves 8 seconds" is the headline
 * an operator wants and the thing they cannot check; the list is what lets them
 * see that the pause before the punchline is about to go.
 */

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

const KIND = {
  silence: { label: 'Pause', colour: 'var(--text-subtle)' },
  filler: { label: 'Filler', colour: 'var(--warning)' },
  both: { label: 'Pause + filler', colour: 'var(--warning)' },
};

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function TightenEdit({ asset, onTightened = null, onWords = null }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [dropped, setDropped] = useState(() => new Set());
  const [opts, setOpts] = useState({ gap_s: 0.45, fillers: true, filler_phrases: true });

  // A cut the operator has put back is excluded here rather than recomputed, so
  // what renders is what is on screen.
  const keep = (() => {
    if (!plan) return [];
    const live = plan.cuts.filter((_, i) => !dropped.has(i));
    const spans = [];
    let at = 0;
    for (const c of live) {
      if (c.from > at) spans.push([+at.toFixed(3), +c.from.toFixed(3)]);
      at = Math.max(at, c.to);
    }
    if (at < plan.original_s) spans.push([+at.toFixed(3), +plan.original_s.toFixed(3)]);
    return spans;
  })();
  const newLength = keep.reduce((n, [a, b]) => n + (b - a), 0);

  async function propose() {
    setBusy('propose'); setError(null);
    try {
      const r = await api.post(`/assets/${asset.id}/cut-proposal`, { options: opts });
      setPlan(r); setDropped(new Set());
      // Handed up so the b-roll planner beside this one works from the same
      // transcript. Whisper is charged by the minute and this clip has just
      // been paid for once.
      if (r.words?.length) onWords?.(r.words);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  async function applyCuts() {
    setBusy('apply'); setError(null);
    try {
      const r = await api.post(`/assets/${asset.id}/cut-apply`, { keep });
      // The render and the library row are two separate things, and recording
      // the row is deliberately unable to fail the render. Saying "done" when
      // the row is missing would leave an operator hunting for a clip that
      // exists on disk and nowhere in the interface.
      if (!r.asset) {
        setError(`The clip rendered to ${r.seconds}s but could not be added to the library. `
          + 'It is on the server; tell someone before you make another.');
        return;
      }
      onTightened?.(r.asset);
      setPlan(null);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Tighten the edit</span>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={propose}>
          {busy === 'propose' ? 'Reading the audio…' : plan ? 'Look again' : 'See what would go'}
        </button>
      </div>

      <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'wrap', marginTop: 'var(--s2)' }}>
        <label style={{ ...CAP, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          Cut pauses over
          <select className="input" style={{ width: 'auto' }} value={opts.gap_s}
            onChange={(e) => setOpts({ ...opts, gap_s: Number(e.target.value) })}>
            {[0.3, 0.45, 0.6, 0.9, 1.5].map((v) => <option key={v} value={v}>{v}s</option>)}
          </select>
        </label>
        <label style={{ ...CAP, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.fillers}
            onChange={(e) => setOpts({ ...opts, fillers: e.target.checked })} />
          um, uh, er
        </label>
        <label style={{ ...CAP, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.filler_phrases}
            onChange={(e) => setOpts({ ...opts, filler_phrases: e.target.checked })} />
          you know, I mean
        </label>
      </div>

      {error && <div style={{ ...CAP, color: 'var(--negative)', marginTop: 'var(--s2)' }}>{error}</div>}

      {plan && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <div style={{ fontSize: 'var(--fs-body)' }}>
            <strong>{clock(plan.original_s)}</strong> down to <strong>{clock(newLength)}</strong>
            <span style={CAP}>
              {' '}· {(plan.original_s - newLength).toFixed(1)}s out of {plan.cuts.length} places
            </span>
          </div>

          {/* Listed, not summarised. The headline is the thing an operator
              cannot check; the list is what lets them see that the pause
              before the punchline is about to go. */}
          <div style={{ marginTop: 'var(--s2)', maxHeight: 280, overflow: 'auto',
            border: LINE, borderRadius: 'var(--r-sm)' }}>
            {plan.cuts.map((c, i) => {
              const out = !dropped.has(i);
              const k = KIND[c.kind] || KIND.silence;
              return (
                <label key={`${c.from}-${c.to}`} style={{
                  display: 'flex', gap: 'var(--s2)', alignItems: 'baseline', cursor: 'pointer',
                  padding: 'var(--s2)', borderBottom: LINE, opacity: out ? 1 : 0.45,
                }}>
                  <input type="checkbox" checked={out} onChange={() => {
                    const next = new Set(dropped);
                    if (out) next.add(i); else next.delete(i);
                    setDropped(next);
                  }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: k.colour }}>
                      {k.label}
                    </span>
                    <span style={{ ...CAP, marginLeft: 6 }}>
                      {clock(c.from)} · {(c.to - c.from).toFixed(2)}s
                    </span>
                    <span style={{ ...CAP, display: 'block', lineHeight: 1.4 }}>{c.text}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" disabled={!!busy || !keep.length}
              onClick={applyCuts}>
              {busy === 'apply' ? 'Rendering…' : `Make the cut (${clock(newLength)})`}
            </button>
            {dropped.size > 0 && (
              <span style={CAP}>{dropped.size} put back</span>
            )}
          </div>

          <div style={{ ...CAP, marginTop: 'var(--s2)', lineHeight: 1.5 }}>
            The original is kept. This renders a second clip beside it, so you can compare them
            and throw this one away. Nothing inside the first second is touched, because that is
            where the hook lives.
          </div>
        </div>
      )}
    </div>
  );
}
