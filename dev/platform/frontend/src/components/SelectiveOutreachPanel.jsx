// Selective Outreach ("Prospecting") — the approval queue IS the product.
// AI sources + fit-scores prospects and drafts every message; a human approves
// every prospect and every send. Nothing here sends unreviewed. Lives inside
// Owned → Email as a distinct tab (logically separate from the owned-list cold
// email suite; different reputation, compliance basis, sending identity).
//
// Talks to /api/prospecting/*. See docs/platform/outreach/PLAN.md.

import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const FIT_COLOUR = { fit: '#1a7f37', maybe: '#9a6b00', disqualified: '#c62828' };

function FitBadge({ verdict, score }) {
  if (!verdict) return <span className="body-sm text-muted">unscored</span>;
  const c = FIT_COLOUR[verdict] || '#888';
  return (
    <span style={{ color: c, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {verdict}{score != null ? ` · ${score}` : ''}
    </span>
  );
}

export default function SelectiveOutreachPanel({ clientId }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState('queue'); // queue | prospects | setup | suppression

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get(`/prospecting/campaigns?client_id=${clientId}`);
      setCampaigns(rows);
      setActiveId(prev => prev || (rows[0] && rows[0].id) || null);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [clientId, toast]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const active = campaigns.find(c => c.id === activeId) || null;

  async function createCampaign() {
    const name = prompt('Name this campaign (e.g. "Architecture practices — Q3"):');
    if (!name || !name.trim()) return;
    try {
      const c = await api.post('/prospecting/campaigns', { client_id: clientId, name: name.trim() });
      toast('Campaign created — set the ICP in Setup.', 'success');
      setActiveId(c.id);
      setView('setup');
      loadCampaigns();
    } catch (e) { toast(e.message, 'error'); }
  }

  if (loading) return <div className="text-subtle" style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="stack stack-lg">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3 className="h2">Selective outreach</h3>
          <p className="body-sm text-muted mt-2" style={{ maxWidth: 620 }}>
            AI researches and fit-scores prospects and drafts every message — but you approve every prospect and every
            send. Nothing goes out unreviewed, including follow-ups and replies. Runs from a dedicated sending identity,
            separate from this client's main email.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={createCampaign}>+ New campaign</button>
      </div>

      {!campaigns.length ? (
        <div className="empty">
          <div className="h3">No campaigns yet</div>
          <p className="body-sm text-muted mt-3">
            Create a campaign, describe who you want to reach (and who to never pitch), connect a verified sending
            identity, then let the queue fill with prospects to approve.
          </p>
          <button className="btn btn-primary btn-sm mt-3" onClick={createCampaign}>+ New campaign</button>
        </div>
      ) : (
        <>
          {/* Campaign selector */}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {campaigns.map(c => (
              <button
                key={c.id}
                className={`btn btn-sm ${c.id === activeId ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveId(c.id)}
                title={c.status}
              >
                {c.name}
                {c.status !== 'active' ? <span className="text-muted"> · {c.status}</span> : null}
                {Number(c.pending_messages) > 0 ? <span style={{ marginLeft: 6, color: '#9a6b00', fontWeight: 700 }}>{c.pending_messages} to review</span> : null}
              </button>
            ))}
          </div>

          {active && (
            <>
              <div className="row" style={{ gap: 4, borderBottom: '1px solid var(--border, #eee)', paddingBottom: 8 }}>
                {[['queue', 'Approval queue'], ['prospects', 'Prospects'], ['setup', 'Setup'], ['suppression', 'Suppression']].map(([k, label]) => (
                  <button key={k} className={`btn btn-sm ${view === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView(k)}>{label}</button>
                ))}
              </div>

              {view === 'queue' && <QueueView campaign={active} onChange={loadCampaigns} />}
              {view === 'prospects' && <ProspectsView campaign={active} onChange={loadCampaigns} />}
              {view === 'setup' && <SetupView campaign={active} clientId={clientId} onChange={loadCampaigns} />}
              {view === 'suppression' && <SuppressionView clientId={clientId} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Approval queue ───────────────────────────────────────────────────────────

function QueueView({ campaign, onChange }) {
  const toast = useToast();
  const [state, setState] = useState('pending');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState({}); // id → {subject, body}

  const load = useCallback(async () => {
    setLoading(true);
    try { setMessages(await api.get(`/prospecting/campaigns/${campaign.id}/messages?state=${state}`)); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [campaign.id, state, toast]);
  useEffect(() => { load(); }, [load]);

  const editVal = (m, field) => (edits[m.id]?.[field] ?? m[field] ?? '');
  const setEdit = (id, field, v) => setEdits(e => ({ ...e, [id]: { ...e[id], [field]: v } }));
  const dirty = (m) => edits[m.id] && ((edits[m.id].subject != null && edits[m.id].subject !== m.subject) || (edits[m.id].body != null && edits[m.id].body !== m.body));

  async function saveEdit(m) {
    try {
      await api.put(`/prospecting/messages/${m.id}`, { subject: editVal(m, 'subject'), body: editVal(m, 'body') });
      toast('Draft saved.', 'success'); load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function act(m, action) {
    try {
      if (action === 'approve') await api.post(`/prospecting/messages/${m.id}/approve`);
      if (action === 'send') await api.post(`/prospecting/messages/${m.id}/send`);
      if (action === 'skip') await api.post(`/prospecting/messages/${m.id}/skip`);
      toast(action === 'send' ? 'Sent.' : action === 'approve' ? 'Approved — scheduled to send.' : 'Skipped.', 'success');
      load(); onChange && onChange();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="stack">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {[['pending', 'To review'], ['approved', 'Scheduled'], ['sent', 'Sent'], ['skipped', 'Skipped']].map(([k, l]) => (
          <button key={k} className={`btn btn-xs ${state === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setState(k)}>{l}</button>
        ))}
      </div>

      {loading ? <div className="text-subtle">Loading…</div>
        : !messages.length ? (
          <div className="empty">
            <div className="h3">{state === 'pending' ? 'Nothing to review' : `No ${state} messages`}</div>
            <p className="body-sm text-muted mt-3">
              {state === 'pending'
                ? 'Approve prospects (or run research) to fill the queue with drafts. Each one lands here for you to read, edit and approve before it can send.'
                : 'Nothing here yet.'}
            </p>
          </div>
        ) : messages.map(m => (
          <div key={m.id} className="card" style={{ padding: 14, border: '1px solid var(--border,#eee)', borderRadius: 8 }}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div>
                <strong>{m.company || '—'}</strong>
                {m.contact_name ? <span className="text-muted"> · {m.contact_name}{m.role ? ` (${m.role})` : ''}</span> : null}
                <div className="body-sm text-muted">{m.email}{m.step ? ` · step ${m.step}` : ''}{m.direction === 'in' ? ' · reply' : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <FitBadge verdict={m.fit_verdict} score={m.fit_score} />
                {m.source ? <div className="body-sm text-muted">via {m.source}{m.source_url ? <> · <a href={m.source_url} target="_blank" rel="noreferrer">source ↗</a></> : null}</div> : null}
              </div>
            </div>
            {m.fit_reasoning ? <div className="body-sm text-muted mt-2"><em>Why:</em> {m.fit_reasoning}</div> : null}
            {m.one_fact ? <div className="body-sm mt-1"><em>Hook:</em> {m.one_fact}</div> : null}

            {state === 'pending' ? (
              <div className="stack mt-3" style={{ gap: 6 }}>
                <input className="input" value={editVal(m, 'subject')} onChange={e => setEdit(m.id, 'subject', e.target.value)} placeholder="Subject" />
                <textarea className="input" rows={7} value={editVal(m, 'body')} onChange={e => setEdit(m.id, 'body', e.target.value)} style={{ fontFamily: 'inherit' }} />
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {dirty(m) && <button className="btn btn-sm btn-ghost" onClick={() => saveEdit(m)}>Save edits</button>}
                  <button className="btn btn-sm btn-primary" onClick={() => act(m, 'approve')}>Approve → schedule</button>
                  <button className="btn btn-sm" onClick={() => act(m, 'send')}>Approve &amp; send now</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => act(m, 'skip')}>Skip</button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <div className="body-sm" style={{ fontWeight: 600 }}>{m.subject}</div>
                <div className="body-sm text-muted" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                {state === 'approved' && <button className="btn btn-xs btn-ghost mt-2" onClick={() => act(m, 'skip')}>Cancel (skip)</button>}
                {m.sent_at ? <div className="body-sm text-muted mt-1">Sent {new Date(m.sent_at).toLocaleString('en-GB')}</div> : null}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

// ── Prospects ────────────────────────────────────────────────────────────────

function ProspectsView({ campaign, onChange }) {
  const toast = useToast();
  const [state, setState] = useState('new');
  const [data, setData] = useState({ prospects: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ company: '', contact_name: '', email: '', role: '', website: '', one_fact: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.get(`/prospecting/campaigns/${campaign.id}/prospects?state=${state}`)); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [campaign.id, state, toast]);
  useEffect(() => { load(); }, [load]);

  async function runResearch() {
    setBusy(true);
    try {
      const r = await api.post(`/prospecting/campaigns/${campaign.id}/source`, {});
      toast(`Research done — ${r.added} new prospect(s) added, ${r.found} found.`, 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function scoreUnscored() {
    setBusy(true);
    try { const r = await api.post(`/prospecting/campaigns/${campaign.id}/score-unscored`, {}); toast(`Scored ${r.scored}, ${r.remaining} left.`, 'success'); load(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function doImport() {
    try { const r = await api.post(`/prospecting/campaigns/${campaign.id}/prospects/import`, { text: importText }); toast(`Imported ${r.imported}, skipped ${r.skipped}.`, 'success'); setImportText(''); setShowImport(false); load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function doAdd() {
    try { await api.post(`/prospecting/campaigns/${campaign.id}/prospects`, addForm); toast('Prospect added + scored.', 'success'); setAddForm({ company: '', contact_name: '', email: '', role: '', website: '', one_fact: '' }); setShowAdd(false); load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function approve(p) {
    try { await api.post(`/prospecting/prospects/${p.id}/approve`); toast('Approved — step 1 drafted into the queue.', 'success'); load(); onChange && onChange(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function dismiss(p) {
    const reason = prompt('Dismiss reason (optional):') ?? '';
    try { await api.post(`/prospecting/prospects/${p.id}/dismiss`, { reason }); load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function rescore(p) {
    try { await api.post(`/prospecting/prospects/${p.id}/score`, {}); load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const states = [['new', 'New'], ['approved', 'Approved'], ['sequenced', 'In sequence'], ['replied', 'Replied'], ['booked', 'Booked'], ['dismissed', 'Dismissed'], ['opted_out', 'Opted out']];

  return (
    <div className="stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {states.map(([k, l]) => (
            <button key={k} className={`btn btn-xs ${state === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setState(k)}>
              {l}{data.counts[k] ? ` (${data.counts[k]})` : ''}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={runResearch}>{busy ? 'Working…' : 'Find prospects (AI)'}</button>
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={scoreUnscored}>Score unscored</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowImport(v => !v)}>Import CSV</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowAdd(v => !v)}>Add manually</button>
        </div>
      </div>

      {showImport && (
        <div className="card" style={{ padding: 12 }}>
          <p className="body-sm text-muted">One per line: <code>company, contact name, email, role, website</code>. A header row is skipped.</p>
          <textarea className="input" rows={5} value={importText} onChange={e => setImportText(e.target.value)} placeholder="Acme Studio, Jane Doe, jane@acme.com, Director, https://acme.com" />
          <div className="row mt-2" style={{ gap: 6 }}><button className="btn btn-sm btn-primary" onClick={doImport}>Import</button><button className="btn btn-sm btn-ghost" onClick={() => setShowImport(false)}>Cancel</button></div>
        </div>
      )}
      {showAdd && (
        <div className="card" style={{ padding: 12 }}>
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8 }}>
            {['company', 'contact_name', 'email', 'role', 'website', 'one_fact'].map(f => (
              <input key={f} className="input" placeholder={f.replace('_', ' ')} value={addForm[f]} onChange={e => setAddForm(s => ({ ...s, [f]: e.target.value }))} />
            ))}
          </div>
          <div className="row mt-2" style={{ gap: 6 }}><button className="btn btn-sm btn-primary" onClick={doAdd}>Add</button><button className="btn btn-sm btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button></div>
        </div>
      )}

      {loading ? <div className="text-subtle">Loading…</div>
        : !data.prospects.length ? <div className="empty"><div className="h3">No {state} prospects</div></div>
          : data.prospects.map(p => (
            <div key={p.id} className="card" style={{ padding: 12, border: '1px solid var(--border,#eee)', borderRadius: 8 }}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>{p.company || '—'}</strong>
                  {p.contact_name ? <span className="text-muted"> · {p.contact_name}{p.role ? ` (${p.role})` : ''}</span> : null}
                  <div className="body-sm text-muted">{p.email || 'no email'}{p.website ? ` · ${p.website}` : ''} · {p.source}{p.source_url ? <> · <a href={p.source_url} target="_blank" rel="noreferrer">source ↗</a></> : null}</div>
                  {p.fit_reasoning ? <div className="body-sm text-muted mt-1"><em>Why:</em> {p.fit_reasoning}</div> : null}
                  {p.one_fact ? <div className="body-sm mt-1"><em>Hook:</em> {p.one_fact}</div> : null}
                  {p.dismiss_reason ? <div className="body-sm text-muted mt-1"><em>Dismissed:</em> {p.dismiss_reason}</div> : null}
                </div>
                <FitBadge verdict={p.fit_verdict} score={p.fit_score} />
              </div>
              {state === 'new' && (
                <div className="row mt-2" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-xs btn-primary" onClick={() => approve(p)} disabled={!p.email} title={p.email ? '' : 'Add an email first'}>Approve → draft</button>
                  <button className="btn btn-xs btn-ghost" onClick={() => dismiss(p)}>Dismiss</button>
                  <button className="btn btn-xs btn-ghost" onClick={() => rescore(p)}>Re-score</button>
                </div>
              )}
            </div>
          ))}
    </div>
  );
}

// ── Setup ────────────────────────────────────────────────────────────────────

function SetupView({ campaign, clientId, onChange }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: campaign.name, status: campaign.status, icp: campaign.icp || '', disqualifiers: campaign.disqualifiers || '',
    booking_url: campaign.booking_url || '', daily_cap: campaign.daily_cap || 20, sender_identity_id: campaign.sender_identity_id || '',
    sequence: JSON.stringify(campaign.sequence || [], null, 2),
  });
  const [identities, setIdentities] = useState([]);
  const [showIdentity, setShowIdentity] = useState(false);
  const [idForm, setIdForm] = useState({ from_name: '', from_email: '', postal_address: '', auth_ok: false });

  const loadIdentities = useCallback(async () => {
    try { setIdentities(await api.get(`/prospecting/identities?client_id=${clientId}`)); } catch (e) { toast(e.message, 'error'); }
  }, [clientId, toast]);
  useEffect(() => { loadIdentities(); }, [loadIdentities]);

  async function save() {
    let sequence;
    try { sequence = JSON.parse(form.sequence); if (!Array.isArray(sequence)) throw new Error(); }
    catch { return toast('Sequence must be a valid JSON array.', 'error'); }
    try {
      await api.put(`/prospecting/campaigns/${campaign.id}`, {
        name: form.name, status: form.status, icp: form.icp, disqualifiers: form.disqualifiers,
        booking_url: form.booking_url, daily_cap: parseInt(form.daily_cap) || 20,
        sender_identity_id: form.sender_identity_id || null, sequence,
      });
      toast('Saved.', 'success'); onChange && onChange();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function createIdentity() {
    if (!idForm.from_name || !idForm.from_email) return toast('Name and email are required.', 'error');
    try {
      const created = await api.post('/prospecting/identities', { client_id: clientId, ...idForm });
      toast('Identity added.', 'success');
      setShowIdentity(false); setIdForm({ from_name: '', from_email: '', postal_address: '', auth_ok: false });
      await loadIdentities();
      setForm(f => ({ ...f, sender_identity_id: created.id }));
    } catch (e) { toast(e.message, 'error'); }
  }
  async function toggleAuth(idn) {
    try { await api.put(`/prospecting/identities/${idn.id}`, { auth_ok: !idn.auth_ok }); loadIdentities(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const F = (label, node, hint) => (
    <label className="stack" style={{ gap: 4 }}>
      <span className="body-sm" style={{ fontWeight: 600 }}>{label}</span>
      {node}
      {hint ? <span className="body-sm text-muted">{hint}</span> : null}
    </label>
  );

  return (
    <div className="stack stack-lg" style={{ maxWidth: 720 }}>
      {F('Campaign name', <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />)}
      {F('Status', (
        <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
          <option value="draft">Draft (nothing sends)</option>
          <option value="active">Active (approved messages dispatch)</option>
          <option value="paused">Paused</option>
        </select>
      ), 'Only an active campaign dispatches approved messages and gets weekly auto-sourcing.')}
      {F('Ideal customer (ICP)', <textarea className="input" rows={3} value={form.icp} onChange={e => setForm(f => ({ ...f, icp: e.target.value }))} placeholder="e.g. UK architecture & design practices, 5–50 staff, that publish their own projects…" />, 'Used to source and fit-score prospects.')}
      {F('Hard disqualifiers', <textarea className="input" rows={2} value={form.disqualifiers} onChange={e => setForm(f => ({ ...f, disqualifiers: e.target.value }))} placeholder="e.g. is itself a PR, marketing or comms agency; is an existing October client" />, 'Anything matching these is auto-disqualified — the guardrail against pitching the wrong people.')}
      {F('Booking link', <input className="input" value={form.booking_url} onChange={e => setForm(f => ({ ...f, booking_url: e.target.value }))} placeholder="https://cal.com/you/intro" />, 'Your real Cal.com / Calendly link. Only offered when a call is warranted.')}
      {F('Daily send cap', <input className="input" type="number" min="1" value={form.daily_cap} onChange={e => setForm(f => ({ ...f, daily_cap: e.target.value }))} />, 'Max sends per day for this campaign — keeps sending human-paced.')}

      <div className="stack" style={{ gap: 6 }}>
        <span className="body-sm" style={{ fontWeight: 600 }}>Sending identity</span>
        <select className="input" value={form.sender_identity_id} onChange={e => setForm(f => ({ ...f, sender_identity_id: e.target.value }))}>
          <option value="">— none selected —</option>
          {identities.map(i => <option key={i.id} value={i.id}>{i.from_name} &lt;{i.from_email}&gt; {i.auth_ok ? '✓ authenticated' : '⚠ not authenticated'}</option>)}
        </select>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {identities.map(i => (
            <span key={i.id} className="body-sm" style={{ padding: '3px 8px', border: '1px solid var(--border,#eee)', borderRadius: 6 }}>
              {i.from_email} · <button className="btn btn-xs btn-ghost" onClick={() => toggleAuth(i)} style={{ color: i.auth_ok ? '#1a7f37' : '#c62828' }}>
                {i.auth_ok ? 'authenticated ✓' : 'mark authenticated'}
              </button>
            </span>
          ))}
          <button className="btn btn-xs btn-ghost" onClick={() => setShowIdentity(v => !v)}>+ Add identity</button>
        </div>
        <p className="body-sm text-muted">
          A campaign can only send from an <strong>authenticated</strong> identity (SPF, DKIM and DMARC verified on a
          dedicated sending domain — never the client's primary domain). Mark it authenticated once DNS is green.
        </p>
        {showIdentity && (
          <div className="card" style={{ padding: 12 }}>
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" placeholder="From name (a real person)" value={idForm.from_name} onChange={e => setIdForm(s => ({ ...s, from_name: e.target.value }))} />
              <input className="input" placeholder="From email (on a dedicated domain)" value={idForm.from_email} onChange={e => setIdForm(s => ({ ...s, from_email: e.target.value }))} />
              <input className="input" placeholder="Postal address (required in every email)" value={idForm.postal_address} onChange={e => setIdForm(s => ({ ...s, postal_address: e.target.value }))} />
              <label className="row body-sm" style={{ gap: 6 }}>
                <input type="checkbox" checked={idForm.auth_ok} onChange={e => setIdForm(s => ({ ...s, auth_ok: e.target.checked }))} />
                SPF/DKIM/DMARC verified (required before it can send)
              </label>
              <div className="row" style={{ gap: 6 }}><button className="btn btn-sm btn-primary" onClick={createIdentity}>Add</button><button className="btn btn-sm btn-ghost" onClick={() => setShowIdentity(false)}>Cancel</button></div>
            </div>
          </div>
        )}
      </div>

      {F('Sequence (JSON)', <textarea className="input" rows={7} value={form.sequence} onChange={e => setForm(f => ({ ...f, sequence: e.target.value }))} style={{ fontFamily: 'monospace', fontSize: 12 }} />, 'Steps: [{ "step":1, "wait_days":0, "angle":"first touch…" }, …]. Each follow-up is drafted into the queue after the prior step sends — it still needs approval.')}

      <div><button className="btn btn-primary" onClick={save}>Save campaign</button></div>
    </div>
  );
}

// ── Suppression ──────────────────────────────────────────────────────────────

function SuppressionView({ clientId }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.get(`/prospecting/suppression?client_id=${clientId}`)); }
    catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  }, [clientId, toast]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!value.trim()) return;
    try { await api.post('/prospecting/suppression', { client_id: clientId, value: value.trim(), reason: 'manual' }); setValue(''); load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(id) {
    try { await api.delete(`/prospecting/suppression/${id}?client_id=${clientId}`); load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="stack" style={{ maxWidth: 620 }}>
      <p className="body-sm text-muted">
        The permanent do-not-contact list — checked at both scoring and send. Opt-outs land here automatically. Add an
        email or a whole domain (e.g. <code>acme.com</code>) to block it everywhere.
      </p>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" placeholder="email or domain" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn btn-sm btn-primary" onClick={add}>Add</button>
      </div>
      {loading ? <div className="text-subtle">Loading…</div>
        : !rows.length ? <div className="body-sm text-muted">Nothing suppressed yet.</div>
          : rows.map(r => (
            <div key={r.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border,#f0f0f0)' }}>
              <span className="body-sm"><strong>{r.value}</strong> <span className="text-muted">· {r.kind} · {r.reason}</span></span>
              <button className="btn btn-xs btn-ghost" onClick={() => remove(r.id)}>Remove</button>
            </div>
          ))}
    </div>
  );
}
