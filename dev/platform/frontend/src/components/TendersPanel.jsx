import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Tenders — October's own tender pipeline (Settings → Templates & tools).
// Sources + manual scan, the filtered notice list (dismiss / Start with Claude),
// and the auto-run email digest settings. Backend: routes/tender.js.

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
  return isNaN(ms) ? null : Math.ceil(ms / 86400000);
}
function fmtValue(n, currency) {
  if (n == null) return '—';
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'CAD' ? 'C$' : '';
  return `${sym}${Math.round(Number(n)).toLocaleString('en-GB')}`;
}

export default function TendersPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [notices, setNotices] = useState([]);
  const [counts, setCounts] = useState(null);
  const [market, setMarket] = useState('');
  const [relevance, setRelevance] = useState('match');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Digest / alerts settings
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestEmail, setDigestEmail] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  // US (SAM.gov) API key
  const [samKey, setSamKey] = useState('');
  const [savingSam, setSavingSam] = useState(false);
  // Per-notice chat
  const [chatNotice, setChatNotice] = useState(null);
  // Inline closing-date edit: { id, value }
  const [editDate, setEditDate] = useState(null);
  // Company details (SQ facts every bid reuses)
  const [companyFields, setCompanyFields] = useState([]);
  const [company, setCompany] = useState({});
  const [companyOpen, setCompanyOpen] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  // Add a tender by URL
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);

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
  async function loadSettings() {
    try {
      const s = await api.get('/tender/settings');
      setDigestEnabled(!!s.digest_enabled);
      setDigestEmail(s.digest_email || '');
    } catch (e) { /* non-fatal */ }
  }
  async function loadCompany() {
    try {
      const [fields, p] = await Promise.all([api.get('/tender/profile/company-fields'), api.get('/tender/profile')]);
      setCompanyFields(fields || []);
      setCompany(p.company || {});
    } catch (e) { /* non-fatal */ }
  }
  async function saveCompany() {
    setSavingCompany(true);
    try {
      const r = await api.put('/tender/profile/company', { company });
      setCompany(r.company || {});
      toast('Company details saved — every bid will use these', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingCompany(false); }
  }

  useEffect(() => { loadSources(); loadSettings(); loadCompany(); }, []); // eslint-disable-line
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

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const s = await api.put('/tender/settings', { digest_enabled: digestEnabled, digest_email: digestEmail.trim() });
      setDigestEnabled(!!s.digest_enabled);
      setDigestEmail(s.digest_email || '');
      toast('Alert settings saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingSettings(false); }
  }
  async function sendTest() {
    try {
      const r = await api.post('/tender/digest/run', {});
      toast(r.sent ? `Test digest sent (${r.count}) to ${r.to}` : `Nothing to send: ${r.reason}`, r.sent ? 'success' : undefined);
    } catch (e) { toast(e.message, 'error'); }
  }
  async function saveSamKey() {
    if (!samKey.trim()) return;
    setSavingSam(true);
    try {
      await api.post('/settings/platform-keys', { SAM_API_KEY: samKey.trim() });
      setSamKey('');
      toast('SAM.gov API key saved — run a scan to pull US notices', 'success');
      loadSources();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingSam(false); }
  }

  async function dismiss(n) {
    setNotices(prev => prev.filter(x => x.id !== n.id));         // optimistic
    try { await api.post(`/tender/notices/${n.id}/dismiss`, {}); }
    catch (e) { toast(e.message, 'error'); loadNotices(); }
  }

  async function saveDate(n) {
    try {
      const updated = await api.put(`/tender/notices/${n.id}/closing`, { closing_at: editDate.value || null });
      setNotices(prev => prev.map(x => x.id === n.id ? { ...x, closing_at: updated.closing_at, needs_manual_check: updated.needs_manual_check } : x));
      setEditDate(null);
      toast('Closing date updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function addByUrl() {
    const url = addUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    toast('Reading the notice…');
    try {
      const r = await api.post('/tender/notices/add-url', { url });
      toast(r.outcome === 'skipped' ? `Already tracked: ${r.title}` : `Added: ${r.title}`, 'success');
      setAddUrl('');
      await loadNotices();
    } catch (e) { toast(e.message, 'error'); }
    finally { setAdding(false); }
  }

  return (
    <div className="stack stack-lg">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="h3" style={{ margin: '0 0 4px' }}>Tenders</h2>
          <p className="body-sm text-muted" style={{ margin: 0, maxWidth: 640 }}>
            Public-sector PR &amp; communications tenders in October’s niche — arts, culture, design,
            heritage and destination buyers. Pulled from the portal feeds below, deduplicated, and
            filtered to marketing/PR work for creative-sector buyers. This is October’s own pipeline,
            not a client’s.
          </p>
        </div>
        <button className="btn btn-primary" onClick={runScan} disabled={running}>
          {running ? 'Scanning…' : 'Run scan now'}
        </button>
      </div>

      {/* Notices — the list first; it's what you act on */}
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

        {/* Add a tender by URL — the guaranteed path for one you've already found. */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input className="input" type="url" placeholder="Found one yourself? Paste a tender URL to add it…"
            value={addUrl} onChange={e => setAddUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addByUrl(); } }}
            style={{ flex: 1, minWidth: 280 }} />
          <button className="btn btn-secondary btn-sm" onClick={addByUrl} disabled={adding || !addUrl.trim()}>
            {adding ? 'Adding…' : 'Add tender'}
          </button>
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
                  <th style={thStyle}>Title</th><th style={thStyle}>Buyer</th><th style={thStyle}>Market</th>
                  <th style={thStyle}>Value</th><th style={thStyle}>Closes</th><th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {notices.map(n => {
                  const dl = daysLeft(n.closing_at);
                  return (
                    <tr key={n.id}>
                      <td style={tdStyle}>
                        {/* Always clickable: the direct notice URL when we have one,
                            otherwise a web search for the title + buyer so the row
                            is never a dead end. */}
                        <a href={n.url || `https://www.google.com/search?q=${encodeURIComponent(`${n.title || ''} ${n.buyer_name || ''} tender`.trim())}`}
                           target="_blank" rel="noopener noreferrer" title={n.url ? 'Open the notice' : 'No direct link — search the web for this notice'}>
                          {n.title || n.external_ref}
                        </a>
                        {!n.url && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-subtle)' }}>↗ search</span>}
                        {n.needs_manual_check && (
                          <span className="badge" style={{ marginLeft: 8, fontSize: 11 }}
                            title="Closing date couldn’t be read automatically — open the notice to confirm the deadline before bidding.">
                            deadline?
                          </span>
                        )}
                        {n.relevance_reason && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-subtle)' }}>· {n.relevance_reason}</span>}
                      </td>
                      <td style={tdStyle}>{n.buyer_name || '—'}</td>
                      <td style={tdStyle}>{(n.market || '').toUpperCase() || '—'}</td>
                      <td style={tdStyle}>{fmtValue(n.value_min, n.currency)}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {editDate?.id === n.id ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input type="date" value={editDate.value} autoFocus
                              onChange={e => setEditDate({ id: n.id, value: e.target.value })}
                              style={{ padding: '2px 5px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
                            <button className="btn btn-primary btn-sm" onClick={() => saveDate(n)}>Save</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditDate(null)}>✕</button>
                          </span>
                        ) : (
                          <>
                            {n.closing_at ? fmtDate(n.closing_at) : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                            {dl != null && dl >= 0 && dl <= 14 && <span style={{ marginLeft: 6, color: 'var(--danger, #c0392b)', fontWeight: 700 }}>{dl}d</span>}
                            <button className="btn-link" title="Set / edit closing date"
                              onClick={() => setEditDate({ id: n.id, value: n.closing_at ? new Date(n.closing_at).toISOString().slice(0, 10) : '' })}
                              style={{ marginLeft: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--link, #06c)', fontSize: 12 }}>✎</button>
                          </>
                        )}
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/tenders/${n.id}`)} title="Open the bid workspace — assess fit, plan and produce the bid with Claude">{n.has_chat ? 'Continue with Claude' : 'Start with Claude'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => dismiss(n)} title="Dismiss — hide this and don't show it again" style={{ marginLeft: 6 }}>Dismiss</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alerts — auto-run email digest */}
      <div className="card">
        <div className="oview-grplabel">Email alerts</div>
        <p className="body-sm text-muted" style={{ margin: '0 0 10px' }}>
          The scan runs automatically every day. Turn this on to get emailed the new creative-sector PR
          matches each time — nothing to check by hand.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
            <input type="checkbox" checked={digestEnabled} onChange={e => setDigestEnabled(e.target.checked)} />
            Email me new tenders
          </label>
          <input className="input" type="email" placeholder="you@octobercomms.com" value={digestEmail}
            onChange={e => setDigestEmail(e.target.value)} style={{ minWidth: 260 }} />
          <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={sendTest} title="Send the digest now, to check it works">Send test</button>
        </div>
      </div>

      {/* Company details — the SQ facts every bid reuses */}
      <div className="card">
        <button className="oview-grplabel" onClick={() => setCompanyOpen(o => !o)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
          Company details {companyOpen ? '▾' : '▸'}
        </button>
        <p className="body-sm text-muted" style={{ margin: '4px 0 0' }}>
          The registration, insurance, accreditation and policy facts a public-sector tender asks for.
          Enter them once — every bid uses them verbatim, so Claude never invents a company or VAT number.
        </p>
        {companyOpen && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginTop: 12 }}>
              {companyFields.map(([key, label]) => {
                const multiline = ['registered_address', 'trading_address', 'directors', 'turnover', 'insurances', 'accreditations', 'policies', 'additional', 'bid_contact'].includes(key);
                return (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    {multiline
                      ? <textarea value={company[key] || ''} rows={2} onChange={e => setCompany(c => ({ ...c, [key]: e.target.value }))}
                          style={{ resize: 'vertical', padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
                      : <input className="input" value={company[key] || ''} onChange={e => setCompany(c => ({ ...c, [key]: e.target.value }))} />}
                  </label>
                );
              })}
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveCompany} disabled={savingCompany} style={{ marginTop: 12 }}>
              {savingCompany ? 'Saving…' : 'Save company details'}
            </button>
          </>
        )}
      </div>

      {/* Sources — the places it searches */}
      <div className="card">
        <div className="oview-grplabel">Sources</div>
        <div className="md-table-wrap">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Source</th><th style={thStyle}>Market</th><th style={thStyle}>Status</th>
                <th style={thStyle}>Last polled</th><th style={thStyle}>Last result</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.name}</td>
                  <td style={tdStyle}>{(s.market || '').toUpperCase() || '—'}</td>
                  <td style={tdStyle}><span className={'suite-status-dot' + (s.enabled ? ' ok' : '')} style={{ marginRight: 6 }} />{s.enabled ? 'On' : 'Off'}</td>
                  <td style={tdStyle}>{fmtDate(s.last_polled_at)}</td>
                  <td style={{ ...tdStyle, color: 'var(--text-subtle)' }}>{s.last_status || '—'}</td>
                </tr>
              ))}
              {!sources.length && <tr><td style={tdStyle} colSpan={5}>No sources configured.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <span className="body-sm text-muted">US (SAM.gov) needs a free API key:</span>
          <input className="input" type="password" placeholder="SAM.gov API key" value={samKey}
            onChange={e => setSamKey(e.target.value)} style={{ minWidth: 240 }} />
          <button className="btn btn-ghost btn-sm" onClick={saveSamKey} disabled={savingSam || !samKey.trim()}>
            {savingSam ? 'Saving…' : 'Save key'}
          </button>
        </div>
      </div>

      {chatNotice && <TenderChatModal notice={chatNotice} onClose={() => setChatNotice(null)} />}
    </div>
  );
}

// "Start with Claude" — a per-notice chat to assess fit and outline a bid.
function TenderChatModal({ notice, onClose }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const SUGGESTIONS = [
    'Is this a genuine fit for October? Run the go/no-go test.',
    'What are the risks and what would we need to win it?',
    'Outline a bid approach — structure and angle.',
  ];

  useEffect(() => { api.get(`/tender/notices/${notice.id}/chat`).then(setMessages).catch(e => toast(e.message, 'error')); }, [notice.id]); // eslint-disable-line
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, sending]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setMessages(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: msg }]);
    setInput(''); setSending(true);
    try {
      const reply = await api.post(`/tender/notices/${notice.id}/chat`, { message: msg });
      setMessages(prev => [...prev, reply]);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSending(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>Start with Claude</h3>
            <p className="caption" style={{ margin: 0, color: 'var(--text-subtle)' }}>{notice.title || notice.external_ref}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1, minHeight: 160, paddingRight: 4 }}>
          {messages.length === 0 && !sending && (
            <div className="empty" style={{ padding: 14 }}>
              <div style={{ marginBottom: 10 }}>Ask Claude to assess this tender and help you bid.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SUGGESTIONS.map(s => <button key={s} className="btn btn-secondary btn-sm" style={{ textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              <div className={m.role === 'user' ? '' : 'card body-sm'} style={{
                maxWidth: m.role === 'user' ? '80%' : '92%',
                background: m.role === 'user' ? 'var(--text)' : undefined, color: m.role === 'user' ? '#fff' : undefined,
                borderRadius: m.role === 'user' ? 'var(--r-md)' : undefined, padding: m.role === 'user' ? '10px 14px' : undefined,
                fontSize: 14, lineHeight: 1.55,
              }}>
                {m.role === 'user'
                  ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                  : <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content || ''}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {sending && <div className="caption" style={{ color: 'var(--text-subtle)', padding: '4px 2px' }}>Thinking…</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask about fit, risks, or a bid approach… (Enter to send)"
            style={{ flex: 1, resize: 'vertical', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          <button className="btn btn-primary" disabled={sending || !input.trim()} onClick={() => send()}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}

const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 17, fontWeight: 700, margin: '10px 0 8px' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 6px' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 10px', lineHeight: 1.55 }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 10px', paddingLeft: 20 }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 10px', paddingLeft: 20 }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 5, lineHeight: 1.5 }} {...p} />,
  table: ({ node, ...p }) => <div className="md-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} {...p} /></div>,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--card-border)' }} {...p} />,
};

const thStyle = { textAlign: 'left', padding: '7px 9px', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' };
const tdStyle = { padding: '7px 9px', borderBottom: '1px solid var(--card-border)', verticalAlign: 'top' };
