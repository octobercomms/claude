import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { addSource, addTrack, addItem } from '@shared/composition.mjs';

const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function BrollPanel({ compId, sourceId, clientId, composition, onCompositionChange }) {
  const [plan, setPlan] = useState(null);
  const [chosen, setChosen] = useState({});
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    api.get(`/clients/${clientId}/assets?kind=video&limit=50`)
      .then(r => setAssets(Array.isArray(r) ? r : (r.rows || [])))
      .catch(() => {});
  }, [clientId]);

  const filled = Object.entries(chosen).filter(([, a]) => a);

  async function propose() {
    setBusy('propose'); setError(null); setDone(false);
    try {
      const r = await api.post(`/compose/compositions/${compId}/broll-plan`, { sourceId });
      setPlan(r); setChosen({});
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  function sourceToTimeline(sourceTime) {
    for (const track of composition.tracks) {
      for (const item of track.items) {
        if (item.source !== sourceId) continue;
        const inPt = item.in || 0;
        if (sourceTime >= inPt && sourceTime < inPt + item.len) {
          return item.at + (sourceTime - inPt);
        }
      }
    }
    return sourceTime;
  }

  const place = useCallback(() => {
    if (!filled.length) return;
    let comp = composition;

    let overlayTrackId = null;
    const baseTrackIds = new Set();
    for (const t of comp.tracks) {
      if (t.kind !== 'video') continue;
      const hasBaseClips = t.items.some(i => comp.sources[i.source]?.kind === 'clip');
      const hasCaptions = t.items.some(i => comp.sources[i.source]?.kind === 'captions');
      if (hasBaseClips && !hasCaptions) baseTrackIds.add(t.id);
      if (!hasBaseClips && !hasCaptions && t.items.length === 0) {
        overlayTrackId = t.id;
      }
    }

    if (!overlayTrackId) {
      const r = addTrack(comp, 'video');
      comp = r.comp;
      overlayTrackId = r.id;
    }

    for (const [i, asset] of filled) {
      const span = plan.spans[Number(i)];
      if (!span) continue;

      const { comp: c1, id: srcId } = addSource(comp, {
        kind: 'clip', asset: asset.id, url: asset.url,
        duration: asset.duration_s || 0,
        width: asset.width || 0, height: asset.height || 0,
        originalName: asset.title || 'B-roll',
      });
      comp = c1;

      const timelineAt = sourceToTimeline(span.from);
      const spanLen = Math.min(span.to - span.from, asset.duration_s || span.to - span.from);

      const { comp: c2 } = addItem(comp, overlayTrackId, {
        at: timelineAt, len: spanLen, source: srcId, in: 0,
        fit: 'cover',
      });
      comp = c2;
    }

    onCompositionChange(comp);
    setDone(true);
    setPlan(null);
    setChosen({});
  }, [filled, plan, composition, onCompositionChange, sourceId]);

  return (
    <div style={{ marginTop: 'var(--s3)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline',
        gap: 'var(--s2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--fs-caption)' }}>B-roll</span>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={propose}>
          {busy === 'propose' ? 'Reading transcript...'
            : plan ? 'Plan again' : 'Find the moments'}
        </button>
      </div>

      {error && <div style={{ ...CAP, color: 'var(--negative)', marginTop: 'var(--s2)' }}>{error}</div>}
      {done && <div style={{ ...CAP, marginTop: 'var(--s2)', color: 'var(--positive)' }}>B-roll placed on timeline.</div>}

      {plan && plan.spans.length === 0 && (
        <div style={{ ...CAP, marginTop: 'var(--s2)' }}>No cutaway moments found in this clip.</div>
      )}

      {plan && plan.spans.length > 0 && (
        <div style={{ marginTop: 'var(--s2)' }}>
          <div style={{ ...CAP, marginBottom: 'var(--s2)', lineHeight: 1.5 }}>
            {plan.spans.length} moment{plan.spans.length === 1 ? '' : 's'}
            {' '}· {filled.length} filled
            {' '}· longest hold: {plan.held_s?.toFixed(0)}s
          </div>

          <div style={{ maxHeight: 280, overflow: 'auto', marginBottom: 'var(--s2)' }}>
            {plan.spans.map((s, i) => (
              <div key={i} style={{
                padding: 'var(--s2)', marginBottom: 'var(--s1)',
                background: chosen[i] ? 'var(--surface-sunken)' : 'transparent',
                borderRadius: 'var(--r-sm)',
                border: 'var(--border-w) solid var(--card-border)',
                fontSize: 'var(--fs-caption)', lineHeight: 1.4,
              }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--s2)' }}>
                  <strong>{clock(s.from)}–{clock(s.to)}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {(s.to - s.from).toFixed(1)}s
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{s.reason}</div>
                <div style={{ color: 'var(--text-subtle)', marginTop: 2, fontStyle: 'italic' }}>
                  "{s.text}"
                </div>
                <div style={{ marginTop: 'var(--s1)' }}>
                  {assets.length > 0 ? (
                    <select className="btn-chip"
                      style={{ padding: '0 var(--s2)', fontSize: 'var(--fs-caption)', maxWidth: '100%' }}
                      value={chosen[i]?.id || ''}
                      onChange={(e) => {
                        const a = assets.find(x => String(x.id) === e.target.value);
                        setChosen(prev => ({ ...prev, [i]: a || null }));
                      }}>
                      <option value="">Choose a clip...</option>
                      {assets.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.title || `Clip ${a.id}`}
                          {a.duration_s ? ` (${Math.round(a.duration_s)}s)` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ ...CAP }}>No video clips in the library.</span>
                  )}
                  {chosen[i] && (
                    <span style={{ ...CAP, marginLeft: 'var(--s1)' }}>
                      {chosen[i].title || 'Selected'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn-primary btn-sm" disabled={!filled.length}
            onClick={place}>
            Place {filled.length} cutaway{filled.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}
