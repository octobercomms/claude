import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

export default function VatPanel() {
  const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const [resolution, setResolution] = useState('');
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/accounts/vat/exceptions')
      .then(r => setExceptions(r.exceptions || []))
      .catch(() => toast('Failed to load VAT exceptions', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const resolve = (id) => {
    if (!resolution.trim()) return;
    api.post(`/accounts/vat/exceptions/${id}/resolve`, { resolution: resolution.trim() })
      .then(() => { toast('Exception resolved', 'success'); setResolving(null); setResolution(''); load(); })
      .catch(e => toast(e.message || 'Resolve failed', 'error'));
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const fmtAmount = (amt, cur) => {
    if (amt == null) return '—';
    return Number(amt).toLocaleString('en-GB', { style: 'currency', currency: cur || 'GBP', minimumFractionDigits: 2 });
  };

  const open = exceptions.filter(e => !e.resolved_at);
  const resolved = exceptions.filter(e => e.resolved_at);

  return (
    <div className="card">
      <div style={{ marginBottom: 'var(--s3)' }}>
        <h2 className="caption">VAT exceptions</h2>
        <p className="body-sm text-muted">
          Transactions flagged during reconciliation with ambiguous or missing tax codes. Resolve each one before preparing the VAT return.
        </p>
      </div>

      {loading && <p className="body-sm text-muted">Loading…</p>}

      {!loading && exceptions.length === 0 && (
        <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
          No VAT exceptions. Exceptions are created when the reconciliation engine cannot determine the correct tax treatment.
        </p>
      )}

      {!loading && open.length > 0 && (
        <>
          <div className="row between center" style={{ marginBottom: 'var(--s2)' }}>
            <span className="body-sm" style={{ fontWeight: 700 }}>Open ({open.length})</span>
          </div>
          <table className="table" style={{ width: '100%', marginBottom: 'var(--s4)' }}>
            <thead>
              <tr>
                <th>Period</th>
                <th>Payee</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Issue</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map(ex => (
                <React.Fragment key={ex.id}>
                  <tr>
                    <td className="body-sm">{ex.period || '—'}</td>
                    <td className="body-sm" style={{ fontWeight: 600 }}>{ex.payee || '—'}</td>
                    <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtAmount(ex.amount, ex.currency)}
                    </td>
                    <td className="body-sm">{ex.issue || ex.exception_type || '—'}</td>
                    <td>
                      {resolving === ex.id ? (
                        <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                          <input
                            className="input input-sm"
                            placeholder="Resolution…"
                            value={resolution}
                            onChange={e => setResolution(e.target.value)}
                            style={{ minWidth: 180 }}
                          />
                          <button className="btn btn-sm btn-primary" onClick={() => resolve(ex.id)}>Save</button>
                          <button className="btn btn-sm" onClick={() => { setResolving(null); setResolution(''); }}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm" onClick={() => setResolving(ex.id)}>Resolve</button>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!loading && resolved.length > 0 && (
        <>
          <div className="row between center" style={{ marginBottom: 'var(--s2)' }}>
            <span className="body-sm text-muted" style={{ fontWeight: 700 }}>Resolved ({resolved.length})</span>
          </div>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Period</th>
                <th>Payee</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Resolution</th>
                <th>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map(ex => (
                <tr key={ex.id}>
                  <td className="body-sm">{ex.period || '—'}</td>
                  <td className="body-sm">{ex.payee || '—'}</td>
                  <td className="body-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtAmount(ex.amount, ex.currency)}
                  </td>
                  <td className="body-sm">{ex.resolution}</td>
                  <td className="body-sm">{fmtDate(ex.resolved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
