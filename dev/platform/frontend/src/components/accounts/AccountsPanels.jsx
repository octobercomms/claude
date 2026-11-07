import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';
import StatStrip from '../shells/StatStrip';

function checkVatWarnings(item, accountCode, taxRate) {
  const warnings = [];
  const amount = Math.abs(parseFloat(item.amount) || 0);
  const payee = (item.payee || '').toLowerCase();
  const currency = (item.currency || 'GBP').toUpperCase();

  if (currency !== 'GBP' && taxRate && !['RRINPUT', 'NONE', 'ZERORATEDINPUT'].includes(taxRate)) {
    warnings.push('Non-GBP transaction with domestic VAT rate; should be reverse charge (RRINPUT) or NONE');
  }
  if (taxRate === 'RRINPUT' && currency === 'GBP') {
    warnings.push('Reverse charge on a GBP transaction; reverse charge is for overseas suppliers');
  }
  if (amount > 250 && taxRate === 'INPUT2' && !accountCode) {
    warnings.push('High-value purchase with standard VAT but no account code');
  }
  const rcPayees = ['meta', 'facebook', 'google', 'dataforseo', 'dropbox', 'slack', 'adobe', 'zoom', 'github', 'anthropic', 'openai', 'amazon web', 'aws', 'notion', 'canva', 'figma', 'vercel', 'linkedin', 'hetzner', 'brevo'];
  if (rcPayees.some(p => payee.includes(p)) && taxRate && taxRate !== 'RRINPUT' && taxRate !== 'NONE') {
    warnings.push(`${item.payee} is typically reverse charge (RRINPUT); currently ${taxRate}`);
  }
  if (amount > 1000 && taxRate === 'NONE' && !['2201', '2202', '2210', '7020'].includes(accountCode)) {
    warnings.push('High-value with no VAT; confirm this is correct');
  }
  return warnings;
}

