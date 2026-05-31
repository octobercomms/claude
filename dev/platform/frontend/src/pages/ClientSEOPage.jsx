import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

// Banner shown above the SEO tab listing the data sources that are
// gated until DataForSEO drops the $100/mo Backlinks + LLM Mentions
// commitment on 1 July 2026.
//
// Pre-cutover: yellow "coming soon" with the feature list.
// Post-cutover: green "now available — open the checklist doc" with
//   a Dismiss button (localStorage-persisted) so once Phase E is in
//   flight the AM can clear it. Without the dismiss it'd stay forever
//   and the reminder is the whole point.
const DFS_DISMISS_KEY = 'dfs_post_unlock_dismissed';
function DfsAvailabilityBanner() {
  const { user } = useAuth();
  const avail = user?.dataforseo_availability;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DFS_DISMISS_KEY) === '1'; }
    catch { return false; }
  });
  if (!avail) return null;
  const when = new Date(avail.enabled_from).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Stream the in-repo checklist .md down to the user's machine so they
  // can stash it somewhere they'll find again on the day. Goes through
  // /api/docs/* so the Bearer token authenticates the request.
  async function downloadChecklist() {
    // Hardcoded so the button still works even on a stale /auth/me
    // payload that pre-dates the doc_path field. The doc is fetched
    // by an authed allowlisted route on the server.
    const filename = 'dataforseo-july-2026.md';
    try {
      const res = await api.raw(`/docs/${filename}`);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    }
  }
  const DOC_FILENAME = 'dataforseo-july-2026.md';

  if (!avail.unlocked) {
    return (
      <div style={{
        marginBottom: 16, padding: '12px 16px', background: '#fffdf2',
        border: '1px solid #ddd6a8', borderRadius: 6, fontSize: 13, color: '#5a4a00',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          Coming {when} — DataForSEO Backlinks &amp; LLM Mentions
        </div>
        <div style={{ lineHeight: 1.5 }}>
          These data sources need a paid commitment with DataForSEO that we don't currently hold.
          On {when} both APIs move to pay-as-you-go and the platform will start pulling them
          automatically. Until then the following won't appear:
        </div>
        <ul style={{ margin: '6px 0 6px 18px', padding: 0, lineHeight: 1.55 }}>
          {avail.gated_features.map(f => <li key={f}>{f}</li>)}
        </ul>
        <div style={{ fontSize: 12, color: '#7a6500' }}>
          Implementation checklist + Phase E PR plan:{' '}
          <button onClick={downloadChecklist}
            style={{ background: 'none', border: 'none', padding: 0, color: '#5a4a00', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
            ↓ download {DOC_FILENAME}
          </button>
        </div>
      </div>
    );
  }

  if (dismissed) return null;
  return (
    <div style={{
      marginBottom: 16, padding: '12px 16px', background: '#e7f4ea',
      border: '1px solid #b6dcc1', borderRadius: 6, fontSize: 13, color: '#1b5e20',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          ✓ DataForSEO Backlinks &amp; LLM Mentions are now available
        </div>
        <div style={{ lineHeight: 1.5 }}>
          {avail.post_unlock_message || 'Backlinks + LLM Mentions are now pay-as-you-go.'}
        </div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          Open <code>docs/{DOC_FILENAME}</code> in the repo — or{' '}
          <button onClick={downloadChecklist}
            style={{ background: 'none', border: 'none', padding: 0, color: '#1b5e20', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
            ↓ download {DOC_FILENAME}
          </button>{' '}
          for the day-of checklist + Phase E PR order.
        </div>
      </div>
      <button
        onClick={() => { try { localStorage.setItem(DFS_DISMISS_KEY, '1'); } catch {} setDismissed(true); }}
        style={{ background: 'none', border: '1px solid #b6dcc1', color: '#1b5e20', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
        Dismiss
      </button>
    </div>
  );
}

import {
  IntentBadge, SerpFeaturePills, KeywordHistoryModal,
  SearchConsoleTab, AIOverviewsTab, ContentGapsTab, PlanningTab,
} from '../components/SeoSuite';

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

// Minimal trend line for the summary cards.
function Sparkline({ data, color = '#3355cc', reverse = false }) {
  const pts = (data || []).filter(v => v != null);
  if (pts.length < 2) return <div style={{ height: 32, marginTop: 8 }} />;
  return (
    <div style={{ height: 32, marginTop: 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 3, right: 2, left: 2, bottom: 3 }}>
          <YAxis hide reversed={reverse} domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Per-date aggregates across all keywords, oldest first, for the sparklines.
function buildTrend(rankMatrix) {
  if (!rankMatrix || !rankMatrix.dates || rankMatrix.dates.length < 2) return null;
  const dates = [...rankMatrix.dates].reverse();
  const kwIds = Object.keys(rankMatrix.positions);
  return dates.map(d => {
    let sum = 0, ranked = 0, top3 = 0, top10 = 0;
    for (const kid of kwIds) {
      const cell = rankMatrix.positions[kid][d];
      if (cell && cell.p != null) {
        sum += cell.p; ranked++;
        if (cell.p <= 3) top3++;
        if (cell.p <= 10) top10++;
      }
    }
    return { date: d, avgPos: ranked ? Math.round(sum / ranked) : null, top3, top10, ranked };
  });
}

function fmtVolume(v) {
  if (v == null) return '—';
  if (v >= 10000) return Math.round(v / 1000) + 'K';
  if (v >= 1000) return (v / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(v);
}

// Buckets keywords under a group label (by tag or landing page).
function groupKeywords(list, by) {
  const groups = {};
  for (const kw of list) {
    const raw = by === 'tag' ? kw.tag : kw.target_url;
    const label = (raw && String(raw).trim()) || (by === 'tag' ? 'Untagged' : 'No landing page');
    (groups[label] = groups[label] || []).push(kw);
  }
  return Object.keys(groups).sort().map(label => ({ label, keywords: groups[label] }));
}

// Inline position-over-time chart shown when a keyword row is expanded.
function ExpandedChart({ kw, rankMatrix, range, setRange }) {
  const hist = (rankMatrix && rankMatrix.positions[kw.id]) || {};
  let series = Object.keys(hist).sort().map(d => ({ date: d, position: hist[d].p }));
  if (range !== 'all') {
    const days = range === '7' ? 7 : 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    series = series.filter(pt => pt.date >= cutoff);
  }
  const hasData = series.filter(p => p.position != null).length >= 2;
  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['7', '7D'], ['30', '30D'], ['all', 'All']].map(([v, l]) => (
          <button key={v} onClick={() => setRange(v)} style={{
            padding: '3px 12px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid #ddd',
            background: range === v ? '#1a1a1a' : '#fff', color: range === v ? '#fff' : '#555',
          }}>{l}</button>
        ))}
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={series} margin={{ top: 5, right: 24, left: -12, bottom: 5 }}>
            <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10 }} />
            <YAxis reversed domain={['auto', 'auto']} tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip formatter={v => [`Position ${v}`, 'Rank']} labelFormatter={fmtDay} />
            <Line type="monotone" dataKey="position" stroke="#1a1a1a" strokeWidth={2} dot={{ r: 2 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p style={{ color: '#888', fontSize: 12, padding: '24px 0', margin: 0 }}>Not enough rank history yet to chart this keyword.</p>
      )}
    </div>
  );
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
  const [expandedId, setExpandedId] = useState(null);
  const [expandRange, setExpandRange] = useState('all');
  const [editingTag, setEditingTag] = useState(null);
  const [groupBy, setGroupBy] = useState('none');
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
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
  const [bucket, setBucket] = useState('all');
  const [historyKeyword, setHistoryKeyword] = useState(null);
  const [classifying, setClassifying] = useState(false);

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

  function toggleExpand(kw) {
    setExpandedId(prev => (prev === kw.id ? null : kw.id));
  }

  async function saveTag(kw) {
    if (!editingTag || editingTag.id !== kw.id) return;
    const next = editingTag.value.trim();
    setEditingTag(null);
    if (next === (kw.tag || '')) return;
    try {
      const updated = await api.put(`/rankings/keywords/${kw.id}`, { tag: next });
      setKeywords(prev => prev.map(k => (k.id === kw.id ? { ...k, tag: updated.tag } : k)));
      if (updated.tag && !tags.includes(updated.tag)) setTags(prev => [...prev, updated.tag]);
    } catch (err) { toast(err.message, 'error'); }
  }

  function toggleGroup(label) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  function renderKeywordRow(kw) {
    const change = kw.current_position && kw.previous_position ? kw.previous_position - kw.current_position : null;
    const loc = LOCATIONS.find(l => l.code === kw.location_code);
    const expanded = expandedId === kw.id;
    return (
      <React.Fragment key={kw.id}>
      <tr style={{ cursor: 'pointer', background: expanded ? '#fafafa' : undefined }} onClick={() => toggleExpand(kw)}>
        <td style={s.td}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {kw.keyword}
            <IntentBadge intent={kw.intent} />
            {kw.aio_present && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: kw.aio_brand_cited ? '#e4f4e8' : '#fef3c7', color: kw.aio_brand_cited ? '#1d7a3a' : '#92400e' }}>AIO{kw.aio_brand_cited ? '+CITED' : ''}</span>}
          </div>
          {kw.target_url && <div style={{ fontSize: 11, color: '#999' }}>{kw.target_url}</div>}
          {kw.serp_features?.length > 0 && <div style={{ marginTop: 3 }}><SerpFeaturePills features={kw.serp_features} /></div>}
        </td>
        <td style={s.td}><span style={s.chip}>{loc ? `${loc.flag} ${loc.name}` : kw.location_name || '—'}</span></td>
        <td style={s.td}><span style={s.chip}>{kw.device}</span></td>
        <td style={s.td} onClick={e => e.stopPropagation()}>
          {editingTag && editingTag.id === kw.id ? (
            <input autoFocus value={editingTag.value}
              onChange={e => setEditingTag({ id: kw.id, value: e.target.value })}
              onBlur={() => saveTag(kw)}
              onKeyDown={e => { if (e.key === 'Enter') saveTag(kw); if (e.key === 'Escape') setEditingTag(null); }}
              placeholder="tag…"
              style={{ ...s.input, padding: '4px 8px', width: 120, fontSize: 12 }} />
          ) : (
            <span onClick={() => setEditingTag({ id: kw.id, value: kw.tag || '' })}
              title="Click to edit tag"
              style={kw.tag ? { ...s.chip, cursor: 'text' } : { cursor: 'text', color: '#bbb', fontSize: 12 }}>
              {kw.tag || '+ tag'}
            </span>
          )}
        </td>
        <td style={{ ...s.td, fontWeight: 600 }}>{fmtVolume(kw.search_volume)}</td>
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
          <button onClick={() => setHistoryKeyword(kw)} title="Full position history" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a4f9c', fontSize: 14, padding: '0 4px' }}>⊞</button>
          <button onClick={() => handleDelete(kw.id)} title="Delete keyword" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} style={{ padding: 0, background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
            <ExpandedChart kw={kw} rankMatrix={rankMatrix} range={expandRange} setRange={setExpandRange} />
          </td>
        </tr>
      )}
      </React.Fragment>
    );
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

  async function handleClassifyIntent() {
    setClassifying(true);
    try {
      const res = await api.post(`/seo/clients/${id}/keywords/classify-intent`);
      toast(`Classified ${res.updated} of ${res.total} keywords.`, 'success');
      const kws = await api.get(`/rankings/keywords?client_id=${id}`);
      setKeywords(kws);
    } catch (err) {
      toast(`Intent classification failed: ${err.message}`, 'error');
    } finally {
      setClassifying(false);
    }
  }

  async function handleCheckAll() {
    setChecking(true);
    try {
      const res = await api.post(`/rankings/check/${id}`);
      toast(`Rank check started for ${res.keywords} keyword${res.keywords === 1 ? '' : 's'} — live results appear over the next few minutes.`, 'success');
      setTimeout(async () => {
        try {
          const kws = await api.get(`/rankings/keywords?client_id=${id}`);
          setKeywords(kws);
        } catch {}
        setChecking(false);
      }, 8000);
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

  const preBucket = keywords.filter(k => {
    if (filterTag && k.tag !== filterTag) return false;
    if (filterLocation && String(k.location_code) !== String(filterLocation)) return false;
    if (search && !k.keyword.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const bucketCounts = {
    all: preBucket.length,
    top3: preBucket.filter(k => k.current_position && k.current_position <= 3).length,
    top10: preBucket.filter(k => k.current_position && k.current_position <= 10).length,
    top30: preBucket.filter(k => k.current_position && k.current_position <= 30).length,
    rest: preBucket.filter(k => k.current_position && k.current_position > 30).length,
    none: preBucket.filter(k => !k.current_position).length,
  };
  const filtered = preBucket.filter(k => {
    if (bucket === 'all') return true;
    const p = k.current_position;
    if (bucket === 'top3') return p && p <= 3;
    if (bucket === 'top10') return p && p <= 10;
    if (bucket === 'top30') return p && p <= 30;
    if (bucket === 'rest') return p && p > 30;
    if (bucket === 'none') return !p;
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
      case 'volume': return kw.search_volume ?? null;
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
    loadRankMatrix();
  }, []);

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <DfsAvailabilityBanner />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Organic — {client?.name}</h1>
        {activeTab === 'keywords' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExport} style={s.btnGhost}>Export CSV</button>
            <button onClick={handleClassifyIntent} style={s.btnGhost} disabled={classifying}>{classifying ? 'Classifying…' : 'Classify Intent'}</button>
            <button onClick={handleCheckAll} style={s.btnGhost} disabled={checking}>{checking ? 'Checking…' : 'Check All Ranks'}</button>
            <button onClick={() => { setShowBulkForm(true); setShowAddForm(false); }} style={s.btnGhost}>Bulk Import</button>
            <button onClick={() => { setShowAddForm(true); setShowBulkForm(false); }} style={s.btn}>+ Add Keyword</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8e8e8', marginBottom: 24 }}>
        {[
          ['keywords', 'Keywords'],
          ['gsc', 'Search Console'],
          ['aio', 'AI Overviews'],
          ['gaps', 'Content Gaps'],
          ['planning', 'Planning'],
          ['authority', 'Authority'],
          ['backlinks', 'Backlinks'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14,
            fontWeight: activeTab === key ? 700 : 400, color: activeTab === key ? '#1a1a1a' : '#888',
            borderBottom: activeTab === key ? '2px solid #1a1a1a' : '2px solid transparent',
            marginBottom: -2,
          }}>{label}</button>
        ))}
      </div>

      {historyKeyword && (
        <KeywordHistoryModal
          keywordId={historyKeyword.id}
          keyword={historyKeyword.keyword}
          onClose={() => setHistoryKeyword(null)}
        />
      )}

      {activeTab === 'gsc' && <SearchConsoleTab clientId={id} />}
      {activeTab === 'aio' && <AIOverviewsTab clientId={id} />}
      {activeTab === 'gaps' && <ContentGapsTab clientId={id} />}
      {activeTab === 'planning' && <PlanningTab clientId={id} />}

      {activeTab === 'keywords' && <>
      {/* Rankings summary */}
      {(() => {
        const trend = buildTrend(rankMatrix);
        const ranked = keywords.filter(k => k.current_position);
        const avgNow = ranked.length ? Math.round(ranked.reduce((a, k) => a + k.current_position, 0) / ranked.length) : null;
        const rankedPrev = keywords.filter(k => k.previous_position);
        const avgPrev = rankedPrev.length ? Math.round(rankedPrev.reduce((a, k) => a + k.previous_position, 0) / rankedPrev.length) : null;
        const t3 = keywords.filter(k => k.current_position && k.current_position <= 3).length;
        const t3p = keywords.filter(k => k.previous_position && k.previous_position <= 3).length;
        const t10 = keywords.filter(k => k.current_position && k.current_position <= 10).length;
        const t10p = keywords.filter(k => k.previous_position && k.previous_position <= 10).length;
        const cards = [
          { label: 'Keywords tracked', value: keywords.length },
          { label: 'Average position', value: avgNow ?? '—', delta: (avgPrev != null && avgNow != null) ? avgPrev - avgNow : null, spark: trend && trend.map(t => t.avgPos), sparkReverse: true },
          { label: 'In top 3', value: t3, delta: t3 - t3p, spark: trend && trend.map(t => t.top3) },
          { label: 'In top 10', value: t10, delta: t10 - t10p, spark: trend && trend.map(t => t.top10) },
          { label: 'Not ranking', value: keywords.filter(k => !k.current_position).length, spark: trend && trend.map(t => keywords.length - t.ranked) },
        ];
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 16 }}>
            {cards.map(c => (
              <div key={c.label} style={s.card}>
                <div style={s.metricLabel}>{c.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a' }}>{c.value}</div>
                  {c.delta != null && c.delta !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: c.delta > 0 ? '#2e7d32' : '#c62828' }}>
                      {c.delta > 0 ? `▲ ${c.delta}` : `▼ ${Math.abs(c.delta)}`}
                    </span>
                  )}
                </div>
                <Sparkline data={c.spark} reverse={c.sparkReverse} />
              </div>
            ))}
          </div>
        );
      })()}

      {/* Position buckets */}
      <div style={{ display: 'flex', border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', marginBottom: 16, background: '#fff' }}>
        {[
          { key: 'all', label: 'All' },
          { key: 'top3', label: 'Top 3' },
          { key: 'top10', label: 'Top 10' },
          { key: 'top30', label: 'Top 30' },
          { key: 'rest', label: '31–100' },
          { key: 'none', label: 'Not ranking' },
        ].map((b, i) => (
          <button key={b.key} onClick={() => setBucket(b.key)} style={{
            flex: 1, padding: '10px 8px', border: 'none', cursor: 'pointer',
            borderLeft: i ? '1px solid #eee' : 'none',
            background: bucket === b.key ? '#1a1a1a' : '#fff',
            color: bucket === b.key ? '#fff' : '#444',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{bucketCounts[b.key]}</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>{b.label}</div>
          </button>
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
      <div style={{ display: 'flex', marginBottom: 12, gap: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex' }}>
          {[['current', 'Current'], ['history', 'By date']].map(([v, label], i) => (
            <button key={v} onClick={() => setKwView(v)} style={{
              padding: '6px 16px', fontSize: 13, cursor: 'pointer', border: '1px solid #ddd',
              background: kwView === v ? '#1a1a1a' : '#fff', color: kwView === v ? '#fff' : '#444',
              borderRadius: i === 0 ? '4px 0 0 4px' : '0 4px 4px 0', borderLeft: i === 0 ? '1px solid #ddd' : 'none',
            }}>{label}</button>
          ))}
        </div>
        {kwView === 'current' && (
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            style={{ ...s.input, width: 190, padding: '6px 10px', fontSize: 13, flex: '0 0 auto' }}>
            <option value="none">No grouping</option>
            <option value="tag">Group by tag</option>
            <option value="url">Group by landing page</option>
          </select>
        )}
      </div>

      {/* Keywords table — current */}
      {kwView === 'current' && (
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {[['keyword', 'Keyword'], ['location', 'Location'], ['device', 'Device'], ['tag', 'Tag'], ['volume', 'Volume'], ['position', 'Position'], ['prev', 'Prev'], ['best', 'Best'], ['checked', 'Checked']].map(([key, label]) => (
                <th key={key} style={{ ...s.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => toggleSort(key)}>
                  {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No keywords yet — add one above</td></tr>
            ) : groupBy === 'none' ? (
              sorted.map(renderKeywordRow)
            ) : (
              groupKeywords(sorted, groupBy).map(group => {
                const collapsed = collapsedGroups.has(group.label);
                const ranked = group.keywords.filter(k => k.current_position);
                const avg = ranked.length ? Math.round(ranked.reduce((sum, k) => sum + k.current_position, 0) / ranked.length) : null;
                return (
                  <React.Fragment key={group.label}>
                    <tr onClick={() => toggleGroup(group.label)} style={{ cursor: 'pointer', background: '#eee' }}>
                      <td colSpan={10} style={{ ...s.td, fontWeight: 700, fontSize: 12 }}>
                        <span style={{ display: 'inline-block', width: 18, color: '#888' }}>{collapsed ? '▶' : '▼'}</span>
                        {group.label}
                        <span style={{ marginLeft: 10, fontWeight: 400, color: '#888' }}>
                          {group.keywords.length} keyword{group.keywords.length === 1 ? '' : 's'}{avg !== null ? ` · avg position ${avg}` : ''}
                        </span>
                      </td>
                    </tr>
                    {!collapsed && group.keywords.map(renderKeywordRow)}
                  </React.Fragment>
                );
              })
            )}
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
                const expanded = expandedId === kw.id;
                return (
                  <React.Fragment key={kw.id}>
                  <tr style={{ cursor: 'pointer', background: expanded ? '#fafafa' : undefined }} onClick={() => toggleExpand(kw)}>
                    <td style={{ ...s.td, position: 'sticky', left: 0, background: expanded ? '#fafafa' : '#fff', fontWeight: 600, fontSize: 13, zIndex: 1 }}>{kw.keyword}</td>
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
                  {expanded && (
                    <tr>
                      <td colSpan={2 + rankMatrix.dates.length} style={{ padding: 0, background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                        <ExpandedChart kw={kw} rankMatrix={rankMatrix} range={expandRange} setRange={setExpandRange} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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
  btn: { background: '#E7CD41', color: '#1a1a1a', border: 'none', borderRadius: 999, padding: '9px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  btnGhost: { background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: 999, padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnSm: { background: '#fff', color: '#1a1a1a', border: '1px solid #ddd', borderRadius: 999, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' },
  chip: { background: '#f0f0f0', borderRadius: 10, padding: '2px 8px', fontSize: 11, color: '#555' },
  tableWrap: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', marginTop: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 16px', textAlign: 'left', background: '#f9f9f9', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '1px solid #e8e8e8' },
  td: { padding: '11px 16px', borderBottom: '1px solid #f5f5f5', verticalAlign: 'middle' },
};
