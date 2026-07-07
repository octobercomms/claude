// SEO drift — Integration E. "Git for SEO": capture a baseline of the client's
// SEO signals (rankings, site-audit score/issues, backlinks, authority) before
// a risky change, then compare current signals against it and severity-code
// every regression. Reads tables OMI already populates — no external API call.

import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

const SEV = {
  critical: { label: 'Critical', tone: 'var(--negative)', soft: 'var(--negative-soft)' },
  warning:  { label: 'Warning',  tone: 'var(--warning)',  soft: 'var(--warning-soft)' },
  info:     { label: 'Info',     tone: 'var(--text-muted)', soft: 'var(--surface-sunken)' },
};

export default function SeoDriftPanel({ clientId }) {
  const { readOnly } = useAuth();
  const [baselines, setBaselines] = useState([]);
  const [selected, setSelected] = useState('');
  const [label, setLabel] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function load() {
    setLoading(true);
    try {
      const { baselines: b } = await api.get(`/seo/clients/${clientId}/drift/baselines`);
      setBaselines(b || []);
      if (b && b.length && !selected) setSelected(b[0].id);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function capture() {
    setBusy(true); setErr(null);
    try {
      await api.post(`/seo/clients/${clientId}/drift/baselines`, { label: label.trim() || null });
      setLabel('');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function compare() {
    setBusy(true); setErr(null); setReport(null);
    try {
      const q = selected ? `?baseline_id=${selected}` : '';
      setReport(await api.get(`/seo/clients/${clientId}/drift/compare${q}`));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm('Delete this baseline?')) return;
    try {
      await api.delete(`/seo/clients/${clientId}/drift/baselines/${id}`);
      if (selected === id) { setSelected(''); setReport(null); }
      await load();
    } catch (e) { setErr(e.message); }
  }

  const fmtDate = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <div className="mb-5">
        <div className="caption">SEO drift</div>
        <h2 className="h2 mt-2">Baseline &amp; compare — catch regressions</h2>
        <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>
          Capture a snapshot of rankings, site-audit health, backlinks and authority before a migration, redesign or big
          content change. Later, compare the current state against it — every drop is severity-coded so nothing slips.
        </p>
      </div>

      <div className="card mb-5">
        <div className="row between center" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 8, flex: 1, minWidth: 260 }}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Baseline name (e.g. Pre-migration)"
              style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
            <button className="btn btn-primary" {...roWrite(readOnly, { onClick: capture, disabled: busy })}>
              {busy ? 'Working…' : '⦿ Capture baseline'}
            </button>
          </div>
        </div>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>
      ) : !baselines.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No baselines yet. Capture one above — it takes a snapshot of the current SEO signals to compare against later.
        </div>
      ) : (
        <>
          <div className="row between center mb-4" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="row center" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="body-sm text-muted">Compare against</span>
              <select value={selected} onChange={e => setSelected(e.target.value)} className="input"
                style={{ padding: '6px 10px', fontSize: 13, minWidth: 260 }}>
                {baselines.map(b => (
                  <option key={b.id} value={b.id}>{b.label ? `${b.label} — ` : ''}{fmtDate(b.captured_at)}</option>
                ))}
              </select>
              <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: compare, disabled: busy || !selected })}>
                {busy ? 'Comparing…' : 'Compare to now'}
              </button>
            </div>
            {selected && (
              <button onClick={() => remove(selected)} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete baseline</button>
            )}
          </div>

          {report && (
            report.changes.length === 0 ? (
              <div className="card"><p className="body-sm text-subtle">No material changes since <strong>{report.baseline.label || fmtDate(report.baseline.captured_at)}</strong>. Steady. 🎉</p></div>
            ) : (
              <>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s3)', marginBottom: 'var(--s4)', maxWidth: 420 }}>
                  {['critical', 'warning', 'info'].map(s => (
                    <div key={s} className="card" style={{ padding: '10px 12px' }}>
                      <div className="caption">{SEV[s].label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: SEV[s].tone }}>{report.summary[s] || 0}</div>
                    </div>
                  ))}
                </div>
                <p className="body-xs text-subtle mb-3">
                  vs <strong>{report.baseline.label || 'baseline'}</strong> captured {fmtDate(report.baseline.captured_at)}.
                </p>
                <div className="stack" style={{ gap: 6 }}>
                  {report.changes.map((c, i) => (
                    <div key={i} className="card" style={{ padding: '10px 12px', borderLeft: `3px solid ${SEV[c.severity].tone}` }}>
                      <div className="row between center" style={{ gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-subtle)' }}>{c.area}</span>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{c.metric}</div>
                        </div>
                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: c.direction === 'up' ? 'var(--positive)' : SEV[c.severity].tone }}>
                            {c.from ?? '—'} → {c.to ?? '—'} {c.direction === 'up' ? '↑' : '↓'}
                          </span>
                          {c.note && <div className="body-xs text-subtle">{c.note}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
