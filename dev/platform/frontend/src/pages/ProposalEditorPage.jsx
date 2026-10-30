import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import ProposalDocument, { PROPOSAL_CSS } from '../components/proposal/ProposalDocument';

// One-glance approval. Left: the proposal exactly as the prospect will see it.
// Right: the checks that matter before it goes (who it's to, which proof was
// matched and why, pricing), a refine box, and after sending, what they read.
const STATUS = {
  draft: 'Draft, not sent', sent: 'Sent, not opened', viewed: 'Opened',
  replied: 'Replied', accepted: 'Accepted', lost: 'Lost',
};
// SOST, in the order the document reads. Splitting the old single "Plan" row
// into its four steps is what makes the dwell bars worth looking at: "four
// minutes on tactics" tells you to talk about delivery, where "read the plan"
// tells you nothing.
const SECTION_LABEL = {
  cover: 'Cover', letter: 'Letter', situation: 'Situation', objectives: 'Objectives',
  strategy: 'Strategy', method: 'How it works', tactics: 'Tactics', proof: 'Proof',
  availability: 'Places', pricing: 'Pricing', next: 'Sign-up step',
};

export default function ProposalEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [p, setP] = useState(null);
  const [preview, setPreview] = useState(null);
  const [proof, setProof] = useState([]);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [methods, setMethods] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  useEffect(() => { load(); api.get('/proposals/proof').then(setProof).catch(() => {}); /* eslint-disable-line */ }, [id]);
  useEffect(() => {
    api.get('/proposals/methods').then(d => {
      setMethods((d.methods || []).filter(m => m.active));
      setCurrencies(d.currencies || []);
    }).catch(() => {});
  }, []);

  // Repricing is not a redraft. Daniel picks the level from the call, and
  // changing his mind must cost nothing, so this swaps the method snapshot and
  // leaves the four written blocks exactly as they are.
  async function setLevel(fields) {
    setBusy('method');
    try { await api.post(`/proposals/${id}/method`, fields); await load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  }

  async function load() {
    try {
      const [row, pv] = await Promise.all([api.get(`/proposals/${id}`), api.get(`/proposals/${id}/preview`)]);
      setP(row); setPreview(pv);
    } catch (e) { toast(e.message, 'error'); }
  }
  async function patch(fields) {
    try { await api.patch(`/proposals/${id}`, fields); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function refine() {
    const m = msg.trim(); if (!m) return;
    setBusy('refine');
    try { await api.post(`/proposals/${id}/refine`, { message: m }); setMsg(''); await load(); toast('Updated.', 'success'); }
    catch (e) { toast(`Couldn't apply: ${e.message}`, 'error'); } finally { setBusy(null); }
  }
  async function send() {
    if (!confirm(`Send to ${p.recipient_email}?`)) return;
    setBusy('send');
    try { await api.post(`/proposals/${id}/send`, {}); await load(); toast('Sent. You will be told the moment it is opened.', 'success'); }
    catch (e) { toast(`Send failed: ${e.message}`, 'error'); } finally { setBusy(null); }
  }
  async function remove() {
    if (!confirm('Delete this proposal?')) return;
    try { await api.delete(`/proposals/${id}`); navigate('/settings/proposals'); }
    catch (e) { toast(e.message, 'error'); }
  }

  if (!p || !preview) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;
  const c = p.content || {};
  const m = p.matched || {};
  const byId = Object.fromEntries(proof.map(x => [x.id, x]));
  const reason = (pid) => m.reasons?.[pid]?.why || '';
  const e = p.engagement || { sections: {} };
  const maxSec = Math.max(1, ...Object.values(e.sections || {}));
  const isDraft = p.status === 'draft';

  const proofSelect = (label, kind, key) => (
    <div className="field">
      <label className="field-label">{label}</label>
      <select className="input" value={m[key] || ''} onChange={ev => patch({ matched: { [key]: ev.target.value || null } })} disabled={!isDraft}>
        <option value="">None</option>
        {(m.alternatives?.[kind] || proof.filter(x => x.kind === kind).map(x => x.id)).map(pid => byId[pid] && (
          <option key={pid} value={pid}>{byId[pid].title}{m.reasons?.[pid] ? ` (score ${m.reasons[pid].score})` : ''}</option>
        ))}
      </select>
      {m[key] && <div className="body-xs text-muted mt-1">Why: {reason(m[key])}</div>}
    </div>
  );

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings/proposals')} style={{ marginBottom: 'var(--s3)' }}>All proposals</button>
      <div className="row between center wrap" style={{ gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
        <div>
          <div className="kicker"><span className="pip" />Proposal · {STATUS[p.status] || p.status}</div>
          <h1 className="h1 mt-2">{p.company_name || 'Proposal'}</h1>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/leads/${p.lead_id}`)}>Open lead</button>
        </div>
        <div className="row wrap" style={{ gap: 'var(--s2)' }}>
          {!isDraft && <a className="btn btn-secondary" href={`${p.link}?preview=1`} target="_blank" rel="noreferrer">View live page</a>}
          {!isDraft && !['replied', 'accepted', 'lost'].includes(p.status) && <button className="btn btn-secondary" onClick={() => patch({ status: 'replied' })}>Mark replied</button>}
          {!isDraft && !['accepted', 'lost'].includes(p.status) && <button className="btn btn-ghost" onClick={() => { const r = prompt('Reason lost (optional)'); if (r !== null) patch({ status: 'lost', lost_reason: r }); }}>Mark lost</button>}
          {isDraft && <button className="btn btn-primary" onClick={send} disabled={busy === 'send' || !p.recipient_email}>{busy === 'send' ? 'Sending…' : 'Approve and send'}</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(300px, 1fr)', gap: 'var(--s5)', alignItems: 'start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', maxHeight: '82vh', overflowY: 'auto' }}>
          <style>{PROPOSAL_CSS}</style>
          <ProposalDocument data={preview} acceptSlot={<div className="body-sm" style={{ color: '#b9b9b9', marginTop: 16 }}>[Name, terms tick-box and Direct Debit button appear here for the prospect.]</div>} />
        </div>

        <div className="stack" style={{ gap: 'var(--s4)' }}>
          {!isDraft && (
            <div className="card">
              <div className="caption mb-3">Engagement</div>
              <div className="body-sm">
                Sent {fmt(p.sent_at)} · opened {p.open_count}× · first {fmt(p.first_opened_at)} · last {fmt(p.last_opened_at)}
              </div>
              <div className="body-sm text-muted mt-1">{e.sessions} session{e.sessions === 1 ? '' : 's'} over {e.distinct_days} day{e.distinct_days === 1 ? '' : 's'}, {Math.round((e.seconds || 0) / 60)} min reading</div>
              <div className="stack mt-3" style={{ gap: 6 }}>
                {Object.keys(SECTION_LABEL).map(k => (
                  <div key={k} className="row center" style={{ gap: 'var(--s2)' }}>
                    <div className="body-xs" style={{ width: 92 }}>{SECTION_LABEL[k]}</div>
                    <div style={{ flex: 1, height: 10, background: 'var(--surface-raised)', borderRadius: 4 }}>
                      <div style={{ width: `${((e.sections?.[k] || 0) / maxSec) * 100}%`, height: '100%', background: k === 'pricing' ? 'var(--accent)' : 'var(--text)', borderRadius: 4 }} />
                    </div>
                    <div className="body-xs text-muted" style={{ width: 36, textAlign: 'right' }}>{e.sections?.[k] || 0}s</div>
                  </div>
                ))}
              </div>
              {p.accepted_at && <div className="body-sm mt-3"><strong>Accepted</strong> by {p.accepted_name} ({p.accepted_package}) {fmt(p.accepted_at)}</div>}
            </div>
          )}

          <div className="card">
            <div className="caption mb-3">Before it goes</div>
            {/* The level and the market. Changing either swaps the priced offer
                and leaves the four written blocks untouched, so a reprice costs
                nothing and never risks the prospect's own sections. */}
            <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <Field label="Level">
                  <select className="input" value={p.method_id || ''} disabled={!isDraft || busy === 'method'}
                    onChange={ev => setLevel({ method_id: ev.target.value })}>
                    {!methods.some(m => m.id === p.method_id) && (
                      <option value={p.method_id || ''}>{p.method_snapshot?.name || 'none'}</option>
                    )}
                    {methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ flex: '0 1 120px' }}>
                <Field label="Currency">
                  <select className="input" value={p.currency || 'GBP'} disabled={!isDraft || busy === 'method'}
                    onChange={ev => setLevel({ currency: ev.target.value })}>
                    {currencies.map(cc => <option key={cc.code} value={cc.code}>{cc.symbol} {cc.code}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            {p.method_snapshot?.price_missing && (
              <div className="body-xs mb-2" style={{ color: 'var(--warning)' }}>
                No {p.currency} price on this level, so the proposal says the price is to confirm.
                Set it in Settings → Proposals and pick the level again.
              </div>
            )}
            <Field label="Send to (email)"><input className="input" defaultValue={p.recipient_email || ''} disabled={!isDraft}
              onBlur={ev => ev.target.value !== (p.recipient_email || '') && patch({ recipient_email: ev.target.value })} /></Field>
            <Field label="Addressed to (as written on the letter)"><input className="input" defaultValue={p.recipient_names || ''} disabled={!isDraft}
              placeholder="Shaun, Craig and Debbie"
              onBlur={ev => ev.target.value !== (p.recipient_names || '') && patch({ recipient_names: ev.target.value })} /></Field>
            <Field label="Email subject"><input className="input" defaultValue={c.email_subject || ''} disabled={!isDraft}
              onBlur={ev => ev.target.value !== (c.email_subject || '') && patch({ content: { email_subject: ev.target.value } })} /></Field>
            <Field label="Covering note"><textarea className="textarea" rows={3} defaultValue={c.email_note || ''} disabled={!isDraft}
              onBlur={ev => ev.target.value !== (c.email_note || '') && patch({ content: { email_note: ev.target.value } })} /></Field>
            <Field label="Cover image URL"><input className="input" defaultValue={c.cover_image || ''} disabled={!isDraft} placeholder="Blank = yellow check"
              onBlur={ev => ev.target.value !== (c.cover_image || '') && patch({ content: { cover_image: ev.target.value || null } })} /></Field>
            {/* The old Currency / One-off onboarding / Recommend row has gone.
                All three were left over from the hardcoded two-tier offer and
                none of them still worked: setup fee and currency now come from
                the method snapshot, and "recommend" does not exist when the
                proposal states one package.

                Currency was the dangerous one. It set a bare symbol on the
                content, so choosing $ would have rendered "$1,870" on a
                proposal still priced and mandated in GBP, in a document that
                becomes an agreement the moment it is accepted. Price lives in
                one place now: the Level and Currency pickers above, which swap
                the whole priced snapshot together. */}
            <div className="body-xs text-muted">Matched on: {(c.sector_tags || []).join(', ') || 'no sector'} · {(c.problem_tags || []).join(', ') || 'no problem tags'}</div>
          </div>

          <div className="card">
            <div className="caption mb-3">Proof matched to this prospect</div>
            {proofSelect('Case study', 'case_study', 'case_study')}
            {proofSelect('Testimonial', 'testimonial', 'testimonial')}
            <div className="field">
              <label className="field-label">Credentials</label>
              {(m.credentials || []).map(cid => byId[cid] && <div key={cid} className="body-sm">{byId[cid].title} <span className="text-muted body-xs">({reason(cid)})</span></div>)}
            </div>
            {!proof.some(x => x.kind === 'case_study') && <div className="body-xs" style={{ color: 'var(--warning, #9a6b00)' }}>No case studies in the library yet. Add them in Settings → Biz dev → Proof library; they are the strongest proof you have.</div>}
          </div>

          {isDraft && (
            <div className="card">
              <div className="caption mb-3">Refine with Claude</div>
              <textarea className="textarea" rows={2} value={msg} onChange={ev => setMsg(ev.target.value)}
                onKeyDown={ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) refine(); }}
                placeholder="e.g. 'make the priority Kindling and Channel press', 'shorter letter', 'mention the heritage consultant'" />
              <button className="btn btn-primary btn-sm mt-2" onClick={refine} disabled={busy === 'refine' || !msg.trim()}>{busy === 'refine' ? 'Rewriting…' : 'Apply (⌘↵)'}</button>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }} onClick={remove}>Delete proposal</button>
        </div>
      </div>
    </div>
  );
}

function fmt(d) {
  return d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

function Field({ label, children }) {
  return <div className="field" style={{ flex: 1 }}><label className="field-label">{label}</label>{children}</div>;
}
