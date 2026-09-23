import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Proof library: the case studies, testimonials, credentials and press lines a
// proposal picks from. Tags drive the matching: sector ×3, problem ×2, so an
// architect sees an architect's quote about the problem they actually have.
const KINDS = { case_study: 'Case study', testimonial: 'Testimonial', credential: 'Credential', press: 'Press line' };
const SECTORS = 'architecture, interiors, residential, commercial, furniture, design, retail, homeware, hospitality, property, construction, culture, events, fashion, lighting';
const PROBLEMS = 'press, search, ai, social, content, positioning, leads, ecommerce, paid, trust';
const EMPTY = { kind: 'case_study', title: '', body: '', attribution: '', sector_tags: '', problem_tags: '', url: '', active: true };

export default function ProofLibraryPage() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [edit, setEdit] = useState(null);

  useEffect(() => { load(); }, []); // eslint-disable-line
  async function load() {
    try { setItems(await api.get('/proposals/proof')); } catch (e) { toast(e.message, 'error'); setItems([]); }
  }
  async function save() {
    const body = { ...edit, sector_tags: String(edit.sector_tags || ''), problem_tags: String(edit.problem_tags || '') };
    try {
      if (edit.id) await api.put(`/proposals/proof/${edit.id}`, body); else await api.post('/proposals/proof', body);
      setEdit(null); await load(); toast('Saved.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(it) {
    if (!confirm(`Delete "${it.title}"?`)) return;
    try { await api.delete(`/proposals/proof/${it.id}`); await load(); } catch (e) { toast(e.message, 'error'); }
  }

  if (items === null) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;
  const counts = Object.fromEntries(Object.keys(KINDS).map(k => [k, items.filter(i => i.kind === k && i.active).length]));

  return (
    <div>
      <div className="row between center wrap mb-4" style={{ gap: 'var(--s3)' }}>
        <div className="body-sm text-muted">{Object.entries(KINDS).map(([k, l]) => `${counts[k]} ${l.toLowerCase()}${counts[k] === 1 ? '' : 's'}`).join(' · ')}</div>
        <button className="btn btn-primary" onClick={() => setEdit({ ...EMPTY })}>Add proof</button>
      </div>
      {counts.case_study === 0 && <div className="card mb-4" style={{ borderColor: 'var(--accent)' }}><div className="body-sm">No case studies yet. A case study in the prospect's sector is the strongest thing a proposal carries. Add two or three per core sector: problem, what October did, the result in numbers.</div></div>}

      {edit && (
        <div className="card mb-4">
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <div className="field" style={{ width: 180 }}><label className="field-label">Type</label>
              <select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ flex: 1 }}><label className="field-label">Title (client, project or credential)</label>
              <input className="input" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></div>
          </div>
          <div className="field"><label className="field-label">{edit.kind === 'testimonial' ? 'Quote' : 'Summary (problem, what we did, result)'}</label>
            <textarea className="textarea" rows={3} value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} /></div>
          <div className="field"><label className="field-label">Attribution / outcome line</label>
            <input className="input" value={edit.attribution || ''} onChange={e => setEdit({ ...edit, attribution: e.target.value })} placeholder="e.g. Craig, Director, ROAR · or · 3 national titles in 6 months" /></div>
          <div className="field"><label className="field-label">Sector tags (comma separated)</label>
            <input className="input" value={edit.sector_tags} onChange={e => setEdit({ ...edit, sector_tags: e.target.value })} placeholder={SECTORS} /></div>
          <div className="field"><label className="field-label">Problem tags (comma separated)</label>
            <input className="input" value={edit.problem_tags} onChange={e => setEdit({ ...edit, problem_tags: e.target.value })} placeholder={PROBLEMS} /></div>
          <div className="field"><label className="field-label">Link (optional)</label>
            <input className="input" value={edit.url || ''} onChange={e => setEdit({ ...edit, url: e.target.value })} /></div>
          <label className="body-sm row center" style={{ gap: 6 }}><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Active (available to proposals)</label>
          <div className="row mt-3" style={{ gap: 'var(--s2)' }}>
            <button className="btn btn-primary" onClick={save}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>Type</th><th>Title</th><th>Sectors</th><th>Evidences</th><th></th></tr></thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} style={{ opacity: it.active ? 1 : 0.5 }}>
                <td className="text-muted">{KINDS[it.kind]}</td>
                <td className="strong" style={{ cursor: 'pointer' }} onClick={() => setEdit({ ...it, sector_tags: (it.sector_tags || []).join(', '), problem_tags: (it.problem_tags || []).join(', ') })}>{it.title}</td>
                <td className="text-muted">{(it.sector_tags || []).join(', ')}</td>
                <td className="text-muted">{(it.problem_tags || []).join(', ')}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(it)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
