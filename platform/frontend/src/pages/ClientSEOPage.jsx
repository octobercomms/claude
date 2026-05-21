import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const LOCATIONS = [
  { name: 'United Kingdom', code: 2826, flag: '🇬🇧' },
  { name: 'United States', code: 2840, flag: '🇺🇸' },
  { name: 'Germany', code: 2276, flag: '🇩🇪' },
  { name: 'France', code: 2250, flag: '🇫🇷' },
  { name: 'Ireland', code: 2372, flag: '🇮🇪' },
  { name: 'Australia', code: 2036, flag: '🇦🇺' },
  { name: 'Canada', code: 2124, flag: '🇨🇦' },
  { name: 'Italy', code: 2380, flag: '🇮🇹' },
  { name: 'Spain', code: 2724, flag: '🇪🇸' },
  { name: 'Netherlands', code: 2528, flag: '🇳🇱' },
  { name: 'Sweden', code: 2752, flag: '🇸🇪' },
  { name: 'Poland', code: 2616, flag: '🇵🇱' },
  { name: 'Belgium', code: 2056, flag: '🇧🇪' },
  { name: 'Portugal', code: 2620, flag: '🇵🇹' },
  { name: 'Switzerland', code: 2756, flag: '🇨🇭' },
  { name: 'Austria', code: 2040, flag: '🇦🇹' },
  { name: 'Norway', code: 2578, flag: '🇳🇴' },
  { name: 'Denmark', code: 2208, flag: '🇩🇰' },
  { name: 'Finland', code: 2246, flag: '🇫🇮' },
  { name: 'New Zealand', code: 2554, flag: '🇳🇿' },
  { name: 'Japan', code: 2392, flag: '🇯🇵' },
  { name: 'India', code: 2356, flag: '🇮🇳' },
  { name: 'Singapore', code: 2702, flag: '🇸🇬' },
  { name: 'UAE', code: 2784, flag: '🇦🇪' },
  { name: 'South Africa', code: 2710, flag: '🇿🇦' },
];

// Position pill: green for top 10, orange for 11-100. Legacy data shows
// italic + lighter, live DataForSEO data shows bold.
function PosBox({ p, legacy }) {
  if (p == null) return <span style={{ color: '#bbb' }}>—</span>;
  const top = p <= 10;
  return (
    <span style={{
      display: 'inline-block', minWidth: 28, textAlign: 'center', padding: '3px 8px',
      borderRadius: 5, fontSize: 13,
      fontWeight: legacy ? 500 : 700,
      fontStyle: legacy ? 'italic' : 'normal',
      background: top ? '#e4f4e8' : '#fcecd9',
      color: top ? '#1d7a3a' : '#9a5a13',
    }}>{p}</span>
  );
}

