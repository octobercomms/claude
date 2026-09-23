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

  if (!lead) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;
  const host = (() => { try { return new URL(lead.url).hostname.replace(/^www\./, ''); } catch { return lead.url; } })();
  const hasDraft = !!lead.draft;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/leads')} style={{ marginBottom: 'var(--s3)' }}>All leads</button>
      <div className="row between center wrap" style={{ gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="kicker"><span className="pip" />Snapshot Studio</div>
          <h1 className="h1 mt-2">{lead.company_name || host}</h1>
          <a className="body-sm text-muted" href={lead.url} target="_blank" rel="noreferrer">{host} ↗</a>
        </div>
        <div className="row wrap" style={{ gap: 'var(--s2)' }}>
          <button className="btn btn-secondary" onClick={() => gather()} disabled={busy === 'gather'}>
            {busy === 'gather' ? 'Drafting…' : (hasDraft ? '↻ Re-draft' : '⚡ Draft')}
          </button>
          <button className="btn btn-secondary" onClick={downloadPdf} disabled={!hasDraft}>PDF</button>
          {['new', 'drafted'].includes(lead.status) && <button className="btn btn-primary" onClick={() => patch({ status: 'sent' })} disabled={!hasDraft}>Mark sent</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(300px, 1fr)', gap: 'var(--s5)', alignItems: 'start' }}>
        {/* Preview */}
        <div className="card" style={{ padding: 'var(--s2)', position: 'sticky', top: 12 }}>
          {busy === 'gather' ? (
            <div className="text-subtle" style={{ padding: 'var(--s8)', textAlign: 'center' }}>Reading {host} and drafting the snapshot… (~15s)</div>
          ) : hasDraft ? (
            <iframe key={bust} title="preview" src={`/api/leads/${id}/preview.html?t=${bust}`}
              style={{ width: '100%', height: '78vh', border: 'none', borderRadius: 'var(--r-sm)' }} />
          ) : (
            <div className="text-subtle" style={{ padding: 'var(--s8)', textAlign: 'center' }}>No draft yet — hit <strong>⚡ Draft</strong> to read their site and generate the snapshot.</div>
          )}
        </div>

        {/* Cockpit */}
        <div className="stack" style={{ gap: 'var(--s4)' }}>
          <PipelineCard lead={lead} onLead={setLead} patch={patch} />

          <div className="card">
            <div className="caption mb-3">Lead</div>
            <Field label="Email"><input className="input" defaultValue={lead.email || ''} placeholder="—"
              onBlur={e => e.target.value !== (lead.email || '') && patch({ email: e.target.value })} /></Field>
            <Field label="Instagram handle"><input className="input" defaultValue={lead.ig_handle || ''} placeholder="@handle"
              onBlur={e => e.target.value !== (lead.ig_handle || '') && patch({ ig_handle: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" rows={2} defaultValue={lead.notes || ''}
              onBlur={e => e.target.value !== (lead.notes || '') && patch({ notes: e.target.value })} /></Field>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)', marginTop: 'var(--s1)' }} onClick={removeLead}>Delete lead</button>
          </div>

          <div className="card">
            <div className="row between center mb-3">
              <div className="caption">Images — tick to feature</div>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>Upload</button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { uploadImage(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {!lead.images?.length ? (
              <div className="body-sm text-subtle">No images yet. Re-draft to pull from their site, or upload an Instagram screen-grab.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 'var(--s2)' }}>
                {lead.images.map(img => (
                  <div key={img.id} style={{ position: 'relative', borderRadius: 'var(--r-sm)', overflow: 'hidden', border: '2px solid ' + (img.featured ? 'var(--accent)' : 'var(--card-border)'), cursor: 'pointer', aspectRatio: '1' }}
                    onClick={() => toggleFeatured(img)} title={img.featured ? 'Featured — click to remove' : 'Click to feature'}>
                    <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {img.featured && <span style={{ position: 'absolute', top: 3, left: 3, background: 'var(--accent)', color: 'var(--accent-on)', fontSize: 'var(--fs-caption)', fontWeight: 800, borderRadius: 'var(--r-sm)', padding: '0 var(--s1)' }}>✓</span>}
                    {img.kind !== 'site' && <span style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 'var(--fs-caption)', fontWeight: 700, borderRadius: 'var(--r-sm)', padding: '0 var(--s1)' }}>UP</span>}
                    <button onClick={e => { e.stopPropagation(); deleteImage(img); }} className="btn-icon btn-icon-sm danger" style={{ position: 'absolute', top: 2, right: 2 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hasDraft && (
            <div className="card">
              <div className="caption mb-3">Refine with Claude</div>
              {log.length > 0 && (
                <div className="stack" style={{ gap: 'var(--s2)', marginBottom: 'var(--s3)', maxHeight: 180, overflowY: 'auto' }}>
                  {log.map((m, i) => (
                    <div key={i} className="body-xs" style={{ padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', background: m.role === 'you' ? 'var(--accent-soft)' : 'var(--surface-raised)' }}>
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

// Sales pipeline controls (docs/omi/sales-pipeline.md): who, how they found
// us, the call and its brief, the call notes, then the proposal.
function PipelineCard({ lead, onLead, patch }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [callAt, setCallAt] = useState(lead.call_at ? toLocalInput(lead.call_at) : '');
  const [busy, setBusy] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [names, setNames] = useState(lead.contact_name || '');
  const [angle, setAngle] = useState('');
  const brief = lead.call_brief;

  useEffect(() => { api.get(`/proposals/lead/${lead.id}`).then(setProposals).catch(() => {}); }, [lead.id]);

  async function book() {
    setBusy('book');
    try {
      await api.post(`/proposals/lead/${lead.id}/call`, { call_at: callAt ? new Date(callAt).toISOString() : null });
      onLead(await api.post(`/proposals/lead/${lead.id}/brief`, {}));
      toast('Call booked. Brief ready.', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  }
  async function regenBrief() {
    setBusy('brief');
    try { onLead(await api.post(`/proposals/lead/${lead.id}/brief`, {})); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  }
  async function draftProposal() {
    setBusy('proposal');
    try {
      const notes = document.getElementById('pp-call-notes')?.value;
      const p = await api.post('/proposals', { lead_id: lead.id, recipient_names: names, recipient_email: lead.email, call_notes: notes, angle });
      navigate(`/proposals/${p.id}`);
    } catch (e) { toast(`Draft failed: ${e.message}`, 'error'); setBusy(null); }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="caption mb-3">Pipeline</div>
      <Field label="Contact name"><input className="input" defaultValue={lead.contact_name || ''} placeholder="—"
        onBlur={e => e.target.value !== (lead.contact_name || '') && patch({ contact_name: e.target.value })} /></Field>
      <Field label="How they heard about us"><input className="input" defaultValue={lead.referral_source || ''} placeholder="ADF, referral, Google…"
        onBlur={e => e.target.value !== (lead.referral_source || '') && patch({ referral_source: e.target.value })} /></Field>

      <div className="row" style={{ gap: 'var(--s2)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><Field label={lead.call_booked_at ? 'Call (booked)' : 'Call time'}>
          <input className="input" type="datetime-local" value={callAt} onChange={e => setCallAt(e.target.value)} /></Field></div>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 'var(--s3)' }} onClick={book} disabled={!!busy}>
          {busy === 'book' ? 'Preparing…' : lead.call_booked_at ? 'Update' : 'Mark call booked'}</button>
      </div>

      {brief && (
        <div className="body-sm" style={{ background: 'var(--surface-raised)', borderRadius: 'var(--r-sm)', padding: 'var(--s3)', marginBottom: 'var(--s3)' }}>
          <div className="row between center"><strong>Call brief</strong>
            <button className="btn btn-ghost btn-sm" onClick={regenBrief} disabled={!!busy}>{busy === 'brief' ? '…' : '↻'}</button></div>
          <p className="mt-1"><em>Open with:</em> {brief.opener}</p>
          <ol style={{ paddingLeft: 18, margin: '6px 0' }}>
            {(brief.talking_points || []).map((t, i) => <li key={i}><strong>{t.point}</strong> <span className="text-muted">({t.evidence})</span></li>)}
          </ol>
          {brief.questions?.length > 0 && <><em>Ask:</em><ul style={{ paddingLeft: 18, margin: '4px 0' }}>{brief.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
          {brief.likely_objection && <p className="mt-1"><em>Likely objection:</em> {brief.likely_objection.objection} <span className="text-muted">→ {brief.likely_objection.answer}</span></p>}
        </div>
      )}

      <Field label="Call notes (type during the call, or paste the Meet notes/transcript)">
        <textarea id="pp-call-notes" className="textarea" rows={5} defaultValue={lead.call_notes || ''}
          placeholder="What they want, in their words. Budget, timeline, who decides, what they've tried."
          onBlur={e => e.target.value !== (lead.call_notes || '') && patch({ call_notes: e.target.value })} /></Field>
      <Field label="Address the proposal to"><input className="input" value={names} onChange={e => setNames(e.target.value)} placeholder="Shaun, Craig and Debbie" /></Field>
      <Field label="Your angle (optional, one line)"><input className="input" value={angle} onChange={e => setAngle(e.target.value)} placeholder="e.g. it's a positioning problem, not a press problem" /></Field>
      <button className="btn btn-primary" onClick={draftProposal} disabled={!!busy || !lead.email}>
        {busy === 'proposal' ? 'Drafting the proposal (about a minute)…' : 'Draft proposal'}</button>
      {!lead.email && <div className="body-xs text-muted mt-1">Add their email above first.</div>}

      {proposals.length > 0 && (
        <div className="mt-3">
          {proposals.map(p => (
            <button key={p.id} className="btn btn-ghost btn-sm" onClick={() => navigate(`/proposals/${p.id}`)}>
              Proposal · {p.status}{p.open_count ? ` · opened ${p.open_count}×` : ''} →
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function toLocalInput(d) {
  const t = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
