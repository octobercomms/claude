import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

export default function DeadlinesPanel() {
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/accounts/deadlines')
      .then(r => setDeadlines(r.deadlines || r || []))
      .catch(() => toast('Failed to load deadlines', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const addDeadline = (data) => {
    api.post('/accounts/deadlines', data)
      .then(() => { toast('Deadline added', 'success'); setShowAdd(false); load(); })
      .catch(e => toast(e.message || 'Failed to add deadline', 'error'));
  };

  const daysUntil = (d) => {
    if (!d) return null;
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  };

  const urgencyColour = (days) => {
    if (days == null) return undefined;
    if (days < 0) return 'var(--danger)';
    if (days <= 14) return 'var(--warning)';
    return 'var(--success)';
  };

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
        <div>
          <h2 className="caption">Tax deadlines</h2>
          <p className="body-sm text-muted">
            VAT quarters, CT600, PAYE and any other filing deadlines. Upcoming deadlines are flagged in the weekly digest.
          </p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : 'Add deadline'}
        </button>
      </div>

      {showAdd && <AddDeadlineForm onSubmit={addDeadline} onCancel={() => setShowAdd(false)} />}

      {loading && <p className="body-sm text-muted">Loading…</p>}

      {!loading && deadlines.length === 0 && (
        <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
          No deadlines set. Add your VAT quarters and CT600 dates to get reminders.
        </p>
      )}

      {!loading && deadlines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {deadlines.map(dl => {
            const days = daysUntil(dl.due_date);
            const colour = urgencyColour(days);
            return (
              <div key={dl.id} className="card" style={{ background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{dl.label}</div>
                  <div className="body-sm text-muted">
                    {dl.tax_type ? <span className="chip chip-neutral" style={{ marginRight: 'var(--s2)' }}>{dl.tax_type}</span> : null}
                    Due {new Date(dl.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {dl.recurrence && <span className="body-sm text-subtle"> ({dl.recurrence})</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--fs-section)', fontWeight: 800, color: colour }}>
                    {days != null ? (days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`) : '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddDeadlineForm({ onSubmit, onCancel }) {
  const [label, setLabel] = useState('');
  const [taxType, setTaxType] = useState('VAT');
  const [dueDate, setDueDate] = useState('');
  const [recurrence, setRecurrence] = useState('quarterly');

  const handle = (e) => {
    e.preventDefault();
    if (!label || !dueDate) return;
    onSubmit({ label, tax_type: taxType, due_date: dueDate, recurrence });
  };

  return (
    <form onSubmit={handle} style={{ marginBottom: 'var(--s4)', padding: 'var(--s3)', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--s3)' }}>
        <label className="body-sm">
          Label
          <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Q1 VAT return" required />
        </label>
        <label className="body-sm">
          Type
          <select className="input" value={taxType} onChange={e => setTaxType(e.target.value)}>
            <option value="VAT">VAT</option>
            <option value="CT600">CT600</option>
            <option value="PAYE">PAYE</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="body-sm">
          Due date
          <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
        </label>
        <label className="body-sm">
          Recurrence
          <select className="input" value={recurrence} onChange={e => setRecurrence(e.target.value)}>
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
            <option value="none">One-off</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
        <button type="submit" className="btn btn-sm btn-primary">Add</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
