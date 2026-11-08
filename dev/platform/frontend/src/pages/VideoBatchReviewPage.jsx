import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import ListDetail from '../components/shells/ListDetail';
import StatStrip from '../components/shells/StatStrip';

/**
 * The review sheet: thirty videos, one verdict each.
 *
 * Three things decided this shape, and all three have cost this codebase time
 * before.
 *
 * **It is L5 ListDetail in its sidebar variant, not a grid.** Thirty items
 * times a thumbnail, a state, a reason and three buttons is about 120 controls
 * with no reading order, and the per-item reason — the whole point of the
 * rationale fields — would truncate to nothing in a tile. A compact list on
 * the left and the record on the right is the shape for working a queue
 * without losing your place.
 *
 * **Approving thirty videos is a keyboard task.** `a`, `r` and `j`/`k` beat
 * ninety clicks, and a sheet you have to click through is a sheet that gets
 * abandoned halfway.
 *
 * **It is honest on a phone.** Approving a batch is exactly a phone job, so
 * this screen is phone-enabled, but the composition editor is not: the Video
 * row is `phone: false`. So "open in editor" is hidden rather than offered and
 * then broken, because a row that navigates to a screen phones are not
 * offered is worse than no row.
 *
 * The state words come from the backend, which derives them by joining the
 * render rather than copying its status onto the item. A copy would go stale
 * the moment the encoder updated the render row.
 */

const STATE_LABEL = {
  blocked: 'Needs content',
  queued: 'Waiting',
  rendering: 'Rendering',
  rendered: 'Ready',
  failed: 'Failed',
};

const VERDICT_CHIP = {
  approved: 'chip chip-success',
  rejected: 'chip chip-warning',
  pending: 'chip chip-neutral',
};

/**
 * What the QC gate thought, as a word.
 *
 * Deliberately not the same vocabulary as the human verdict above: the
 * machine has not approved anything, it has measured. "Broken" and "Look"
 * say what to do next; "Clean" says only that nothing measurable is wrong,
 * which is not the same as the video being any good.
 */
const QC_CHIP = {
  fail: { label: 'Broken', cls: 'chip chip-danger' },
  look: { label: 'Look', cls: 'chip chip-warning' },
  pass: { label: 'Clean', cls: 'chip chip-neutral' },
  unmeasured: { label: 'Unmeasured', cls: 'chip chip-outline' },
};

