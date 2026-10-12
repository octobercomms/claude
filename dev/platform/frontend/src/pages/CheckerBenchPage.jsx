import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

/**
 * The checker bench. Temporary, and it says so on the page.
 *
 * One question: does October's deterministic checker predict anything a trained
 * detector agrees with, on October's own writing? Load specimens, label how each
 * was really produced, score them with both, and read the two columns together.
 *
 * Kept out of the Releases editor on purpose. The editor is for issuing work and
 * has to stay stable; this is an experiment with a planned end, and when the
 * thresholds are set the page, its route and its table are deleted together.
 */
const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

// Four levels rather than two. A binary human/AI label throws away the middle,
// and the middle — an AI draft a person reported into — is where October's work
// sits and where the detectors disagreed most sharply.
const LABELS = [
  ['cold', 'Written cold', 'from the fact sheet, no AI prose'],
  ['ai_rewritten', 'AI draft, rewritten', 'the sentences were written again by hand'],
  ['ai_edited', 'AI draft, edited', 'tidied, cut, facts added, structure kept'],
  ['ai_raw', 'Essentially AI', 'as generated, give or take a word'],
  ['unknown', 'Not sure', 'label it later'],
];
const LABEL_NAME = Object.fromEntries(LABELS.map(([k, n]) => [k, n]));

/** Pearson correlation, the one number that answers the bench's question. */
function correlation(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2;
  }
  if (!dx || !dy) return null;
  return +(num / Math.sqrt(dx * dy)).toFixed(2);
}

/**
 * Our score against the detector's, one dot per specimen.
 *
 * The dot's shape carries the label as well as its fill, because a reader who
 * cannot separate the hues still has to be able to read the chart. If the two
 * tools measure the same thing the cloud runs top-left to bottom-right: a high
 * score here, a low percentage there.
 */
function Scatter({ rows }) {
  const pts = rows.filter((r) => r.own_score != null && r.pangram_pct != null);
  const W = 420; const H = 300; const P = 42;
  const x = (v) => P + (v / 100) * (W - P - 12);
  const y = (v) => H - P - (v / 100) * (H - P - 14);
  const r = correlation(pts.map((p) => [p.own_score, Number(p.pangram_pct)]));
  const fill = (label) => (label === 'cold' ? 'var(--positive)'
    : label === 'ai_raw' ? 'var(--negative)'
      : label === 'unknown' ? 'var(--text-subtle)' : 'var(--warning)');

  if (!pts.length) {
    return <div style={CAP}>No specimen has both scores yet. The chart appears once one does.</div>;
  }
  return (
    <div>
      <svg width={W} height={H} role="img"
        aria-label={`October score against detector percentage, ${pts.length} specimens.`}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={P} x2={W - 12} y1={y(t)} y2={y(t)} stroke="var(--card-border)" strokeWidth="1" />
            <text x={P - 8} y={y(t) + 4} textAnchor="end" style={{ fontSize: 10, fill: 'var(--text-subtle)' }}>{t}</text>
            <text x={x(t)} y={H - P + 16} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--text-subtle)' }}>{t}</text>
          </g>
        ))}
        {pts.map((p) => (
          <circle key={p.id} cx={x(p.own_score)} cy={y(Number(p.pangram_pct))} r="6"
            fill={fill(p.label)} stroke="var(--surface)" strokeWidth="2">
            <title>{`${p.title || 'Untitled'} — ${LABEL_NAME[p.label]}: ours ${p.own_score}, detector ${p.pangram_pct}%`}</title>
          </circle>
        ))}
        <text x={(W + P) / 2} y={H - 6} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--text-subtle)' }}>
          October score →
        </text>
        <text x={12} y={16} style={{ fontSize: 11, fill: 'var(--text-subtle)' }}>↑ detector % AI</text>
      </svg>
      <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
        {r == null
          ? `${pts.length} paired specimens. Three are needed before a correlation means anything.`
          : <>Correlation <strong>{r}</strong> across {pts.length} specimens. The two tools agree when this sits
            near −1, which is what a cloud running from top-left to bottom-right looks like. Near 0 means
            October&rsquo;s score predicts nothing the detector sees, and that is a result worth having.</>}
      </div>
    </div>
  );
}

