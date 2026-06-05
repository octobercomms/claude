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
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>October Forms not connected</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Add an October Forms connector for this client under the <strong>Connectors</strong> tab to see form analytics here.
        </p>
      </div>
    );
  }

  if (!formId) {
    return (
      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>No form selected</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          The October Forms connector is configured, but no form has been picked yet. Open the connector in the <strong>Connectors</strong> tab and choose which form belongs to this client.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Form</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{formLabel || `Form ${formId}`}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>From</label>
            <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
              style={dateInputStyle} />
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>To</label>
            <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
              style={dateInputStyle} />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, background: '#fff5f5', borderColor: '#fecaca', color: '#991b1b' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && !stats && <div style={{ color: 'var(--text-subtle)', padding: 20, textAlign: 'center' }}>Loading…</div>}

      {/* KPI row */}
      {stats && (
        <div style={cardStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
            Performance — {range.from} to {range.to}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
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
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Funnel — step drop-off</div>
          <FunnelBars steps={funnel.steps} />
        </div>
      )}

      {/* Timeseries */}
      {timeseries?.days?.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Daily volume</div>
          <Sparkline days={timeseries.days} />
        </div>
      )}

      {/* Submissions */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Submissions {submissionsTotal ? `(${submissionsTotal.toLocaleString()})` : ''}
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...dateInputStyle, padding: '6px 10px' }}>
            <option value="">All statuses</option>
            <option value="complete">Complete</option>
            <option value="partial">Partial</option>
          </select>
        </div>
        {submissions == null ? (
          <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>
        ) : submissions.length === 0 ? (
          <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No submissions in this range.</div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
                    <td style={tdStyle}><code style={{ fontSize: 11 }}>{s.id}</code></td>
                    <td style={tdStyle}>
                      <span style={{ ...statusPill, background: s.status === 'complete' ? '#dcfce7' : '#fef3c7', color: s.status === 'complete' ? '#166534' : '#92400e' }}>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  Page {page + 1} of {Math.ceil(submissionsTotal / PAGE_SIZE)}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={page === 0} onClick={() => { const p = page - 1; setPage(p); loadSubmissions(credentials, p); }} style={btnSmStyle}>← Prev</button>
                  <button disabled={(page + 1) * PAGE_SIZE >= submissionsTotal} onClick={() => { const p = page + 1; setPage(p); loadSubmissions(credentials, p); }} style={btnSmStyle}>Next →</button>
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
    <div style={{ padding: '12px 14px', border: '2px solid var(--accent)', borderRadius: 6, background: accent ? '#fffbe6' : 'var(--surface-raised)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function FunnelBars({ steps }) {
  const max = Math.max(...steps.map(s => s.reached || 0), 1);
  const start = steps[0]?.reached || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => {
        const w = ((s.reached || 0) / max) * 100;
        const dropPct = i > 0 ? ((steps[i - 1].reached - s.reached) / (steps[i - 1].reached || 1)) * 100 : 0;
        return (
          <div key={s.step_id || i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span><strong>{i + 1}.</strong> {s.title || s.step_id}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {(s.reached || 0).toLocaleString()} ({((s.reached / start) * 100).toFixed(1)}%)
                {i > 0 && dropPct > 0 && <span style={{ color: 'var(--negative)', marginLeft: 8 }}>−{dropPct.toFixed(1)}%</span>}
              </span>
            </div>
            <div style={{ height: 14, background: 'var(--surface-sunken)', borderRadius: 3, overflow: 'hidden' }}>
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
        {series('views', '#a3a3a3')}
        {series('starts', '#3b82f6')}
        {series('completes', '#16a34a')}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, marginTop: 6, color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#a3a3a3', marginRight: 5, verticalAlign: 'middle' }} />Views</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#3b82f6', marginRight: 5, verticalAlign: 'middle' }} />Starts</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#16a34a', marginRight: 5, verticalAlign: 'middle' }} />Completes</span>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Submission <code style={{ fontSize: 13 }}>{submissionId}</code></div>
          <button onClick={onClose} style={btnSmStyle}>Close</button>
        </div>
        {err && <div style={{ color: 'var(--negative)', fontSize: 13 }}>{err}</div>}
        {!data && !err && <div style={{ color: 'var(--text-subtle)' }}>Loading…</div>}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div><strong>Status:</strong> {data.status}</div>
              <div><strong>Step reached:</strong> {data.step_reached ?? '—'}</div>
              <div><strong>Created:</strong> {data.created_at ? new Date(data.created_at).toLocaleString('en-GB') : '—'}</div>
              <div><strong>Updated:</strong> {data.updated_at ? new Date(data.updated_at).toLocaleString('en-GB') : '—'}</div>
              {data.seconds_active != null && <div><strong>Time active:</strong> {secs(data.seconds_active)}</div>}
            </div>
            {data.answers_table?.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Answers</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {data.answers_table.map((a, i) => (
                      <tr key={i} style={{ borderTop: i ? '1px solid #f0f0f0' : 'none' }}>
                        <td style={{ padding: '6px 8px 6px 0', width: '40%', color: 'var(--text-muted)' }}>{a.label}</td>
                        <td style={{ padding: '6px 0' }}>{Array.isArray(a.value) ? a.value.join(', ') : String(a.value ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.files?.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Files</div>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {data.files.map((f, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                        {f.filename || f.name || f.url}
                      </a>
                      {f.size && <span style={{ color: 'var(--text-subtle)', fontSize: 11, marginLeft: 6 }}>({Math.round(f.size / 1024)} KB)</span>}
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

const cardStyle = { background: 'white', border: '2px solid var(--accent)', borderRadius: 6, padding: 20 };
const dateInputStyle = { padding: '5px 8px', border: '2px solid var(--accent)', borderRadius: 4, fontSize: 12 };
const thStyle = { textAlign: 'left', padding: '4px 12px 8px 0', fontSize: 11, color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle = { padding: '7px 12px 7px 0', borderTop: '1px solid #f5f5f5' };
const statusPill = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, textTransform: 'capitalize' };
const btnSmStyle = { background: 'var(--surface)', color: 'var(--text)', border: '2px solid var(--accent)', borderRadius: 999, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 };
const modalOverlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalStyle = { background: 'white', borderRadius: 8, padding: 24, width: '100%', maxWidth: 720, maxHeight: '90vh', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' };
