import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Visualise — image generation + surgical-refinement studio (Workspace module,
// docs/omi/visualise-studio.md). Phase 1 is the foundation: the library reads
// the client's projects + available presets through the capability-gated API,
// proving auth/access/DB end-to-end. The create flow, generation, the
// circle-and-fix canvas, lock and 4K export land in later phases.
//
// Two views via ?tab= like the rest of OMI: `library` (default) and, later,
// `studio&project=<id>`.
const STATUS = {
  draft: { label: 'Draft', tone: 'var(--text-subtle)' },
  in_progress: { label: 'In progress', tone: 'var(--accent)' },
  locked: { label: 'Locked', tone: 'var(--positive)' },
};

export default function ClientVisualisePage() {
  const { id } = useParams();
  const toast = useToast();
  const [params] = useSearchParams();
  const tab = params.get('tab') || 'library';

  const [projects, setProjects] = useState(null);
  const [presets, setPresets] = useState([]);

  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);
  async function load() {
    try {
      const [pj, ps] = await Promise.all([
        api.get(`/visualise/clients/${id}/projects`),
        api.get(`/visualise/clients/${id}/presets`),
      ]);
      setProjects(pj);
      setPresets(ps);
    } catch (e) { toast(e.message, 'error'); setProjects([]); }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

  return (
    <div>
      <div className="kicker"><span className="pip" />Visualise</div>
      <header className="hero">
        <h1 className="display">Visualise</h1>
        <p className="body mt-4" style={{ maxWidth: 640 }}>
          Reference in → generate → circle-and-fix the wrong bit → lock → faithful 4K.
          Every project is saved here and reopenable. <strong>The studio arrives in the next phase</strong> —
          this is the foundation.
        </p>
      </header>

      {tab === 'studio' ? (
        <div className="card"><div className="text-subtle" style={{ padding: 20 }}>The studio canvas is coming in a later phase.</div></div>
      ) : (
        <>
          <div className="card mb-6" style={{ borderColor: 'var(--accent)' }}>
            <div className="row between center wrap" style={{ gap: 12 }}>
              <div>
                <div className="caption mb-1">Presets available</div>
                <div className="body-sm text-muted">
                  {presets.length ? presets.map(p => p.name).join(' · ') : 'Loading…'}
                </div>
              </div>
              <button className="btn btn-primary" disabled title="Arrives in the next phase">+ New project (next phase)</button>
            </div>
          </div>

          {projects === null ? (
            <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>
          ) : !projects.length ? (
            <div className="card"><div className="text-subtle" style={{ padding: 20 }}>No projects yet. Once the studio ships, new visualisations will appear here.</div></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {projects.map(p => {
                const st = STATUS[p.status] || STATUS.draft;
                return (
                  <div key={p.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ aspectRatio: '4/3', background: 'var(--surface-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {p.thumb_url
                        ? <img src={p.thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span className="text-subtle body-xs">No image yet</span>}
                    </div>
                    <div style={{ padding: 12 }}>
                      <div className="strong" style={{ marginBottom: 4 }}>{p.name}</div>
                      <div className="row between center">
                        <span style={{ color: st.tone, fontWeight: 700, fontSize: 12 }}>{st.label}</span>
                        <span className="text-subtle body-xs">{p.variant_count || 0} variant{p.variant_count === 1 ? '' : 's'} · {fmt(p.created_at)}</span>
                      </div>
                      {p.created_by_name && <div className="text-subtle body-xs mt-1">by {p.created_by_name}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
