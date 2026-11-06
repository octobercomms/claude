import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const STATUS_CHIP = {
  matched:  'chip chip-success',
  missing:  'chip chip-danger',
  uploaded: 'chip chip-accent',
};

export default function InvoiceMatchPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('missing');
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/accounts/queue?invoice_status=${filter}&limit=50`)
      .then(r => setItems(r.items || []))
      .catch(() => toast('Failed to load invoice data', 'error'))
      .finally(() => setLoading(false));
  }, [filter, toast]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const daysSince = (d) => {
    if (!d) return null;
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return diff;
  };

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
        <div>
          <h2 className="caption">Invoice matching</h2>
          <p className="body-sm text-muted">
            Transactions matched against invoices in Google Drive. Missing invoices are flagged for attention.
          </p>
        </div>
        <select className="input input-sm" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="missing">Missing</option>
          <option value="matched">Matched</option>
          <option value="uploaded">Uploaded to Xero</option>
        </select>
      </div>

      {loading && <p className="body-sm text-muted">Loading…</p>}

      {!loading && items.length === 0 && (
        <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
          No {filter} invoices. {filter === 'missing' ? 'Run a sync and check back, or everything is matched.' : ''}
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
                <th>Invoice status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const days = daysSince(item.txn_date);
                const urgency = days >= 14 ? 'var(--danger)' : days >= 7 ? 'var(--warning)' : undefined;
                return (
                  <tr key={item.id}>
                    <td className="body-sm">{fmtDate(item.txn_date)}</td>
                    <td className="body-sm" style={{ fontWeight: 600 }}>{item.payee || '(unknown)'}</td>
                    <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(item.amount).toLocaleString('en-GB', { style: 'currency', currency: item.currency || 'GBP' })}
                    </td>
                    <td>
                      <span className={STATUS_CHIP[item.invoice_status] || 'chip'}>{item.invoice_status || 'unknown'}</span>
                    </td>
                    <td className="body-sm" style={{ color: urgency, fontWeight: urgency ? 700 : undefined }}>
                      {days != null ? `${days}d` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
