import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import TemplatePicker from '../components/TemplatePicker';
import FeatureCost from '../components/FeatureCost';
import AssetLibrary from '../components/AssetLibrary';
import ReferencePanel from '../components/video/ReferencePanel';

/**
 * Brief a batch of videos and set it running.
 *
 * The whole point is that nobody watches it: pick a shape, hand it the
 * photographs and the lines of text, press go, and move on to the next
 * project. So the two things this screen owes the operator are both about the
 * moment BEFORE pressing go.
 *
 * **It shows what will happen, before it happens.** The pre-flight is a
 * separate call from the run, and it says how many of the items can actually
 * run, what the ones that cannot are missing, and what the whole thing costs
 * against what the month's budget has left. A thirty-item run that discovers
 * at item nineteen that a client only uploaded four photographs has already
 * spent eighteen renders and an hour, and nobody is there to notice.
 *
 * **Nothing it says is invented.** The counts and the sentence come from the
 * backend's own planner, which is the same code the run itself uses, so what
 * the screen promises and what the runner does cannot drift. A screen that
 * computed its own estimate would be a second implementation of the decision.
 */

/** One item of the batch, as the form holds it. */
const emptyItem = (i) => ({ key: `i${i}`, assets: [], lines: '' });

export default function VideoBatchPage({ clientId }) {
  const [templateId, setTemplateId] = useState('');
  const [brief, setBrief] = useState('');
  const [items, setItems] = useState([emptyItem(0)]);
  const [music, setMusic] = useState(null);
  // Which item's library is open. One at a time, so the page does not
  // become eight asset grids.
  const [picking, setPicking] = useState(null);
  const [pickingMusic, setPickingMusic] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    api.get('/compose/templates').then((r) => setTemplates(r.templates || [])).catch(() => {});
  }, []);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId]
  );

  /**
   * The form's items, in the shape the planner takes.
   *
   * Which slot gets the photographs, which gets the lines and which gets the
   * music is read off the template rather than hardcoded, because the eight
   * shapes do not agree on their slot names: `stills`, `frames`, `clippings`,
   * `footage`. Hardcoding `stills` would have worked for one of them.
   */
  const payload = useCallback(() => {
    if (!template) return [];
    const pictureSlot = template.needs.find((n) => n.kind === 'still' || n.kind === 'clip');
    const textSlot = template.needs.find((n) => n.kind === 'text');
    const audioSlot = template.needs.find((n) => n.kind === 'audio');
    return items.map((it, i) => {
      const content = {};
      if (pictureSlot) {
        content[pictureSlot.slot] = it.assets.map((a) => ({ kind: 'clip', asset: a.id }));
      }
      if (textSlot) {
        const lines = it.lines.split('\n').map((l) => l.trim()).filter(Boolean);
        content[textSlot.slot] = textSlot.max === 1 ? (lines[0] || '') : lines;
      }
      if (audioSlot && music) {
        content[audioSlot.slot] = { kind: 'audio', asset: music.id };
      }
      return { ref: `item-${i + 1}`, content };
    });
  }, [items, template, music]);

  // Re-plan whenever anything that affects the answer changes. Debounced,
  // because a keystroke in a text box should not be a round trip.
  useEffect(() => {
    if (!templateId) { setPlan(null); return undefined; }
    let live = true;
    setPlanning(true);
    const t = setTimeout(() => {
      api.post(`/compose/clients/${clientId}/batches/plan`, { templateId, items: payload() })
        .then((p) => { if (live) { setPlan(p); setError(null); } })
        .catch((e) => { if (live) { setPlan(null); setError(e.message); } })
        .finally(() => { if (live) setPlanning(false); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [clientId, templateId, payload]);

  const go = async () => {
    setRunning(true);
    setError(null);
    try {
      const out = await api.post(`/compose/clients/${clientId}/batches`, {
        templateId, items: payload(), brief, seed: `b${Date.now().toString(36)}`,
      });
      setDone(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  if (done) {
    return (
      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <h2>Running</h2>
        <p>
          {done.items.filter((i) => i.composition_id).length} of {done.items.length} videos are
          encoding. They render one at a time, so a batch this size takes a while; nothing is
          lost if the server restarts.
        </p>
        {done.stoppedBy && (
          <div className="chip chip-warning" style={{ marginBottom: 'var(--s3)' }}>
            {done.stoppedBy}
          </div>
        )}
        <p style={{ color: 'var(--text-muted)' }}>
          Open <strong>Review</strong> to approve them as they finish. Nothing leaves for Drive
          or Instagram until you do.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => { setDone(null); setItems([emptyItem(0)]); }}>
          Brief another
        </button>
      </div>
    );
  }

  const canRun = !!templateId && !!plan && plan.runnable > 0 && !running;

  return (
    <div style={{ marginTop: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
      <section className="card">
        <h2>1. The shape</h2>
        <TemplatePicker value={templateId} onChange={setTemplateId} disabled={running} />
      </section>

      {/* Reading a reference belongs here rather than on its own screen: the
          question it answers is "which shape", and the answer is a reading to
          confirm against the eight above. */}
      <ReferencePanel clientId={clientId} />

      {template && (
        <>
          <section className="card">
            <h2>2. The brief</h2>
            <textarea
              rows={3}
              value={brief}
              placeholder="What this run is for. Carried with the batch so you know what it was."
              onChange={(e) => setBrief(e.target.value)}
              style={{ width: '100%' }}
            />
            {template.needs.some((n) => n.kind === 'audio') && (
              <div style={{ marginTop: 'var(--s3)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)' }}>
                  <span>Music bed, used by every item</span>
                  <strong>{music ? music.title : 'none chosen'}</strong>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPickingMusic(!pickingMusic)}
                  >
                    {pickingMusic ? 'Close' : music ? 'Change' : 'Choose'}
                  </button>
                </div>
                {pickingMusic && (
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <AssetLibrary
                      clientId={clientId}
                      kind="audio"
                      compact
                      title="Pick a music bed"
                      onPick={(a) => { setMusic(a); setPickingMusic(false); }}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <h2>3. The items</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              One video per item. Each needs{' '}
              {template.needs
                .filter((n) => n.kind !== 'audio')
                .map((n) => `${n.min}${n.max > n.min ? ` to ${n.max}` : ''} ${n.kind === 'text' ? 'lines of text' : 'photographs'}`)
                .join(' and ')}.
            </p>
            {items.map((it, i) => {
              const problems = plan?.items?.[i]?.problems || [];
              return (
                <div
                  key={it.key}
                  style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--card-border)',
                    paddingTop: i === 0 ? 0 : 'var(--s3)',
                    marginTop: i === 0 ? 0 : 'var(--s3)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong>Item {i + 1}</strong>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setItems(items.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--s2)' }}>
                    {it.assets.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className="approve-thumb"
                        title={`${a.title} — click to remove`}
                        onClick={() => setItems(items.map((x, j) => (
                          j === i ? { ...x, assets: x.assets.filter((b) => b.id !== a.id) } : x
                        )))}
                      >
                        {a.url ? <img src={a.url} alt={a.title || ''} /> : <span>{a.title}</span>}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setPicking(picking === i ? null : i)}
                    >
                      {picking === i ? 'Close' : 'Add photographs'}
                    </button>
                  </div>
                  {picking === i && (
                    <div style={{ marginTop: 'var(--s2)' }}>
                      <AssetLibrary
                        clientId={clientId}
                        kind="image"
                        compact
                        title={`Pick photographs for item ${i + 1}`}
                        onPick={(a) => setItems(items.map((x, j) => (
                          j === i && !x.assets.some((b) => b.id === a.id)
                            ? { ...x, assets: [...x.assets, a] }
                            : x
                        )))}
                      />
                    </div>
                  )}
                  {template.needs.some((n) => n.kind === 'text') && (
                    <textarea
                      rows={2}
                      value={it.lines}
                      placeholder={'One line per line of on-screen type'}
                      onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, lines: e.target.value } : x)))}
                      style={{ width: '100%', marginTop: 'var(--s2)' }}
                    />
                  )}
                  {/* What is wrong with THIS item, in the planner's own words,
                      while the operator is still looking at it. */}
                  {problems.length > 0 && (
                    <div className="chip chip-warning" style={{ marginTop: 'var(--s2)' }}>
                      {problems.map((p) => [p.slot, p.says].filter(Boolean).join(' ')).join('; ')}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 'var(--s3)' }}
              onClick={() => setItems([...items, emptyItem(items.length)])}
            >
              Add an item
            </button>
          </section>

          <section className="card">
            <h2>4. Before you start</h2>
            {error && <div className="chip chip-warning">{error}</div>}
            {planning && <div style={{ color: 'var(--text-muted)' }}>Working it out…</div>}
            {plan && !planning && (
              <>
                {/* The planner's own sentence, not a second version of it. */}
                <p style={{ fontSize: '1.1em' }}>{plan.says}</p>
                {plan.overBudget && (
                  <div className="chip chip-warning">
                    This run is over what the month has left. It will stop when the budget is
                    reached, and the items it did not get to will say so.
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
              <button type="button" className="btn btn-primary" disabled={!canRun} onClick={go}>
                {running ? 'Starting…' : `Run ${plan?.runnable || 0} video${plan?.runnable === 1 ? '' : 's'}`}
              </button>
              {/* One chip, on the action that commits the spend. */}
              <FeatureCost
                feature="composition_transcribe"
                units={plan?.runnable || null}
                task="video_batch"
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
