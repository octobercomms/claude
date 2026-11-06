import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

export default function DigestsPanel() {
  const [digests, setDigests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/accounts/digests?limit=12')
      .then(r => setDigests(r.digests || []))
      .catch(() => toast('Failed to load digests', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const build = () => {
    setBuilding(true);
    api.post('/accounts/digests/build')
      .then(r => {
        toast('Weekly digest built', 'success');
        load();
      })
      .catch(e => toast(e.message || 'Build failed', 'error'))
      .finally(() => setBuilding(false));
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
        <div>
          <h2 className="caption">Weekly digests</h2>
          <p className="body-sm text-muted">
            Reconciliation summaries built every Monday at 07:30. Covers queue activity, missing invoices and upcoming deadlines.
          </p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={build} disabled={building}>
          {building ? 'Building…' : 'Build now'}
        </button>
      </div>

      {loading && <p className="body-sm text-muted">Loading…</p>}

      {!loading && digests.length === 0 && (
        <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
          No digests yet. Build one manually or wait for the Monday cron.
        </p>
      )}

      {!loading && digests.length > 0 && (
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Period</th>
              <th style={{ textAlign: 'right' }}>Reconciled</th>
              <th style={{ textAlign: 'right' }}>Pending</th>
              <th style={{ textAlign: 'right' }}>Missing invoices</th>
              <th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {digests.map(d => {
              const summary = typeof d.summary === 'string' ? JSON.parse(d.summary) : d.summary;
              return (
                <tr key={d.id}>
                  <td className="body-sm">{fmtDate(d.period_start)} – {fmtDate(d.period_end)}</td>
                  <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {d.items_reconciled ?? summary?.reconciliation?.confirmedThisWeek ?? '—'}
                  </td>
                  <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {d.items_pending ?? summary?.reconciliation?.pending ?? '—'}
                  </td>
                  <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <span className={d.invoices_missing > 0 ? 'text-danger' : ''}>
                      {d.invoices_missing ?? summary?.invoices?.missing ?? '—'}
                    </span>
                  </td>
                  <td className="body-sm">
                    {d.sent_at
                      ? <span className="chip chip-success">Sent {fmtDate(d.sent_at)}</span>
                      : <span className="chip">Not sent</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
