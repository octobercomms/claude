import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS_COLORS = {
  sent: 'var(--positive)', generated: 'var(--accent)', generating: 'var(--warning)',
  pending: 'var(--text-subtle)', failed: 'var(--negative)', sending: 'var(--warning)',
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

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>;

  return (
    <div className="suite-reports">
      <header className="hero">
        <div>
          <h1 className="display">Reports</h1>
        </div>
        <div className="hero-actions">
          <button onClick={() => setShowTrigger(true)} className="btn btn-primary btn-sm">+ Trigger Report</button>
        </div>
      </header>
      <div style={{ display: 'none' }}>
      </div>

      {showTrigger && (
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>Trigger Report</h3>
          <form onSubmit={handleTrigger} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="field">
                <label className="field-label">Client</label>
                <select className="input" value={trigger.client_id} required
                  onChange={e => setTrigger(p => ({ ...p, client_id: e.target.value }))}>
                  <option value="">Select client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Report Type</label>
                <select className="input" value={trigger.report_type}
                  onChange={e => setTrigger(p => ({ ...p, report_type: e.target.value }))}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Period Start (optional)</label>
                <input type="date" className="input" value={trigger.period_start}
                  onChange={e => setTrigger(p => ({ ...p, period_start: e.target.value }))} />
              </div>
              <div className="field">
                <label className="field-label">Period End (optional)</label>
                <input type="date" className="input" value={trigger.period_end}
                  onChange={e => setTrigger(p => ({ ...p, period_end: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={triggering}>{triggering ? 'Generating…' : 'Generate'}</button>
              <button type="button" onClick={() => setShowTrigger(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select className="input" style={{ width: 200 }} value={filterClient} onChange={e => setFilterClient(e.target.value)}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" style={{ width: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['pending','generating','generated','sending','sent','failed'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              {['Client', 'Type', 'Period', 'Status', 'Generated', 'Sent', ''].map(h => (
                <th key={h} >{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>No reports found</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id}>
                <td ><strong>{r.client_name}</strong></td>
                <td >
                  <span className="chip chip-accent">{r.report_type}</span>
                </td>
                <td >{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</td>
                <td >
                  <span style={{ color: STATUS_COLORS[r.status] || 'var(--text-subtle)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                    {r.status}
                  </span>
                  {r.status === 'failed' && r.error_log && (
                    <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 4, maxWidth: 300, wordBreak: 'break-word' }}>
                      {r.error_log}
                    </div>
                  )}
                </td>
                <td >{r.generated_at ? fmtDate(r.generated_at) : '—'}</td>
                <td >{r.sent_at ? fmtDate(r.sent_at) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {(r.status === 'generated' || r.status === 'sent') && (
                      <button onClick={() => handlePreview(r.id)} className="btn btn-secondary btn-sm">Preview</button>
                    )}
                    {r.pdf_path && (
                      <a href={`/pdfs/report-${r.id}.pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">PDF</a>
                    )}
                    {(r.status === 'generated' || r.status === 'sent' || r.status === 'failed') && (
                      <button onClick={() => handleResend(r.id)} className="btn btn-secondary btn-sm">{r.status === 'failed' ? 'Retry' : 'Resend'}</button>
                    )}
                    <button onClick={() => handleDelete(r.id)} className="btn btn-danger btn-sm">✕</button>
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

