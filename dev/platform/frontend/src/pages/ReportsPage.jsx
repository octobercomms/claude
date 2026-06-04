import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS_COLORS = {
  sent: '#2e7d32', generated: '#1565c0', generating: '#f57c00',
  pending: '#888', failed: '#c62828', sending: '#f57c00',
};

export default function ReportsPage() {
  const toast = useToast();
  const [reports, setReports] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showTrigger, setShowTrigger] = useState(false);
  const [trigger, setTrigger] = useState({ client_id: '', report_type: 'weekly', period_start: '', period_end: '' });
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/reports'), api.get('/clients')])
      .then(([r, c]) => { setReports(r); setClients(c); })
      .finally(() => setLoading(false));
  }, []);

  async function handleTrigger(e) {
    e.preventDefault();
    setTriggering(true);
    try {
      await api.post('/reports/trigger', trigger);
      const updated = await api.get('/reports');
      setReports(updated);
      setShowTrigger(false);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setTriggering(false);
    }
  }

  async function handleResend(reportId) {
    if (!window.confirm('Resend this report?')) return;
    try {
      await api.post(`/reports/${reportId}/resend`);
      toast('Resend initiated');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleDelete(reportId) {
    if (!window.confirm('Delete this report?')) return;
    try {
      await api.delete(`/reports/${reportId}`);
      setReports(prev => prev.filter(r => r.id !== reportId));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handlePreview(reportId) {
    try {
      const { url } = await api.get(`/reports/${reportId}/preview-url`);
      window.open(url, '_blank');
    } catch (err) {
      alert(`Could not open preview: ${err.message}`);
    }
  }

  const filtered = reports.filter(r => {
    if (filterClient && r.client_id !== filterClient) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  return (
    <div className="suite-social">
      <header className="hero">
        <div className="row between wrap center">
          <h1 className="display">Reports</h1>
          <button onClick={() => setShowTrigger(true)} className="btn btn-primary">+ Trigger Report</button>
        </div>
      </header>
      <div style={{ display: 'none' }}>
      </div>

      {showTrigger && (
        <div style={styles.card}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>Trigger Report</h3>
          <form onSubmit={handleTrigger} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={styles.field}>
                <label style={styles.label}>Client</label>
                <select style={styles.input} value={trigger.client_id} required
                  onChange={e => setTrigger(p => ({ ...p, client_id: e.target.value }))}>
                  <option value="">Select client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Report Type</label>
                <select style={styles.input} value={trigger.report_type}
                  onChange={e => setTrigger(p => ({ ...p, report_type: e.target.value }))}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Period Start (optional)</label>
                <input type="date" style={styles.input} value={trigger.period_start}
                  onChange={e => setTrigger(p => ({ ...p, period_start: e.target.value }))} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Period End (optional)</label>
                <input type="date" style={styles.input} value={trigger.period_end}
                  onChange={e => setTrigger(p => ({ ...p, period_end: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={styles.btn} disabled={triggering}>{triggering ? 'Generating…' : 'Generate'}</button>
              <button type="button" onClick={() => setShowTrigger(false)} style={styles.btnGhost}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select style={{ ...styles.input, width: 200 }} value={filterClient} onChange={e => setFilterClient(e.target.value)}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select style={{ ...styles.input, width: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['pending','generating','generated','sending','sent','failed'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Client', 'Type', 'Period', 'Status', 'Generated', 'Sent', ''].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#888' }}>No reports found</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id}>
                <td style={styles.td}><strong>{r.client_name}</strong></td>
                <td style={styles.td}>
                  <span style={styles.typeBadge(r.report_type)}>{r.report_type}</span>
                </td>
                <td style={styles.td}>{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</td>
                <td style={styles.td}>
                  <span style={{ color: STATUS_COLORS[r.status] || '#888', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                    {r.status}
                  </span>
                  {r.status === 'failed' && r.error_log && (
                    <div style={{ fontSize: 11, color: '#c62828', marginTop: 4, maxWidth: 300, wordBreak: 'break-word' }}>
                      {r.error_log}
                    </div>
                  )}
                </td>
                <td style={styles.td}>{r.generated_at ? fmtDate(r.generated_at) : '—'}</td>
                <td style={styles.td}>{r.sent_at ? fmtDate(r.sent_at) : '—'}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {(r.status === 'generated' || r.status === 'sent') && (
                      <button onClick={() => handlePreview(r.id)} style={styles.btnSm}>Preview</button>
                    )}
                    {r.pdf_path && (
                      <a href={`/pdfs/report-${r.id}.pdf`} target="_blank" rel="noreferrer" style={styles.btnSm}>PDF</a>
                    )}
                    {(r.status === 'generated' || r.status === 'sent' || r.status === 'failed') && (
                      <button onClick={() => handleResend(r.id)} style={styles.btnSm}>{r.status === 'failed' ? 'Retry' : 'Resend'}</button>
                    )}
                    <button onClick={() => handleDelete(r.id)} style={{ ...styles.btnSm, color: '#c62828' }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = {
  card: { background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 14, padding: 24, marginBottom: 24 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2 },
  input: { padding: '10px 12px', border: '2px solid var(--accent)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--accent-soft)' },
  btn: { background: 'var(--accent)', color: 'var(--accent-on)', border: '2px solid var(--accent)', borderRadius: 999, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'var(--accent-soft)', color: '#1a1a1a', border: '2px solid var(--accent)', borderRadius: 999, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnSm: { background: 'var(--accent-soft)', color: '#1a1a1a', border: '2px solid var(--accent)', borderRadius: 999, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 600, textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap', fontFamily: 'inherit' },
  tableWrap: { background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 14, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '12px 16px', textAlign: 'left', background: '#fafafa', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: '#888', borderBottom: '2px solid #1a1a1a' },
  td: { padding: '12px 16px', borderBottom: '2px solid #f3f3f3', verticalAlign: 'middle' },
  typeBadge: (t) => ({ background: t === 'monthly' ? 'rgba(231,205,65,0.15)' : 'rgba(156,139,44,0.15)', color: t === 'monthly' ? '#7a6500' : '#5d6020', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, border: '1px solid currentColor' }),
};
