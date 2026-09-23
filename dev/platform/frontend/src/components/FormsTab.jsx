import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';

function defaultRange() {
  const today = new Date();
  const past = new Date(today);
  past.setDate(past.getDate() - 29);
  return {
    from: past.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function pct(v) {
  if (v == null || !isFinite(v)) return '—';
  return `${(parseFloat(v) * 100).toFixed(1)}%`;
}
function num(v) {
  if (v == null) return '—';
  return Math.round(parseFloat(v)).toLocaleString();
}
function secs(v) {
  if (!v) return '—';
  const n = parseInt(v);
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  return `${m}m ${n - m * 60}s`;
}

// Calls the October Forms API directly from the browser using ?api_key=.
// This bypasses the platform server so the host's IP restrictions don't apply.
async function ocfGet(credentials, path, params = {}) {
  const base = credentials.site_url.trim().replace(/\/$/, '');
  const qs = new URLSearchParams({ ...params, api_key: credentials.api_key });
  const url = `${base}/wp-json/ocf/v1/api${path}?${qs}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text();
    let msg = res.statusText;
    try { msg = JSON.parse(body)?.message || msg; } catch {}
    throw new Error(`October Forms ${res.status} on ${path}: ${msg}`);
  }
  return res.json();
}

export default function FormsTab({ clientId, connectors }) {
  const formsConnector = useMemo(() => {
    const candidates = connectors.filter(c => c.connector_type === 'october_forms');
    return candidates.find(c => c.status === 'active' && c.config?.value)
        || candidates.find(c => c.status === 'active')
        || candidates[0]
        || null;
  }, [connectors]);

  const [range, setRange] = useState(defaultRange());
  const [credentials, setCredentials] = useState(null);
  const [stats, setStats] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [submissions, setSubmissions] = useState(null);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const PAGE_SIZE = 50;

  const connectorId = formsConnector?.id;
  const formId = formsConnector?.config?.value;
  const formLabel = formsConnector?.config?.label || formId || null;

  // Fetch decrypted credentials from the backend once per connector.
  useEffect(() => {
    if (!connectorId) return;
    setCredentials(null);
    setError(null);
    api.get(`/october-forms/connectors/${connectorId}/credentials`)
      .then(setCredentials)
      .catch(err => setError(`Could not load connector credentials: ${err.message}`));
  }, [connectorId]);

  async function loadAll(creds = credentials) {
    if (!creds || !formId) return;
    setLoading(true); setError(null);
    try {
      const [s, f, t] = await Promise.all([
        ocfGet(creds, `/forms/${encodeURIComponent(formId)}/stats`, { from: range.from, to: range.to }),
        ocfGet(creds, `/forms/${encodeURIComponent(formId)}/funnel`, { from: range.from, to: range.to }),
        ocfGet(creds, `/forms/${encodeURIComponent(formId)}/timeseries`, { from: range.from, to: range.to }),
      ]);
      setStats(s); setFunnel(f); setTimeseries(t);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  async function loadSubmissions(creds = credentials, p = page) {
    if (!creds || !formId) return;
    try {
      const params = { from: range.from, to: range.to, limit: PAGE_SIZE, offset: p * PAGE_SIZE };
      if (statusFilter) params.status = statusFilter;
      const data = await ocfGet(creds, `/forms/${encodeURIComponent(formId)}/submissions`, params);
      const rows = Array.isArray(data) ? data : (data?.submissions || data?.rows || data?.data || []);
      const total = data?.total ?? (Array.isArray(data) ? data.length : rows.length);
      setSubmissions(rows);
      setSubmissionsTotal(total);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (!credentials) return;
    loadAll(credentials);
    loadSubmissions(credentials, 0);
    setPage(0);
    /* eslint-disable-next-line */
  }, [credentials, range.from, range.to]);

  useEffect(() => {
    if (!credentials) return;
    loadSubmissions(credentials, 0);
    setPage(0);
    /* eslint-disable-next-line */
  }, [statusFilter]);

  if (!formsConnector) {
    return (
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>October Forms not connected</div>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', margin: 0 }}>
          Add an October Forms connector for this client under the <strong>Connectors</strong> tab to see form analytics here.
        </p>
      </div>
    );
  }

  if (!formId) {
    return (
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>No form selected</div>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', margin: 0 }}>
          The October Forms connector is configured, but no form has been picked yet. Open the connector in the <strong>Connectors</strong> tab and choose which form belongs to this client.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      {/* Header */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Form</div>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-title)' }}>{formLabel || `Form ${formId}`}</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
            <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>From</label>
            <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
              style={dateInputStyle} />
            <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>To</label>
            <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
              style={dateInputStyle} />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, background: 'var(--negative-soft)', borderColor: 'var(--negative)', color: 'var(--negative)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && !stats && <div style={{ color: 'var(--text-subtle)', padding: 'var(--s5)', textAlign: 'center' }}>Loading…</div>}

      {/* KPI row */}
      {stats && (
        <div style={cardStyle}>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s4)' }}>
            Performance — {range.from} to {range.to}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s3)' }}>
            <Kpi label="Views" value={num(stats.views)} />
            <Kpi label="Starts" value={num(stats.starts)} />
            <Kpi label="Partials" value={num(stats.partials)} />
            <Kpi label="Completes" value={num(stats.completes)} />
            <Kpi label="View → Start" value={pct(stats.view_to_start_rate)} />
            <Kpi label="Start → Complete" value={pct(stats.start_to_complete)} />
            <Kpi label="Overall conv." value={pct(stats.overall_conversion)} accent />
            <Kpi label="Median time" value={secs(stats.median_seconds)} />
          </div>
        </div>
      )}

      {/* Funnel */}
      {funnel?.steps?.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s4)' }}>Funnel — step drop-off</div>
          <FunnelBars steps={funnel.steps} />
        </div>
      )}

      {/* Timeseries */}
      {timeseries?.days?.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s4)' }}>Daily volume</div>
          <Sparkline days={timeseries.days} />
        </div>
      )}

      {/* Submissions */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s4)' }}>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Submissions {submissionsTotal ? `(${submissionsTotal.toLocaleString()})` : ''}
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...dateInputStyle, padding: 'var(--s2) var(--s3)' }}>
            <option value="">All statuses</option>
            <option value="complete">Complete</option>
            <option value="partial">Partial</option>
          </select>
        </div>
        {submissions == null ? (
          <div style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>Loading…</div>
        ) : submissions.length === 0 ? (
          <div style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>No submissions in this range.</div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
              <thead>
                <tr>
                  {['ID', 'Status', 'Step reached', 'Started', 'Last activity', ''].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map(s => (
                  <tr key={s.id}>
                    <td style={tdStyle}><code style={{ fontSize: 'var(--fs-caption)' }}>{s.id}</code></td>
                    <td style={tdStyle}>
                      <span style={{ ...statusPill, background: s.status === 'complete' ? 'var(--positive-soft)' : 'var(--warning-soft)', color: s.status === 'complete' ? 'var(--positive)' : 'var(--warning)' }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={tdStyle}>{s.step_reached ?? s.last_step ?? '—'}</td>
                    <td style={tdStyle}>{s.created_at ? new Date(s.created_at).toLocaleString('en-GB') : '—'}</td>
                    <td style={tdStyle}>{s.updated_at ? new Date(s.updated_at).toLocaleString('en-GB') : '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button onClick={() => setDrilldown(s.id)} style={btnSmStyle}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {submissionsTotal > PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s3)' }}>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                  Page {page + 1} of {Math.ceil(submissionsTotal / PAGE_SIZE)}
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                  <button disabled={page === 0} onClick={() => { const p = page - 1; setPage(p); loadSubmissions(credentials, p); }} style={btnSmStyle}>Prev</button>
                  <button disabled={(page + 1) * PAGE_SIZE >= submissionsTotal} onClick={() => { const p = page + 1; setPage(p); loadSubmissions(credentials, p); }} style={btnSmStyle}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {drilldown && (
        <SubmissionModal
          credentials={credentials}
          submissionId={drilldown}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, accent = false }) {
  return (
    <div style={{ padding: 'var(--s3) var(--s4)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: accent ? 'var(--warning-soft)' : 'var(--surface-raised)' }}>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s1)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function FunnelBars({ steps }) {
  const max = Math.max(...steps.map(s => s.reached || 0), 1);
  const start = steps[0]?.reached || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
      {steps.map((s, i) => {
        const w = ((s.reached || 0) / max) * 100;
        const dropPct = i > 0 ? ((steps[i - 1].reached - s.reached) / (steps[i - 1].reached || 1)) * 100 : 0;
        return (
          <div key={s.step_id || i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-caption)', marginBottom: 'var(--s1)' }}>
              <span><strong>{i + 1}.</strong> {s.title || s.step_id}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {(s.reached || 0).toLocaleString()} ({((s.reached / start) * 100).toFixed(1)}%)
                {i > 0 && dropPct > 0 && <span style={{ color: 'var(--negative)', marginLeft: 'var(--s2)' }}>−{dropPct.toFixed(1)}%</span>}
              </span>
            </div>
            <div style={{ height: 14, background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              <div style={{ width: `${w}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ days }) {
  if (!days.length) return null;
  const W = 800, H = 140, P = 24;
  const maxY = Math.max(...days.map(d => Math.max(d.views || 0, d.starts || 0, d.completes || 0)), 1);
  const xStep = (W - P * 2) / Math.max(days.length - 1, 1);
  const series = (key, color) => {
    const pts = days.map((d, i) => `${P + i * xStep},${H - P - ((d[key] || 0) / maxY) * (H - P * 2)}`).join(' ');
    return <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />;
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 160 }}>
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#ddd" strokeWidth="1" />
        {series('views', 'var(--text-subtle)')}
        {series('starts', 'var(--accent)')}
        {series('completes', 'var(--positive)')}
      </svg>
      <div style={{ display: 'flex', gap: 'var(--s4)', fontSize: 'var(--fs-caption)', marginTop: 'var(--s2)', color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--text-subtle)', marginRight: 'var(--s1)', verticalAlign: 'middle' }} />Views</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--accent)', marginRight: 'var(--s1)', verticalAlign: 'middle' }} />Starts</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--positive)', marginRight: 'var(--s1)', verticalAlign: 'middle' }} />Completes</span>
        <span style={{ marginLeft: 'auto' }}>{days[0]?.date} → {days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function SubmissionModal({ credentials, submissionId, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!credentials) return;
    ocfGet(credentials, `/submissions/${encodeURIComponent(submissionId)}`)
      .then(setData).catch(e => setErr(e.message));
  }, [credentials, submissionId]);

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 720 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-title)' }}>Submission <code style={{ fontSize: 'var(--fs-body)' }}>{submissionId}</code></div>
          <button onClick={onClose} style={btnSmStyle}>Close</button>
        </div>
        {err && <div style={{ color: 'var(--negative)', fontSize: 'var(--fs-body)' }}>{err}</div>}
        {!data && !err && <div style={{ color: 'var(--text-subtle)' }}>Loading…</div>}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)', fontSize: 'var(--fs-body)' }}>
              <div><strong>Status:</strong> {data.status}</div>
              <div><strong>Step reached:</strong> {data.step_reached ?? '—'}</div>
              <div><strong>Created:</strong> {data.created_at ? new Date(data.created_at).toLocaleString('en-GB') : '—'}</div>
              <div><strong>Updated:</strong> {data.updated_at ? new Date(data.updated_at).toLocaleString('en-GB') : '—'}</div>
              {data.seconds_active != null && <div><strong>Time active:</strong> {secs(data.seconds_active)}</div>}
            </div>
            {data.answers_table?.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>Answers</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-caption)' }}>
                  <tbody>
                    {data.answers_table.map((a, i) => (
                      <tr key={i} style={{ borderTop: i ? '1px solid #f0f0f0' : 'none' }}>
                        <td style={{ padding: 'var(--s2) var(--s2) var(--s2) 0', width: '40%', color: 'var(--text-muted)' }}>{a.label}</td>
                        <td style={{ padding: 'var(--s2) 0' }}>{Array.isArray(a.value) ? a.value.join(', ') : String(a.value ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.files?.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-body)', marginBottom: 'var(--s2)' }}>Files</div>
                <ul style={{ paddingLeft: 'var(--s5)', margin: 0 }}>
                  {data.files.map((f, i) => (
                    <li key={i} style={{ marginBottom: 'var(--s1)' }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>
                        {f.filename || f.name || f.url}
                      </a>
                      {f.size && <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-caption)', marginLeft: 'var(--s2)' }}>({Math.round(f.size / 1024)} KB)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle = { background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 'var(--s5)' };
const dateInputStyle = { padding: 'var(--s1) var(--s2)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-caption)' };
const thStyle = { textAlign: 'left', padding: 'var(--s1) var(--s3) var(--s2) 0', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle = { padding: 'var(--s2) var(--s3) var(--s2) 0', borderTop: '1px solid #f5f5f5' };
const statusPill = { fontSize: 'var(--fs-caption)', fontWeight: 600, padding: 'var(--s1) var(--s2)', borderRadius: 'var(--r-md)', textTransform: 'capitalize' };
const btnSmStyle = { background: 'var(--surface)', color: 'var(--text)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)', padding: 'var(--s2) var(--s4)', fontSize: 'var(--fs-caption)', cursor: 'pointer', fontWeight: 600 };
const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalStyle = { background: 'white', borderRadius: 'var(--r-sm)', padding: 'var(--s6)', width: '100%', maxWidth: 720, maxHeight: '90vh', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' };
