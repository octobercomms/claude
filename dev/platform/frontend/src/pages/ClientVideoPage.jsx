import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Video Studio (slice 1) — create an edit project, upload raw clips, and run
// the auto-edit pipeline. Editing itself runs on the dedicated render worker
// that drains the job queue; this screen creates/queues the work and polls
// status. The grade→re-edit loop and export land in later slices.

const STYLE_PRESETS = [
  { value: 'auto', label: 'Auto (from brand kit)' },
  { value: 'bold-centred', label: 'Bold centred captions' },
  { value: 'lower-third', label: 'Lower-third captions' },
  { value: 'karaoke', label: 'Karaoke highlight' },
];

const STATUS_LABEL = {
  draft: 'Draft', queued: 'Queued — waiting for the render worker',
  processing: 'Processing…', graded: 'Graded', done: 'Done', failed: 'Failed',
};

export default function ClientVideoPage() {
  const toast = useToast();
  const { id } = useParams();
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);   // full project (with clips/jobs)
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('auto');
  const [outputTarget, setOutputTarget] = useState('download');
  const [driveFolder, setDriveFolder] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get(`/video/clients/${id}/projects`)
      .then(r => { setProjects(r.projects || []); setDriveFolder(r.drive_folder || ''); })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  async function saveDriveFolder() {
    setSavingFolder(true);
    try { await api.put(`/clients/${id}/video-delivery`, { video_drive_folder: driveFolder.trim() || null }); toast('Drive folder saved.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setSavingFolder(false); }
  }

  async function openProject(pid) {
    try { setActive(await api.get(`/video/projects/${pid}`)); }
    catch (e) { toast(e.message, 'error'); }
  }

  // Poll an active project while it's mid-pipeline.
  useEffect(() => {
    if (!active || !['queued', 'processing'].includes(active.status)) return;
    const t = setInterval(() => openProject(active.id), 5000);
    return () => clearInterval(t);
  }, [active?.id, active?.status]);

  async function createProject(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const p = await api.post(`/video/clients/${id}/projects`, { name: name.trim(), style_preset: preset, output_target: outputTarget });
      setProjects(prev => [{ ...p, clip_count: 0 }, ...prev]);
      setName('');
      openProject(p.id);
    } catch (e) { toast(e.message, 'error'); }
    finally { setCreating(false); }
  }

  async function uploadClips(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !active) return;
    setUploading(true);
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    try {
      await api.postForm(`/video/projects/${active.id}/clips`, fd);
      await openProject(active.id);
      toast(`Added ${files.length} clip${files.length === 1 ? '' : 's'}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function runEdit() {
    try {
      const p = await api.post(`/video/projects/${active.id}/run`, {});
      setActive(p);
      toast('Auto-edit queued — the render worker will pick it up.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteProject(pid) {
    if (!window.confirm('Delete this project and its clips?')) return;
    try {
      await api.delete(`/video/projects/${pid}`);
      setProjects(prev => prev.filter(p => p.id !== pid));
      if (active?.id === pid) setActive(null);
    } catch (err) { toast(err.message, 'error'); }
  }

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>;

  return (
    <div className="suite-video">
      <div className="kicker"><span className="pip" /><span>Video Studio · auto-edit</span></div>
      <header className="hero"><div><h1 className="display mt-2">Video Studio</h1></div></header>
      <p style={{ fontSize: 13, color: 'var(--text-subtle)', maxWidth: 720, margin: '0 0 18px' }}>
        Drop raw clips, pick a brand style, and run the auto-edit — it trims dead air, adds captions
        and motion graphics, grades the result, and re-edits until it passes. Rendering runs on the
        dedicated worker; this screen queues the job and tracks it.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 22 }}>
        {/* Left: create + project list */}
        <div>
          <form onSubmit={createProject} className="card" style={{ marginBottom: 14 }}>
            <div className="caption mb-2">New edit</div>
            <input className="input" placeholder="Project name" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 8 }} />
            <select className="input" value={preset} onChange={e => setPreset(e.target.value)} style={{ marginBottom: 8 }}>
              {STYLE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select className="input" value={outputTarget} onChange={e => setOutputTarget(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="download">Deliver: download / email</option>
              <option value="drive">Deliver: Google Drive folder</option>
            </select>
            <button className="btn btn-primary" disabled={creating || !name.trim()} style={{ width: '100%' }}>
              {creating ? 'Creating…' : '+ Create'}
            </button>
          </form>

          {/* Per-client Drive delivery folder. */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="caption mb-2">Google Drive delivery folder</div>
            <input className="input" placeholder="https://drive.google.com/drive/folders/…" value={driveFolder} onChange={e => setDriveFolder(e.target.value)} style={{ marginBottom: 8 }} />
            <button className="btn btn-secondary btn-sm" onClick={saveDriveFolder} disabled={savingFolder}>{savingFolder ? 'Saving…' : 'Save folder'}</button>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6 }}>Masters from “Deliver: Drive” projects land here. Needs an active Google connector with Drive access.</div>
          </div>
          <div className="h3" style={{ marginBottom: 8 }}>Projects</div>
          {!projects.length && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No projects yet.</div>}
          {projects.map(p => (
            <div key={p.id} className="card" style={{ padding: 10, marginBottom: 8, cursor: 'pointer', background: p.id === active?.id ? 'var(--accent-soft)' : 'var(--surface)' }}
              onClick={() => openProject(p.id)}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>
                {p.clip_count || 0} clip{(p.clip_count || 0) === 1 ? '' : 's'} · {STATUS_LABEL[p.status] || p.status}
              </div>
            </div>
          ))}
        </div>

        {/* Right: active project */}
        <div>
          {!active ? (
            <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>Select or create a project.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div className="h2">{active.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Status: {STATUS_LABEL[active.status] || active.status}{active.error ? ` — ${active.error}` : ''}{active.score != null ? ` · QA score ${active.score}/100` : ''}</div>
                  {active.status === 'done' && active.output_url && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <a className="btn btn-primary btn-sm" href={`/api/video/projects/${active.id}/output`} target="_blank" rel="noreferrer">↓ Download finished video</a>
                      {active.delivered_url && (
                        <a className="btn btn-secondary btn-sm" href={active.delivered_url} target="_blank" rel="noreferrer">📁 Open in Drive</a>
                      )}
                    </div>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--text-subtle)' }} onClick={() => deleteProject(active.id)}>Delete</button>
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="caption">Clips ({active.clips?.length || 0})</div>
                  <div>
                    <input ref={fileRef} type="file" accept="video/*" multiple onChange={uploadClips} style={{ display: 'none' }} />
                    <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : '↑ Add clips'}</button>
                  </div>
                </div>
                {active.clips?.length ? (
                  <table className="table"><tbody>
                    {active.clips.map(c => (
                      <tr key={c.id}>
                        <td>{c.filename}</td>
                        <td style={{ color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>{c.duration_s ? `${Math.round(c.duration_s)}s` : '—'}</td>
                        <td style={{ color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>{c.size_bytes ? `${(c.size_bytes / 1e6).toFixed(1)} MB` : ''}</td>
                      </tr>
                    ))}
                  </tbody></table>
                ) : <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No clips yet — add your raw footage.</div>}
              </div>

              <button className="btn btn-primary" disabled={!active.clips?.length || ['queued', 'processing'].includes(active.status)} onClick={runEdit}>
                {['queued', 'processing'].includes(active.status) ? 'Running…' : '▶ Auto-edit'}
              </button>

              {active.jobs?.length > 0 && (
                <div className="card" style={{ marginTop: 14 }}>
                  <div className="caption mb-2">Pipeline</div>
                  {active.jobs.map(j => (
                    <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--card-border)' }}>
                      <span style={{ textTransform: 'capitalize' }}>{j.stage}</span>
                      <span style={{ color: j.status === 'failed' ? 'var(--negative)' : j.status === 'done' ? 'var(--positive)' : 'var(--text-subtle)' }}>{j.status}{j.error ? ` — ${j.error}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
