import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';

const LOCATIONS = [
  { name: 'United Kingdom', code: 2826, flag: '🇬🇧' },
  { name: 'United States', code: 2840, flag: '🇺🇸' },
  { name: 'Ireland', code: 2372, flag: '🇮🇪' },
  { name: 'Australia', code: 2036, flag: '🇦🇺' },
  { name: 'Canada', code: 2124, flag: '🇨🇦' },
];

export default function ClientSEOPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [tags, setTags] = useState([]);
  const [seoSummary, setSeoSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [filterTag, setFilterTag] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [search, setSearch] = useState('');
  const [historyModal, setHistoryModal] = useState(null);
  const [history, setHistory] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkDevice, setBulkDevice] = useState('desktop');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkLocation, setBulkLocation] = useState(2826);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulking, setBulking] = useState(false);
  const [newKw, setNewKw] = useState({ keyword: '', target_url: '', device: 'desktop', tag: '', location_name: 'United Kingdom', location_code: 2826 });

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/rankings/keywords?client_id=${id}`),
      api.get(`/rankings/tags/${id}`),
    ]).then(([c, kws, t]) => {
      setClient(c);
      setKeywords(kws);
      setTags(t);
    }).finally(() => setLoading(false));
  }, [id]);

  async function loadSeoSummary() {
    if (!client?.domain) return;
    setLoadingSummary(true);
    try {
      const [bl, llm] = await Promise.allSettled([
        api.get(`/rankings/seo-summary/${id}`),
        api.get(`/rankings/llm-visibility/${id}`),
      ]);
      setSeoSummary({
        backlinks: bl.status === 'fulfilled' ? bl.value : null,
        llm: llm.status === 'fulfilled' ? llm.value : null,
      });
    } finally {
      setLoadingSummary(false);
    }
  }

  async function openHistory(kw) {
    setHistoryModal(kw);
    const data = await api.get(`/rankings/keywords/${kw.id}/history`);
    setHistory(data);
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const kw = await api.post('/rankings/keywords', { ...newKw, client_id: id });
      setKeywords(prev => [...prev, kw]);
      setNewKw({ keyword: '', target_url: '', device: 'desktop', tag: '', location_name: 'United Kingdom', location_code: 2826 });
      setShowAddForm(false);
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(kwId) {
    if (!window.confirm('Delete this keyword?')) return;
    await api.delete(`/rankings/keywords/${kwId}`);
    setKeywords(prev => prev.filter(k => k.id !== kwId));
  }

  async function handleCheckAll() {
    setChecking(true);
    try {
      await api.post(`/rankings/check/${id}`);
      setTimeout(async () => {
        const kws = await api.get(`/rankings/keywords?client_id=${id}`);
        setKeywords(kws);
        setChecking(false);
      }, 3000);
    } catch (err) { alert(err.message); setChecking(false); }
  }

  async function handleBulkImport(e) {
    e.preventDefault();
    setBulking(true); setBulkMsg('');
    try {
      const loc = LOCATIONS.find(l => l.code === Number(bulkLocation)) || LOCATIONS[0];
      const kws = bulkText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const parts = line.split(',').map(p => p.trim());
        return { keyword: parts[0], target_url: parts[1] || '', tag: parts[2] || bulkTag, device: bulkDevice, location_code: loc.code, location_name: loc.name };
      });
      const { inserted } = await api.post('/rankings/keywords/bulk', { client_id: id, keywords: kws });
      setBulkMsg(`Imported ${inserted} keyword${inserted !== 1 ? 's' : ''}.`);
      const updated = await api.get(`/rankings/keywords?client_id=${id}`);
      setKeywords(updated);
      setBulkText('');
    } catch (err) { setBulkMsg(`Error: ${err.message}`); }
    finally { setBulking(false); }
  }

  async function handleExport() {
    const res = await api.raw(`/rankings/export/${id}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'keywords.csv'; a.click();
  }

  const filtered = keywords.filter(k => {
    if (filterTag && k.tag !== filterTag) return false;
    if (filterLocation && String(k.location_code) !== String(filterLocation)) return false;
    if (search && !k.keyword.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  const bl = seoSummary?.backlinks;
  const llm = seoSummary?.llm;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>SEO &amp; Rankings — {client?.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport} style={s.btnGhost}>Export CSV</button>
          <button onClick={handleCheckAll} style={s.btnGhost} disabled={checking}>{checking ? 'Checking…' : 'Check All Ranks'}</button>
          <button onClick={() => { setShowBulkForm(true); setShowAddForm(false); }} style={s.btnGhost}>Bulk Import</button>
          <button onClick={() => { setShowAddForm(true); setShowBulkForm(false); }} style={s.btn}>+ Add Keyword</button>
        </div>
      </div>

      {/* DA / Backlinks / LLM cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {/* Domain Authority */}
        <div style={s.card}>
          <div style={s.cardTitle}>Domain Authority &amp; Backlinks</div>
          {!client?.domain ? (
            <p style={{ fontSize: 12, color: '#888' }}>
              Add a domain in <Link to={`/clients/${id}?tab=details`} style={{ color: '#1a1a1a' }}>client details</Link> to enable this.
            </p>
          ) : seoSummary === null ? (
            <button onClick={loadSeoSummary} disabled={loadingSummary} style={s.btnSm}>
              {loadingSummary ? 'Loading…' : 'Fetch data'}
            </button>
          ) : bl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <div style={s.metricRow}><span style={s.metricVal}>{bl.domain_rank ?? '—'}</span><span style={s.metricLabel}>Domain Rank</span></div>
              <div style={s.metricRow}><span style={s.metricVal}>{(bl.referring_domains || 0).toLocaleString()}</span><span style={s.metricLabel}>Referring Domains</span></div>
              <div style={s.metricRow}><span style={s.metricVal}>{(bl.backlinks_total || 0).toLocaleString()}</span><span style={s.metricLabel}>Total Backlinks</span></div>
              {bl.new_backlinks != null && <div style={s.metricRow}><span style={{ ...s.metricVal, color: '#2e7d32' }}>+{bl.new_backlinks}</span><span style={s.metricLabel}>New this month</span></div>}
              {bl.lost_backlinks != null && <div style={s.metricRow}><span style={{ ...s.metricVal, color: '#c62828' }}>-{bl.lost_backlinks}</span><span style={s.metricLabel}>Lost this month</span></div>}
              <button onClick={loadSeoSummary} style={{ ...s.btnSm, marginTop: 4 }}>Refresh</button>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#c62828' }}>No data returned — check DataForSEO credentials.</p>
          )}
        </div>

        {/* AI Visibility */}
        <div style={s.card}>
          <div style={s.cardTitle}>AI Brand Visibility</div>
          {!client?.domain ? (
            <p style={{ fontSize: 12, color: '#888' }}>
              Add a domain in <Link to={`/clients/${id}?tab=details`} style={{ color: '#1a1a1a' }}>client details</Link> to enable this.
            </p>
          ) : seoSummary === null ? (
            <button onClick={loadSeoSummary} disabled={loadingSummary} style={s.btnSm}>
              {loadingSummary ? 'Loading…' : 'Fetch data'}
            </button>
          ) : llm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              <div style={s.metricRow}><span style={s.metricVal}>{llm.keywords_checked}</span><span style={s.metricLabel}>Keywords checked</span></div>
              <div style={s.metricRow}><span style={s.metricVal}>{llm.ai_overview_present}</span><span style={s.metricLabel}>Triggered AI Overview</span></div>
              <div style={s.metricRow}>
                <span style={{ ...s.metricVal, color: llm.brand_visible > 0 ? '#2e7d32' : '#c62828' }}>{llm.brand_visible}</span>
                <span style={s.metricLabel}>Brand mentioned</span>
              </div>
              {llm.details?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {llm.details.map((d, i) => (
                    <div key={i} style={{ marginBottom: 6, padding: '6px 8px', background: '#f9f9f9', borderRadius: 4 }}>
                      <div style={{ fontWeight: 600 }}>{d.keyword}</div>
                      <div style={{ color: d.brand_mentioned ? '#2e7d32' : '#999' }}>
                        {d.brand_mentioned ? '✓ Brand visible' : 'Not mentioned'}
                        {d.has_ai_overview ? ' · AI Overview present' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#999' }}>No AI visibility data.</p>
          )}
        </div>

        {/* Rankings summary */}
        <div style={s.card}>
          <div style={s.cardTitle}>Rankings Summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <div style={s.metricRow}><span style={s.metricVal}>{keywords.length}</span><span style={s.metricLabel}>Keywords tracked</span></div>
            <div style={s.metricRow}><span style={s.metricVal}>{keywords.filter(k => k.current_position && k.current_position <= 10).length}</span><span style={s.metricLabel}>In top 10</span></div>
            <div style={s.metricRow}><span style={s.metricVal}>{keywords.filter(k => k.current_position && k.current_position <= 3).length}</span><span style={s.metricLabel}>In top 3</span></div>
            <div style={s.metricRow}><span style={s.metricVal}>{keywords.filter(k => !k.current_position).length}</span><span style={s.metricLabel}>Not ranking</span></div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select style={s.input} value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
          <option value="">All locations</option>
          {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
        </select>
        {tags.length > 0 && (
          <select style={s.input} value={filterTag} onChange={e => setFilterTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <input style={{ ...s.input, flex: 1 }} placeholder="Search keywords…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Add keyword form */}
      {showAddForm && (
        <div style={{ ...s.card, marginBottom: 16 }}>
          <div style={s.cardTitle}>Add Keyword</div>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr', gap: 12 }}>
              {[
                { label: 'Keyword', el: <input style={s.input} required value={newKw.keyword} onChange={e => setNewKw(p => ({ ...p, keyword: e.target.value }))} /> },
                { label: 'Target URL', el: <input style={s.input} value={newKw.target_url} onChange={e => setNewKw(p => ({ ...p, target_url: e.target.value }))} placeholder="https://…" /> },
                { label: 'Location', el: (
                  <select style={s.input} value={newKw.location_code} onChange={e => {
                    const loc = LOCATIONS.find(l => l.code === Number(e.target.value)) || LOCATIONS[0];
                    setNewKw(p => ({ ...p, location_code: loc.code, location_name: loc.name }));
                  }}>
                    {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                  </select>
                )},
                { label: 'Device', el: (
                  <select style={s.input} value={newKw.device} onChange={e => setNewKw(p => ({ ...p, device: e.target.value }))}>
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                  </select>
                )},
                { label: 'Tag', el: <input style={s.input} value={newKw.tag} onChange={e => setNewKw(p => ({ ...p, tag: e.target.value }))} placeholder="brand, category…" /> },
              ].map(({ label, el }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={s.label}>{label}</label>
                  {el}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={s.btn}>Add</button>
              <button type="button" onClick={() => setShowAddForm(false)} style={s.btnGhost}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk import form */}
      {showBulkForm && (
        <div style={{ ...s.card, marginBottom: 16 }}>
          <div style={s.cardTitle}>Bulk Import</div>
          <p style={{ margin: '8px 0 16px', fontSize: 12, color: '#888' }}>One keyword per line. Optional columns: <code>keyword, target_url, tag</code></p>
          <form onSubmit={handleBulkImport} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <textarea style={{ ...s.input, minHeight: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'enamel mug\nenamel teapot, https://falconenamelware.com/collections, tableware'}
              value={bulkText} onChange={e => setBulkText(e.target.value)} required />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {[
                { label: 'Location', el: <select style={s.input} value={bulkLocation} onChange={e => setBulkLocation(e.target.value)}>{LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}</select> },
                { label: 'Device', el: <select style={s.input} value={bulkDevice} onChange={e => setBulkDevice(e.target.value)}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select> },
                { label: 'Default Tag', el: <input style={s.input} value={bulkTag} onChange={e => setBulkTag(e.target.value)} placeholder="brand, category…" /> },
              ].map(({ label, el }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={s.label}>{label}</label>
                  {el}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="submit" style={s.btn} disabled={bulking}>{bulking ? 'Importing…' : 'Import'}</button>
              <button type="button" onClick={() => { setShowBulkForm(false); setBulkMsg(''); }} style={s.btnGhost}>Cancel</button>
              {bulkMsg && <span style={{ fontSize: 13, color: bulkMsg.startsWith('Error') ? '#c62828' : '#2e7d32' }}>{bulkMsg}</span>}
            </div>
          </form>
        </div>
      )}

      {/* Keywords table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>{['Keyword', 'Location', 'Device', 'Tag', 'Position', 'Prev', 'Best', 'Checked', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No keywords yet — add one above</td></tr>
            ) : filtered.map(kw => {
              const change = kw.current_position && kw.previous_position ? kw.previous_position - kw.current_position : null;
              const loc = LOCATIONS.find(l => l.code === kw.location_code);
              return (
                <tr key={kw.id} style={{ cursor: 'pointer' }} onClick={() => openHistory(kw)}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{kw.keyword}</div>
                    {kw.target_url && <div style={{ fontSize: 11, color: '#999' }}>{kw.target_url}</div>}
                  </td>
                  <td style={s.td}><span style={s.chip}>{loc ? `${loc.flag} ${loc.name}` : kw.location_name || '—'}</span></td>
                  <td style={s.td}><span style={s.chip}>{kw.device}</span></td>
                  <td style={s.td}>{kw.tag ? <span style={s.chip}>{kw.tag}</span> : '—'}</td>
                  <td style={s.td}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{kw.current_position || '—'}</span>
                    {change !== null && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: change > 0 ? '#2e7d32' : change < 0 ? '#c62828' : '#888' }}>
                        {change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : '–'}
                      </span>
                    )}
                  </td>
                  <td style={s.td}>{kw.previous_position || '—'}</td>
                  <td style={{ ...s.td, color: '#2e7d32', fontWeight: 600 }}>{kw.best_position || '—'}</td>
                  <td style={s.td}>{kw.last_checked ? new Date(kw.last_checked).toLocaleDateString('en-GB') : '—'}</td>
                  <td style={s.td} onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDelete(kw.id)} style={{ ...s.btnSm, color: '#c62828' }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* History modal */}
      {historyModal && (
        <div style={s.overlay} onClick={() => setHistoryModal(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{historyModal.keyword}</h3>
              <button onClick={() => setHistoryModal(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#888' }}>×</button>
            </div>
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={history} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                  <XAxis dataKey="checked_at" tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} tick={{ fontSize: 10 }} />
                  <YAxis reversed domain={['auto', 'auto']} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => [`Position ${v}`, 'Rank']} />
                  <Line type="monotone" dataKey="position" stroke="#1a1a1a" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>No rank history yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  card: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, padding: 20 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  metricVal: { fontSize: 20, fontWeight: 700, color: '#1a1a1a' },
  metricLabel: { fontSize: 11, color: '#888' },
  label: { fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '9px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13, width: '100%' },
  btn: { background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { background: 'transparent', color: '#444', border: '1px solid #ddd', borderRadius: 4, padding: '9px 16px', fontSize: 13, cursor: 'pointer' },
  btnSm: { background: '#f0f0f0', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  chip: { background: '#f0f0f0', borderRadius: 10, padding: '2px 8px', fontSize: 11, color: '#555' },
  tableWrap: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', marginTop: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 16px', textAlign: 'left', background: '#f9f9f9', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '1px solid #e8e8e8' },
  td: { padding: '11px 16px', borderBottom: '1px solid #f5f5f5', verticalAlign: 'middle' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'white', borderRadius: 8, padding: 28, width: '100%', maxWidth: 620, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' },
};