export default function CheckerBenchPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [quote, setQuote] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ title: '', label: 'cold', body_html: '', note: '' });

  async function load() {
    const r = await api.get('/lab/samples');
    setRows(r.samples || []);
    setConfigured(!!r.pangram_configured);
    api.get('/lab/detector-quote').then(setQuote).catch(() => {});
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, []); // eslint-disable-line

  const byLabel = useMemo(() => {
    const out = {};
    for (const r of rows) (out[r.label] = out[r.label] || []).push(r);
    return out;
  }, [rows]);

  async function add() {
    if (!form.body_html.trim()) { toast('Paste the release text first.', 'info'); return; }
    setBusy('add');
    try {
      await api.post('/lab/samples', form);
      setForm({ title: '', label: form.label, body_html: '', note: '' });
      await load();
      toast('Added and scored.', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  async function rescore() {
    setBusy('rescore');
    try {
      const r = await api.post('/lab/rescore', {});
      await load();
      toast(`Re-scored ${r.rescored} specimens with the current analyser.`, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  async function detect(row) {
    setBusy(row.id);
    try {
      const r = await api.post(`/lab/samples/${row.id}/detect`, {});
      await load();
      toast(r.cached ? 'Unchanged since the last check, so nothing was spent.'
        : `Detector says ${r.pangram_pct}% AI.`, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  return (
    <div>
      <div className="card warning" style={{ marginBottom: 'var(--s4)' }}>
        <strong>Temporary.</strong> This bench exists to calibrate the humanity checker against a trained
        detector. It is deliberately outside the Releases editor: that has to stay stable, and this has a
        planned end. When the thresholds are set, the page, its route and its table are deleted together,
        and nothing in the editor changes.
      </div>

      <h2 className="h2" style={{ marginTop: 0 }}>Checker bench</h2>
      <p style={{ ...CAP, maxWidth: '48em' }}>
        One question: does October&rsquo;s own score predict what a trained detector sees, on October&rsquo;s
        own writing? Load specimens, label how each was really produced, and read the two columns together.
        Our score is free and recomputed in bulk whenever the analyser changes. The detector bills per 100
        words, runs one specimen per press, and never re-bills text it has already seen.
      </p>

      {/* ── Add a specimen ───────────────────────────────────────────── */}
      <div style={{ border: LINE, borderRadius: 'var(--r-sm)', padding: 'var(--s4)', marginBottom: 'var(--s4)' }}>
        <div style={{ fontWeight: 700, marginBottom: 'var(--s2)' }}>Add a specimen</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--s3)' }}>
          <label className="field">
            <span className="field-label">Title</span>
            <input className="input" value={form.title} placeholder="Which release this is"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">How it was really written</span>
            <select className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>
              {LABELS.map(([k, n, hint]) => <option key={k} value={k}>{n} — {hint}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">The text</span>
          <textarea className="input" rows={8} value={form.body_html}
            placeholder="Paste the release. HTML or plain text, either is fine."
            style={{ width: '100%', boxSizing: 'border-box' }}
            onChange={(e) => setForm({ ...form, body_html: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Note <span style={{ fontWeight: 400, ...CAP }}>anything that would otherwise be forgotten</span></span>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button className="btn btn-primary btn-sm" disabled={busy === 'add'} onClick={add}>
          {busy === 'add' ? 'Adding…' : 'Add and score'}
        </button>
      </div>

      {/* ── The reading ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 'var(--s5)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <div style={{ border: LINE, borderRadius: 'var(--r-sm)', padding: 'var(--s4)' }}>
          <Scatter rows={rows} />
        </div>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 'var(--s2)' }}>The corpus</div>
          {LABELS.map(([k, n]) => (
            <div key={k} className="row" style={{ gap: 'var(--s2)', padding: '2px 0', alignItems: 'baseline' }}>
              <span style={{ width: 34, fontWeight: 700 }}>{byLabel[k]?.length || 0}</span>
              <span style={{ fontSize: 'var(--fs-body)' }}>{n}</span>
            </div>
          ))}
          <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
            Roughly even numbers at each end, or any accuracy figure is meaningless: with twenty written
            cold and three essentially AI, &ldquo;always say human&rdquo; scores 87%.
          </div>

          <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: LINE }}>
            <button className="btn btn-secondary btn-sm" disabled={busy === 'rescore'} onClick={rescore}>
              {busy === 'rescore' ? 'Re-scoring…' : 'Re-score all with the current analyser'}
            </button>
            <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
              Free. Press it after the analyser changes to see whether agreement improved across the whole
              corpus rather than on one release.
            </div>
          </div>

          <div style={{ marginTop: 'var(--s3)' }}>
            <a className="btn btn-secondary btn-sm" href="/api/lab/export.csv">↓ Export the pairs as CSV</a>
            <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
              How the data reaches a calibration session. Download it and commit it to the repo.
            </div>
          </div>

          {quote && (
            <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s2)', borderTop: LINE }}>
              {configured
                ? <>{quote.pending} specimen{quote.pending === 1 ? '' : 's'} unchecked, {quote.words} words.
                  Checking them all would cost about <strong>${quote.cost_usd}</strong>, one press at a time.</>
                : <>No detector key configured, so the right-hand column stays empty. Add one under{' '}
                  <a href="/settings?tab=outreach">Settings → Keys → Outreach finders → AI detection (Pangram)</a>.
                  Everything else on this page works without it.</>}
            </div>
          )}
        </div>
      </div>

      {/* ── The specimens ────────────────────────────────────────────── */}
      <table className="table">
        <thead>
          <tr>
            <th>Title</th><th>How it was written</th><th style={{ textAlign: 'right' }}>Words</th>
            <th style={{ textAlign: 'right' }}>October</th><th style={{ textAlign: 'right' }}>Detector</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.title || <span style={CAP}>Untitled</span>}</td>
              <td>
                <select className="input" value={r.label} style={{ padding: '2px 6px', fontSize: 'var(--fs-caption)' }}
                  onChange={async (e) => {
                    await api.patch(`/lab/samples/${r.id}`, { label: e.target.value });
                    load();
                  }}>
                  {LABELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              </td>
              <td style={{ textAlign: 'right' }}>{r.word_count}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.own_score ?? '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>
                {r.pangram_pct == null ? <span style={CAP}>—</span> : `${r.pangram_pct}%`}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn btn-secondary btn-sm" disabled={!configured || busy === r.id}
                  title={configured ? 'One billable call' : 'No detector key configured'}
                  onClick={() => detect(r)}>
                  {busy === r.id ? '…' : r.pangram_checked_at ? 'Re-check' : 'Check'}
                </button>
                <button className="btn btn-icon btn-icon-sm danger" title="Remove"
                  onClick={async () => { await api.delete(`/lab/samples/${r.id}`); load(); }}>×</button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} style={CAP}>Nothing loaded yet. Paste a release above to start.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
