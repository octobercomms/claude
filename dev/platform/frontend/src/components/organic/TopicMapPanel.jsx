import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';
import PipelineStep from './PipelineStep';
import { BriefView } from './BriefPanel';

// Topic map — the persisted, question-led content plan. Grow a map from a seed
// (Claude expands it into a keyword universe grounded in the brief + tracked
// keywords, then clusters it into one-question-per-piece groups). Each cluster
// is a planned piece with a status you move through the pipeline, and you can
// generate its GEO brief right here.
const STATUSES = [
  { key: 'planned',   label: 'Planned',   color: 'var(--text-subtle)' },
  { key: 'briefed',   label: 'Briefed',   color: '#6b7cff' },
  { key: 'drafted',   label: 'Drafted',   color: 'var(--warning, #9a6b00)' },
  { key: 'published', label: 'Published', color: 'var(--positive, #1e8449)' },
  { key: 'dismissed', label: 'Dismissed', color: 'var(--text-subtle)' },
];
const statusMeta = (k) => STATUSES.find(s => s.key === k) || STATUSES[0];

export default function TopicMapPanel({ clientId }) {
  const { readOnly } = useAuth();
  const [maps, setMaps] = useState([]);
  const [map, setMap] = useState(null);           // detailed active map
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('');
  const [building, setBuilding] = useState(false);
  const [briefs, setBriefs] = useState({});       // clusterId → brief
  const [busy, setBusy] = useState({});           // clusterId → bool
  const [err, setErr] = useState(null);

  useEffect(() => { loadMaps(); /* eslint-disable-line */ }, [clientId]);

  async function loadMaps() {
    try {
      const rows = await api.get(`/seo/clients/${clientId}/topic-maps`);
      setMaps(rows || []);
      if (rows?.length && !map) openMap(rows[0].id);
    } catch (e) { setErr(e.message); }
  }

  async function openMap(id) {
    try { setMap(await api.get(`/seo/topic-maps/${id}`)); setBriefs({}); }
    catch (e) { setErr(e.message); }
  }

  async function build() {
    if (!seed.trim()) return;
    setBuilding(true); setErr(null);
    try {
      const m = await api.post(`/seo/clients/${clientId}/topic-maps`, { seed: seed.trim(), name: name.trim() || undefined });
      setSeed(''); setName('');
      setMap(m);
      await loadMaps();
    } catch (e) { setErr(e.message); }
    finally { setBuilding(false); }
  }

  async function del(id) {
    if (!confirm('Delete this topic map and all its planned pieces?')) return;
    try {
      await api.delete(`/seo/topic-maps/${id}`);
      const next = maps.filter(m => m.id !== id);
      setMaps(next);
      if (map?.id === id) { setMap(null); if (next.length) openMap(next[0].id); }
    } catch (e) { setErr(e.message); }
  }

  async function generateBrief(cluster) {
    setBusy(b => ({ ...b, [cluster.id]: true })); setErr(null);
    try {
      const { brief } = await api.post(`/seo/topic-clusters/${cluster.id}/brief`, {});
      setBriefs(b => ({ ...b, [cluster.id]: brief }));
      setMap(m => ({ ...m, clusters: m.clusters.map(c => c.id === cluster.id ? { ...c, has_brief: true, status: c.status === 'planned' ? 'briefed' : c.status } : c) }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(b => ({ ...b, [cluster.id]: false })); }
  }

  async function setStatus(cluster, status) {
    setMap(m => ({ ...m, clusters: m.clusters.map(c => c.id === cluster.id ? { ...c, status } : c) })); // optimistic
    try { await api.patch(`/seo/topic-clusters/${cluster.id}`, { status }); }
    catch (e) { setErr(e.message); openMap(map.id); }
  }

  return (
    <PipelineStep num={1} title="Topic map" nextLabel={null}
      tagline="Grow a whole content plan from one seed. Claude expands it into a keyword universe (grounded in this client's brief and tracked keywords), then clusters it into pieces — one question answered by a series of keywords each. Every cluster is a planned piece you can brief and track.">

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="caption mb-2">Grow a topic map from a seed</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input value={seed} onChange={e => setSeed(e.target.value)} placeholder="Seed theme — e.g. 'enamel camping mugs'"
            onKeyDown={e => { if (e.key === 'Enter') build(); }}
            style={{ flex: 2, minWidth: 220, padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', boxSizing: 'border-box' }} />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Map name (optional)"
            style={{ flex: 1, minWidth: 160, padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', boxSizing: 'border-box' }} />
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: build, disabled: building || !seed.trim() })}>
            {building ? 'Building… (~30s)' : '🌱 Build topic map'}
          </button>
        </div>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {maps.length > 0 && (
        <div className="row wrap mb-4" style={{ gap: 6 }}>
          {maps.map(m => (
            <button key={m.id} type="button" onClick={() => openMap(m.id)}
              className={`btn btn-sm ${map?.id === m.id ? 'btn-primary' : 'btn-secondary'}`} title={m.seed || ''}>
              {m.name} <span style={{ opacity: 0.7 }}>· {m.cluster_count}</span>
            </button>
          ))}
        </div>
      )}

      {map && (
        <div>
          <div className="row between center mb-3" style={{ gap: 12 }}>
            <div>
              <div className="h3">{map.name}</div>
              <div className="body-xs text-subtle mt-1">
                {map.clusters.length} planned piece{map.clusters.length === 1 ? '' : 's'}
                {' · '}{map.clusters.filter(c => c.status === 'published').length} published
              </div>
            </div>
            <button onClick={() => del(map.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete map</button>
          </div>

          <div className="stack" style={{ gap: 'var(--s4)' }}>
            {map.clusters.map(c => {
              const brief = briefs[c.id];
              const sm = statusMeta(c.status);
              return (
                <div key={c.id} className="card">
                  <div className="row between center wrap" style={{ marginBottom: 'var(--s3)', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: sm.color }}>● {sm.label}</span>
                        <span className="caption" style={{ color: 'var(--text-subtle)' }}>{c.intent}</span>
                      </div>
                      <div className="h3 mt-2">{c.label}</div>
                      {c.core_question && <div className="body-sm mt-1" style={{ fontWeight: 600 }}>❓ {c.core_question}</div>}
                      <div className="body-xs text-muted mt-1">Primary: <strong style={{ color: 'var(--text)' }}>{c.primary_keyword}</strong></div>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <select value={c.status} onChange={e => setStatus(c, e.target.value)} disabled={readOnly}
                        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)' }}>
                        {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => generateBrief(c), disabled: !!busy[c.id] })}>
                        {busy[c.id] ? 'Briefing…' : (c.has_brief || brief) ? '✓ Re-brief' : 'Generate brief →'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(Array.isArray(c.secondary) ? c.secondary : []).map((k, j) => (
                      <span key={j} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{k}</span>
                    ))}
                  </div>
                  {brief && <BriefView brief={brief} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!map && !maps.length && !building && (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No topic maps yet. Enter a seed theme above and Claude will grow you a full content plan.
        </div>
      )}
    </PipelineStep>
  );
}
