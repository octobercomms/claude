import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { csvEscape } from '../utils/csv';

// Results + the 24/7 watcher view for a press campaign: open/click rates, a
// sortable per-journalist table (repeat-open counts, what they clicked, warm
// flag), the warm threshold, and the suppression lists. Reads
// /press/releases/:id/analytics + /press/clients/:clientId/*.
export default function PressCampaignAnalytics({ clientId, release }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: 'interest_score', dir: 'desc' });
  const [cfg, setCfg] = useState(null);
  const [supp, setSupp] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api.get(`/press/releases/${release.id}/analytics`),
        api.get(`/press/clients/${clientId}/warm-config`).catch(() => null),
      ]);
      setData(a); setCfg(c);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [release.id, clientId, toast]);
  useEffect(() => { load(); }, [load]);

  async function saveCfg(next) {
    setCfg(next);
    try { await api.put(`/press/clients/${clientId}/warm-config`, next); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function loadSuppression() {
    try { setSupp(await api.get(`/press/clients/${clientId}/suppression`)); }
    catch (e) { toast(e.message, 'error'); }
  }

  function exportCsv() {
    const rows = (data?.recipients || []).map(r => [
      r.name, r.email, r.company, r.opens, r.clicks, r.warm_at ? 'warm' : '',
      r.replied ? 'replied' : '', r.bounced ? 'bounced' : '', (r.clicked_urls || []).join(' | '),
    ]);
    const header = ['Name', 'Email', 'Outlet', 'Opens', 'Clicks', 'Warm', 'Replied', 'Bounced', 'Clicked URLs'];
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `press-results-${(release.title || 'campaign').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.csv`;
    a.click();
  }

  function sortBy(key) {
    setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  }
  const rows = [...(data?.recipients || [])].sort((a, b) => {
    const dir = sort.dir === 'desc' ? -1 : 1;
    const av = a[sort.key] ?? 0, bv = b[sort.key] ?? 0;
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });

  const t = data?.totals || {};
  const Stat = ({ n, label, sub }) => (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{n ?? '—'}</div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>{label}{sub != null ? ` · ${sub}%` : ''}</div>
    </div>
  );
  const Th = ({ k, children, right }) => (
    <th onClick={() => sortBy(k)} style={{ cursor: 'pointer', textAlign: right ? 'right' : 'left', padding: '6px 8px', fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
      {children}{sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  if (loading) return <div className="text-subtle" style={{ padding: 16 }}>Loading results…</div>;

  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline', padding: 14, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
        <Stat n={t.recipients} label="recipients" />
        <Stat n={t.opened} label="opened" sub={t.open_rate} />
        <Stat n={t.clicked} label="clicked" sub={t.click_rate} />
        <Stat n={t.replied} label="replied" sub={t.reply_rate} />
        <div style={{ minWidth: 90 }}>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: t.warm ? '#c2410c' : 'var(--text)' }}>{t.warm ?? 0}</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>🔥 warm</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {/* Warm threshold */}
      {cfg && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 600 }}>“Warm” when</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            opens ≥
            <input type="number" min="1" value={cfg.min_opens ?? 3} onChange={e => saveCfg({ ...cfg, min_opens: parseInt(e.target.value, 10) || 1 })}
              style={{ width: 48, padding: '2px 5px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={cfg.any_click !== false} onChange={e => saveCfg({ ...cfg, any_click: e.target.checked })} />
            or any link click
          </label>
          <span style={{ color: 'var(--text-subtle)' }}>· warm journalists appear on the client’s coverage dashboard automatically.</span>
        </div>
      )}

      {/* Per-recipient table */}
      <div style={{ overflowX: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: 'var(--border-w) solid var(--card-border)' }}>
            <Th k="name">Journalist</Th>
            <Th k="opens" right>Opens</Th>
            <Th k="clicks" right>Clicks</Th>
            <Th k="interest_score" right>Interest</Th>
            <Th k="warm_at">Status</Th>
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={5} style={{ padding: 14, color: 'var(--text-subtle)' }}>No sends yet — results appear once the campaign goes out.</td></tr>}
            {rows.map(r => (
              <tr key={r.contact_id} style={{ borderTop: 'var(--border-w) solid var(--accent-soft)' }}>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{r.name || r.email}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{r.company || ''}{r.company && r.email ? ' · ' : ''}{r.email}</div>
                  {r.clicked_urls?.length ? <div style={{ fontSize: 11, color: 'var(--accent)' }}>clicked: {r.clicked_urls.slice(0, 2).join(', ')}{r.clicked_urls.length > 2 ? '…' : ''}</div> : null}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: r.opens >= 3 ? 700 : 400 }}>{r.opens || 0}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: r.clicks ? 700 : 400, color: r.clicks ? 'var(--accent)' : 'inherit' }}>{r.clicks || 0}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.interest_score || 0}</td>
                <td style={{ padding: '6px 8px' }}>
                  {r.warm_at ? <span className="chip" style={{ background: '#fff2e8', color: '#c2410c' }}>🔥 warm</span>
                    : r.bounced ? <span className="chip" style={{ color: 'var(--negative)' }}>bounced</span>
                    : r.replied ? <span className="chip chip-accent">replied</span>
                    : r.opened ? <span className="chip">opened</span>
                    : <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Suppression */}
      <div>
        {!supp ? (
          <button className="btn btn-link btn-sm" onClick={loadSuppression}>Show unsubscribes &amp; do-not-contact</button>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="field-label">Unsubscribed ({supp.unsubscribed.length})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 12 }}>
                {!supp.unsubscribed.length && <div className="text-subtle">None.</div>}
                {supp.unsubscribed.map(u => <div key={u.id} style={{ padding: '3px 0' }}>{u.name || u.email} <span className="text-subtle">· {u.email}</span></div>)}
              </div>
            </div>
            <div>
              <div className="field-label">Do-not-contact / bounced ({supp.do_not_contact.length})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 12 }}>
                {!supp.do_not_contact.length && <div className="text-subtle">None.</div>}
                {supp.do_not_contact.map(u => <div key={u.id} style={{ padding: '3px 0' }}>{u.name || u.email} <span className="text-subtle">· {u.email}</span></div>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
