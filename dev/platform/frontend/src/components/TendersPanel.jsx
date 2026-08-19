import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Tenders — the org-level (October's own) tender pipeline, sitting in
// Settings → Templates & tools next to Leads. Phase 1 surface: the source
// feeds with their last-poll status + a manual "Run scan now", and the
// ingested notices with light filters. Scoring, briefs and the digest arrive
// in later phases. Backend: routes/tender.js (agency-staff only).

const MARKETS = [
  { k: '', label: 'All markets' },
  { k: 'uk', label: '🇬🇧 UK' },
  { k: 'eu', label: '🇪🇺 EU' },
  { k: 'canada', label: '🇨🇦 Canada' },
  { k: 'us', label: '🇺🇸 US' },
];

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

function daysLeft(d) {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  if (isNaN(ms)) return null;
  return Math.ceil(ms / 86400000);
}

function fmtValue(n, currency) {
  if (n == null) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'CAD' ? 'C$' : '';
  return `${sym}${Math.round(Number(n)).toLocaleString('en-GB')}`;
}

export default function TendersPanel() {
  const toast = useToast();
  const [sources, setSources] = useState([]);
  const [notices, setNotices] = useState([]);
  const [counts, setCounts] = useState(null);
  const [market, setMarket] = useState('');
  const [relevance, setRelevance] = useState('match');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function loadSources() {
    try { setSources(await api.get('/tender/sources')); } catch (e) { toast(e.message, 'error'); }
  }

  async function loadNotices() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ upcoming: '1', relevance, limit: '300' });
      if (market) params.set('market', market);
      const res = await api.get(`/tender/notices?${params.toString()}`);
      setNotices(res.notices || []);
      setCounts(res.counts || null);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadSources(); }, []); // eslint-disable-line
  useEffect(() => { loadNotices(); }, [market, relevance]); // eslint-disable-line

  async function runScan() {
    if (running) return;
    setRunning(true);
    toast('Scanning tender portals — this can take a minute…');
    try {
      const report = await api.post('/tender/ingest/run', {});
      const t = report.totals || {};
      toast(`Scan done: ${t.inserted || 0} new, ${t.updated || 0} updated, ${t.expired || 0} closed`, 'success');
      await Promise.all([loadSources(), loadNotices()]);
    } catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  return (
    <div className="stack stack-lg">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="h3" style={{ margin: '0 0 4px' }}>Tenders</h2>
            <p className="body-sm text-muted" style={{ margin: 0, maxWidth: 640 }}>
              Public-sector PR &amp; communications tenders in October’s niche — arts, culture, design,
              heritage and destination buyers. Pulled from the portal feeds below, deduplicated, and
              filtered to marketing/PR work for creative-sector buyers (the feeds carry a lot of
              unrelated fit-out, maintenance and events work — that’s hidden by default). This is
              October’s own pipeline, not a client’s.
            </p>
          </div>
          <button className="btn btn-primary" onClick={runScan} disabled={running}>
            {running ? 'Scanning…' : 'Run scan now'}
          </button>
        </div>
      </div>

      {/* Sources + their last poll status */}
      <div className="card">
        <div className="oview-grplabel">Sources</div>
        <div className="md-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Market</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last polled</th>
                <th style={thStyle}>Last result</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.name}</td>
                  <td style={tdStyle}>{(s.market || '').toUpperCase() || '—'}</td>
                  <td style={tdStyle}>
                    <span className={'suite-status-dot' + (s.enabled ? ' ok' : '')} style={{ marginRight: 6 }} />
                    {s.enabled ? 'On' : 'Off'}
                  </td>
                  <td style={tdStyle}>{fmtDate(s.last_polled_at)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-subtle)' }}>{s.last_status || '—'}</td>
                </tr>
              ))}
              {!sources.length && <tr><td style={tdStyle} colSpan={5}>No sources configured.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="body-sm text-muted" style={{ margin: '10px 0 0' }}>
          CanadaBuys and SAM.gov (US) ship switched off until their live feeds are validated; UK (D3) and EU (TED) are on.
        </p>
      </div>

      {/* Notices */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="oview-grplabel" style={{ margin: 0 }}>Open notices{notices.length ? ` (${notices.length})` : ''}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="input" value={relevance} onChange={e => setRelevance(e.target.value)} style={{ width: 'auto' }}>
              <option value="match">Creative-sector PR{counts ? ` (${counts.match})` : ''}</option>
              <option value="comms">All PR / comms{counts ? ` (${counts.match + counts.maybe})` : ''}</option>
              <option value="all">Everything{counts ? ` (${counts.total})` : ''}</option>
            </select>
            <select className="input" value={market} onChange={e => setMarket(e.target.value)} style={{ width: 'auto' }}>
              {MARKETS.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <p className="body-sm text-muted">Loading…</p>
        ) : !notices.length ? (
          <div className="empty" style={{ padding: 18 }}>
            {counts && counts.total > 0
              ? <>No creative-sector PR tenders in the current feed. Switch to <strong>All PR / comms</strong> or <strong>Everything</strong> above to widen the filter.</>
              : <>Nothing ingested yet. Hit <strong>Run scan now</strong> to pull the latest notices from the live feeds.</>}
          </div>
        ) : (
          <div className="md-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Buyer</th>
                  <th style={thStyle}>Market</th>
                  <th style={thStyle}>Value</th>
                  <th style={thStyle}>Closes</th>
                </tr>
              </thead>
              <tbody>
                {notices.map(n => {
                  const dl = daysLeft(n.closing_at);
                  return (
                    <tr key={n.id}>
                      <td style={tdStyle}>
                        {n.url
                          ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title || n.external_ref}</a>
                          : (n.title || n.external_ref)}
                        {n.needs_manual_check && <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}>check</span>}
                        {n.relevance_reason && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-subtle)' }}>· {n.relevance_reason}</span>}
                      </td>
                      <td style={tdStyle}>{n.buyer_name || '—'}</td>
                      <td style={tdStyle}>{(n.market || '').toUpperCase() || '—'}</td>
                      <td style={tdStyle}>{fmtValue(n.value_min, n.currency)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {fmtDate(n.closing_at)}
                        {dl != null && dl >= 0 && dl <= 14 && (
                          <span style={{ marginLeft: 6, color: 'var(--danger, #c0392b)', fontWeight: 700 }}>{dl}d</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '7px 9px', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' };
const tdStyle = { padding: '7px 9px', borderBottom: '1px solid var(--card-border)', verticalAlign: 'top' };
