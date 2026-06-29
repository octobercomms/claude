// AI-SEO panel (Organic suite → AI SEO tab). Two linked tools:
//   1. Keyword targets — Claude derives the keywords/topics competitors win on
//      in AI search + SERPs (the "top 50 keywords" step).
//   2. Article fit scan — score the client's articles against those targets and
//      get concrete on-page fixes (the "rate & optimise every article" step).

import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const INTENT_COLOR = {
  transactional: 'var(--positive, #1a7f37)',
  commercial: '#9a6b00',
  informational: 'var(--text-muted)',
  navigational: 'var(--text-subtle)',
};
function scoreColor(n) {
  if (n == null) return 'var(--text-subtle)';
  if (n >= 70) return 'var(--positive, #1a7f37)';
  if (n >= 45) return '#9a6b00';
  return 'var(--negative, #b3261e)';
}

export default function AiSeoPanel({ clientId }) {
  const toast = useToast();
  const [keywords, setKeywords] = useState([]);
  const [scans, setScans] = useState([]);
  const [seed, setSeed] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const [k, s] = await Promise.all([
        api.get(`/ai-seo/clients/${clientId}/keywords`),
        api.get(`/ai-seo/clients/${clientId}/scans`),
      ]);
      setKeywords(k.keywords || []);
      setScans(s.scans || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function generate() {
    setGenLoading(true);
    try {
      const r = await api.post(`/ai-seo/clients/${clientId}/keywords/generate`, { seed });
      setKeywords(r.keywords || []);
      toast(`Generated ${r.keywords?.length || 0} keyword targets.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setGenLoading(false); }
  }

  async function scan() {
    if (!url.trim()) { toast('Paste an article URL to scan.', 'error'); return; }
    setScanning(true);
    try {
      const r = await api.post(`/ai-seo/clients/${clientId}/scan`, { url: url.trim() });
      setScans(prev => [r.scan, ...prev]);
      setUrl('');
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  }

  async function removeScan(id) {
    try { await api.delete(`/ai-seo/clients/${clientId}/scans/${id}`); setScans(prev => prev.filter(s => s.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="stack stack-lg">
      <p className="body" style={{ maxWidth: 780 }}>
        Find the keywords competitors win on in AI search (ChatGPT, Claude, Gemini, AI Overviews) and classic SERPs,
        then score your articles against them and get concrete fixes. Owned and in-house — no per-call connector.
      </p>

      <div className="aiseo-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, alignItems: 'start' }}>
      {/* 1 · Keyword targets */}
      <div>
        <h3 className="h3 mb-2">AI search keyword targets</h3>
        <div className="card">
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Optional focus / seed — e.g. 'sustainable packaging for DTC brands'"
              value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') generate(); }} />
            <button className="btn btn-primary" onClick={generate} disabled={genLoading}>
              {genLoading ? 'Generating…' : (keywords.length ? 'Regenerate' : 'Generate targets')}
            </button>
          </div>
          {!keywords.length && loaded && (
            <p className="body-sm text-subtle" style={{ marginTop: 10 }}>
              No targets yet — generate a list from this client's competitors and brief. (Set the client's competitors in Setup for sharper results.)
            </p>
          )}
          {keywords.length > 0 && (
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr>{['#', 'Keyword', 'Intent', 'Why'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {keywords.map(k => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 700, color: 'var(--text-subtle)' }}>{k.priority}</td>
                    <td style={{ fontWeight: 600 }}>{k.keyword}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: INTENT_COLOR[k.intent] || 'var(--text-subtle)' }}>{k.intent || '—'}</span></td>
                    <td className="body-sm text-muted">{k.rationale || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 2 · Article fit scan */}
      <div>
        <h3 className="h3 mb-2">Article fit scan</h3>
        <div className="card">
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Article URL — score it against the targets above"
              value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') scan(); }} />
            <button className="btn btn-primary" onClick={scan} disabled={scanning || !keywords.length} title={!keywords.length ? 'Generate keyword targets first' : ''}>
              {scanning ? 'Scanning…' : 'Scan article'}
            </button>
          </div>
          {!keywords.length && <p className="body-xs text-subtle" style={{ marginTop: 8 }}>Generate keyword targets above first — scans are scored against them.</p>}

          {scans.length > 0 && (
            <div className="stack stack-sm" style={{ marginTop: 14 }}>
              {scans.map(s => (
                <div key={s.id} className="card" style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ textAlign: 'center', minWidth: 44 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(s.score) }}>{s.score ?? '—'}</div>
                      <div className="body-xs text-subtle">fit</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="body" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.url}</div>
                      <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-accent">{s.url}</a>
                        {s.best_keyword && <> · best fit: <strong>{s.best_keyword}</strong></>}
                      </div>
                      {s.summary && <p className="body-sm" style={{ marginTop: 6 }}>{s.summary}</p>}
                      {Array.isArray(s.fixes) && s.fixes.length > 0 && (
                        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                          {s.fixes.map((f, i) => <li key={i} className="body-sm" style={{ marginBottom: 2 }}>{f}</li>)}
                        </ul>
                      )}
                    </div>
                    <button onClick={() => removeScan(s.id)} className="btn btn-secondary btn-sm">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