function useXeroRefData() {
  const [accounts, setAccounts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  useEffect(() => {
    api.get('/accounts/xero/chart-of-accounts').then(d => setAccounts(d.accounts || [])).catch(() => {});
    api.get('/accounts/xero/tax-rates').then(d => setTaxRates(d.rates || [])).catch(() => {});
  }, []);
  return { accounts, taxRates };
}

function AccountCodeSelect({ value, onChange, accounts }) {
  const [manual, setManual] = useState(false);
  if (manual || !accounts.length) {
    return (
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
        <input className="input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} />
        {accounts.length > 0 && <button type="button" className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => setManual(false)}>List</button>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
      <select className="input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }}>
        <option value="">Select account...</option>
        {accounts.filter(a => a.status === 'ACTIVE').map(a => (
          <option key={a.code} value={a.code}>{a.code} - {a.name}</option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => setManual(true)}>Type</button>
    </div>
  );
}

function TaxRateSelect({ value, onChange, taxRates }) {
  const [manual, setManual] = useState(false);
  if (manual || !taxRates.length) {
    return (
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
        <input className="input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} />
        {taxRates.length > 0 && <button type="button" className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => setManual(false)}>List</button>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
      <select className="input" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }}>
        <option value="">Select tax rate...</option>
        {taxRates.filter(r => r.status === 'ACTIVE').map(r => (
          <option key={r.taxType} value={r.taxType}>{r.taxType} - {r.name} ({r.effectiveRate}%)</option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => setManual(true)}>Type</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardPanel — accounts overview
// ---------------------------------------------------------------------------

export function DashboardPanel() {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get('/accounts/dashboard');
        setData(d);
      } catch (e) { toast(e.message, 'error'); }
      finally { setLoading(false); }
    })();
  }, [toast]);

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;
  if (!data) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Unable to load dashboard.</div>;

  const q = data.queue || {};
  const inv = data.invoices || {};
  const deadlines = data.deadlines || [];
  const urgentDeadlines = deadlines.filter(d => {
    const days = Math.ceil((new Date(d.due_date) - new Date()) / (1000 * 60 * 60 * 24));
    return days <= 30 && d.status !== 'filed' && d.status !== 'paid';
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Accounts overview</div>

      <StatStrip items={[
        { label: 'Pending review', value: q.pending || 0 },
        { label: 'Confirmed', value: q.confirmed || 0 },
        { label: 'Written to Xero', value: q.written || 0 },
        { label: 'Errors', value: q.error || 0, color: (q.error || 0) > 0 ? 'var(--danger)' : undefined },
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s4)' }}>
        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div className="h5" style={{ marginBottom: 'var(--s3)' }}>Reconciliation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            <div className="row between">
              <span className="text-muted">Total in queue</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{q.total || 0}</span>
            </div>
            <div className="row between">
              <span className="text-muted">Pending</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: (q.pending || 0) > 0 ? 'var(--warning)' : undefined }}>{q.pending || 0}</span>
            </div>
            <div className="row between">
              <span className="text-muted">Skipped</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{q.skipped || 0}</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div className="h5" style={{ marginBottom: 'var(--s3)' }}>Invoices</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            <div className="row between">
              <span className="text-muted">Matched</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inv.matched || 0}</span>
            </div>
            <div className="row between">
              <span className="text-muted">Attached to Xero</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inv.attached || 0}</span>
            </div>
            <div className="row between">
              <span className="text-muted">Missing</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: (inv.missing || 0) > 0 ? 'var(--danger)' : undefined }}>{inv.missing || 0}</span>
            </div>
          </div>
        </div>

        {urgentDeadlines.length > 0 && (
          <div className="card" style={{ padding: 'var(--s4)' }}>
            <div className="h5" style={{ marginBottom: 'var(--s3)' }}>Upcoming deadlines</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              {urgentDeadlines.slice(0, 5).map((d, i) => {
                const days = Math.ceil((new Date(d.due_date) - new Date()) / (1000 * 60 * 60 * 24));
                const urgency = days <= 7 ? 'var(--danger)' : days <= 14 ? 'var(--warning)' : undefined;
                return (
                  <div key={i} className="row between">
                    <span className="text-muted">{d.tax_type} {d.period_label}</span>
                    <span style={{ fontWeight: 600, color: urgency }}>{days}d</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReconcilePanel — the main reconciliation queue
// ---------------------------------------------------------------------------

export function ReconcilePanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const { accounts: xeroAccounts, taxRates: xeroTaxRates } = useXeroRefData();
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
  const [selected, setSelected] = useState(new Set());
  const [batchWorking, setBatchWorking] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [vatWarnings, setVatWarnings] = useState({});
  const [xeroConnected, setXeroConnected] = useState(null);
  const tableRef = useRef(null);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queueData, xeroStatus] = await Promise.all([
        api.get(`/accounts/queue?${new URLSearchParams({ status, limit: LIMIT, offset, ...(search ? { search } : {}) })}`),
        api.get('/accounts/xero/status'),
      ]);
      setItems(queueData.items || []);
      setTotal(queueData.total || 0);
      setStats(queueData.stats || null);
      setXeroConnected(!!xeroStatus.connected);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [status, search, offset, toast]);

  useEffect(() => { load(); }, [load]);

  // Reset focused index when items change
  useEffect(() => { setFocusedIdx(0); }, [items]);

  // Keyboard navigation for the reconcile queue
  useEffect(() => {
    if (status !== 'pending') return;
    function handleKeyDown(e) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

      const pendingItems = items.filter(i => i.status === 'pending');
      if (!pendingItems.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIdx(prev => Math.min(prev + 1, pendingItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIdx(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          const item = pendingItems[focusedIdx];
          if (item && editingId !== item.id) {
            startApprove(item);
          } else if (item && editingId === item.id) {
            confirmApprove(item.id);
          }
          break;
        }
        case 's': {
          e.preventDefault();
          const item = pendingItems[focusedIdx];
          if (item) handleReject(item.id);
          break;
        }
        case 'e': {
          e.preventDefault();
          const item = pendingItems[focusedIdx];
          if (item) startApprove(item);
          break;
        }
        case 'Escape':
          e.preventDefault();
          setEditingId(null);
          setVatWarnings({});
          break;
        default:
          break;
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [status, items, focusedIdx, editingId, editCode, editTax]);

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
    setEditCode(item.suggested_code || '');
    setEditTax(item.suggested_rate || '');
  }

  async function confirmApprove(id, force) {
    const item = items.find(i => i.id === id);
    if (item && !force) {
      const warnings = checkVatWarnings(item, editCode, editTax);
      if (warnings.length) {
        setVatWarnings(prev => ({ ...prev, [id]: warnings }));
        return;
      }
    }
    roWrite(readOnly, async () => {
      try {
        await api.post(`/accounts/queue/${id}/approve`, {
          accountCode: editCode,
          taxRate: editTax,
        });
        toast('Approved');
        setEditingId(null);
        setVatWarnings(prev => { const n = { ...prev }; delete n[id]; return n; });
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

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const pendingItems = items.filter(i => i.status === 'pending');
    if (selected.size === pendingItems.length && pendingItems.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingItems.map(i => i.id)));
    }
  }

  async function handleBatchApprove() {
    if (!selected.size) return;
    roWrite(readOnly, async () => {
      setBatchWorking(true);
      try {
        const r = await api.post('/accounts/queue/batch-approve', { ids: [...selected] });
        toast(`Batch approved ${r.confirmed ?? 0} items${r.errors?.length ? `, ${r.errors.length} errors` : ''}`);
        setSelected(new Set());
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setBatchWorking(false); }
    });
  }

  async function handleBatchSkip() {
    if (!selected.size) return;
    roWrite(readOnly, async () => {
      setBatchWorking(true);
      try {
        const r = await api.post('/accounts/queue/batch-skip', { ids: [...selected] });
        toast(`Batch skipped ${r.skipped ?? 0} items`);
        setSelected(new Set());
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setBatchWorking(false); }
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
          <a
            href={`/api/accounts/queue/export.csv?status=${status}`}
            className="btn btn-ghost"
            download
            style={{ textDecoration: 'none' }}
          >Export CSV</a>
          {selected.size > 0 && (
            <>
              <span className="chip chip-accent" style={{ fontVariantNumeric: 'tabular-nums' }}>{selected.size} selected</span>
              <button className="btn" onClick={handleBatchApprove} disabled={batchWorking}>
                {batchWorking ? 'Working...' : `Approve ${selected.size}`}
              </button>
              <button className="btn btn-ghost" onClick={handleBatchSkip} disabled={batchWorking}>
                Skip {selected.size}
              </button>
              <button className="btn btn-ghost" style={{ color: 'var(--text-muted)' }} onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {status === 'pending' && items.length > 0 && (
        <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)', display: 'flex', gap: 'var(--s3)' }}>
          <span><kbd style={{ padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 3, fontSize: '0.85em' }}>&uarr;&darr;</kbd> Navigate</span>
          <span><kbd style={{ padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 3, fontSize: '0.85em' }}>Enter</kbd> Approve</span>
          <span><kbd style={{ padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 3, fontSize: '0.85em' }}>S</kbd> Skip</span>
          <span><kbd style={{ padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 3, fontSize: '0.85em' }}>E</kbd> Edit</span>
          <span><kbd style={{ padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 3, fontSize: '0.85em' }}>Esc</kbd> Cancel</span>
        </div>
      )}

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          {xeroConnected === false ? (
            <div className="text-muted">Xero is not connected. Go to the Xero tab to connect, then sync bank transactions.</div>
          ) : (
            <div className="text-muted">No items in the queue{status !== 'all' ? ` with status "${status}"` : ''}.</div>
          )}
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                {status === 'pending' && (
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === items.filter(i => i.status === 'pending').length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
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
              {items.map((item, idx) => {
                const pendingItems = items.filter(i => i.status === 'pending');
                const pendingIdx = pendingItems.indexOf(item);
                const isFocused = status === 'pending' && pendingIdx === focusedIdx;
                return (
                <React.Fragment key={item.id}>
                  <tr
                    style={isFocused ? { outline: '2px solid var(--blue-500, #3b82f6)', outlineOffset: '-2px', background: 'var(--surface-hover, rgba(59,130,246,0.06))' } : undefined}
                    onClick={() => { if (pendingIdx >= 0) setFocusedIdx(pendingIdx); }}
                  >
                    {status === 'pending' && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                        />
                      </td>
                    )}
                    <td style={{ whiteSpace: 'nowrap' }}>{item.line_date?.slice(0, 10) || '—'}</td>
                    <td>{item.payee || item.description || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(item.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td>{item.currency || 'GBP'}</td>
                    <td>
                      <span className="body-sm">{item.suggested_code || '—'}</span>
                      {item.suggested_name && (
                        <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>{item.suggested_name}</div>
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
                      <td colSpan={status === 'pending' ? 10 : 9}>
                        <div className="card" style={{ padding: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
                          <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <label style={{ fontSize: 'var(--fs-body-sm)', minWidth: 200, flex: 1 }}>
                              Account code
                              <AccountCodeSelect value={editCode} onChange={v => { setEditCode(v); setVatWarnings(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }} accounts={xeroAccounts} />
                            </label>
                            <label style={{ fontSize: 'var(--fs-body-sm)', minWidth: 200, flex: 1 }}>
                              Tax rate
                              <TaxRateSelect value={editTax} onChange={v => { setEditTax(v); setVatWarnings(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }} taxRates={xeroTaxRates} />
                            </label>
                            <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                              {vatWarnings[item.id] ? (
                                <button className="btn" style={{ background: 'var(--amber-600, #d97706)', color: '#fff' }} onClick={() => confirmApprove(item.id, true)}>Confirm anyway</button>
                              ) : (
                                <button className="btn btn-primary" onClick={() => confirmApprove(item.id)}>Confirm</button>
                              )}
                              <button className="btn btn-ghost" onClick={() => { setEditingId(null); setVatWarnings(prev => { const n = { ...prev }; delete n[item.id]; return n; }); }}>Cancel</button>
                            </div>
                          </div>
                          {vatWarnings[item.id] && (
                            <div style={{ background: 'var(--amber-50, #fffbeb)', border: '1px solid var(--amber-300, #fcd34d)', borderRadius: 'var(--radius, 6px)', padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-body-sm)' }}>
                              <div style={{ fontWeight: 600, color: 'var(--amber-800, #92400e)', marginBottom: 'var(--s1)' }}>VAT warning</div>
                              <ul style={{ margin: 0, paddingLeft: 'var(--s4)', color: 'var(--amber-700, #b45309)' }}>
                                {vatWarnings[item.id].map((w, i) => <li key={i}>{w}</li>)}
                              </ul>
                            </div>
                          )}
                          {item.ai_reasoning && (
                            <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>{item.ai_reasoning}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );})}
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
  const { accounts: xeroAccounts, taxRates: xeroTaxRates } = useXeroRefData();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [seeding, setSeeding] = useState(false);
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

  async function handleSeedRules() {
    roWrite(readOnly, async () => {
      setSeeding(true);
      try {
        const r = await api.post('/accounts/rules/seed');
        toast(`Seeded ${r.seeded} common rules`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setSeeding(false); }
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
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <button className="btn" onClick={handleSeedRules} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed common rules'}
          </button>
          <button className="btn btn-primary" onClick={() => startEdit(null)}>Add rule</button>
        </div>
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
              <AccountCodeSelect value={form.account_code} onChange={v => setForm(f => ({ ...f, account_code: v }))} accounts={xeroAccounts} />
            </label>
            <label className="body-sm">
              Account name
              <input className="input" value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} />
            </label>
            <label className="body-sm">
              Tax rate
              <TaxRateSelect value={form.tax_rate} onChange={v => setForm(f => ({ ...f, tax_rate: v }))} taxRates={xeroTaxRates} />
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
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState(null);
  const [missing, setMissing] = useState([]);
  const [driveStatus, setDriveStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, ds] = await Promise.all([
        api.get('/accounts/invoices/stats'),
        api.get('/accounts/invoices/missing'),
        api.get('/accounts/drive/status').catch(() => null),
      ]);
      setStats(s);
      setMissing(m.invoices || []);
      setDriveStatus(ds);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleScan() {
    roWrite(readOnly, async () => {
      setScanning(true);
      try {
        const r = await api.post('/accounts/drive/scan');
        if (r.error) {
          toast(r.error, 'warning');
        } else {
          toast(`Scanned ${r.scanned} files: ${r.matched} matched, ${r.missing} missing`);
        }
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setScanning(false); }
    });
  }

  async function handleAttach(matchId) {
    roWrite(readOnly, async () => {
      try {
        await api.post(`/accounts/drive/attach/${matchId}`);
        toast('Invoice attached to Xero');
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

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

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="row between center" style={{ marginBottom: 'var(--s2)' }}>
          <div className="h5">Google Drive invoice scanner</div>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning || !driveStatus?.configured}>
            {scanning ? 'Scanning...' : 'Scan Drive folder'}
          </button>
        </div>
        {driveStatus?.configured ? (
          <div className="body-sm text-muted">
            Folder: {driveStatus.folderName || driveStatus.folderId}
            {driveStatus.accessible === false && (
              <span className="chip chip-danger" style={{ marginLeft: 'var(--s2)' }}>Not accessible</span>
            )}
            {driveStatus.accessible && (
              <span className="chip chip-success" style={{ marginLeft: 'var(--s2)' }}>Connected</span>
            )}
          </div>
        ) : (
          <div className="body-sm text-muted">
            Set <code>ACCOUNTS_DRIVE_FOLDER_ID</code> in Settings to point at your receipts/invoices folder in Google Drive.
            {driveStatus?.serviceAccountEmail && (
              <> Share the folder with <code>{driveStatus.serviceAccountEmail}</code></>
            )}
          </div>
        )}
      </div>

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
              <th>Drive match</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
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
                <td className="text-muted">{inv.drive_file_name || '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {inv.drive_file_id && inv.status === 'matched' && (
                    <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => handleAttach(inv.id)}>
                      Attach to Xero
                    </button>
                  )}
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
// DeadlinesPanel — UK tax deadline tracker
// ---------------------------------------------------------------------------

export function DeadlinesPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedYear, setSeedYear] = useState(new Date().getFullYear());
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
        const r = await api.post('/accounts/deadlines/seed', { year: seedYear });
        if (r.inserted > 0) {
          toast(`Added ${r.inserted} deadlines for ${seedYear}${r.updated ? `, ${r.updated} updated` : ''}`);
        } else {
          toast(`All ${r.total} deadlines for ${seedYear} already up to date`);
        }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          <select className="input" value={seedYear} onChange={e => setSeedYear(Number(e.target.value))} style={{ width: 90 }}>
            {[...Array(5)].map((_, i) => {
              const y = new Date().getFullYear() - 1 + i;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
          <button className="btn" onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed deadlines'}
          </button>
        </div>
      </div>

      {deadlines.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No deadlines set. Use "Seed deadlines" to populate VAT, CT600, PAYE and pension contribution dates for a given year.</div>
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
                            <option value="preparing">Preparing</option>
                            <option value="ready">Ready to file</option>
                            <option value="filed">Filed</option>
                            <option value="paid">Paid</option>
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
// VatPanel — VAT pack preparation + exceptions
// ---------------------------------------------------------------------------

export function VatPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState(null);
  const [resolution, setResolution] = useState('');
  const [quarters, setQuarters] = useState(null);
  const [packResult, setPackResult] = useState(null);
  const [buildingPack, setBuildingPack] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [excData, qData] = await Promise.all([
        api.get('/accounts/vat/exceptions'),
        api.get('/accounts/vat/quarters'),
      ]);
      setExceptions(excData.exceptions || []);
      setQuarters(qData);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleBuildPack(year, quarter) {
    roWrite(readOnly, async () => {
      setBuildingPack(true);
      try {
        const r = await api.get(`/accounts/vat/pack/${year}/${quarter}`);
        setPackResult(r);
        toast(`VAT pack built: ${r.summary?.totalTransactions ?? 0} transactions, ${r.newExceptions ?? 0} new exceptions`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setBuildingPack(false); }
    });
  }

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
      {quarters && (
        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
            <div className="h4">VAT quarter-end pack</div>
            <div className="row center" style={{ gap: 'var(--s2)' }}>
              <button className="btn" onClick={() => handleBuildPack(quarters.previous.year, quarters.previous.q)} disabled={buildingPack}>
                {buildingPack ? 'Building...' : `Build ${quarters.previous.label} ${quarters.previous.year}`}
              </button>
              <button className="btn btn-primary" onClick={() => handleBuildPack(quarters.current.year, quarters.current.q)} disabled={buildingPack}>
                {buildingPack ? 'Building...' : `Build ${quarters.current.label} ${quarters.current.year}`}
              </button>
            </div>
          </div>
          <div className="body-sm text-muted" style={{ marginBottom: 'var(--s3)' }}>
            Scans all confirmed transactions for the quarter, groups them by VAT rate, flags exceptions, and checks for missing invoices.
          </div>
          {packResult?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s3)' }}>
              <div className="card" style={{ padding: 'var(--s3)', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600 }}>{packResult.summary.totalTransactions}</div>
                <div className="body-sm text-muted">Transactions</div>
              </div>
              <div className="card" style={{ padding: 'var(--s3)', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600 }}>
                  {packResult.summary.netPayable != null
                    ? `£${Number(packResult.summary.netPayable).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
                    : '—'}
                </div>
                <div className="body-sm text-muted">Net VAT payable</div>
              </div>
              <div className="card" style={{ padding: 'var(--s3)', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600, color: packResult.summary.unresolvedExceptions > 0 ? 'var(--danger)' : undefined }}>
                  {packResult.summary.unresolvedExceptions}
                </div>
                <div className="body-sm text-muted">Open exceptions</div>
              </div>
              <div className="card" style={{ padding: 'var(--s3)', textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600, color: packResult.summary.missingInvoices > 0 ? 'var(--warning)' : undefined }}>
                  {packResult.summary.missingInvoices}
                </div>
                <div className="body-sm text-muted">Missing invoices</div>
              </div>
            </div>
          )}
          {packResult?.summary?.byRate?.length > 0 && (
            <div style={{ marginTop: 'var(--s3)' }}>
              <div className="h5" style={{ marginBottom: 'var(--s2)' }}>Breakdown by VAT rate</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Rate</th>
                    <th style={{ textAlign: 'right' }}>Count</th>
                    <th style={{ textAlign: 'right' }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {packResult.summary.byRate.map(r => (
                    <tr key={r.rate}>
                      <td style={{ fontWeight: 500 }}>{r.rate}</td>
                      <td style={{ textAlign: 'right' }}>{r.count}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        £{Number(r.net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
              <th>Reason</th>
              <th>Payee</th>
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
                  <td>{ex.flag_reason || '—'}</td>
                  <td>{ex.payee || '—'}</td>
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

  const [sending, setSending] = useState(null);

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

  async function handleBuildAndSend() {
    roWrite(readOnly, async () => {
      setBuilding(true);
      try {
        const r = await api.post('/accounts/digests/build-and-send');
        if (r.emailed) {
          toast('Digest built and emailed');
        } else {
          toast(`Digest built, but email failed: ${r.emailError || 'unknown error'}`, 'warning');
        }
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setBuilding(false); }
    });
  }

  async function handleSendEmail(digestId) {
    roWrite(readOnly, async () => {
      setSending(digestId);
      try {
        const r = await api.post(`/accounts/digests/${digestId}/send`);
        if (r.alreadySent) {
          toast('Already sent', 'warning');
        } else {
          toast(`Digest emailed to ${r.to}`);
        }
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setSending(null); }
    });
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <div className="h4">Weekly digests</div>
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <button className="btn" onClick={handleBuild} disabled={building}>
            {building ? 'Building...' : 'Build only'}
          </button>
          <button className="btn btn-primary" onClick={handleBuildAndSend} disabled={building}>
            {building ? 'Building...' : 'Build and send'}
          </button>
        </div>
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
                    {!d.sent_at && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 'var(--fs-body-sm)' }}
                        onClick={e => { e.stopPropagation(); handleSendEmail(d.id); }}
                        disabled={sending === d.id}
                      >
                        {sending === d.id ? 'Sending...' : 'Send email'}
                      </button>
                    )}
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
// DrivePanel — Google Drive invoice/receipt scanner
// ---------------------------------------------------------------------------

export function DrivePanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [folderUrl, setFolderUrl] = useState('');
  const [folderConfig, setFolderConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [driveStatus, folder] = await Promise.all([
        api.get('/accounts/drive/status'),
        api.get('/accounts/drive-folder'),
      ]);
      setStatus(driveStatus);
      setFolderConfig(folder);
      if (folder.folderId) setFolderUrl(folder.folderId);
      if (driveStatus.accessible) {
        const fileData = await api.get('/accounts/drive/files');
        setFiles(fileData.files || []);
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveFolder() {
    if (!folderUrl.trim()) return;
    setSaving(true);
    try {
      const result = await api.put('/accounts/drive-folder', { url: folderUrl.trim() });
      toast('Drive folder saved', 'success');
      setFolderUrl(result.folderId || folderUrl);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  function handleCopyEmail() {
    const email = folderConfig?.serviceAccountEmail || status?.serviceAccountEmail;
    if (email) {
      navigator.clipboard.writeText(email).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  async function handleScan() {
    roWrite(readOnly, async () => {
      setScanning(true);
      try {
        const result = await api.post('/accounts/drive/scan');
        setScanResult(result);
        if (result.error) {
          toast(result.error, 'warning');
        } else {
          toast(`Scanned ${result.scanned} files: ${result.matched} matched, ${result.missing} missing`);
        }
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setScanning(false); }
    });
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  const serviceEmail = folderConfig?.serviceAccountEmail || status?.serviceAccountEmail;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Google Drive invoice scanner</div>

      {!serviceEmail ? (
        <div className="card" style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          <div className="h5">Google service account required</div>
          <div className="body-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            <div>
              The Drive scanner needs a Google service account key before it can access any folder.
              This is the same service account used for GA4, Search Console and Merchant Center on the Integrations page.
            </div>
            <div>
              Paste <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> in <strong>Settings &gt; Integrations</strong>, then return here.
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          <div className="h5">Invoice folder</div>
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
            <input
              type="text"
              className="input"
              placeholder="Paste Google Drive folder URL or folder ID"
              value={folderUrl}
              onChange={e => setFolderUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveFolder(); }}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleSaveFolder} disabled={saving || !folderUrl.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <div className="body-sm text-muted">
            Paste the full URL from your browser, e.g. https://drive.google.com/drive/folders/1abc...
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
            <div className="body-sm text-muted">
              Share the folder with: <code>{serviceEmail}</code>
            </div>
            <button className="btn btn-sm" onClick={handleCopyEmail} style={{ whiteSpace: 'nowrap' }}>
              {copied ? 'Copied' : 'Copy email'}
            </button>
          </div>
        </div>
      )}

      {serviceEmail && status?.configured && (
        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="row center" style={{ gap: 'var(--s3)' }}>
              {status.accessible
                ? <span className="chip chip-success">Connected</span>
                : <span className="chip chip-danger">Not accessible</span>
              }
              {status.folderName && <span style={{ fontWeight: 500 }}>{status.folderName}</span>}
            </div>
            {!status.accessible && status.error && (
              <div className="body-sm" style={{ color: 'var(--danger)' }}>{status.error}</div>
            )}
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
              <button className="btn btn-primary" onClick={handleScan} disabled={scanning || !status.accessible}>
                {scanning ? 'Scanning...' : 'Scan and match'}
              </button>
            </div>
          </div>
        </div>
      )}

      {serviceEmail && scanResult && !scanResult.error && (
        <StatStrip items={[
          { label: 'Scanned', value: scanResult.scanned },
          { label: 'Matched', value: scanResult.matched },
          { label: 'Missing', value: scanResult.missing },
        ]} />
      )}

      {serviceEmail && files.length > 0 && (
        <>
          <div className="h5">{files.length} invoice files in folder</div>
          <table className="table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {files.slice(0, 50).map(f => (
                <tr key={f.id}>
                  <td>
                    {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a> : f.name}
                  </td>
                  <td className="body-sm text-muted">{f.mimeType?.split('/').pop() || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {f.size != null ? `${Math.round(f.size / 1024)} KB` : '—'}
                  </td>
                  <td className="body-sm text-muted">
                    {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {files.length > 50 && (
            <div className="body-sm text-muted">Showing first 50 of {files.length} files</div>
          )}
        </>
      )}

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="h5" style={{ marginBottom: 'var(--s2)' }}>Setup</div>
        <div className="body-sm text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          {!serviceEmail ? (
            <>
              <div>1. Add <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> in Settings &gt; Integrations (the same service account used for GA4, Search Console and Merchant Center).</div>
              <div>2. Return here. The remaining steps appear once the key is configured.</div>
            </>
          ) : (
            <>
              <div>1. Create a Google Drive folder for invoices and receipts.</div>
              <div>2. Copy the service account email shown above and share the folder with it as <strong>Editor</strong>.</div>
              <div>3. Paste the folder URL into the input above and click Save.</div>
              <div>4. Click "Scan and match" to find invoices that match reconcile queue items.</div>
            </>
          )}
        </div>
      </div>
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
          <div>1. Create a Xero app at developer.xero.com (web app type) and note the client ID and secret.</div>
          <div>2. Set the redirect URI to your platform URL + <code>/api/accounts/xero/callback</code></div>
          <div>3. Scroll down and paste the client ID, secret and redirect URI into the fields below, then save.</div>
          <div>4. Click "Connect to Xero" above to authorise.</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReportsPanel — P&L and Trial Balance from Xero
// ---------------------------------------------------------------------------

function ukFinancialYearStart() {
  const now = new Date();
  const y = now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6) ? now.getFullYear() - 1 : now.getFullYear();
  return `${y}-04-06`;
}

function XeroReportTable({ report }) {
  if (!report?.Reports?.length) return <div className="text-muted">No report data returned.</div>;
  const rep = report.Reports[0];
  if (!rep?.Rows?.length) return <div className="text-muted">Report has no rows.</div>;

  return (
    <div>
      {rep.ReportTitles && (
        <div className="body-sm text-muted" style={{ marginBottom: 'var(--s3)' }}>
          {rep.ReportTitles.join(' | ')}
        </div>
      )}
      <table className="table">
        <tbody>
          {rep.Rows.map((row, ri) => {
            if (row.RowType === 'Header') {
              return (
                <tr key={ri}>
                  {(row.Cells || []).map((cell, ci) => (
                    <th key={ci} style={ci > 0 ? { textAlign: 'right' } : {}}>{cell.Value || ''}</th>
                  ))}
                </tr>
              );
            }
            if (row.RowType === 'Section') {
              return (
                <React.Fragment key={ri}>
                  {row.Title && (
                    <tr>
                      <td colSpan={10} style={{ fontWeight: 600, paddingTop: 'var(--s3)', borderBottom: '1px solid var(--border)' }}>{row.Title}</td>
                    </tr>
                  )}
                  {(row.Rows || []).map((subRow, si) => {
                    const isSummary = subRow.RowType === 'SummaryRow';
                    return (
                      <tr key={`${ri}-${si}`} style={isSummary ? { fontWeight: 600, borderTop: '2px solid var(--border)' } : {}}>
                        {(subRow.Cells || []).map((cell, ci) => (
                          <td key={ci} style={{
                            ...(ci > 0 ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : {}),
                            ...(isSummary ? { fontWeight: 600 } : {}),
                          }}>
                            {cell.Value || ''}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            }
            if (row.RowType === 'SummaryRow') {
              return (
                <tr key={ri} style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  {(row.Cells || []).map((cell, ci) => (
                    <td key={ci} style={{
                      ...(ci > 0 ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : {}),
                      fontWeight: 700,
                    }}>
                      {cell.Value || ''}
                    </td>
                  ))}
                </tr>
              );
            }
            return null;
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsPanel() {
  const { toast } = useToast();
  const today = new Date().toISOString().split('T')[0];
  const [reportType, setReportType] = useState('pnl');
  const [fromDate, setFromDate] = useState(ukFinancialYearStart());
  const [toDate, setToDate] = useState(today);
  const [balanceDate, setBalanceDate] = useState(today);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleFetch() {
    setLoading(true);
    setReport(null);
    try {
      if (reportType === 'pnl') {
        const data = await api.get(`/accounts/xero/profit-and-loss?from=${fromDate}&to=${toDate}`);
        setReport(data);
      } else if (reportType === 'trial') {
        const data = await api.get(`/accounts/xero/trial-balance?date=${balanceDate}`);
        setReport(data);
      } else if (reportType === 'balance') {
        const data = await api.get(`/accounts/xero/balance-sheet?date=${balanceDate}`);
        setReport(data);
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Financial reports</div>

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <label className="body-sm">
            Report
            <select className="input" value={reportType} onChange={e => setReportType(e.target.value)} style={{ marginLeft: 'var(--s2)' }}>
              <option value="pnl">Profit and Loss</option>
              <option value="trial">Trial Balance</option>
              <option value="balance">Balance Sheet</option>
            </select>
          </label>
          {reportType === 'pnl' ? (
            <>
              <label className="body-sm">
                From
                <input type="date" className="input" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ marginLeft: 'var(--s2)' }} />
              </label>
              <label className="body-sm">
                To
                <input type="date" className="input" value={toDate} onChange={e => setToDate(e.target.value)} style={{ marginLeft: 'var(--s2)' }} />
              </label>
            </>
          ) : (reportType === 'trial' || reportType === 'balance') ? (
            <label className="body-sm">
              As at
              <input type="date" className="input" value={balanceDate} onChange={e => setBalanceDate(e.target.value)} style={{ marginLeft: 'var(--s2)' }} />
            </label>
          ) : null}
          <button className="btn btn-primary" onClick={handleFetch} disabled={loading}>
            {loading ? 'Loading...' : 'Fetch report'}
          </button>
        </div>
      </div>

      {report && <XeroReportTable report={report} />}

      {!report && !loading && (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">Select a report type and date range, then click "Fetch report". Reports are pulled live from Xero.</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FxPanel — foreign currency gain/loss tracking
// ---------------------------------------------------------------------------

export function FxPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [currency, setCurrency] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [fromDate, setFromDate] = useState(yearStart);
  const [toDate, setToDate] = useState(today);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (currency) params.set('currency', currency);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const [evData, sumData] = await Promise.all([
        api.get(`/accounts/fx/events?${params}`),
        api.get(`/accounts/fx/summary?${params}`),
      ]);
      setEvents(evData.events || []);
      setSummary(sumData);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [currency, fromDate, toDate, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleScan() {
    roWrite(readOnly, async () => {
      setScanning(true);
      try {
        const r = await api.post('/accounts/fx/scan');
        toast(`Scanned queue: ${r.recorded} FX events recorded from ${r.scanned} non-GBP transactions`);
        load();
      } catch (e) { toast(e.message, 'error'); }
      finally { setScanning(false); }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <div className="h4">FX gain/loss tracker</div>
        <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
          {scanning ? 'Scanning...' : 'Scan queue for FX'}
        </button>
      </div>

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <label className="body-sm">
            Currency
            <select className="input" value={currency} onChange={e => setCurrency(e.target.value)} style={{ marginLeft: 'var(--s2)' }}>
              <option value="">All</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="CAD">CAD</option>
            </select>
          </label>
          <label className="body-sm">
            From
            <input type="date" className="input" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ marginLeft: 'var(--s2)' }} />
          </label>
          <label className="body-sm">
            To
            <input type="date" className="input" value={toDate} onChange={e => setToDate(e.target.value)} style={{ marginLeft: 'var(--s2)' }} />
          </label>
        </div>
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s3)' }}>
          {summary.byCurrency?.map(row => (
            <div key={row.currency} className="card" style={{ padding: 'var(--s3)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600 }}>{row.currency}</div>
              <div className="body-sm text-muted">{row.event_count} events</div>
              <div style={{
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: Number(row.total_realised_gbp) >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>
                {Number(row.total_realised_gbp) >= 0 ? '+' : ''}
                {Number(row.total_realised_gbp).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
              </div>
            </div>
          ))}
          {summary.totals && (
            <div className="card" style={{ padding: 'var(--s3)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600 }}>Total</div>
              <div className="body-sm text-muted">{summary.totals.eventCount} events</div>
              <div style={{
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: summary.totals.totalRealisedGbp >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>
                {summary.totals.totalRealisedGbp >= 0 ? '+' : ''}
                {summary.totals.totalRealisedGbp.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
              </div>
              <div className="body-sm">
                <span style={{ color: 'var(--success)' }}>
                  Gains: {summary.totals.gainsGbp.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
                </span>
                {' / '}
                <span style={{ color: 'var(--danger)' }}>
                  Losses: {summary.totals.lossesGbp.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : events.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No FX events recorded. Click "Scan queue for FX" to detect non-GBP transactions from the reconciliation queue.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Currency</th>
              <th>Invoice/Ref</th>
              <th style={{ textAlign: 'right' }}>Raise rate</th>
              <th style={{ textAlign: 'right' }}>Settle rate</th>
              <th style={{ textAlign: 'right' }}>Realised (GBP)</th>
              <th>Account</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{ev.created_at?.slice(0, 10)}</td>
                <td>{ev.currency}</td>
                <td className="body-sm">{ev.invoice_ref || ev.xero_txn_id || '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {ev.raise_rate != null ? Number(ev.raise_rate).toFixed(4) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {ev.settle_rate != null ? Number(ev.settle_rate).toFixed(4) : '—'}
                </td>
                <td style={{
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  color: ev.realised_gbp != null
                    ? (Number(ev.realised_gbp) >= 0 ? 'var(--success)' : 'var(--danger)')
                    : undefined,
                }}>
                  {ev.realised_gbp != null
                    ? `${Number(ev.realised_gbp) >= 0 ? '+' : ''}${Number(ev.realised_gbp).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`
                    : '—'}
                </td>
                <td className="body-sm">{ev.account_code || '—'}</td>
                <td className="body-sm text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {ev.notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="h5" style={{ marginBottom: 'var(--s2)' }}>How FX tracking works</div>
        <div className="body-sm text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <div>When a non-GBP transaction is confirmed in the reconciliation queue, it is flagged as an FX event.</div>
          <div>If a raise rate and settle rate are available, the realised gain or loss in GBP is calculated automatically.</div>
          <div>Events without rates (most bank transactions) are recorded for tracking. You can update rates manually when the invoice is settled.</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuditPanel — confirmation audit trail
// ---------------------------------------------------------------------------

export function AuditPanel() {
  const { toast } = useToast();
  const [confirmations, setConfirmations] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset });
      if (source) params.set('source', source);
      if (search) params.set('lineRef', search);
      const data = await api.get(`/accounts/audit-trail?${params}`);
      setConfirmations(data.confirmations || []);
      setTotal(data.total || 0);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [source, search, offset, toast]);

  useEffect(() => { load(); }, [load]);

  const ruleCount = confirmations.filter(c => c.source === 'rule').length;
  const aiCount = confirmations.filter(c => c.source === 'ai').length;
  const manualCount = confirmations.filter(c => c.source === 'manual').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Audit trail</div>

      <StatStrip items={[
        { label: 'Total confirmations', value: total },
        { label: 'Rule-matched', value: ruleCount },
        { label: 'AI-classified', value: aiCount },
        { label: 'Manual', value: manualCount },
      ]} />

      <div className="row center" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="input"
          placeholder="Search by line ref..."
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}
          style={{ width: 220 }}
        />
        <select className="input" value={source} onChange={e => { setSource(e.target.value); setOffset(0); }}>
          <option value="">All sources</option>
          <option value="rule">Rule</option>
          <option value="ai">AI</option>
          <option value="manual">Manual</option>
        </select>
        <a
          href={`/api/accounts/audit-trail/export.csv${source ? `?source=${source}` : ''}`}
          className="btn btn-ghost"
          download
          style={{ textDecoration: 'none' }}
        >Export CSV</a>
      </div>

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : confirmations.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No confirmations recorded yet. Confirmations are created when reconciliation items are approved.</div>
        </div>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Proposed</th>
                <th>Confirmed</th>
                <th>Source</th>
                <th>By</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {confirmations.map(c => {
                const changed = c.proposed_code !== c.confirmed_code || c.proposed_rate !== c.confirmed_rate;
                return (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.confirmed_at?.slice(0, 10)}</td>
                    <td>{c.payee || c.description || c.line_ref}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {c.amount != null ? Number(c.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}
                      {c.currency && c.currency !== 'GBP' && <span className="body-sm text-muted"> {c.currency}</span>}
                    </td>
                    <td className="body-sm text-muted">
                      {c.proposed_code || '—'} / {c.proposed_rate || '—'}
                    </td>
                    <td style={{ fontWeight: changed ? 600 : 400 }}>
                      {c.confirmed_code} / {c.confirmed_rate || '—'}
                      {changed && <span className="chip chip-accent" style={{ marginLeft: 'var(--s1)', fontSize: 'var(--fs-body-sm)' }}>changed</span>}
                    </td>
                    <td>
                      <span className={`chip ${c.source === 'rule' ? 'chip-success' : c.source === 'ai' ? 'chip-accent' : ''}`}>
                        {c.source}
                      </span>
                    </td>
                    <td className="body-sm">{c.confirmed_by || '—'}</td>
                    <td className="body-sm text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.reasoning || '—'}
                    </td>
                  </tr>
                );
              })}
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