function fmtDay(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function ClientSEOPage() {
  const toast = useToast();
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [tags, setTags] = useState([]);
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
  const [seoMetrics, setSeoMetrics] = useState([]);
  const [seoMetricEdit, setSeoMetricEdit] = useState({ month: '', moz_da: '', authority_score: '', referring_domains: '', notes: '' });
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [backlinks, setBacklinks] = useState(null);
  const [backlinksLoading, setBacklinksLoading] = useState(false);
  const [backlinksError, setBacklinksError] = useState('');
  const [backlinksFetched, setBacklinksFetched] = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [kwView, setKwView] = useState('current');
  const [rankMatrix, setRankMatrix] = useState(null);
  const [rankMatrixLoading, setRankMatrixLoading] = useState(false);
  const [rankMatrixFetched, setRankMatrixFetched] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/rankings/keywords?client_id=${id}`),
      api.get(`/rankings/tags/${id}`),
      api.get(`/rankings/seo-metrics/${id}`),
    ]).then(([c, kws, t, metrics]) => {
      setClient(c);
      setKeywords(kws);
      setTags(t);
      setSeoMetrics(metrics);
      // Pre-fill edit form with current month
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const existing = metrics.find(m => m.month && m.month.startsWith(currentMonth.slice(0, 7)));
      if (existing) {
        setSeoMetricEdit({
          month: currentMonth,
          moz_da: existing.moz_da ?? '',
          authority_score: existing.authority_score ?? '',
          referring_domains: existing.referring_domains ?? '',
          notes: existing.notes ?? '',
        });
      } else {
        setSeoMetricEdit(p => ({ ...p, month: currentMonth }));
      }
    }).finally(() => setLoading(false));
  }, [id]);

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
    } catch (err) { toast(err.message, 'error'); }
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
    } catch (err) { toast(err.message, 'error'); setChecking(false); }
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

  async function handleSaveSeoMetrics(e) {
    e.preventDefault();
    setSavingMetrics(true);
    try {
      const updated = await api.put(`/rankings/seo-metrics/${id}`, {
        month: seoMetricEdit.month,
        moz_da: seoMetricEdit.moz_da !== '' ? Number(seoMetricEdit.moz_da) : null,
        authority_score: seoMetricEdit.authority_score !== '' ? Number(seoMetricEdit.authority_score) : null,
        referring_domains: seoMetricEdit.referring_domains !== '' ? Number(seoMetricEdit.referring_domains) : null,
        notes: seoMetricEdit.notes || null,
      });
      setSeoMetrics(prev => {
        const idx = prev.findIndex(m => m.month && m.month.startsWith(updated.month.slice(0, 7)));
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
        return [updated, ...prev].sort((a, b) => b.month.localeCompare(a.month));
      });
      toast('SEO metrics saved', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSavingMetrics(false); }
  }

  async function handleExport() {
    const res = await api.raw(`/rankings/export/${id}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'keywords.csv'; a.click();
  }

  async function loadBacklinks() {
    setBacklinksLoading(true);
    setBacklinksError('');
    try {
      const data = await api.get(`/rankings/seo-summary/${id}`);
      setBacklinks(data);
    } catch (err) {
      setBacklinksError(err.message);
    } finally {
      setBacklinksLoading(false);
      setBacklinksFetched(true);
    }
  }

  async function loadRankMatrix() {
    setRankMatrixLoading(true);
    try {
      const data = await api.get(`/rankings/history/${id}`);
      setRankMatrix(data);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRankMatrixLoading(false);
      setRankMatrixFetched(true);
    }
  }

  const filtered = keywords.filter(k => {
    if (filterTag && k.tag !== filterTag) return false;
    if (filterLocation && String(k.location_code) !== String(filterLocation)) return false;
    if (search && !k.keyword.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function sortValue(kw, key) {
    if (rankMatrix && rankMatrix.dates.includes(key)) {
      const cell = rankMatrix.positions[kw.id] ? rankMatrix.positions[kw.id][key] : null;
      return cell ? cell.p : null;
    }
    switch (key) {
      case 'keyword': return (kw.keyword || '').toLowerCase();
      case 'location': return (kw.location_name || '').toLowerCase();
      case 'device': return (kw.device || '').toLowerCase();
      case 'tag': return (kw.tag || '').toLowerCase();
      case 'position': return kw.current_position ?? null;
      case 'prev': return kw.previous_position ?? null;
      case 'best': return kw.best_position ?? null;
      case 'checked': return kw.last_checked ? new Date(kw.last_checked).getTime() : null;
      default: return null;
    }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const va = sortValue(a, sortKey);
        const vb = sortValue(b, sortKey);
        const na = va == null || va === '';
        const nb = vb == null || vb === '';
        if (na && nb) return 0;
        if (na) return 1;
        if (nb) return -1;
        const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const [activeTab, setActiveTab] = useState('keywords');

  useEffect(() => {
    if (activeTab === 'backlinks' && !backlinksFetched && !backlinksLoading) {
      loadBacklinks();
    }
  }, [activeTab]);

  useEffect(() => {
    if (kwView === 'history' && !rankMatrixFetched && !rankMatrixLoading) {
      loadRankMatrix();
    }
  }, [kwView]);

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>SEO — {client?.name}</h1>
        {activeTab === 'keywords' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExport} style={s.btnGhost}>Export CSV</button>
            <button onClick={handleCheckAll} style={s.btnGhost} disabled={checking}>{checking ? 'Checking…' : 'Check All Ranks'}</button>
            <button onClick={() => { setShowBulkForm(true); setShowAddForm(false); }} style={s.btnGhost}>Bulk Import</button>
            <button onClick={() => { setShowAddForm(true); setShowBulkForm(false); }} style={s.btn}>+ Add Keyword</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8e8e8', marginBottom: 24 }}>
        {[['keywords', 'Keywords'], ['authority', 'Authority'], ['backlinks', 'Backlinks']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14,
            fontWeight: activeTab === key ? 700 : 400, color: activeTab === key ? '#1a1a1a' : '#888',
            borderBottom: activeTab === key ? '2px solid #1a1a1a' : '2px solid transparent',
            marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {activeTab === 'keywords' && <>
      {/* Rankings summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Keywords tracked', val: keywords.length },
          { label: 'In top 3', val: keywords.filter(k => k.current_position && k.current_position <= 3).length },
          { label: 'In top 10', val: keywords.filter(k => k.current_position && k.current_position <= 10).length },
          { label: 'Not ranking', val: keywords.filter(k => !k.current_position).length },
        ].map(m => (
          <div key={m.label} style={s.card}>
            <div style={s.metricVal}>{m.val}</div>
            <div style={s.metricLabel}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select style={{ ...s.input, width: 220, flex: '0 0 auto' }} value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
          <option value="">All locations</option>
          {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
        </select>
        {tags.length > 0 && (
          <select style={{ ...s.input, width: 180, flex: '0 0 auto' }} value={filterTag} onChange={e => setFilterTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <input style={{ ...s.input, flex: 1, minWidth: 0 }} placeholder="Search keywords…" value={search} onChange={e => setSearch(e.target.value)} />
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

      {/* View toggle */}
      <div style={{ display: 'flex', marginBottom: 12 }}>
        {[['current', 'Current'], ['history', 'By date']].map(([v, label], i) => (
          <button key={v} onClick={() => setKwView(v)} style={{
            padding: '6px 16px', fontSize: 13, cursor: 'pointer', border: '1px solid #ddd',
            background: kwView === v ? '#1a1a1a' : '#fff', color: kwView === v ? '#fff' : '#444',
            borderRadius: i === 0 ? '4px 0 0 4px' : '0 4px 4px 0', borderLeft: i === 0 ? '1px solid #ddd' : 'none',
          }}>{label}</button>
        ))}
      </div>

      {/* Keywords table — current */}
      {kwView === 'current' && (
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {[['keyword', 'Keyword'], ['location', 'Location'], ['device', 'Device'], ['tag', 'Tag'], ['position', 'Position'], ['prev', 'Prev'], ['best', 'Best'], ['checked', 'Checked']].map(([key, label]) => (
                <th key={key} style={{ ...s.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => toggleSort(key)}>
                  {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={9} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No keywords yet — add one above</td></tr>
            ) : sorted.map(kw => {
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
                    <PosBox p={kw.current_position} legacy={kw.current_source === 'legacy'} />
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
      )}

      {/* Keywords table — by date */}
      {kwView === 'history' && (
      <div style={{ ...s.tableWrap, overflowX: 'auto' }}>
        {rankMatrixLoading ? (
          <div style={{ padding: 20, color: '#888', fontSize: 13 }}>Loading rank history…</div>
        ) : !rankMatrix || rankMatrix.dates.length === 0 ? (
          <div style={{ padding: 20, color: '#888', fontSize: 13 }}>No rank history yet — positions appear here once daily checks run or legacy data is imported.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, cursor: 'pointer', userSelect: 'none', position: 'sticky', left: 0, background: '#f9f9f9', zIndex: 2 }} onClick={() => toggleSort('keyword')}>
                  Keyword{sortKey === 'keyword' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ ...s.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => toggleSort('location')}>
                  Location{sortKey === 'location' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                {rankMatrix.dates.map(d => (
                  <th key={d} style={{ ...s.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'center' }} onClick={() => toggleSort(d)}>
                    {fmtDay(d)}{sortKey === d ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(kw => {
                const loc = LOCATIONS.find(l => l.code === kw.location_code);
                const kwHist = rankMatrix.positions[kw.id] || {};
                return (
                  <tr key={kw.id} style={{ cursor: 'pointer' }} onClick={() => openHistory(kw)}>
                    <td style={{ ...s.td, position: 'sticky', left: 0, background: '#fff', fontWeight: 600, fontSize: 13, zIndex: 1 }}>{kw.keyword}</td>
                    <td style={s.td}><span style={s.chip}>{loc ? `${loc.flag} ${loc.name}` : kw.location_name || '—'}</span></td>
                    {rankMatrix.dates.map(d => {
                      const cell = kwHist[d];
                      return (
                        <td key={d} style={{ ...s.td, textAlign: 'center' }}>
                          <PosBox p={cell ? cell.p : null} legacy={cell ? cell.src === 'legacy' : false} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {(kwView === 'current' || (rankMatrix && rankMatrix.dates.length > 0)) && (
        <p style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
          <strong>Bold</strong> = live DataForSEO data · <em>italic</em> = imported legacy data ·
          green = top 10 · orange = 11–100 · click a keyword for its position graph.
        </p>
      )}

      </>}

      {activeTab === 'authority' && (
      <div style={{ ...s.card, marginTop: 0 }}>
        <div style={s.cardTitle}>Manual SEO Metrics</div>

        {/* Metrics history table */}
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={s.table}>
            <thead>
              <tr>
                {['Month', 'Moz DA', 'Authority Score', 'Referring Domains', 'Notes', 'Edit'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seoMetrics.slice(0, 6).length === 0 ? (
                <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No metrics yet — enter values below</td></tr>
              ) : seoMetrics.slice(0, 6).map((m, i) => {
                const monthLabel = m.month
                  ? new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
                  : '—';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={s.td}>{monthLabel}</td>
                    <td style={s.td}>{m.moz_da ?? '—'}</td>
                    <td style={s.td}>{m.authority_score ?? '—'}</td>
                    <td style={s.td}>{m.referring_domains != null ? Number(m.referring_domains).toLocaleString('en-GB') : '—'}</td>
                    <td style={{ ...s.td, maxWidth: 200, color: '#666' }}>{m.notes || '—'}</td>
                    <td style={s.td}>
                      <button
                        style={s.btnSm}
                        onClick={() => {
                          const iso = m.month ? m.month.slice(0, 10) : '';
                          setSeoMetricEdit({
                            month: iso,
                            moz_da: m.moz_da ?? '',
                            authority_score: m.authority_score ?? '',
                            referring_domains: m.referring_domains ?? '',
                            notes: m.notes ?? '',
                          });
                        }}
                      >Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Inline edit / entry form */}
        <form onSubmit={handleSaveSeoMetrics} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            {seoMetricEdit.month
              ? `Editing: ${new Date(seoMetricEdit.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`
              : 'Enter / update metrics'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 2fr', gap: 12 }}>
            {[
              { label: 'Month', el: <input type="date" style={s.input} value={seoMetricEdit.month} onChange={e => setSeoMetricEdit(p => ({ ...p, month: e.target.value }))} required /> },
              { label: 'Moz DA', el: <input type="number" min="0" max="100" style={s.input} value={seoMetricEdit.moz_da} onChange={e => setSeoMetricEdit(p => ({ ...p, moz_da: e.target.value }))} placeholder="0–100" /> },
              { label: 'Authority Score', el: <input type="number" min="0" max="100" style={s.input} value={seoMetricEdit.authority_score} onChange={e => setSeoMetricEdit(p => ({ ...p, authority_score: e.target.value }))} placeholder="0–100" /> },
              { label: 'Referring Domains', el: <input type="number" min="0" style={s.input} value={seoMetricEdit.referring_domains} onChange={e => setSeoMetricEdit(p => ({ ...p, referring_domains: e.target.value }))} placeholder="0" /> },
              { label: 'Notes', el: <input style={s.input} value={seoMetricEdit.notes} onChange={e => setSeoMetricEdit(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" /> },
            ].map(({ label, el }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={s.label}>{label}</label>
                {el}
              </div>
            ))}
          </div>
          <div>
            <button type="submit" style={s.btn} disabled={savingMetrics}>
              {savingMetrics ? 'Saving…' : 'Save Metrics'}
            </button>
          </div>
        </form>
      </div>

      )}

      {activeTab === 'backlinks' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={s.cardTitle}>Backlink Profile{backlinks?.domain ? ` — ${backlinks.domain}` : ''}</div>
            <button onClick={loadBacklinks} style={s.btnGhost} disabled={backlinksLoading}>
              {backlinksLoading ? 'Fetching…' : 'Refresh'}
            </button>
          </div>

          {backlinksLoading && !backlinks && (
            <div style={{ ...s.card, color: '#888', fontSize: 13 }}>Fetching backlink data from DataForSEO…</div>
          )}

          {backlinksError && (
            <div style={{ ...s.card, color: '#c62828', fontSize: 13 }}>
              Couldn't load backlink data: {backlinksError}
            </div>
          )}

          {!backlinksError && backlinks?.empty && (
            <div style={{ ...s.card, color: '#888', fontSize: 13 }}>
              No backlink data returned for <strong>{backlinks.domain}</strong> yet.
            </div>
          )}

          {!backlinksError && backlinks && !backlinks.empty && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              {[
                { label: 'Domain Rank', val: backlinks.domain_rank },
                { label: 'Total Backlinks', val: backlinks.backlinks_total },
                { label: 'Referring Domains', val: backlinks.referring_domains },
                { label: 'Referring IPs', val: backlinks.referring_ips },
                { label: 'New Backlinks', val: backlinks.new_backlinks, color: '#2e7d32' },
                { label: 'Lost Backlinks', val: backlinks.lost_backlinks, color: '#c62828' },
                { label: 'Broken Backlinks', val: backlinks.broken_backlinks },
                { label: 'Spam Score', val: backlinks.spam_score },
              ].map(m => (
                <div key={m.label} style={s.card}>
                  <div style={{ ...s.metricVal, color: m.color || '#1a1a1a' }}>
                    {m.val == null ? '—' : Number(m.val).toLocaleString('en-GB')}
                  </div>
                  <div style={s.metricLabel}>{m.label}</div>
                </div>
              ))}
            </div>
          )}

          <p style={{ marginTop: 16, color: '#aaa', fontSize: 12 }}>
            Live data from DataForSEO for the domain set on the <strong>Details</strong> tab. Each refresh runs a new query.
          </p>
        </div>
      )}

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
