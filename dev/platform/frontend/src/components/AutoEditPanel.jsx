// Social factory → auto-edit. Push a post into the auto-edit pipeline: upload
// a raw clip (or several), pick a caption style, and the render worker trims
// dead air, captions it, grades, and exports a finished reel. We reuse the
// Video Studio's project/clip/run API end-to-end — this is just the factory-
// native entry point, seeded from the post, so the AM never leaves the card.
//
// Editing runs on the dedicated render worker that drains the job queue; this
// panel creates + queues the work and polls status until the master is ready.

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

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

// A short, human project name seeded from the post so the AM recognises it in
// the Studio list later.
function seedName(post) {
  const base = (post.hook || post.caption || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const tag = `${post.platform || 'social'} ${post.kind || 'reel'}`;
  return base ? `${base} — auto-edit` : `${tag} — auto-edit`;
}

export default function AutoEditPanel({ clientId, post }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [preset, setPreset] = useState('auto');
  const [project, setProject] = useState(null);   // full project (with clips/jobs)
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Poll while the pipeline is running so stages + the download appear live.
  useEffect(() => {
    if (!project || !['queued', 'processing'].includes(project.status)) return;
    const t = setInterval(async () => {
      try { setProject(await api.get(`/video/projects/${project.id}`)); } catch { /* keep last */ }
    }, 5000);
    return () => clearInterval(t);
  }, [project?.id, project?.status]);

  // One-click: create a project seeded from the post, upload the chosen
  // clip(s), and queue the auto-edit. Multi-select uploads them all into one
  // edit.
  async function uploadAndRun(e) {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const p = await api.post(`/video/clients/${clientId}/projects`, {
        name: seedName(post), style_preset: preset, output_target: 'download',
      });
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      await api.postForm(`/video/projects/${p.id}/clips`, fd);
      const ran = await api.post(`/video/projects/${p.id}/run`, {});
      setProject(ran);
      toast('Auto-edit queued — the render worker will pick it up.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
      {!project ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
            Upload your raw footage and the auto-edit pipeline trims dead air, adds captions and motion
            graphics, grades the result, and re-edits until it passes. Rendering runs on the dedicated
            worker — it lands here when it's done.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={preset} onChange={e => setPreset(e.target.value)} className="input" style={{ maxWidth: 220 }}>
              {STYLE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input ref={fileRef} type="file" accept="video/*" multiple onChange={uploadAndRun} style={{ display: 'none' }} />
            <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: () => fileRef.current?.click(), disabled: busy })}>
              {busy ? 'Uploading…' : '↑ Upload clip & auto-edit'}
            </button>
          </div>
        </>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 8 }}>
            Status: {STATUS_LABEL[project.status] || project.status}
            {project.error ? ` — ${project.error}` : ''}
            {project.score != null ? ` · QA score ${project.score}/100` : ''}
          </div>

          {project.status === 'done' && project.output_url && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <a className="btn btn-primary btn-sm" href={`/api/video/projects/${project.id}/output`} target="_blank" rel="noreferrer">↓ Download finished reel</a>
              {project.delivered_url && (
                <a className="btn btn-secondary btn-sm" href={project.delivered_url} target="_blank" rel="noreferrer">↗ Open delivered</a>
              )}
            </div>
          )}

          {project.jobs?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {project.jobs.map(j => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderTop: '1px solid var(--card-border)' }}>
                  <span style={{ textTransform: 'capitalize' }}>{j.stage}</span>
                  <span style={{ color: j.status === 'failed' ? 'var(--negative)' : j.status === 'done' ? 'var(--positive)' : 'var(--text-subtle)' }}>
                    {j.status}{j.error ? ` — ${j.error}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setProject(null)}>
            ＋ Start another auto-edit
          </button>
        </div>
      )}
    </div>
  );
}
