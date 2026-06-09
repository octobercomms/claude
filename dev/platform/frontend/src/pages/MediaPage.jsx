import React, { useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Global media database admin — publication deduplication.
export default function MediaPage() {
  const toast = useToast();
  const [clusters, setClusters] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [ai, setAi] = useState(false);
  const [chosen, setChosen] = useState({}); // clusterIndex -> canonical outlet id
  const [done, setDone] = useState({}); // clusterIndex -> merged count

  function badge(method, confidence) {
    if (method === 'exact') return <span className="chip" style={{ background: '#dcfce7', color: '#166534' }}>Exact · safe</span>;
    if (method === 'ai') return <span className="chip chip-accent">AI confirmed · {Math.round(confidence * 100)}%</span>;
    return <span className="chip">Possible · review</span>;
  }

  async function scan() {
    setScanning(true);
    setClusters(null);
    setDone({});
    try {
      const r = await api.get('/pr/dedup/outlets/scan');
      setClusters(r.clusters || []);
      setAi(!!r.ai);
      // default canonical = the suggested (cleanest) name's id
      const pick = {};
      (r.clusters || []).forEach((c, i) => {
        const m = c.members.find((x) => x.name === c.suggested) || c.members[0];
        if (m) pick[i] = m.id;
      });
      setChosen(pick);
    } catch (err) { toast(err.message, 'error'); }
    finally { setScanning(false); }
  }

  async function merge(ci) {
    const cluster = clusters[ci];
    const canonId = chosen[ci];
    if (!canonId) { toast('Pick which publication to keep.', 'error'); return; }
    const memberIds = cluster.members.map((m) => m.id).filter((x) => x !== canonId);
    try {
      const r = await api.post('/pr/dedup/outlets/merge', { canonical_id: canonId, member_ids: memberIds });
      setDone((d) => ({ ...d, [ci]: r.merged }));
    } catch (err) { toast(err.message, 'error'); }
  }

  async function mergeAllExact() {
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].method === 'exact' && !done[i]) await merge(i);
    }
    toast('Exact matches merged', 'success');
  }

  return (
    <div className="suite-media">
      <div className="kicker"><span className="pip" /><span>Press • Publications</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="display">Press</h1>
        <button className="btn btn-primary" disabled={scanning} onClick={scan}>{scanning ? 'Scanning…' : '🔍 Find duplicate publications'}</button>
      </header>

      <p style={{ color: 'var(--text-subtle)', marginBottom: 'var(--s4)' }}>
        Publications are shared across all clients. Scanning finds duplicates (e.g. <em>Dezeen</em> / <em>Dezeen.com</em>); exact matches are safe to merge, and fuzzy ones are confirmed by Claude before they're shown. Merging keeps one record and repoints all coverage to it.
      </p>

      {clusters && clusters.length > 0 && (
        <div style={{ marginBottom: 'var(--s4)', display: 'flex', gap: 10, alignItems: 'center' }}>
          {!ai && <span className="chip">Claude not available — fuzzy matches are heuristic; review carefully</span>}
          {clusters.some((c) => c.method === 'exact') && <button className="btn btn-secondary btn-sm" onClick={mergeAllExact}>Merge all exact matches</button>}
        </div>
      )}

      {clusters && clusters.length === 0 && (
        <div className="card" style={{ padding: 24 }}><p style={{ color: 'var(--text-subtle)' }}>No duplicates found — your publications look clean.</p></div>
      )}

      {clusters && clusters.map((c, ci) => (
        <div key={ci} className="card" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8 }}>{badge(c.method, c.confidence)}</div>
          {done[ci] != null ? (
            <p style={{ color: 'var(--text-subtle)' }}>✓ Merged {done[ci]} duplicate(s).</p>
          ) : (
            <>
              <table className="table" style={{ marginBottom: 10 }}>
                <thead><tr><th style={{ width: 70 }}>Keep</th><th>Publication</th></tr></thead>
                <tbody>
                  {c.members.map((m) => (
                    <tr key={m.id}>
                      <td><input type="radio" name={`canon-${ci}`} checked={chosen[ci] === m.id} onChange={() => setChosen((s) => ({ ...s, [ci]: m.id }))} /></td>
                      <td>{m.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-primary btn-sm" onClick={() => merge(ci)}>Merge into selected</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
