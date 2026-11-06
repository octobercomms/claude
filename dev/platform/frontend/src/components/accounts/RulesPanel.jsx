import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const MATCH_LABELS = { exact: 'Exact', starts_with: 'Starts with', contains: 'Contains', regex: 'Regex' };

export default function RulesPanel() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const { toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.get('/accounts/rules')
      .then(r => setRules(r.rules || r || []))
      .catch(() => toast('Failed to load rules', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = (id, updates) => {
    api.put(`/accounts/rules/${id}`, updates)
      .then(() => { toast('Rule updated', 'success'); setEditing(null); load(); })
      .catch(e => toast(e.message || 'Save failed', 'error'));
  };

  const remove = (id) => {
    if (!window.confirm('Delete this classification rule?')) return;
    api.delete(`/accounts/rules/${id}`)
      .then(() => { toast('Rule deleted', 'success'); load(); })
      .catch(e => toast(e.message || 'Delete failed', 'error'));
  };

  return (
    <div className="card">
      <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
        <div>
          <h2 className="caption">Classification rules</h2>
          <p className="body-sm text-muted">
            Deterministic rules applied before AI classification. Built automatically when you approve a suggestion, or add them here.
          </p>
        </div>
        <span className="chip chip-accent">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
      </div>

      {loading && <p className="body-sm text-muted">Loading…</p>}

      {!loading && rules.length === 0 && (
        <p className="body-sm text-muted" style={{ padding: 'var(--s4) 0' }}>
          No rules yet. Approve transactions in the reconcile tab to build rules automatically.
        </p>
      )}

      {!loading && rules.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Pattern</th>
                <th>Match type</th>
                <th>Account code</th>
                <th>Tax rate</th>
                <th>Hits</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id}>
                  <td className="body-sm" style={{ fontWeight: 600 }}>{rule.pattern}</td>
                  <td><span className="chip chip-neutral">{MATCH_LABELS[rule.match_type] || rule.match_type}</span></td>
                  <td className="body-sm">{rule.account_code || '—'}</td>
                  <td className="body-sm">{rule.tax_type || '—'}</td>
                  <td className="body-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{rule.hit_count ?? 0}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                      <button className="btn btn-sm" onClick={() => setEditing(editing === rule.id ? null : rule.id)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => remove(rule.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditRow rule={rules.find(r => r.id === editing)} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function EditRow({ rule, onSave, onCancel }) {
  const [accountCode, setAccountCode] = useState(rule?.account_code || '');
  const [taxType, setTaxType] = useState(rule?.tax_type || '');
  const [matchType, setMatchType] = useState(rule?.match_type || 'exact');

  if (!rule) return null;
  return (
    <div className="card" style={{ marginTop: 'var(--s3)', background: 'var(--surface-2)' }}>
      <h3 className="caption" style={{ marginBottom: 'var(--s2)' }}>Edit rule: {rule.pattern}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--s3)' }}>
        <label className="body-sm">
          Match type
          <select className="input" value={matchType} onChange={e => setMatchType(e.target.value)}>
            <option value="exact">Exact</option>
            <option value="starts_with">Starts with</option>
            <option value="contains">Contains</option>
            <option value="regex">Regex</option>
          </select>
        </label>
        <label className="body-sm">
          Account code
          <input className="input" value={accountCode} onChange={e => setAccountCode(e.target.value)} />
        </label>
        <label className="body-sm">
          Tax rate
          <input className="input" value={taxType} onChange={e => setTaxType(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(rule.id, { match_type: matchType, account_code: accountCode, tax_type: taxType })}>Save</button>
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
