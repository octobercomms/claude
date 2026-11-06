import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';
import StatStrip from '../shells/StatStrip';

// ---------------------------------------------------------------------------
// ReconcilePanel — the main reconciliation queue
// ---------------------------------------------------------------------------

export function ReconcilePanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoConfirming, setAutoConfirming] = useState(false);
  const [writingBack, setWritingBack] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editCode, setEditCode] = useState('');
  const [editTax, setEditTax] = useState('');
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: LIMIT, offset });
      if (search) params.set('search', search);
      const data = await api.get(`/accounts/queue?${params}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setStats(data.stats || null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [status, search, offset, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleSync() {
    roWrite(readOnly, async () => {
      setSyncing(true);
      try {
        const r = await api.post('/accounts/sync');
        toast(`Synced: ${r.queued ?? 0} queued, ${r.ruleMatched ?? 0} rule-matched, ${r.aiClassified ?? 0} AI-classified`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setSyncing(false); }
    });
  }

  async function handleAutoConfirm() {
    roWrite(readOnly, async () => {
      setAutoConfirming(true);
      try {
        const r = await api.post('/accounts/queue/auto-confirm', { threshold: 0.95 });
        toast(`Auto-confirmed ${r.confirmed ?? 0} high-confidence items`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setAutoConfirming(false); }
    });
  }

  async function handleWriteBack() {
    roWrite(readOnly, async () => {
      setWritingBack(true);
      try {
        const r = await api.post('/accounts/queue/write-back');
        toast(`Written back: ${r.written ?? 0} items to Xero`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setWritingBack(false); }
    });
  }

  function startApprove(item) {
    setEditingId(item.id);
    setEditCode(item.suggested_account_code || '');
    setEditTax(item.suggested_tax_rate || '');
  }

  async function confirmApprove(id) {
    roWrite(readOnly, async () => {
      try {
        await api.post(`/accounts/queue/${id}/approve`, {
          accountCode: editCode,
          taxRate: editTax,
        });
        toast('Approved');
        setEditingId(null);
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function handleReject(id) {
    roWrite(readOnly, async () => {
      try {
        await api.post(`/accounts/queue/${id}/reject`);
        toast('Skipped');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function confidenceChip(conf) {
    const pct = Math.round((conf || 0) * 100);
    const cls = pct >= 95 ? 'chip-success' : pct >= 70 ? 'chip-warning' : 'chip-danger';
    return <span className={`chip ${cls}`}>{pct}%</span>;
  }

  function statusChip(s) {
    const map = { pending: 'chip-accent', confirmed: 'chip-success', written: 'chip-success', skipped: '', error: 'chip-danger' };
    return <span className={`chip ${map[s] || ''}`}>{s}</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      {stats && (
        <StatStrip items={[
          { label: 'Pending', value: stats.pending ?? 0, feature: true },
          { label: 'Confirmed', value: stats.confirmed ?? 0 },
          { label: 'Written to Xero', value: stats.written ?? 0 },
          { label: 'Total in queue', value: stats.total ?? 0 },
        ]} />
      )}

      <div className="row between center" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <input
            type="text"
            className="input"
            placeholder="Search payee..."
            value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0); }}
            style={{ width: 220 }}
          />
          <select className="input" value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="written">Written</option>
            <option value="skipped">Skipped</option>
            <option value="error">Error</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <button className="btn" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
          <button className="btn" onClick={handleAutoConfirm} disabled={autoConfirming}>
            {autoConfirming ? 'Confirming...' : 'Auto-confirm'}
          </button>
          <button className="btn btn-primary" onClick={handleWriteBack} disabled={writingBack}>
            {writingBack ? 'Writing...' : 'Write back to Xero'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No items in the queue{status !== 'all' ? ` with status "${status}"` : ''}.</div>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Ccy</th>
                <th>Account code</th>
                <th>Confidence</th>
                <th>Source</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <React.Fragment key={item.id}>
                  <tr>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.line_date?.slice(0, 10) || '—'}</td>
                    <td>{item.payee || item.description || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(item.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td>{item.currency || 'GBP'}</td>
                    <td>
                      <span className="body-sm">{item.suggested_account_code || '—'}</span>
                      {item.suggested_account_name && (
                        <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>{item.suggested_account_name}</div>
                      )}
                    </td>
                    <td>{confidenceChip(item.confidence)}</td>
                    <td><span className="body-sm">{item.match_source || '—'}</span></td>
                    <td>{statusChip(item.status)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {item.status === 'pending' && (
                        <>
                          <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => startApprove(item)}>Approve</button>
                          <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }} onClick={() => handleReject(item.id)}>Skip</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editingId === item.id && (
                    <tr>
                      <td colSpan={9}>
                        <div className="card" style={{ padding: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
                          <label style={{ fontSize: 'var(--fs-body-sm)' }}>
                            Account code
                            <input className="input" value={editCode} onChange={e => setEditCode(e.target.value)} style={{ width: 120, marginLeft: 'var(--s2)' }} />
                          </label>
                          <label style={{ fontSize: 'var(--fs-body-sm)' }}>
                            Tax rate
                            <input className="input" value={editTax} onChange={e => setEditTax(e.target.value)} style={{ width: 160, marginLeft: 'var(--s2)' }} />
                          </label>
                          {item.reasoning && (
                            <span className="text-muted" style={{ fontSize: 'var(--fs-body-sm)', flex: 1 }}>{item.reasoning}</span>
                          )}
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
                            <button className="btn btn-primary" onClick={() => confirmApprove(item.id)}>Confirm</button>
                            <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {total > LIMIT && (
            <div className="row center" style={{ gap: 'var(--s3)', justifyContent: 'center' }}>
              <button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}>Previous</button>
              <span className="body-sm text-muted">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
              <button className="btn btn-ghost" disabled={offset + LIMIT >= total} onClick={() => setOffset(o => o + LIMIT)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RulesPanel — deterministic payee-to-code mapping rules
// ---------------------------------------------------------------------------

export function RulesPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const BLANK = { payee_pattern: '', match_type: 'contains', account_code: '', account_name: '', tax_rate: '', notes: '' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api.get(`/accounts/rules${params}`);
      setRules(data.rules || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [search, toast]);

  useEffect(() => { load(); }, [load]);

  function startEdit(rule) {
    setEditingId(rule?.id || 'new');
    setForm(rule ? {
      payee_pattern: rule.payee_pattern,
      match_type: rule.match_type,
      account_code: rule.account_code,
      account_name: rule.account_name || '',
      tax_rate: rule.tax_rate || '',
      notes: rule.notes || '',
    } : { ...BLANK });
  }

  async function handleSave() {
    roWrite(readOnly, async () => {
      try {
        if (editingId === 'new') {
          await api.post('/accounts/rules', form);
          toast('Rule created');
        } else {
          await api.put(`/accounts/rules/${editingId}`, form);
          toast('Rule updated');
        }
        setEditingId(null);
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this rule?')) return;
    roWrite(readOnly, async () => {
      try {
        await api.delete(`/accounts/rules/${id}`);
        toast('Rule deleted');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <input
          type="text"
          className="input"
          placeholder="Search rules..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <button className="btn btn-primary" onClick={() => startEdit(null)}>Add rule</button>
      </div>

      {editingId && (
        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div className="h4" style={{ marginBottom: 'var(--s3)' }}>{editingId === 'new' ? 'New rule' : 'Edit rule'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
            <label className="body-sm">
              Payee pattern
              <input className="input" value={form.payee_pattern} onChange={e => setForm(f => ({ ...f, payee_pattern: e.target.value }))} />
            </label>
            <label className="body-sm">
              Match type
              <select className="input" value={form.match_type} onChange={e => setForm(f => ({ ...f, match_type: e.target.value }))}>
                <option value="contains">Contains</option>
                <option value="exact">Exact</option>
                <option value="starts_with">Starts with</option>
                <option value="regex">Regex</option>
              </select>
            </label>
            <label className="body-sm">
              Account code
              <input className="input" value={form.account_code} onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))} />
            </label>
            <label className="body-sm">
              Account name
              <input className="input" value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} />
            </label>
            <label className="body-sm">
              Tax rate
              <input className="input" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))} />
            </label>
            <label className="body-sm">
              Notes
              <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : rules.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No rules yet. Rules are created automatically when you approve reconciliation items, or you can add them manually.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Payee pattern</th>
              <th>Match</th>
              <th>Account</th>
              <th>Tax rate</th>
              <th>Confirmed</th>
              <th>Last seen</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => (
              <tr key={rule.id}>
                <td style={{ fontWeight: 500 }}>{rule.payee_pattern}</td>
                <td><span className="chip">{rule.match_type}</span></td>
                <td>
                  {rule.account_code}
                  {rule.account_name && <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>{rule.account_name}</div>}
                </td>
                <td>{rule.tax_rate || '—'}</td>
                <td>{rule.times_confirmed ?? 0}x</td>
                <td style={{ whiteSpace: 'nowrap' }}>{rule.last_seen ? new Date(rule.last_seen).toLocaleDateString('en-GB') : '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => startEdit(rule)}>Edit</button>
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--danger)' }} onClick={() => handleDelete(rule.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InvoicesPanel — invoice matching stats and missing invoices
// ---------------------------------------------------------------------------

export function InvoicesPanel() {
  const { toast } = useToast();
  const [stats, setStats] = useState(null);
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, m] = await Promise.all([
          api.get('/accounts/invoices/stats'),
          api.get('/accounts/invoices/missing'),
        ]);
        setStats(s);
        setMissing(m.invoices || []);
      } catch (e) { toast(e.message, 'error'); }
      finally { setLoading(false); }
    })();
  }, [toast]);

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      {stats && (
        <StatStrip items={[
          { label: 'Missing invoices', value: stats.missing ?? 0, feature: stats.missing > 0 },
          { label: 'Matched', value: stats.matched ?? 0 },
          { label: 'Attached to Xero', value: stats.attached ?? 0 },
        ]} />
      )}

      <div className="h4">Missing invoices</div>
      {missing.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">All invoices accounted for.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Payee / Contact</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Currency</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {missing.map((inv, i) => (
              <tr key={inv.id || i}>
                <td style={{ whiteSpace: 'nowrap' }}>{inv.invoice_date?.slice(0, 10) || '—'}</td>
                <td>{inv.xero_contact || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {Number(inv.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </td>
                <td>{inv.currency || 'GBP'}</td>
                <td className="text-muted">{inv.reference || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeadlinesPanel — UK tax deadline tracker
// ---------------------------------------------------------------------------

export function DeadlinesPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts/deadlines');
      setDeadlines(data.deadlines || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleSeed() {
    roWrite(readOnly, async () => {
      setSeeding(true);
      try {
        const r = await api.post('/accounts/deadlines/seed');
        toast(`Seeded ${r.seeded} deadlines`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setSeeding(false); }
    });
  }

  function startEdit(d) {
    setEditingId(d.id);
    setEditStatus(d.status || 'upcoming');
    setEditNotes(d.notes || '');
  }

  async function handleUpdate(id) {
    roWrite(readOnly, async () => {
      try {
        await api.put(`/accounts/deadlines/${id}`, { status: editStatus, notes: editNotes });
        toast('Deadline updated');
        setEditingId(null);
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function urgencyClass(dueDate) {
    const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days <= 7) return 'chip-danger';
    if (days <= 30) return 'chip-warning';
    return 'chip-success';
  }

  function daysLabel(dueDate) {
    const days = Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    return `${days}d`;
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <div className="h4">Tax deadlines</div>
        <button className="btn" onClick={handleSeed} disabled={seeding}>
          {seeding ? 'Seeding...' : 'Seed UK deadlines'}
        </button>
      </div>

      {deadlines.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No deadlines set. Use "Seed UK deadlines" to populate the standard VAT, CT600 and PAYE dates.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Period</th>
              <th>Due date</th>
              <th>Urgency</th>
              <th>Status</th>
              <th>Notes</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deadlines.map(d => (
              <React.Fragment key={d.id}>
                <tr>
                  <td style={{ fontWeight: 500 }}>{d.tax_type}</td>
                  <td>{d.period_label || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.due_date?.slice(0, 10)}</td>
                  <td><span className={`chip ${urgencyClass(d.due_date)}`}>{daysLabel(d.due_date)}</span></td>
                  <td><span className={`chip ${d.status === 'filed' ? 'chip-success' : d.status === 'overdue' ? 'chip-danger' : ''}`}>{d.status}</span></td>
                  <td className="text-muted" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.notes || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => startEdit(d)}>Edit</button>
                  </td>
                </tr>
                {editingId === d.id && (
                  <tr>
                    <td colSpan={7}>
                      <div className="card" style={{ padding: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
                        <label className="body-sm">
                          Status
                          <select className="input" value={editStatus} onChange={e => setEditStatus(e.target.value)} style={{ marginLeft: 'var(--s2)' }}>
                            <option value="upcoming">Upcoming</option>
                            <option value="in_progress">In progress</option>
                            <option value="filed">Filed</option>
                            <option value="overdue">Overdue</option>
                          </select>
                        </label>
                        <label className="body-sm" style={{ flex: 1 }}>
                          Notes
                          <input className="input" value={editNotes} onChange={e => setEditNotes(e.target.value)} style={{ marginLeft: 'var(--s2)', width: '100%' }} />
                        </label>
                        <button className="btn btn-primary" onClick={() => handleUpdate(d.id)}>Save</button>
                        <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VatPanel — VAT exceptions list
// ---------------------------------------------------------------------------

export function VatPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState(null);
  const [resolution, setResolution] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts/vat/exceptions');
      setExceptions(data.exceptions || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleResolve(id) {
    roWrite(readOnly, async () => {
      try {
        await api.post(`/accounts/vat/exceptions/${id}/resolve`, { resolution });
        toast('Exception resolved');
        setResolvingId(null);
        setResolution('');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">VAT exceptions</div>
      {exceptions.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No VAT exceptions. Exceptions are flagged during reconciliation when a transaction's VAT treatment looks wrong.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Type</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map(ex => (
              <React.Fragment key={ex.id}>
                <tr>
                  <td>{ex.period || '—'}</td>
                  <td>{ex.exception_type || '—'}</td>
                  <td>{ex.description || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {ex.amount != null ? Number(ex.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                  </td>
                  <td>
                    {ex.resolved_at
                      ? <span className="chip chip-success">Resolved</span>
                      : <span className="chip chip-warning">Open</span>
                    }
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!ex.resolved_at && (
                      <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => { setResolvingId(ex.id); setResolution(''); }}>Resolve</button>
                    )}
                  </td>
                </tr>
                {resolvingId === ex.id && (
                  <tr>
                    <td colSpan={6}>
                      <div className="card" style={{ padding: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                        <input
                          className="input"
                          placeholder="Resolution notes..."
                          value={resolution}
                          onChange={e => setResolution(e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button className="btn btn-primary" onClick={() => handleResolve(ex.id)}>Confirm</button>
                        <button className="btn btn-ghost" onClick={() => setResolvingId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DigestsPanel — weekly digest history
// ---------------------------------------------------------------------------

export function DigestsPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [digests, setDigests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts/digests?limit=24');
      setDigests(data.digests || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleBuild() {
    roWrite(readOnly, async () => {
      setBuilding(true);
      try {
        await api.post('/accounts/digests/build');
        toast('Digest built');
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setBuilding(false); }
    });
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <div className="h4">Weekly digests</div>
        <button className="btn btn-primary" onClick={handleBuild} disabled={building}>
          {building ? 'Building...' : 'Build now'}
        </button>
      </div>

      {digests.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No digests yet. The first one is built automatically on Monday mornings, or you can trigger one manually.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {digests.map(d => {
            const summary = typeof d.summary === 'string' ? JSON.parse(d.summary) : d.summary;
            const isExpanded = expanded === d.id;
            return (
              <div key={d.id} className="card" style={{ padding: 'var(--s4)' }}>
                <div className="row between center" style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : d.id)}>
                  <div>
                    <span style={{ fontWeight: 500 }}>{d.period_start} to {d.period_end}</span>
                    {d.sent_at && <span className="chip chip-success" style={{ marginLeft: 'var(--s2)' }}>Sent</span>}
                  </div>
                  <div className="row center" style={{ gap: 'var(--s3)' }}>
                    <span className="body-sm text-muted">{d.items_reconciled ?? 0} reconciled</span>
                    <span className="body-sm text-muted">{d.items_pending ?? 0} pending</span>
                    <span className="body-sm text-muted">{d.invoices_missing ?? 0} missing invoices</span>
                    <span style={{ fontSize: 'var(--fs-body-sm)' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExpanded && summary && (
                  <div style={{ marginTop: 'var(--s3)', fontSize: 'var(--fs-body-sm)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
                      <div>
                        <div className="h5">Reconciliation</div>
                        <div>Confirmed this week: {summary.reconciliation?.confirmedThisWeek ?? 0}</div>
                        <div>Pending: {summary.reconciliation?.pending ?? 0}</div>
                        <div>Written: {summary.reconciliation?.totalWritten ?? 0}</div>
                      </div>
                      <div>
                        <div className="h5">Invoices</div>
                        <div>Missing: {summary.invoices?.missing ?? 0}</div>
                        <div>Matched: {summary.invoices?.matched ?? 0}</div>
                        <div>Attached: {summary.invoices?.attached ?? 0}</div>
                      </div>
                    </div>
                    {summary.deadlines?.length > 0 && (
                      <div style={{ marginTop: 'var(--s3)' }}>
                        <div className="h5">Upcoming deadlines</div>
                        {summary.deadlines.map((dl, i) => (
                          <div key={i} className="text-muted">
                            {dl.type} ({dl.label}): {dl.dueDate?.slice(0, 10)} — {dl.daysUntil}d away — {dl.status}
                          </div>
                        ))}
                      </div>
                    )}
                    {summary.invoices?.missingList?.length > 0 && (
                      <div style={{ marginTop: 'var(--s3)' }}>
                        <div className="h5">Top missing invoices</div>
                        {summary.invoices.missingList.map((m, i) => (
                          <div key={i} className="text-muted">
                            {m.payee}: {m.currency || 'GBP'} {Number(m.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })} on {m.date?.slice(0, 10)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// XeroPanel — OAuth connection management
// ---------------------------------------------------------------------------

export function XeroPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts/xero/status');
      setStatus(data);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('connected') === '1') {
      toast('Xero connected successfully');
    }
    const error = params.get('error');
    if (error) {
      toast(`Xero error: ${error}`, 'error');
    }
  }, [location.search, toast]);

  async function handleConnect() {
    roWrite(readOnly, async () => {
      setConnecting(true);
      try {
        const data = await api.get('/accounts/xero/auth-url');
        if (data.url) window.location.href = data.url;
      } catch (e) { toast(e.message, 'error'); }
      finally { setConnecting(false); }
    });
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect from Xero? This removes stored tokens. You can reconnect at any time.')) return;
    roWrite(readOnly, async () => {
      setDisconnecting(true);
      try {
        await api.post('/accounts/xero/disconnect');
        toast('Disconnected from Xero');
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setDisconnecting(false); }
    });
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Xero connection</div>

      <div className="card" style={{ padding: 'var(--s4)' }}>
        {status?.connected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="row center" style={{ gap: 'var(--s3)' }}>
              <span className="chip chip-success">Connected</span>
              <span style={{ fontWeight: 500 }}>{status.tenantName}</span>
            </div>
            {status.expiresAt && (
              <div className="body-sm text-muted">
                Token expires: {new Date(status.expiresAt).toLocaleString('en-GB')}
                {new Date(status.expiresAt) < new Date() && (
                  <span className="chip chip-danger" style={{ marginLeft: 'var(--s2)' }}>Expired</span>
                )}
              </div>
            )}
            {status.scopes && (
              <div className="body-sm text-muted">Scopes: {status.scopes}</div>
            )}
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
              <button className="btn" onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Redirecting...' : 'Reconnect'}
              </button>
              <button className="btn btn-danger" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="row center" style={{ gap: 'var(--s2)' }}>
              <span className="chip">Not connected</span>
            </div>
            <div className="body-sm text-muted">
              Connect your Xero account to enable automated reconciliation. You will need your Xero client ID and secret configured in Settings first.
            </div>
            <button className="btn btn-primary" onClick={handleConnect} disabled={connecting} style={{ alignSelf: 'flex-start' }}>
              {connecting ? 'Redirecting...' : 'Connect to Xero'}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="h5" style={{ marginBottom: 'var(--s2)' }}>Setup</div>
        <div className="body-sm text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <div>1. Create a Xero app at developer.xero.com and note the client ID and secret.</div>
          <div>2. Set the redirect URI to your platform URL + <code>/api/accounts/xero/callback</code></div>
          <div>3. Add the client ID, secret and redirect URI in Settings under Connections.</div>
          <div>4. Click "Connect to Xero" above to authorise.</div>
        </div>
      </div>
    </div>
  );
}
