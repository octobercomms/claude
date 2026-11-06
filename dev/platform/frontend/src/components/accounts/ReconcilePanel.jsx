import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const STATUS_CHIPS = {
  pending:   'chip chip-warning',
  confirmed: 'chip chip-success',
  written:   'chip chip-accent',
  skipped:   'chip',
  error:     'chip chip-danger',
};

export default function ReconcilePanel() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`/accounts/queue?status=${filter}&offset=${(page - 1) * 25}&limit=25`),
      api.get('/accounts/dashboard'),
    ])
      .then(([q, d]) => {
        setItems(q.items || []);
        setTotal(q.total || 0);
        setStats(d);
      })
      .catch(() => toast('Failed to load reconciliation data', 'error'))
      .finally(() => setLoading(false));
  }, [filter, page, toast]);

  useEffect(() => { load(); }, [load]);

  const sync = () => {
    setSyncing(true);
    api.post('/accounts/sync')
      .then(r => {
        toast(`Synced ${r.inserted || 0} new transactions`, 'success');
        load();
      })
      .catch(e => toast(e.message || 'Sync failed', 'error'))
      .finally(() => setSyncing(false));
  };

  const approve = (id) => {
    api.post(`/accounts/queue/${id}/approve`)
      .then(() => { toast('Approved', 'success'); load(); })
      .catch(e => toast(e.message || 'Approve failed', 'error'));
  };

  const reject = (id) => {
    api.post(`/accounts/queue/${id}/reject`, { reason: 'Manual skip' })
      .then(() => { toast('Skipped', 'success'); load(); })
      .catch(e => toast(e.message || 'Reject failed', 'error'));
  };

  const autoConfirm = () => {
    if (!window.confirm('Auto-confirm all rule-matched items with >= 95% confidence?')) return;
    api.post('/accounts/queue/auto-confirm', { threshold: 0.95 })
      .then(r => { toast(`Auto-confirmed ${r.confirmed || 0} items`, 'success'); load(); })
      .catch(e => toast(e.message || 'Auto-confirm failed', 'error'));
  };

  const writeBack = () => {
    if (!window.confirm('Write all confirmed items back to Xero? This creates real transactions.')) return;
    api.post('/accounts/queue/write-back')
      .then(r => { toast(`Wrote ${r.written || 0} items to Xero`, 'success'); load(); })
      .catch(e => toast(e.message || 'Write-back failed', 'error'));
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const fmtAmount = (amt, cur) => {
    const n = Number(amt);
    const sign = n < 0 ? '' : '+';
    return `${sign}${n.toLocaleString('en-GB', { style: 'currency', currency: cur || 'GBP', minimumFractionDigits: 2 })}`;
  };

  return (
    <>
      {stats && (
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div style={{ display: 'flex', gap: 'var(--s5)', flexWrap: 'wrap' }}>
            <StatBox label="Pending review" value={stats.queue?.pending ?? 0} accent={stats.queue?.pending > 0} />
            <StatBox label="Confirmed" value={stats.queue?.confirmed ?? 0} />
            <StatBox label="Written to Xero" value={stats.queue?.written ?? 0} />
            <StatBox label="Missing invoices" value={stats.invoices?.missing ?? 0} accent={stats.invoices?.missing > 0} />
            <StatBox label="Upcoming deadlines" value={stats.deadlines?.length ?? 0} />
          </div>
        </div>
      )}

      <div className="card">
        <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
          <h2 className="caption">Reconciliation queue</h2>
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            <select
              className="input input-sm"
              value={filter}
              onChange={e => { setFilter(e.target.value); setPage(1); }}
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="written">Written</option>
              <option value="skipped">Skipped</option>
              <option value="all">All</option>
            </select>
            <button className="btn btn-sm" onClick={autoConfirm}>Auto-confirm</button>
            <button className="btn btn-sm" onClick={writeBack}>Write to Xero</button>
            <button className="btn btn-sm btn-primary" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync from Xero'}
            </button>
          </div>
        </div>

        {loading && <p className="body-sm text-muted">Loading…</p>}

        {!loading && items.length === 0 && (
          <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
            {filter === 'pending' ? 'Nothing to review. Run a sync or wait for the weekly job.' : `No ${filter} items.`}
          </p>
        )}

        {!loading && items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Suggested account</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="body-sm">{fmtDate(item.txn_date)}</td>
                    <td className="body-sm" style={{ fontWeight: 600 }}>{item.payee || '(unknown)'}</td>
                    <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(item.amount, item.currency)}
                    </td>
                    <td className="body-sm">{item.suggested_account || '—'}</td>
                    <td>
                      {item.confidence != null && (
                        <span className={`chip ${item.confidence >= 0.8 ? 'chip-success' : item.confidence >= 0.5 ? 'chip-warning' : 'chip-danger'}`}>
                          {Math.round(item.confidence * 100)}%
                        </span>
                      )}
                    </td>
                    <td><span className={STATUS_CHIPS[item.status] || 'chip'}>{item.status}</span></td>
                    <td>
                      {item.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                          <button className="btn btn-sm btn-primary" onClick={() => approve(item.id)}>Approve</button>
                          <button className="btn btn-sm" onClick={() => reject(item.id)}>Skip</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 25 && (
          <div className="row center" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <span className="body-sm text-muted">Page {page} of {Math.ceil(total / 25)}</span>
            <button className="btn btn-sm" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}

function StatBox({ label, value, accent }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-section)', fontWeight: 800, lineHeight: 1.1, color: accent ? 'var(--danger)' : undefined }}>{value}</div>
    </div>
  );
}