/** Is this a phone-width screen? Used only to hide a link phones cannot follow. */
function useIsPhone() {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 720px)');
    const on = (e) => setPhone(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

export default function VideoBatchReviewPage({ clientId, onOpenInEditor = null }) {
  const [list, setList] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isPhone = useIsPhone();
  const liveRef = useRef(true);

  useEffect(() => () => { liveRef.current = false; }, []);

  useEffect(() => {
    api.get(`/compose/clients/${clientId}/batches`)
      .then((rows) => {
        setList(rows);
        if (rows.length && batchId == null) setBatchId(rows[0].id);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const load = useCallback(() => {
    if (batchId == null) return;
    api.get(`/compose/batches/${batchId}`)
      .then((b) => { if (liveRef.current) { setBatch(b); setError(null); } })
      .catch((e) => { if (liveRef.current) setError(e.message); });
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  // Poll while anything is still encoding, and stop when nothing is. A sheet
  // that keeps polling a finished batch is a request every three seconds for
  // as long as the tab is open.
  useEffect(() => {
    const working = (batch?.summary?.queued || 0) > 0;
    if (!working) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [batch?.summary?.queued, load]);

  const items = batch?.items || [];
  const current = items[Math.min(cursor, Math.max(0, items.length - 1))] || null;

  const decide = useCallback(async (item, verdict) => {
    if (!item) return;
    setBusy(true);
    try {
      await api.post(`/compose/batch-items/${item.id}/verdict`, { verdict });
      load();
      // Move on. The sheet's job is to be worked through, so a verdict
      // advances rather than leaving you where you were.
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [load, items.length]);

  const retry = useCallback(async (item) => {
    setBusy(true);
    try {
      await api.post(`/compose/batch-items/${item.id}/retry`, {});
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [load]);

  // Approve, reject, and move. Ninety clicks otherwise.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      else if (e.key === 'a' && current?.state === 'rendered') { e.preventDefault(); decide(current, 'approved'); }
      else if (e.key === 'r' && current) { e.preventDefault(); decide(current, 'rejected'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, items.length, decide]);

  if (error && !batch) {
    return <div className="chip chip-warning" style={{ marginTop: 'var(--s4)' }}>{error}</div>;
  }
  if (!list.length) {
    return (
      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <p>No batches yet. Brief one on <strong>Batch</strong> and it will appear here.</p>
      </div>
    );
  }

  const s = batch?.summary || {};

  return (
    <div style={{ marginTop: 'var(--s4)' }}>
      <div className="row" style={{ gap: 'var(--s2)', alignItems: 'center', marginBottom: 'var(--s3)' }}>
        <label htmlFor="batch-pick">Batch</label>
        <select
          id="batch-pick"
          value={batchId ?? ''}
          onChange={(e) => { setBatchId(Number(e.target.value)); setCursor(0); }}
        >
          {list.map((b) => (
            <option key={b.id} value={b.id}>
              {b.template_id} · {b.total} item{b.total === 1 ? '' : 's'} · {new Date(b.created_at).toLocaleDateString('en-GB')}
            </option>
          ))}
        </select>
      </div>

      {/* The roll-up. `Awaiting review` is the number that decides whether
          this screen is worth opening, so it is the featured tile. */}
      {/* `Watch these first` is the featured tile rather than `Awaiting
          review`, because the second number is the one that says "watch
          thirty" and the first is the one that says "watch two". That is the
          whole value of the QC gate. */}
      <StatStrip items={[
        {
          label: 'Watch these first',
          value: s.suspect ?? '—',
          sub: s.suspect ? `${s.qc_fail || 0} broken, ${s.qc_look || 0} worth a look` : 'nothing flagged',
          feature: true,
        },
        { label: 'Awaiting review', value: s.pending ?? '—', sub: s.qc_clean ? `${s.qc_clean} measured clean` : null },
        { label: 'Approved', value: s.approved ?? '—' },
        { label: 'Still encoding', value: s.queued ?? '—' },
        { label: 'Needs content', value: s.blocked ?? '—' },
        { label: 'Failed', value: s.failed ?? '—' },
        {
          label: 'Estimated',
          value: batch?.estimate_usd != null ? `$${Number(batch.estimate_usd).toFixed(2)}` : '—',
          sub: 'USD',
        },
      ]}
      />

      {error && <div className="chip chip-warning" style={{ margin: 'var(--s2) 0' }}>{error}</div>}

      <ListDetail
        sidebar
        list={(
          <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '70vh' }}>
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setCursor(i)}
                aria-current={i === cursor}
                style={{
                  display: 'flex',
                  width: '100%',
                  gap: 'var(--s2)',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: 'var(--s2)',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--card-border)',
                  background: i === cursor ? 'var(--surface-raised)' : 'transparent',
                  boxShadow: i === cursor ? 'inset 3px 0 0 var(--accent)' : 'none',
                  font: 'inherit',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: 'var(--text-muted)', minWidth: '2.2em' }}>{it.idx + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.title || it.ref || `Item ${it.idx + 1}`}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>
                    {STATE_LABEL[it.state] || it.state}
                    {it.state === 'rendering' && it.render_progress ? ` ${it.render_progress}%` : ''}
                  </span>
                </span>
                {it.verdict === 'pending' && it.qc_verdict && QC_CHIP[it.qc_verdict] && (
                  <span className={QC_CHIP[it.qc_verdict].cls}>
                    {QC_CHIP[it.qc_verdict].label}
                  </span>
                )}
                {it.verdict !== 'pending' && (
                  <span className={VERDICT_CHIP[it.verdict]}>{it.verdict}</span>
                )}
              </button>
            ))}
          </div>
        )}
        detail={(
          <div className="card">
            {!current && <p>Nothing selected.</p>}
            {current && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0 }}>{current.title || `Item ${current.idx + 1}`}</h2>
                  <span className="chip chip-neutral">{STATE_LABEL[current.state] || current.state}</span>
                  {current.verdict !== 'pending' && (
                    <span className={VERDICT_CHIP[current.verdict]}>{current.verdict}</span>
                  )}
                  {current.ref && (
                    <span style={{ color: 'var(--text-muted)' }}>from {current.ref}</span>
                  )}
                </div>

                {current.state === 'rendered' && current.output_url && (
                  <video
                    src={current.output_url}
                    controls
                    style={{ width: '100%', maxWidth: 420, marginTop: 'var(--s3)', background: '#000' }}
                  />
                )}

                {/* What the machine measured, and where to look. The time is
                    the point: "frozen for 3s at 8s" sends you to 8 seconds
                    rather than making you watch the whole thing. */}
                {current.qc && (
                  <div style={{ marginTop: 'var(--s3)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)' }}>
                      {QC_CHIP[current.qc_verdict] && (
                        <span className={QC_CHIP[current.qc_verdict].cls}>
                          {QC_CHIP[current.qc_verdict].label}
                        </span>
                      )}
                      <span>{current.qc.says}</span>
                    </div>
                    <ul style={{ marginTop: 'var(--s2)', color: 'var(--text-muted)' }}>
                      {(current.qc.checks || [])
                        .filter((c) => c.level === 'fail' || c.level === 'look')
                        .map((c) => (
                          <li key={c.id}>
                            {c.says}
                            {c.at != null && ` — at ${c.at}s`}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {/* The planner's own words about what this item needs. This is
                    what a tile would have truncated away. */}
                {current.state === 'blocked' && (
                  <div style={{ marginTop: 'var(--s3)' }}>
                    <p>This one did not run:</p>
                    <ul>
                      {(current.problems || []).map((p, i) => (
                        <li key={i}>{[p.slot, p.says].filter(Boolean).join(' ')}</li>
                      ))}
                    </ul>
                    <p style={{ color: 'var(--text-muted)' }}>
                      Fix the content and brief it again. There is nothing here to approve.
                    </p>
                  </div>
                )}

                {current.state === 'failed' && (
                  <div style={{ marginTop: 'var(--s3)' }}>
                    <p>The render failed:</p>
                    <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>
                      {current.render_error || 'no reason recorded'}
                    </pre>
                  </div>
                )}

                <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s4)', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || current.state !== 'rendered'}
                    onClick={() => decide(current, 'approved')}
                    title={current.state === 'rendered' ? 'Approve (a)' : 'Nothing to approve yet'}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => decide(current, 'rejected')}
                    title="Reject (r)"
                  >
                    Reject
                  </button>
                  {current.verdict !== 'pending' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => decide(current, 'pending')}
                    >
                      Undo
                    </button>
                  )}
                  {current.composition_id && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => retry(current)}
                    >
                      Render again
                    </button>
                  )}
                  {/* Hidden on a phone rather than offered and broken: the
                      composition editor is phone: false. */}
                  {current.composition_id && !isPhone && onOpenInEditor && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => onOpenInEditor(current.composition_id)}
                    >
                      Open in the editor
                    </button>
                  )}
                </div>

                <p style={{ color: 'var(--text-muted)', marginTop: 'var(--s3)', fontSize: '0.9em' }}>
                  {isPhone
                    ? 'Nothing leaves for Drive or Instagram until it is approved.'
                    : 'a approve · r reject · j/k move. Nothing leaves for Drive or Instagram until it is approved.'}
                </p>
              </>
            )}
          </div>
        )}
      />
    </div>
  );
}
