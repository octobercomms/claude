import React, { useEffect, useState } from 'react';
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

const DEFAULT_LOC = LOCATIONS[0];

export default function RankingsPage() {
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [tags, setTags] = useState([]);
  const [filterTag, setFilterTag] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyModal, setHistoryModal] = useState(null);
  const [history, setHistory] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkDevice, setBulkDevice] = useState('desktop');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkLocation, setBulkLocation] = useState(DEFAULT_LOC.code);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulking, setBulking] = useState(false);
  const [newKw, setNewKw] = useState({ keyword: '', target_url: '', device: 'desktop', tag: '', location_name: DEFAULT_LOC.name, location_code: DEFAULT_LOC.code });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.get('/clients').then(setClients);
  }, []);

  useEffect(() => {
    if (!selectedClient) { setKeywords([]); setTags([]); return; }
    setLoading(true);
    Promise.all([
      api.get(`/rankings/keywords?client_id=${selectedClient}`),
      api.get(`/rankings/tags/${selectedClient}`),
    ]).then(([kws, t]) => {
      setKeywords(kws);
      setTags(t);
    }).finally(() => setLoading(false));
  }, [selectedClient]);

  async function openHistory(kw) {
    setHistoryModal(kw);
    const data = await api.get(`/rankings/keywords/${kw.id}/history`);
    setHistory(data.reverse());
  }

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const kw = await api.post('/rankings/keywords', { ...newKw, client_id: selectedClient });
      setKeywords(prev => [...prev, kw]);
      setNewKw({ keyword: '', target_url: '', device: 'desktop', tag: '', location_name: DEFAULT_LOC.name, location_code: DEFAULT_LOC.code });
      setShowAddForm(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleDelete(kwId) {
    if (!window.confirm('Delete this keyword?')) return;
    await api.delete(`/rankings/keywords/${kwId}`);
    setKeywords(prev => prev.filter(k => k.id !== kwId));
  }

  async function handleCheckAll() {
    if (!selectedClient) return;
    setChecking(true);
    try {
      await api.post(`/rankings/check/${selectedClient}`);
      setTimeout(async () => {
        const kws = await api.get(`/rankings/keywords?client_id=${selectedClient}`);
        setKeywords(kws);
        setChecking(false);
      }, 3000);
    } catch (err) {
      toast(err.message, 'error');
      setChecking(false);
    }
  }

  async function handleBulkImport(e) {
    e.preventDefault();
    setBulking(true);
    setBulkMsg('');
    try {
      const loc = LOCATIONS.find(l => l.code === Number(bulkLocation)) || DEFAULT_LOC;
      const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
      const keywords = lines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          keyword: parts[0],
          target_url: parts[1] || '',
          tag: parts[2] || bulkTag,
          device: bulkDevice,
          location_code: loc.code,
          location_name: loc.name,
        };
      });
      const { inserted } = await api.post('/rankings/keywords/bulk', { client_id: selectedClient, keywords });
      setBulkMsg(`Imported ${inserted} keyword${inserted !== 1 ? 's' : ''}.`);
      const kws = await api.get(`/rankings/keywords?client_id=${selectedClient}`);
      setKeywords(kws);
      setBulkText('');
    } catch (err) {
      setBulkMsg(`Error: ${err.message}`);
    } finally {
      setBulking(false);
    }
  }

  async function handleExport() {
    const res = await api.raw(`/rankings/export/${selectedClient}`);
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

  const posChange = (curr, prev) => {
    if (!curr || !prev) return null;
    return prev - curr; // positive = improved (lower number = better rank)
  };

  return (
    <div className="suite-organic">
      <header className="hero">
        <h1 className="display">Rankings</h1>
      </header>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div />
        {selectedClient && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExport} className="btn btn-secondary">Export CSV</button>
            <button onClick={handleCheckAll} className="btn btn-secondary" disabled={checking}>
              {checking ? 'Checking…' : 'Check All Ranks'}
            </button>
            <button onClick={() => { setShowBulkForm(true); setShowAddForm(false); }} className="btn btn-secondary">Bulk Import</button>
            <button onClick={() => { setShowAddForm(true); setShowBulkForm(false); }} className="btn btn-primary">+ Add Keyword</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select className="input" value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selectedClient && (
          <select className="input" value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
            <option value="">All locations</option>
            {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
          </select>
        )}
        {tags.length > 0 && (
          <select className="input" value={filterTag} onChange={e => setFilterTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {selectedClient && (
          <input
            className="input" style={{ flex: 1 }}
            placeholder="Search keywords…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}
      </div>

      {showAddForm && (
        <div className="card">
          <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>Add Keyword</h3>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr', gap: 12 }}>
              <div className="field">
                <label className="field-label">Keyword</label>
                <input className="input" required value={newKw.keyword} onChange={e => setNewKw(p => ({ ...p, keyword: e.target.value }))} />
              </div>
              <div className="field">
                <label className="field-label">Target URL</label>
                <input className="input" value={newKw.target_url} onChange={e => setNewKw(p => ({ ...p, target_url: e.target.value }))} placeholder="https://…" />
              </div>
              <div className="field">
                <label className="field-label">Location</label>
                <select className="input" value={newKw.location_code} onChange={e => {
                  const loc = LOCATIONS.find(l => l.code === Number(e.target.value)) || DEFAULT_LOC;
                  setNewKw(p => ({ ...p, location_code: loc.code, location_name: loc.name }));
                }}>
                  {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Device</label>
                <select className="input" value={newKw.device} onChange={e => setNewKw(p => ({ ...p, device: e.target.value }))}>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Tag</label>
                <input className="input" value={newKw.tag} onChange={e => setNewKw(p => ({ ...p, tag: e.target.value }))} placeholder="brand, category…" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary">Add</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {showBulkForm && (
        <div className="card">
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Bulk Import Keywords</h3>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-subtle)' }}>
            One keyword per line. Optional columns: <code>keyword, target_url, tag</code>
          </p>
          <form onSubmit={handleBulkImport} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <textarea
              className="input" style={{ minHeight: 180, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'enamel mug\nenamel teapot\nenamel dinner set, https://falconenamelware.com/collections/dinner, tableware'}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              required
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div className="field">
                <label className="field-label">Location</label>
                <select className="input" value={bulkLocation} onChange={e => setBulkLocation(e.target.value)}>
                  {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Device</label>
                <select className="input" value={bulkDevice} onChange={e => setBulkDevice(e.target.value)}>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">Default Tag (if not in line)</label>
                <input className="input" value={bulkTag} onChange={e => setBulkTag(e.target.value)} placeholder="brand, category…" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={bulking}>{bulking ? 'Importing…' : 'Import Keywords'}</button>
              <button type="button" onClick={() => { setShowBulkForm(false); setBulkMsg(''); }} className="btn btn-secondary">Cancel</button>
              {bulkMsg && <span style={{ fontSize: 13, color: bulkMsg.startsWith('Error') ? 'var(--negative)' : 'var(--positive)' }}>{bulkMsg}</span>}
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading keywords…</div>
      ) : !selectedClient ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40, textAlign: 'center' }}>Select a client to view rankings</div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                {['Keyword', 'Location', 'Device', 'Tag', 'Current', 'Previous', 'Best', 'Last Checked', ''].map(h => (
                  <th key={h} >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>No keywords found</td></tr>
              ) : filtered.map(kw => {
                const change = posChange(kw.current_position, kw.previous_position);
                const loc = LOCATIONS.find(l => l.code === kw.location_code);
                return (
                  <tr key={kw.id} style={{ cursor: 'pointer' }} onClick={() => openHistory(kw)}>
                    <td >
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{kw.keyword}</div>
                      {kw.target_url && <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{kw.target_url}</div>}
                    </td>
                    <td >
                      <span className="chip chip-neutral">{loc ? `${loc.flag} ${loc.name}` : kw.location_name || '—'}</span>
                    </td>
                    <td ><span className="chip chip-neutral">{kw.device}</span></td>
                    <td >{kw.tag ? <span className="chip chip-neutral">{kw.tag}</span> : '—'}</td>
                    <td >
                      <span style={{ fontSize: 16, fontWeight: 700, color: kw.current_position ? 'var(--text)' : 'var(--text-subtle)' }}>
                        {kw.current_position || '—'}
                      </span>
                      {change !== null && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: change > 0 ? 'var(--positive)' : change < 0 ? 'var(--negative)' : 'var(--text-subtle)' }}>
                          {change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : '–'}
                        </span>
                      )}
                    </td>
                    <td >{kw.previous_position || '—'}</td>
                    <td style={{ color: 'var(--positive)', fontWeight: 600 }}>{kw.best_position || '—'}</td>
                    <td >{kw.last_checked ? new Date(kw.last_checked).toLocaleDateString('en-GB') : '—'}</td>
                    <td  onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDelete(kw.id)} className="btn btn-secondary btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {historyModal && (
        <div  onClick={() => setHistoryModal(null)}>
          <div  onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{historyModal.keyword}</h3>
              <button onClick={() => setHistoryModal(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-subtle)' }}>×</button>
            </div>
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={history} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                  <XAxis dataKey="checked_at" tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} tick={{ fontSize: 10 }} />
                  <YAxis reversed domain={['auto', 'auto']} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={v => [`Position ${v}`, 'Rank']} />
                  <Line type="monotone" dataKey="position" stroke="#1a1a1a" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: 'var(--text-subtle)', textAlign: 'center', padding: 40 }}>No rank history yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

