import React, { useState } from 'react';
import { api } from '../../utils/api';

const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const KIND = {
  silence: { label: 'Pause', colour: 'var(--text-subtle)' },
  filler: { label: 'Filler', colour: 'var(--warning)' },
  both: { label: 'Pause + filler', colour: 'var(--warning)' },
};

export default function TightenPanel({ compId, sourceId, composition, onCompositionChange, trackId }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [dropped, setDropped] = useState(() => new Set());
  const [opts, setOpts] = useState({ gap_s: 0.45, fillers: true, filler_phrases: true });

  const liveCuts = plan ? plan.cuts.filter((_, i) => !dropped.has(i)) : [];

  const keepSpans = (() => {
    if (!plan) return [];
    const spans = [];
    let at = 0;
    for (const c of liveCuts) {
      if (c.from > at) spans.push([+at.toFixed(3), +c.from.toFixed(3)]);
      at = Math.max(at, c.to);
    }
    if (at < plan.original_s) spans.push([+at.toFixed(3), +plan.original_s.toFixed(3)]);
    return spans;
  })();
  const newLength = keepSpans.reduce((n, [a, b]) => n + (b - a), 0);

  async function propose() {
    setBusy('propose'); setError(null);
    try {
      const r = await api.post(`/compose/compositions/${compId}/tighten`, { sourceId, options: opts });
      setPlan(r); setDropped(new Set());
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  function toggleCut(i) {
    setDropped(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function apply() {
    if (!keepSpans.length || !plan) return;
    const track = composition.tracks.find(t => t.id === trackId);
    if (!track) return;

    const items = track.items.filter(i => i.source === sourceId);
    if (!items.length) return;

    const newItems = [];
    for (const item of items) {
      const itemIn = item.in || 0;
      const itemEnd = itemIn + item.len;
      let timelineAt = item.at;

      for (const [kFrom, kTo] of keepSpans) {
        const overlapFrom = Math.max(kFrom, itemIn);
        const overlapTo = Math.min(kTo, itemEnd);
        if (overlapTo <= overlapFrom) continue;

        newItems.push({
          ...item,
          id: undefined,
          at: +timelineAt.toFixed(6),
          len: +(overlapTo - overlapFrom).toFixed(6),
          in: +overlapFrom.toFixed(6),
        });
        timelineAt += overlapTo - overlapFrom;
      }
    }

    const otherItems = track.items.filter(i => i.source !== sourceId);
    const updatedTracks = composition.tracks.map(t =>
      t.id === trackId
        ? { ...t, items: [...otherItems, ...newItems].sort((a, b) => a.at - b.at) }
        : t
    );
    onCompositionChange({ ...composition, tracks: updatedTracks });
    setPlan(null);
  }

  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--fs-caption)' }}>Tighten</span>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={propose}>
          {busy === 'propose' ? 'Analysing...' : plan ? 'Re-analyse' : 'Find dead air'}
        </button>
      </div>

      {error && <div style={{ ...CAP, color: 'var(--negative)', marginTop: 'var(--s2)' }}>{error}</div>}

      {plan && plan.cuts.length === 0 && (
        <div style={{ ...CAP, marginTop: 'var(--s2)' }}>No pauses or fillers found.</div>
      )}

      {plan && plan.cuts.length > 0 && (
        <div style={{ marginTop: 'var(--s2)' }}>
          <div style={{ ...CAP, marginBottom: 'var(--s2)', lineHeight: 1.5 }}>
            {liveCuts.length} cut{liveCuts.length === 1 ? '' : 's'} selected
            {' '}· saves {(plan.original_s - newLength).toFixed(1)}s
            {' '}· {clock(newLength)} from {clock(plan.original_s)}
          </div>

          <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 'var(--s2)' }}>
            {plan.cuts.map((c, i) => {
              const k = KIND[c.kind] || KIND.silence;
              const active = !dropped.has(i);
              return (
                <label key={i} style={{
                  display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start',
                  padding: '4px 0', cursor: 'pointer',
                  opacity: active ? 1 : 0.45,
                  fontSize: 'var(--fs-caption)', lineHeight: 1.4,
                }}>
                  <input type="checkbox" checked={active}
                    onChange={() => toggleCut(i)}
                    style={{ marginTop: 2 }} />
                  <span>
                    <span style={{ color: k.colour, fontWeight: 600 }}>{k.label}</span>
                    {' '}{clock(c.from)}–{clock(c.to)}
                    {' '}({(c.to - c.from).toFixed(1)}s)
                    {c.words?.length > 0 && (
                      <span style={{ color: 'var(--text-muted)', display: 'block' }}>
                        …{c.words.join(' ')}…
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <button className="btn btn-primary btn-sm" disabled={!liveCuts.length}
            onClick={apply}>
            Apply {liveCuts.length} cut{liveCuts.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}
