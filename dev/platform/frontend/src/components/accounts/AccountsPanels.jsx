import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';
import StatStrip from '../shells/StatStrip';

const RC_RATES = new Set(['RRINPUT', 'RRINPUT2', 'REVERSECHARGES']);

function checkVatWarnings(item, accountCode, taxRate) {
  const warnings = [];
  const payee = (item.payee || '').toLowerCase();
  const currency = (item.currency || 'GBP').toUpperCase();

  if (currency !== 'GBP' && taxRate && !RC_RATES.has(taxRate) && taxRate !== 'NONE' && taxRate !== 'ZERORATEDINPUT') {
    warnings.push('Non-GBP transaction with domestic VAT rate; should be reverse charge or NONE');
  }
  if (RC_RATES.has(taxRate) && currency === 'GBP') {
    warnings.push('Reverse charge on a GBP transaction; reverse charge is for overseas suppliers');
  }
  const rcPayees = ['meta', 'facebook', 'google', 'dataforseo', 'dropbox', 'slack', 'adobe', 'zoom', 'github', 'anthropic', 'openai', 'amazon web', 'aws', 'notion', 'canva', 'figma', 'vercel', 'linkedin', 'hetzner', 'brevo'];
  if (rcPayees.some(p => payee.includes(p)) && taxRate && !RC_RATES.has(taxRate) && taxRate !== 'NONE') {
    warnings.push(`${item.payee} is typically reverse charge; currently ${taxRate}`);
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
    const status = d.effective_status || d.status;
    return days <= 30 && status !== 'filed' && status !== 'paid';
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
  const [syncError, setSyncError] = useState(null);
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
    setSyncing(true);
    setSyncError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch('/api/accounts/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const r = await res.json();
      toast(`Synced: ${r.queued ?? 0} queued, ${r.ruleMatched ?? 0} rule-matched, ${r.aiClassified ?? 0} AI-classified`);
      load();
    } catch (e) {
      clearTimeout(timer);
      const msg = e.name === 'AbortError'
        ? 'Sync timed out. Xero may be slow to respond; try again in a minute.'
        : e.message;
      setSyncError(msg);
      toast(msg, 'error');
    } finally { setSyncing(false); }
  }

  async function handleAutoConfirm() {
    setAutoConfirming(true);
    try {
      const r = await api.post('/accounts/queue/auto-confirm', { threshold: 0.95 });
      toast(`Auto-confirmed ${r.confirmed ?? 0} high-confidence items`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setAutoConfirming(false); }
  }

  async function handleWriteBack() {
    setWritingBack(true);
    try {
      const r = await api.post('/accounts/queue/write-back');
      toast(`Written back: ${r.written ?? 0} items to Xero`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setWritingBack(false); }
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
  }

  async function handleReject(id) {
    try {
      await api.post(`/accounts/queue/${id}/reject`);
      toast('Skipped');
      load();
    } catch (e) { toast(e.message, 'error'); }
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
    setBatchWorking(true);
    try {
      const r = await api.post('/accounts/queue/batch-approve', { ids: [...selected] });
      toast(`Batch approved ${r.confirmed ?? 0} items${r.errors?.length ? `, ${r.errors.length} errors` : ''}`);
      setSelected(new Set());
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBatchWorking(false); }
  }

  async function handleBatchSkip() {
    if (!selected.size) return;
    setBatchWorking(true);
    try {
      const r = await api.post('/accounts/queue/batch-skip', { ids: [...selected] });
      toast(`Batch skipped ${r.skipped ?? 0} items`);
      setSelected(new Set());
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBatchWorking(false); }
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

      <div style={{ padding: 'var(--s3)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)', background: 'var(--surface-alt, var(--surface))', borderRadius: 'var(--radius, 6px)', borderLeft: '3px solid var(--text-muted)' }}>
        OMI pre-codes bank transactions so Xero can match them automatically. Unreconciled statement lines are not available via the Xero API; check your Xero dashboard for the full reconciliation view.
      </div>

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
          <button className="btn" {...roWrite(readOnly, { onClick: handleSync, disabled: syncing })} style={syncError ? { borderColor: 'var(--red)' } : undefined}>
            {syncing ? 'Syncing…' : syncError ? 'Sync failed – retry' : 'Sync now'}
          </button>
          <button className="btn" {...roWrite(readOnly, { onClick: handleAutoConfirm, disabled: autoConfirming })}>
            {autoConfirming ? 'Confirming...' : 'Auto-confirm'}
          </button>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleWriteBack, disabled: writingBack })}>
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
              <button className="btn" {...roWrite(readOnly, { onClick: handleBatchApprove, disabled: batchWorking })}>
                {batchWorking ? 'Working...' : `Approve ${selected.size}`}
              </button>
              <button className="btn btn-ghost" {...roWrite(readOnly, { onClick: handleBatchSkip, disabled: batchWorking })}>
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
                          <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }} {...roWrite(readOnly, { onClick: () => handleReject(item.id) })}>Skip</button>
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
                                <button className="btn" style={{ background: 'var(--amber-600, #d97706)', color: '#fff' }} {...roWrite(readOnly, { onClick: () => confirmApprove(item.id, true) })}>Confirm anyway</button>
                              ) : (
                                <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => confirmApprove(item.id) })}>Confirm</button>
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
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api.delete(`/accounts/rules/${id}`);
      toast('Rule deleted');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  const [purging, setPurging] = useState(false);

  async function handleSeedRules() {
    setSeeding(true);
    try {
      const r = await api.post('/accounts/rules/seed');
      toast(`Seeded ${r.inserted} rules from supplier brain${r.skipped ? `, ${r.skipped} already existed` : ''}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSeeding(false); }
  }

  async function handlePurgeInvalid() {
    if (!window.confirm('Delete all rules whose account code does not exist in the Xero chart of accounts?')) return;
    setPurging(true);
    try {
      const r = await api.post('/accounts/rules/purge-invalid');
      toast(`Removed ${r.deleted} invalid rules`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setPurging(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="card" style={{ padding: 'var(--s3)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-muted)' }}>
        Rules are the fallback for transactions the supplier brain does not recognise. The brain (177 suppliers from your Xero history) is checked first; rules only fire on tier 3 unknowns. "Seed from brain" copies auto-coding suppliers into rules. "Purge invalid" removes rules whose account codes are not in your Xero chart.
      </div>
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
          <button className="btn" style={{ color: 'var(--danger)' }} {...roWrite(readOnly, { onClick: handlePurgeInvalid, disabled: purging })}>
            {purging ? 'Purging...' : 'Purge invalid'}
          </button>
          <button className="btn" {...roWrite(readOnly, { onClick: handleSeedRules, disabled: seeding })}>
            {seeding ? 'Seeding...' : 'Seed from brain'}
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
            <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleSave })}>Save</button>
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
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--danger)' }} {...roWrite(readOnly, { onClick: () => handleDelete(rule.id) })}>Delete</button>
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
  const [allInvoices, setAllInvoices] = useState([]);
  const [driveStatus, setDriveStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [attachingAll, setAttachingAll] = useState(false);
  const [quarter, setQuarter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (quarter) params.set('quarter', quarter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const [s, m, ds, all] = await Promise.all([
        api.get('/accounts/invoices/stats'),
        api.get('/accounts/invoices/missing'),
        api.get('/accounts/drive/status').catch(() => null),
        api.get(`/accounts/invoices/all${qs ? `?${qs}` : ''}`),
      ]);
      setStats(s);
      setMissing(m.invoices || []);
      setDriveStatus(ds);
      setAllInvoices(all.invoices || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast, quarter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleScan() {
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
  }

  async function handleAttach(matchId) {
    try {
      await api.post(`/accounts/drive/attach/${matchId}`);
      toast('Invoice attached to Xero');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function handleAttachAll() {
    setAttachingAll(true);
    try {
      const r = await api.post('/accounts/drive/attach-all');
      toast(`Attached ${r.attached} invoices to Xero${r.errors?.length ? `, ${r.errors.length} errors` : ''}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setAttachingAll(false); }
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
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleScan, disabled: scanning || !driveStatus?.configured })}>
              {scanning ? 'Scanning...' : 'Scan Drive folder'}
            </button>
            <button className="btn" {...roWrite(readOnly, { onClick: handleAttachAll, disabled: attachingAll || !stats?.matched })}>
              {attachingAll ? 'Attaching...' : 'Attach all to Xero'}
            </button>
          </div>
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
                    <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} {...roWrite(readOnly, { onClick: () => handleAttach(inv.id) })}>
                      Attach to Xero
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="row between center" style={{ marginTop: 'var(--s3)', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div className="h4" style={{ margin: 0 }}>All invoices</div>
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <select value={quarter} onChange={e => setQuarter(e.target.value)} className="input" style={{ minWidth: 140 }}>
            <option value="">All quarters</option>
            {(() => {
              const now = new Date();
              const opts = [];
              for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
                for (let q = 4; q >= 1; q--) {
                  opts.push(`${y}-Q${q}`);
                }
              }
              return opts.map(o => <option key={o} value={o}>{o}</option>);
            })()}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input" style={{ minWidth: 120 }}>
            <option value="">All statuses</option>
            <option value="matched">Matched</option>
            <option value="attached">Attached to Xero</option>
            <option value="missing">Missing</option>
            <option value="pending">Pending</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </div>

      {allInvoices.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">{quarter || statusFilter ? 'No invoices match the selected filters.' : 'No invoice records yet.'}</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Payee / Contact</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Currency</th>
              <th>Status</th>
              <th>Source</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {allInvoices.map((inv, i) => {
              const statusChip = {
                attached: { className: 'chip chip-success', label: 'Attached' },
                matched: { className: 'chip chip-info', label: 'Matched' },
                missing: { className: 'chip chip-danger', label: 'Missing' },
                pending: { className: 'chip', label: 'Pending' },
                manual: { className: 'chip', label: 'Manual' },
              }[inv.status] || { className: 'chip', label: inv.status };
              return (
                <tr key={inv.id || i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{inv.invoice_date?.slice(0, 10) || '—'}</td>
                  <td>{inv.xero_contact || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Number(inv.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                  </td>
                  <td>{inv.currency || 'GBP'}</td>
                  <td><span className={statusChip.className}>{statusChip.label}</span></td>
                  <td className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>
                    {inv.drive_file_name ? 'Drive' : inv.email_message_id ? 'Email' : inv.xero_txn_id ? 'Xero' : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {inv.drive_file_id && inv.status === 'matched' && (
                      <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} {...roWrite(readOnly, { onClick: () => handleAttach(inv.id) })}>
                        Attach
                      </button>
                    )}
                    {inv.attached_to_xero && (
                      <span className="body-sm text-muted">In Xero</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {allInvoices.length > 0 && (
        <div className="body-sm text-muted">{allInvoices.length} invoice{allInvoices.length !== 1 ? 's' : ''}</div>
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
  const [inferring, setInferring] = useState(false);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkFiling, setBulkFiling] = useState(false);

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
  }

  function startEdit(d) {
    setEditingId(d.id);
    setEditStatus(d.effective_status || d.status || 'upcoming');
    setEditNotes(d.notes || '');
  }

  async function handleInfer() {
    setInferring(true);
    try {
      const r = await api.post('/accounts/deadlines/infer-filed');
      toast(`Checked ${r.checked} deadlines, ${r.inferred} updated from payments`);
      if (r.inferred > 0) load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setInferring(false); }
  }

  async function handleBulkFile() {
    setBulkFiling(true);
    try {
      const r = await api.post('/accounts/deadlines/bulk-file', { beforeDate: bulkDate });
      toast(`${r.updated} deadline${r.updated !== 1 ? 's' : ''} marked as filed`);
      setBulkDate('');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBulkFiling(false); }
  }

  async function handleUpdate(id) {
    try {
      await api.put(`/accounts/deadlines/${id}`, { status: editStatus, notes: editNotes });
      toast('Deadline updated');
      setEditingId(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
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
          <button className="btn" {...roWrite(readOnly, { onClick: handleSeed, disabled: seeding })}>
            {seeding ? 'Seeding...' : 'Seed deadlines'}
          </button>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleInfer, disabled: inferring })}>
            {inferring ? 'Checking...' : 'Infer from payments'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <span className="body-sm text-muted">Mark all deadlines before</span>
        <input type="date" className="input" value={bulkDate} onChange={e => setBulkDate(e.target.value)} style={{ width: 160 }} />
        <span className="body-sm text-muted">as filed</span>
        <button className="btn" {...roWrite(readOnly, { onClick: handleBulkFile, disabled: !bulkDate || bulkFiling })}>
          {bulkFiling ? 'Filing...' : 'Mark filed'}
        </button>
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
              <th style={{ textAlign: 'right' }}>Payment</th>
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
                  <td><span className={`chip ${(d.effective_status || d.status) === 'filed' || (d.effective_status || d.status) === 'paid' ? 'chip-success' : (d.effective_status || d.status) === 'overdue' ? 'chip-danger' : ''}`}>{d.effective_status || d.status}</span></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-body-sm)' }}>{d.payment_amount ? Number(d.payment_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                  <td className="text-muted" style={{ fontSize: 'var(--fs-body-sm)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.notes || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => startEdit(d)}>Edit</button>
                  </td>
                </tr>
                {editingId === d.id && (
                  <tr>
                    <td colSpan={8}>
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
                        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => handleUpdate(d.id) })}>Save</button>
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
    setBuildingPack(true);
    try {
      const r = await api.get(`/accounts/vat/pack/${year}/${quarter}`);
      setPackResult(r);
      toast(`VAT pack built: ${r.summary?.totalTransactions ?? 0} transactions, ${r.newExceptions ?? 0} new exceptions`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBuildingPack(false); }
  }

  async function handleResolve(id) {
    try {
      await api.post(`/accounts/vat/exceptions/${id}/resolve`, { resolution });
      toast('Exception resolved');
      setResolvingId(null);
      setResolution('');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      {quarters && (
        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div className="row between center" style={{ marginBottom: 'var(--s3)' }}>
            <div className="h4">VAT quarter-end pack</div>
            <div className="row center" style={{ gap: 'var(--s2)' }}>
              <button className="btn" {...roWrite(readOnly, { onClick: () => handleBuildPack(quarters.previous.year, quarters.previous.q), disabled: buildingPack })}>
                {buildingPack ? 'Building...' : `Build ${quarters.previous.label} ${quarters.previous.year}`}
              </button>
              <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => handleBuildPack(quarters.current.year, quarters.current.q), disabled: buildingPack })}>
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

          {packResult?.summary?.brainFlags?.length > 0 && (
            <div style={{ marginTop: 'var(--s3)' }}>
              <div className="h5" style={{ marginBottom: 'var(--s2)', color: 'var(--warning)' }}>
                Brain inconsistencies ({packResult.summary.brainFlags.length})
              </div>
              <div className="body-sm text-muted" style={{ marginBottom: 'var(--s2)' }}>
                These transactions have a different VAT treatment from what the supplier brain expects. Worth reviewing before the quarter closes.
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Applied rate</th>
                    <th>Brain expects</th>
                  </tr>
                </thead>
                <tbody>
                  {packResult.summary.brainFlags.map((f, i) => (
                    <tr key={f.lineRef || i}>
                      <td>{f.supplier || f.payee}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{typeof f.date === 'string' ? f.date.slice(0, 10) : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {f.currency !== 'GBP' ? `${f.currency} ` : '£'}{Number(f.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                      <td><span className="chip chip-danger">{f.txnRate}</span></td>
                      <td><span className="chip chip-success">{f.brainRate}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {packResult?.summary?.missingInvoiceList?.length > 0 && (
            <div style={{ marginTop: 'var(--s3)' }}>
              <div className="h5" style={{ marginBottom: 'var(--s2)', color: 'var(--danger)' }}>
                Missing invoices ({packResult.summary.missingInvoices})
              </div>
              <div className="body-sm text-muted" style={{ marginBottom: 'var(--s2)' }}>
                Transactions over £50 in this quarter without a matched invoice.
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {packResult.summary.missingInvoiceList.map((m, i) => (
                    <tr key={m.lineRef || i}>
                      <td>{m.payee || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{typeof m.date === 'string' ? m.date.slice(0, 10) : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Number(m.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                      <td>{m.currency || 'GBP'}</td>
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
                        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: () => handleResolve(ex.id) })}>Confirm</button>
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
    setBuilding(true);
    try {
      await api.post('/accounts/digests/build');
      toast('Digest built');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBuilding(false); }
  }

  async function handleBuildAndSend() {
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
  }

  async function handleSendEmail(digestId) {
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
  }

  if (loading) return <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <div className="h4">Weekly digests</div>
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <button className="btn" {...roWrite(readOnly, { onClick: handleBuild, disabled: building })}>
            {building ? 'Building...' : 'Build only'}
          </button>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleBuildAndSend, disabled: building })}>
            {building ? 'Building...' : 'Build and send'}
          </button>
        </div>
      </div>

      {digests.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No digests yet. The first one is built automatically on Friday mornings, or you can trigger one manually.</div>
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
                        {...roWrite(readOnly, { onClick: e => { e.stopPropagation(); handleSendEmail(d.id); }, disabled: sending === d.id })}
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
                    {summary.suppliers && (
                      <div style={{ marginTop: 'var(--s3)' }}>
                        <div className="h5">Supplier brain</div>
                        <div>Total: {summary.suppliers.total ?? 0} | Auto-coding: {summary.suppliers.autoCoding ?? 0} | Learning: {summary.suppliers.learning ?? 0}</div>
                        {summary.suppliers.autoCodedThisWeek?.length > 0 && (
                          <div style={{ marginTop: 'var(--s2)' }}>
                            <div className="text-muted">Auto-coded this week:</div>
                            {summary.suppliers.autoCodedThisWeek.map((a, i) => (
                              <div key={i} className="text-muted">{a.display_name}: {a.count} transactions</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {summary.overdueDeadlines > 0 && (
                      <div style={{ marginTop: 'var(--s3)', padding: 'var(--s2) var(--s3)', background: 'var(--warning-soft)', borderLeft: '3px solid var(--warning)', borderRadius: 'var(--r-sm)' }}>
                        <strong style={{ color: 'var(--warning)' }}>{summary.overdueDeadlines} overdue deadline{summary.overdueDeadlines > 1 ? 's' : ''}</strong>
                        <span className="text-muted"> require attention.</span>
                      </div>
                    )}
                    {summary.deadlines?.length > 0 && (
                      <div style={{ marginTop: 'var(--s3)' }}>
                        <div className="h5">Upcoming deadlines</div>
                        {summary.deadlines.map((dl, i) => {
                          const color = dl.status === 'overdue' ? 'var(--danger)' : dl.daysUntil <= 7 ? 'var(--danger)' : dl.daysUntil <= 14 ? 'var(--warning)' : undefined;
                          return (
                            <div key={i} className="text-muted" style={{ color }}>
                              {dl.type} ({dl.label}): {dl.dueDate?.slice(0, 10)} {dl.daysUntil < 0 ? `${Math.abs(dl.daysUntil)}d overdue` : `${dl.daysUntil}d`} {dl.status}
                            </div>
                          );
                        })}
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
  const [subfolders, setSubfolders] = useState([]);
  const [discovering, setDiscovering] = useState(false);

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
        const [fileData, subData] = await Promise.all([
          api.get('/accounts/drive/files'),
          api.get('/accounts/drive/subfolders').catch(() => ({ subfolders: [] })),
        ]);
        setFiles(fileData.files || []);
        setSubfolders(subData.subfolders || []);
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
  }

  async function handleDiscover() {
    setDiscovering(true);
    try {
      const result = await api.post('/accounts/drive/discover');
      setSubfolders(result.subfolders || []);
      toast(`Found ${(result.subfolders || []).length} subfolders`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setDiscovering(false); }
  }

  async function handleToggleSubfolder(folderId, included) {
    try {
      await api.put(`/accounts/drive/subfolders/${folderId}`, { included });
      // Cascade: also update children in local state
      const parent = subfolders.find(s => s.drive_folder_id === folderId);
      setSubfolders(prev => prev.map(s =>
        s.drive_folder_id === folderId ? { ...s, included } :
        (parent && s.parent_id === folderId) ? { ...s, included } :
        s
      ));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function handleToggleAllSubfolders(included) {
    try {
      const result = await api.put('/accounts/drive/subfolders', { included });
      setSubfolders(result.subfolders || []);
    } catch (e) { toast(e.message, 'error'); }
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
              Paste the JSON key into the <strong>Service Account Key</strong> field on{' '}
              <Link to="/settings/integrations">Settings &gt; Integrations</Link>, then return here.
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
              {status.fileCount != null && (
                <span className="body-sm text-muted">{status.fileCount} invoice {status.fileCount === 1 ? 'file' : 'files'}</span>
              )}
            </div>
            {!status.accessible && status.error && (
              <div className="body-sm" style={{ color: 'var(--danger)' }}>{status.error}</div>
            )}
            <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
              <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleScan, disabled: scanning || !status.accessible })}>
                {scanning ? 'Scanning...' : 'Scan and match'}
              </button>
            </div>
          </div>
        </div>
      )}

      {serviceEmail && status?.accessible && (
        <div className="card" style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="h5">Subfolders</div>
            <button className="btn btn-sm" onClick={handleDiscover} disabled={discovering}>
              {discovering ? 'Scanning...' : subfolders.length ? 'Refresh' : 'Discover subfolders'}
            </button>
          </div>
          {subfolders.length > 0 ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="body-sm text-muted">
                  {subfolders.filter(s => s.included).length} of {subfolders.length} included in scan
                  {' '}({subfolders.filter(s => s.included).reduce((sum, s) => sum + (s.file_count || 0), 0)} files)
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                  <button className="btn btn-sm" onClick={() => handleToggleAllSubfolders(true)}>Select all</button>
                  <button className="btn btn-sm" onClick={() => handleToggleAllSubfolders(false)}>Deselect all</button>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Scan</th>
                    <th>Folder</th>
                    <th style={{ textAlign: 'right' }}>Files</th>
                    <th>Last scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const isTopLevel = sf => !sf.path.includes('/');
                    const topFolders = subfolders.filter(isTopLevel);
                    const childrenOf = id => subfolders.filter(sf => sf.parent_id === id);
                    const rows = [];
                    for (const parent of topFolders) {
                      rows.push({ ...parent, _isParent: true });
                      for (const child of childrenOf(parent.drive_folder_id)) {
                        rows.push({ ...child, _isChild: true });
                      }
                    }
                    return rows.map(sf => (
                      <tr key={sf.drive_folder_id} style={{ opacity: sf.included ? 1 : 0.5 }}>
                        <td style={{ paddingLeft: sf._isChild ? 'var(--s4)' : undefined }}>
                          <input
                            type="checkbox"
                            checked={sf.included}
                            onChange={e => handleToggleSubfolder(sf.drive_folder_id, e.target.checked)}
                          />
                        </td>
                        <td>
                          <span style={{ fontWeight: sf._isParent ? 600 : 400 }}>{sf.name}</span>
                          {sf._isParent && (() => {
                            const kids = childrenOf(sf.drive_folder_id);
                            const included = kids.filter(c => c.included).length;
                            return kids.length > 0 ? (
                              <span className="body-sm text-muted" style={{ marginLeft: 'var(--s2)' }}>
                                {included}/{kids.length} suppliers
                              </span>
                            ) : null;
                          })()}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {sf.file_count != null ? sf.file_count : '—'}
                        </td>
                        <td className="body-sm text-muted">
                          {sf.last_scanned_at ? new Date(sf.last_scanned_at).toLocaleDateString('en-GB') : '—'}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </>
          ) : (
            <div className="body-sm text-muted">
              Click "Discover subfolders" to find year folders and other subfolders in your invoices folder.
              You can then choose which ones to include in the weekly scan.
            </div>
          )}
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
          <div className="h5">{files.length} invoice files across included folders</div>
          <table className="table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Folder</th>
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
                  <td className="body-sm text-muted">{f.folderPath || 'Root'}</td>
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
        <div className="body-sm" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          {!serviceEmail ? (
            <>
              <div style={{ marginBottom: 'var(--s2)' }}>
                The Drive scanner needs a Google service account key. A service account is a non-human Google identity that
                lets OMI access Drive folders you share with it, without needing anyone to log in.
              </div>
              <div style={{ fontWeight: 500 }}>1. Get a service account key</div>
              <div className="text-muted" style={{ marginBottom: 'var(--s1)' }}>
                Check whether your Google Cloud project already has a service account. If it does, generate a new JSON key
                for it. If it does not, create one first.
              </div>
              <ol style={{ margin: 0, paddingLeft: 'var(--s4)', color: 'var(--text-muted)' }}>
                <li>
                  Open{' '}
                  <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                    console.cloud.google.com &gt; IAM &gt; Service Accounts
                  </a>.
                </li>
                <li>
                  If a service account is listed, click it. If the list is empty, click <strong>Create Service Account</strong>,
                  give it a name (e.g. "october-marketing-intelligence"), and click <strong>Done</strong>.
                </li>
                <li>Go to the <strong>Keys</strong> tab, click <strong>Add Key &gt; Create new key</strong>, choose <strong>JSON</strong>, and download the file.</li>
              </ol>
              <div style={{ fontWeight: 500, marginTop: 'var(--s2)' }}>2. Paste the key into OMI</div>
              <ol style={{ margin: 0, paddingLeft: 'var(--s4)', color: 'var(--text-muted)' }}>
                <li>
                  Go to <Link to="/settings/integrations" style={{ color: 'var(--accent)' }}>Settings &gt; Integrations</Link>.
                </li>
                <li>Paste the full contents of the downloaded JSON file into the <strong>Service Account Key</strong> field and save.</li>
                <li>Return here. The service account email will appear and the folder input will unlock.</li>
              </ol>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 500 }}>Connect a Drive folder</div>
              <ol style={{ margin: 0, paddingLeft: 'var(--s4)', color: 'var(--text-muted)' }}>
                <li>Create a folder in Google Drive for invoices and receipts (or use an existing one).</li>
                <li>
                  Share the folder with the service account email shown above. Click "Copy email", open the folder in Drive,
                  click <strong>Share</strong>, paste the email, and set the permission to <strong>Editor</strong>.
                  Editor is required so OMI can read the files.
                </li>
                <li>Copy the folder URL from your browser and paste it into the input above, then click Save.</li>
                <li>Click "Scan and match" to find invoices that match reconcile queue items.</li>
              </ol>
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
    setConnecting(true);
    try {
      const data = await api.get('/accounts/xero/auth-url');
      if (data.url) window.location.href = data.url;
    } catch (e) { toast(e.message, 'error'); }
    finally { setConnecting(false); }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect from Xero? This removes stored tokens. You can reconnect at any time.')) return;
    setDisconnecting(true);
    try {
      await api.post('/accounts/xero/disconnect');
      toast('Disconnected from Xero');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setDisconnecting(false); }
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
              <button className="btn" {...roWrite(readOnly, { onClick: handleConnect, disabled: connecting })}>
                {connecting ? 'Redirecting...' : 'Reconnect'}
              </button>
              <button className="btn btn-danger" {...roWrite(readOnly, { onClick: handleDisconnect, disabled: disconnecting })}>
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="row center" style={{ gap: 'var(--s2)' }}>
              <span className="chip">Not connected</span>
            </div>
            {status?.credentialsConfigured === false && (
              <div className="callout callout-warning">
                Xero credentials are not saved yet. Scroll down and fill in the client ID, secret and redirect URI, then click Save before connecting.
              </div>
            )}
            <div className="body-sm text-muted">
              Connect your Xero account to enable automated reconciliation.
            </div>
            <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleConnect, disabled: connecting || status?.credentialsConfigured === false })} style={{ alignSelf: 'flex-start' }}>
              {connecting ? 'Redirecting...' : 'Connect to Xero'}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 'var(--s4)' }}>
        <div className="h5" style={{ marginBottom: 'var(--s2)' }}>Setup</div>
        <div className="body-sm text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <div>1. Create a Xero app at <a href="https://apps.developer.xero.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>developer.xero.com</a> (web app type) and note the client ID and secret.</div>
          <div>2. Set the redirect URI in the Xero app to your platform URL + <code>/api/accounts/xero/callback</code></div>
          <div>3. Scroll down and paste the client ID, secret and redirect URI into the credential fields below, then click Save.</div>
          <div>4. Once saved, click "Connect to Xero" above to authorise.</div>
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
    setScanning(true);
    try {
      const r = await api.post('/accounts/fx/scan');
      toast(`Scanned queue: ${r.recorded} FX events recorded from ${r.scanned} non-GBP transactions`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="row between center">
        <div className="h4">FX gain/loss tracker</div>
        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleScan, disabled: scanning })}>
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

// ---------------------------------------------------------------------------
// SuppliersPanel — supplier brain: view, edit and bootstrap suppliers
// ---------------------------------------------------------------------------

export function SuppliersPanel() {
  const { readOnly } = useAuth();
  const { toast } = useToast();
  const { accounts: xeroAccounts, taxRates: xeroTaxRates } = useXeroRefData();
  const [suppliers, setSuppliers] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [bootstrapping, setBootstrapping] = useState(false);
  const [seedingDrive, setSeedingDrive] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [vatFilter, setVatFilter] = useState('');
  const [expandedPatterns, setExpandedPatterns] = useState(new Set());

  const BLANK = {
    display_name: '', match_patterns: '', account_code: '', account_name: '',
    vat_treatment: 'NONE', usual_currency: 'GBP', expected_cadence: '',
    invoice_source: 'unknown', auto_code: true, notes: '',
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      if (search) qp.set('search', search);
      if (vatFilter) qp.set('vatTreatment', vatFilter);
      const qs = qp.toString();
      const data = await api.get(`/accounts/suppliers${qs ? `?${qs}` : ''}`);
      setSuppliers(data.suppliers || []);
      setTotal(data.total || 0);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [search, vatFilter, toast]);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.get('/accounts/suppliers/stats');
      setStats(s);
    } catch {}
  }, []);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  function startEdit(supplier) {
    setEditingId(supplier?.id || 'new');
    setForm(supplier ? {
      display_name: supplier.display_name,
      match_patterns: (supplier.match_patterns || []).join(', '),
      account_code: supplier.account_code || '',
      account_name: supplier.account_name || '',
      vat_treatment: supplier.vat_treatment || 'NONE',
      usual_currency: supplier.usual_currency || 'GBP',
      expected_cadence: supplier.expected_cadence || '',
      invoice_source: supplier.invoice_source || 'unknown',
      auto_code: supplier.auto_code === true,
      notes: supplier.notes || '',
    } : { ...BLANK });
  }

  async function handleSave() {
    const patterns = form.match_patterns
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const payload = {
      displayName: form.display_name,
      matchPatterns: patterns,
      accountCode: form.account_code,
      accountName: form.account_name,
      vatTreatment: form.vat_treatment,
      usualCurrency: form.usual_currency,
      expectedCadence: form.expected_cadence || null,
      invoiceSource: form.invoice_source,
      autoCode: form.auto_code,
      notes: form.notes,
    };

    try {
      if (editingId === 'new') {
        await api.post('/accounts/suppliers', payload);
        toast('Supplier created');
      } else {
        await api.put(`/accounts/suppliers/${editingId}`, payload);
        toast('Supplier updated');
      }
      setEditingId(null);
      load();
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this supplier?')) return;
    try {
      await api.delete(`/accounts/suppliers/${id}`);
      toast('Supplier deleted');
      load();
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function handleBootstrap() {
    setBootstrapping(true);
    try {
      const r = await api.post('/accounts/suppliers/bootstrap');
      toast(`Bootstrap complete: ${r.created} suppliers created from ${r.contactsFound} Xero contacts`);
      load();
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBootstrapping(false); }
  }

  async function handleSeedFromDrive() {
    setSeedingDrive(true);
    try {
      const r = await api.post('/accounts/drive/seed-suppliers');
      toast(`Drive seed: ${r.created} new, ${r.matched} enriched, ${r.skipped} skipped`);
      load();
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSeedingDrive(false); }
  }

  async function handleCleanup() {
    setCleaning(true);
    try {
      const r = await api.post('/accounts/suppliers/cleanup');
      const parts = [];
      if (r.patternsStripped) parts.push(`${r.patternsStripped} pattern sets cleaned`);
      if (r.reverseChargeFixed) parts.push(`${r.reverseChargeFixed} reverse charge flags fixed`);
      if (r.cadenceReset) parts.push(`${r.cadenceReset} cadences reset`);
      if (r.junkDeleted) parts.push(`${r.junkDeleted} junk records deleted`);
      toast(parts.length ? `Cleanup: ${parts.join(', ')}` : 'No changes needed');
      load();
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
    finally { setCleaning(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      {stats && (
        <StatStrip items={[
          { label: 'Total suppliers', value: stats.total },
          { label: 'Settled (10+ confirmations)', value: stats.settled },
          { label: 'Learning (<3)', value: stats.learning },
          { label: 'Auto-coding', value: stats.auto_coding },
          { label: 'Reverse charge', value: stats.reverse_charge },
        ]} />
      )}

      <div className="row between center">
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <input
            type="text"
            className="input"
            placeholder="Search suppliers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <select
            className="input"
            value={vatFilter}
            onChange={e => setVatFilter(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="">All VAT treatments</option>
            <option value="OUTPUT2">OUTPUT2 (Standard)</option>
            <option value="INPUT2">INPUT2 (Standard)</option>
            <option value="ZERORATEDINPUT">Zero rated</option>
            <option value="EXEMPTINPUT">Exempt</option>
            <option value="REVERSECHARGES">Reverse charge</option>
            <option value="RRINPUT">RRINPUT</option>
            <option value="RRINPUT2">RRINPUT2</option>
            <option value="NONE">None</option>
          </select>
        </div>
        <div className="row center" style={{ gap: 'var(--s2)' }}>
          <button
            className="btn"
            {...roWrite(readOnly, { onClick: handleCleanup, disabled: cleaning })}
          >
            {cleaning ? 'Cleaning...' : 'Clean up'}
          </button>
          <button
            className="btn"
            {...roWrite(readOnly, { onClick: handleSeedFromDrive, disabled: seedingDrive })}
          >
            {seedingDrive ? 'Seeding...' : 'Seed from Drive'}
          </button>
          <button
            className="btn"
            {...roWrite(readOnly, { onClick: handleBootstrap, disabled: bootstrapping })}
          >
            {bootstrapping ? 'Bootstrapping...' : 'Bootstrap from Xero'}
          </button>
          <button className="btn btn-primary" onClick={() => startEdit(null)}>Add supplier</button>
        </div>
      </div>

      {editingId && (
        <div className="card" style={{ padding: 'var(--s4)' }}>
          <div className="h4" style={{ marginBottom: 'var(--s3)' }}>{editingId === 'new' ? 'New supplier' : 'Edit supplier'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
            <label className="body-sm">
              Display name
              <input className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
            </label>
            <label className="body-sm">
              Match patterns (comma-separated)
              <input className="input" value={form.match_patterns} onChange={e => setForm(f => ({ ...f, match_patterns: e.target.value }))} placeholder="adobe, adobe systems, adobe creative" />
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
              VAT treatment
              <TaxRateSelect value={form.vat_treatment} onChange={v => setForm(f => ({ ...f, vat_treatment: v }))} taxRates={xeroTaxRates} />
            </label>
            <label className="body-sm">
              Currency
              <select className="input" value={form.usual_currency} onChange={e => setForm(f => ({ ...f, usual_currency: e.target.value }))}>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="CAD">CAD</option>
              </select>
            </label>
            <label className="body-sm">
              Expected cadence
              <select className="input" value={form.expected_cadence} onChange={e => setForm(f => ({ ...f, expected_cadence: e.target.value }))}>
                <option value="">Unknown</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="ad_hoc">Ad hoc</option>
              </select>
            </label>
            <label className="body-sm">
              Invoice source
              <select className="input" value={form.invoice_source} onChange={e => setForm(f => ({ ...f, invoice_source: e.target.value }))}>
                <option value="unknown">Unknown</option>
                <option value="email">Email</option>
                <option value="drive">Google Drive</option>
                <option value="xero">Xero</option>
                <option value="portal">Supplier portal</option>
                <option value="none">None expected</option>
              </select>
            </label>
            <label className="body-sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              <input type="checkbox" checked={form.auto_code} onChange={e => setForm(f => ({ ...f, auto_code: e.target.checked }))} />
              Auto-code transactions
            </label>
            <label className="body-sm">
              Notes
              <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-primary" {...roWrite(readOnly, { onClick: handleSave })}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : suppliers.length === 0 ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No suppliers yet. Use "Bootstrap from Xero" to seed from your transaction history, or add suppliers manually.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Patterns</th>
              <th>Account</th>
              <th>VAT</th>
              <th>Currency</th>
              <th>Cadence</th>
              <th>Confidence</th>
              <th>Last seen</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 500 }}>
                  {s.display_name}
                  {!s.auto_code && <span className="chip" style={{ marginLeft: 'var(--s1)', fontSize: 'var(--fs-body-sm)' }}>manual</span>}
                </td>
                <td className="body-sm text-muted" style={{ maxWidth: 200 }}>
                  {(() => {
                    const patterns = s.match_patterns || [];
                    const expanded = expandedPatterns.has(s.id);
                    if (patterns.length <= 2 || expanded) {
                      return (
                        <span>
                          {patterns.join(', ')}
                          {expanded && patterns.length > 2 && (
                            <button
                              className="btn-link"
                              style={{ marginLeft: 'var(--s1)', fontSize: 'var(--fs-body-sm)', color: 'var(--primary)' }}
                              onClick={() => setExpandedPatterns(prev => { const n = new Set(prev); n.delete(s.id); return n; })}
                            >collapse</button>
                          )}
                        </span>
                      );
                    }
                    return (
                      <span>
                        {patterns.slice(0, 2).join(', ')}
                        <button
                          className="btn-link"
                          style={{ marginLeft: 'var(--s1)', fontSize: 'var(--fs-body-sm)', color: 'var(--primary)' }}
                          onClick={() => setExpandedPatterns(prev => new Set([...prev, s.id]))}
                        >+{patterns.length - 2} more</button>
                      </span>
                    );
                  })()}
                </td>
                <td>
                  {s.account_code}
                  {s.account_name && <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>{s.account_name}</div>}
                </td>
                <td>
                  <span className={`chip ${s.is_reverse_charge ? 'chip-accent' : ''}`}>
                    {s.vat_treatment || 'NONE'}
                  </span>
                </td>
                <td>{s.usual_currency || 'GBP'}</td>
                <td className="body-sm">{s.expected_cadence || '—'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {s.confidence_counter || 0}x
                  {s.amount_min != null && s.amount_max != null && (
                    <div className="text-muted" style={{ fontSize: 'var(--fs-body-sm)' }}>
                      {Number(s.amount_min).toFixed(0)}–{Number(s.amount_max).toFixed(0)}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {s.last_seen ? new Date(s.last_seen).toLocaleDateString('en-GB') : '—'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)' }} onClick={() => startEdit(s)}>Edit</button>
                  <button className="btn btn-ghost" style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--danger)' }} {...roWrite(readOnly, { onClick: () => handleDelete(s.id) })}>Delete</button>
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
// ExtensionPanel — generate/revoke tokens for the Xero Brain Chrome extension
// ---------------------------------------------------------------------------

export function ExtensionPanel() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts/extension/tokens');
      setTokens(data.tokens || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const data = await api.post('/accounts/extension/tokens', { label: label || undefined });
      setNewToken(data.token);
      setLabel('');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setCreating(false); }
  };

  const revoke = async (id) => {
    try {
      await api.delete(`/accounts/extension/tokens/${id}`);
      toast('Token revoked');
      if (newToken) setNewToken(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(newToken).then(
      () => toast('Token copied to clipboard'),
      () => toast('Copy failed; select and copy manually', 'error')
    );
  };

  const activeTokens = tokens.filter(t => !t.revoked_at);
  const revokedTokens = tokens.filter(t => t.revoked_at);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Chrome extension tokens</div>
      <p className="body-sm text-muted" style={{ margin: 0 }}>
        Generate a bearer token for the Xero Brain Chrome extension. The extension reads payee text
        from Xero's reconciliation page and queries the supplier brain for coding suggestions.
        Tokens are shown once on creation; store the value in the extension's settings.
      </p>

      {newToken && (
        <div className="card" style={{ padding: 'var(--s4)', background: 'var(--surface-success, var(--green-50, #f0fdf4))', border: '1px solid var(--green-200, #bbf7d0)' }}>
          <div className="body-sm" style={{ fontWeight: 600, marginBottom: 'var(--s2)' }}>New token created. Copy it now; it will not be shown again.</div>
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
            <code style={{ flex: 1, wordBreak: 'break-all', padding: 'var(--s2)', background: 'var(--surface-secondary)', borderRadius: 4, fontSize: 'var(--fs-body-sm)' }}>
              {newToken}
            </code>
            <button className="btn btn-primary" onClick={copyToken}>Copy</button>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 'var(--s2)', fontSize: 'var(--fs-body-sm)' }} onClick={() => setNewToken(null)}>Dismiss</button>
        </div>
      )}

      <div className="row center" style={{ gap: 'var(--s3)' }}>
        <input
          type="text"
          className="input"
          placeholder="Token label (optional)"
          value={label}
          onChange={e => setLabel(e.target.value)}
          style={{ width: 240 }}
        />
        <button className="btn btn-primary" disabled={creating} onClick={create}>
          {creating ? 'Creating...' : 'Generate token'}
        </button>
      </div>

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading...</div>
      ) : activeTokens.length === 0 && !newToken ? (
        <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
          <div className="text-muted">No active tokens. Generate one above to use the Chrome extension.</div>
        </div>
      ) : (
        <>
          {activeTokens.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeTokens.map(t => (
                  <tr key={t.id}>
                    <td className="body-sm">{t.label || 'Unnamed'}</td>
                    <td className="body-sm text-muted">{new Date(t.created_at).toLocaleDateString('en-GB')}</td>
                    <td className="body-sm text-muted">{t.last_used ? new Date(t.last_used).toLocaleDateString('en-GB') : 'Never'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost" style={{ color: 'var(--red-600, #dc2626)', fontSize: 'var(--fs-body-sm)' }} onClick={() => revoke(t.id)}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {revokedTokens.length > 0 && (
            <details style={{ marginTop: 'var(--s2)' }}>
              <summary className="body-sm text-muted" style={{ cursor: 'pointer' }}>
                {revokedTokens.length} revoked token{revokedTokens.length !== 1 ? 's' : ''}
              </summary>
              <table className="table" style={{ marginTop: 'var(--s2)', opacity: 0.6 }}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Created</th>
                    <th>Revoked</th>
                  </tr>
                </thead>
                <tbody>
                  {revokedTokens.map(t => (
                    <tr key={t.id}>
                      <td className="body-sm">{t.label || 'Unnamed'}</td>
                      <td className="body-sm text-muted">{new Date(t.created_at).toLocaleDateString('en-GB')}</td>
                      <td className="body-sm text-muted">{new Date(t.revoked_at).toLocaleDateString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      <div className="card" style={{ padding: 'var(--s4)', marginTop: 'var(--s3)' }}>
        <div className="body-sm" style={{ fontWeight: 600, marginBottom: 'var(--s2)' }}>Extension setup</div>
        <ol className="body-sm" style={{ margin: 0, paddingLeft: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <li>
            <strong>Download the extension</strong> and unzip it to a folder on your computer.
            <div style={{ marginTop: 'var(--s2)' }}>
              <button className="btn btn-secondary" onClick={() => {
                const a = document.createElement('a');
                a.href = '/api/accounts/extension/download';
                a.click();
              }}>
                Download extension (.zip)
              </button>
            </div>
          </li>
          <li>Open Chrome and go to <code>chrome://extensions</code></li>
          <li>Turn on <strong>Developer mode</strong> using the toggle in the top-right corner</li>
          <li>Click <strong>Load unpacked</strong> (top left) and select the unzipped folder</li>
          <li>Click the extension's puzzle-piece icon in Chrome's toolbar, then click <strong>Xero Brain</strong> to open its settings</li>
          <li>Enter the server URL: <code>{window.location.origin}</code></li>
          <li>Paste the token generated above into the Token field and click Save</li>
          <li>Open Xero's bank reconciliation page; the extension will show coding suggestions beside each transaction</li>
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PrecodePanel — preview and trigger pre-coded spend transactions
// ---------------------------------------------------------------------------

export function PrecodePanel() {
  const { toast } = useToast();
  const [stats, setStats] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts/precode/stats');
      setStats(data);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const data = await api.get('/accounts/precode/preview');
      setPreview(data);
    } catch (e) { toast(e.message, 'error'); }
    finally { setPreviewing(false); }
  };

  const stateLabel = {
    not_run: 'Never run',
    ran_nothing_eligible: 'Last run found nothing eligible',
    has_writes: 'Has written transactions',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
      <div className="h4">Pre-coding</div>
      <p className="body-sm text-muted" style={{ margin: 0 }}>
        Pre-coding creates spend-money transactions in Xero for suppliers whose coding has been
        confirmed 5+ times. Each transaction is booked to the supplier's known account code with
        the correct VAT treatment, and any matched invoice is attached.
      </p>

      {loading ? (
        <div className="text-muted" style={{ padding: 'var(--s5)' }}>Loading stats...</div>
      ) : stats && (
        <StatStrip items={[
          { label: 'Status', value: stateLabel[stats.state] || stats.state },
          { label: 'Eligible now', value: stats.eligible_now ?? '?' },
          { label: 'Written', value: stats.written ?? 0 },
          { label: 'Matched', value: stats.matched ?? 0 },
          { label: 'Errors', value: stats.errors ?? 0 },
          { label: 'Total amount', value: stats.total_amount ? `${Number(stats.total_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '0.00' },
        ]} />
      )}

      <div className="row center" style={{ gap: 'var(--s3)' }}>
        <button className="btn btn-primary" disabled={previewing} onClick={runPreview}>
          {previewing ? 'Loading preview...' : 'Preview next pass'}
        </button>
      </div>

      {preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {preview.state === 'nothing_eligible' ? (
            <div className="card" style={{ padding: 'var(--s5)', textAlign: 'center' }}>
              <div className="text-muted">No suppliers are eligible for pre-coding. A supplier needs 5+ confirmed codings, a known account code, and a known VAT treatment.</div>
            </div>
          ) : (
            <>
              <StatStrip items={[
                { label: 'Eligible', value: preview.eligible },
                { label: 'Would write', value: preview.wouldWrite },
                { label: 'Would skip', value: preview.wouldSkip },
              ]} />

              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Account</th>
                    <th>VAT</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Currency</th>
                    <th>Confidence</th>
                    <th>Invoice</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map(p => (
                    <tr key={p.supplierId} style={p.wouldSkip ? { opacity: 0.5 } : undefined}>
                      <td className="body-sm">{p.supplierName}</td>
                      <td className="body-sm">{p.accountCode}{p.accountName ? ` (${p.accountName})` : ''}</td>
                      <td className="body-sm">
                        {p.vatTreatment}
                        {p.isReverseCharge && <span style={{ marginLeft: 4, color: 'var(--amber-600, #d97706)', fontSize: 'var(--fs-body-sm)' }}>RC</span>}
                      </td>
                      <td className="body-sm" style={{ textAlign: 'right' }}>{p.amount != null ? p.amount.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : '—'}</td>
                      <td className="body-sm">{p.currency}</td>
                      <td className="body-sm">{p.confidenceCounter}x</td>
                      <td className="body-sm">{p.matchedInvoice ? 'Yes' : '—'}</td>
                      <td className="body-sm">{p.wouldSkip ? <span style={{ color: 'var(--red-600, #dc2626)' }}>{p.skipReason}</span> : <span style={{ color: 'var(--green-600, #16a34a)' }}>Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
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
