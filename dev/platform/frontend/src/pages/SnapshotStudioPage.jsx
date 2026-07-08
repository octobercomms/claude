import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Snapshot Studio cockpit — draft on the left (live preview), curate on the
// right (lead fields · asset tray · refine chat). Admin-only.
export default function SnapshotStudioPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [lead, setLead] = useState(null);
  const [busy, setBusy] = useState(null);      // 'gather' | 'refine' | null
  const [bust, setBust] = useState(0);          // force preview reload
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState([]);
  const fileRef = useRef(null);
  const gatheredOnce = useRef(false);

  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  async function load() {
    try {
      const l = await api.get(`/leads/${id}`);
      setLead(l);
      if (params.get('gather') === '1' && !gatheredOnce.current && l.status === 'new') {
        gatheredOnce.current = true;
        setParams({}, { replace: true });
        gather(l);
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  function refreshPreview() { setBust(b => b + 1); }

  async function gather(current = lead) {
    setBusy('gather');
    try {
      const l = await api.post(`/leads/${id}/gather`, {});
      setLead(l); refreshPreview();
      toast('Snapshot drafted.', 'success');
    } catch (e) { toast(`Draft failed: ${e.message}`, 'error'); }
    finally { setBusy(null); }
  }

  async function refine() {
    const text = msg.trim();
    if (!text || busy) return;
    setBusy('refine'); setMsg('');
    setLog(prev => [...prev, { role: 'you', text }]);
    try {
      const l = await api.post(`/leads/${id}/refine`, { message: text });
      setLead(l); refreshPreview();
      setLog(prev => [...prev, { role: 'claude', text: 'Updated the draft.' }]);
    } catch (e) {
      setLog(prev => [...prev, { role: 'claude', text: `Couldn't apply that: ${e.message}` }]);
    } finally { setBusy(null); }
  }

  async function patch(fields) {
    try { setLead(await api.patch(`/leads/${id}`, fields)); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function toggleFeatured(img) {
    try {
      await api.patch(`/leads/images/${img.id}`, { featured: !img.featured });
      setLead(l => ({ ...l, images: l.images.map(x => x.id === img.id ? { ...x, featured: !x.featured } : x) }));
      refreshPreview();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function uploadImage(file) {
    if (!file) return;
    try {
      const fd = new FormData(); fd.append('file', file);
      await api.postForm(`/leads/${id}/images`, fd);
      await load();
      toast('Image added — tick it to feature.', 'success');
    } catch (e) { toast(`Upload failed: ${e.message}`, 'error'); }
  }

  async function deleteImage(img) {
    try {
      await api.delete(`/leads/images/${img.id}`);
      setLead(l => ({ ...l, images: l.images.filter(x => x.id !== img.id) }));
      refreshPreview();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function removeLead() {
    if (!confirm('Delete this lead and its snapshot?')) return;
    try { await api.delete(`/leads/${id}`); navigate('/leads'); }
    catch (e) { toast(e.message, 'error'); }
  }

  function downloadPdf() {
    let filename = 'growth-snapshot.pdf';
    fetch(`/api/leads/${id}/pdf`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) return r.json().then(j => Promise.reject(new Error(j.error || 'PDF failed')));
        // Honour the server's filename ("October Communications Growth Snapshot
        // for <company>.pdf"); prefer the RFC 5987 filename* if present.
        const cd = r.headers.get('Content-Disposition') || '';
        const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
        const plain = cd.match(/filename="([^"]+)"/i);
        if (star) { try { filename = decodeURIComponent(star[1]); } catch { /* keep default */ } }
        else if (plain) filename = plain[1];
        return r.blob();
      })
      .then(blob => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
      })
      .catch(e => toast(e.message, 'error'));
  }

  if (!lead) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;
  const host = (() => { try { return new URL(lead.url).hostname.replace(/^www\./, ''); } catch { return lead.url; } })();
  const hasDraft = !!lead.draft;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/leads')} style={{ marginBottom: 10 }}>← All leads</button>
      <div className="row between center wrap" style={{ gap: 12, marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="kicker"><span className="pip" />Snapshot Studio</div>
          <h1 className="h1 mt-2">{lead.company_name || host}</h1>
          <a className="body-sm text-muted" href={lead.url} target="_blank" rel="noreferrer">{host} ↗</a>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => gather()} disabled={busy === 'gather'}>
            {busy === 'gather' ? 'Drafting…' : (hasDraft ? '↻ Re-draft' : '⚡ Draft')}
          </button>
          <button className="btn btn-secondary" onClick={downloadPdf} disabled={!hasDraft}>↓ PDF</button>
          {lead.status !== 'sent' && <button className="btn btn-primary" onClick={() => patch({ status: 'sent' })} disabled={!hasDraft}>Mark sent</button>}
          {lead.status === 'sent' && <button className="btn btn-primary" onClick={() => patch({ status: 'booked' })}>Mark booked</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(300px, 1fr)', gap: 18, alignItems: 'start' }}>
        {/* Preview */}
        <div className="card" style={{ padding: 8, position: 'sticky', top: 12 }}>
          {busy === 'gather' ? (
            <div className="text-subtle" style={{ padding: 40, textAlign: 'center' }}>Reading {host} and drafting the snapshot… (~15s)</div>
          ) : hasDraft ? (
            <iframe key={bust} title="preview" src={`/api/leads/${id}/preview.html?t=${bust}`}
              style={{ width: '100%', height: '78vh', border: 'none', borderRadius: 'var(--r-sm)' }} />
          ) : (
            <div className="text-subtle" style={{ padding: 40, textAlign: 'center' }}>No draft yet — hit <strong>⚡ Draft</strong> to read their site and generate the snapshot.</div>
          )}
        </div>

        {/* Cockpit */}
        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="caption mb-3">Lead</div>
            <Field label="Email"><input className="input" defaultValue={lead.email || ''} placeholder="—"
              onBlur={e => e.target.value !== (lead.email || '') && patch({ email: e.target.value })} /></Field>
            <Field label="Instagram handle"><input className="input" defaultValue={lead.ig_handle || ''} placeholder="@handle"
              onBlur={e => e.target.value !== (lead.ig_handle || '') && patch({ ig_handle: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" rows={2} defaultValue={lead.notes || ''}
              onBlur={e => e.target.value !== (lead.notes || '') && patch({ notes: e.target.value })} /></Field>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)', marginTop: 4 }} onClick={removeLead}>Delete lead</button>
          </div>

          <div className="card">
            <div className="row between center mb-3">
              <div className="caption">Images — tick to feature</div>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>⬆ Upload</button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { uploadImage(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {!lead.images?.length ? (
              <div className="body-sm text-subtle">No images yet. Re-draft to pull from their site, or upload an Instagram screen-grab.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
                {lead.images.map(img => (
                  <div key={img.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '2px solid ' + (img.featured ? 'var(--accent)' : 'var(--card-border)'), cursor: 'pointer', aspectRatio: '1' }}
                    onClick={() => toggleFeatured(img)} title={img.featured ? 'Featured — click to remove' : 'Click to feature'}>
                    <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {img.featured && <span style={{ position: 'absolute', top: 3, left: 3, background: 'var(--accent)', color: 'var(--accent-on)', fontSize: 10, fontWeight: 800, borderRadius: 4, padding: '0 5px' }}>✓</span>}
                    {img.kind !== 'site' && <span style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 8, fontWeight: 700, borderRadius: 3, padding: '0 4px' }}>UP</span>}
                    <button onClick={e => { e.stopPropagation(); deleteImage(img); }} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hasDraft && (
            <div className="card">
              <div className="caption mb-3">Refine with Claude</div>
              {log.length > 0 && (
                <div className="stack" style={{ gap: 6, marginBottom: 10, maxHeight: 180, overflowY: 'auto' }}>
                  {log.map((m, i) => (
                    <div key={i} className="body-xs" style={{ padding: '6px 10px', borderRadius: 8, background: m.role === 'you' ? 'var(--accent-soft)' : 'var(--surface-raised)' }}>
                      <strong>{m.role === 'you' ? 'You' : 'Claude'}:</strong> {m.text}
                    </div>
                  ))}
                </div>
              )}
              <textarea className="textarea" rows={2} value={msg} onChange={e => setMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) refine(); }}
                placeholder="e.g. 'lean into listed buildings', 'punchier PR angle', 'drop the paid section'" />
              <button className="btn btn-primary btn-sm mt-2" onClick={refine} disabled={busy === 'refine' || !msg.trim()}>
                {busy === 'refine' ? 'Rewriting…' : 'Apply (⌘↵)'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
