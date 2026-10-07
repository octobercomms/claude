import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';

// Audiences within one press release.
//
// One release, several named audiences (Workplace, Retail, Residential…). Each
// is built from an uploaded list plus tags, locked to snapshot who is in it, and
// given its own subject lines, intro and follow-ups. The release body and hero
// stay shared, because it is one press release.
//
// The dedupe is not a report you remember to run. Membership lives on
// (campaign, contact), so adding a list that overlaps an existing audience
// surfaces the overlap immediately and asks where those people belong. Nobody
// moves on their own, and nobody can end up in two.
//
// Each audience sends on its own Go, with its own test and preview, so a wrong
// intro on one audience cannot take the rest of the release with it.

const LINE = 'var(--border-w) solid var(--card-border)';
const CAP = { fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' };

export default function PressAudiences({ releaseId, clientId, readOnly, steps = [], onSent }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [open, setOpen] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/press/releases/${releaseId}/segments`);
      setSegments(r.segments || []);
      setUnassigned(r.unassigned || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseId]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e?.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const seg = await api.post(`/press/releases/${releaseId}/segments`, { name: newName.trim() });
      setNewName('');
      await load();
      setOpen(seg.id);
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setCreating(false); }
  }

  const totalSendable = segments.reduce((n, s) => n + (s.member_count - s.suppressed_count), 0);

  return (
    <div className="card" style={{ padding: 'var(--s4)', marginTop: 'var(--s4)' }}>
      <div className="row center" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        <div>
          <div className="h3">Audiences</div>
          <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
            One release, several lists, each with its own intro and subject lines. Nobody can be in two.
          </div>
        </div>
        {segments.length > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 'var(--fs-section)', fontWeight: 800, lineHeight: 1 }}>{totalSendable.toLocaleString()}</div>
            <div style={CAP}>across {segments.length} audience{segments.length === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>

      {loading && <div style={{ ...CAP, padding: 'var(--s4) 0' }}>Loading…</div>}

      {!loading && !segments.length && (
        <div style={{ ...CAP, padding: 'var(--s3) 0' }}>
          No audiences yet. Add one per group you want to write a different covering note for, for example
          Workplace, Retail, Residential. Leave this empty to send one pitch to the whole list as before.
        </div>
      )}

      {!loading && segments.map((s) => (
        <Audience
          key={s.id}
          seg={s}
          releaseId={releaseId}
          clientId={clientId}
          readOnly={readOnly}
          steps={steps}
          isOpen={open === s.id}
          onToggle={() => setOpen(open === s.id ? null : s.id)}
          onChanged={load}
          onSent={onSent}
          others={segments.filter((x) => x.id !== s.id)}
        />
      ))}

      {!readOnly && (
        <form onSubmit={create} className="row center" style={{ gap: 'var(--s2)', marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
          <input className="input" style={{ flex: 1 }} value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="New audience name, e.g. Workplace" />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={creating || !newName.trim()}>
            {creating ? 'Adding…' : 'Add audience'}
          </button>
        </form>
      )}

      {unassigned.length > 0 && (
        <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)' }}>
            {unassigned.length.toLocaleString()} on this release, in no audience
          </div>
          <div style={{ ...CAP, marginTop: 'var(--s1)' }}>
            They are still part of the release and receive the shared pitch. File them into an audience to give
            them a tailored one.
          </div>
        </div>
      )}
    </div>
  );
}

function Audience({ seg, releaseId, clientId, readOnly, steps, isOpen, onToggle, onChanged, onSent, others }) {
  const toast = useToast();
  const [tab, setTab] = useState('who');
  const [busy, setBusy] = useState('');
  const [conflicts, setConflicts] = useState([]);

  const frozen = !!seg.sent_at;
  const locked = !!seg.locked_at;
  const sendable = seg.member_count - seg.suppressed_count;
  const ro = readOnly || frozen;

  async function act(label, fn) {
    setBusy(label);
    try { await fn(); await onChanged(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }

  return (
    <div style={{ border: LINE, borderRadius: 'var(--r-sm)', marginTop: 'var(--s3)', overflow: 'hidden' }}>
      <button onClick={onToggle} className="accordion-trigger" style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3)' }}>
        <div style={{ textAlign: 'left', minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
            {seg.name}
            {frozen && <span style={{ ...CAP, marginLeft: 'var(--s2)' }}>sent {new Date(seg.sent_at).toLocaleDateString('en-GB')}</span>}
            {!frozen && locked && <span style={{ ...CAP, marginLeft: 'var(--s2)' }}>locked</span>}
          </div>
          <div style={CAP}>
            {sendable.toLocaleString()} to send
            {seg.suppressed_count > 0 && ` · ${seg.suppressed_count} suppressed`}
            {seg.intro ? ' · tailored intro written' : ' · using the shared pitch'}
          </div>
        </div>
        <span aria-hidden>{isOpen ? '−' : '+'}</span>
      </button>

      {isOpen && (
        <div style={{ padding: 'var(--s3)', borderTop: LINE }}>
          <div className="row" style={{ gap: 'var(--s2)', marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
            {[['who', 'Who is in it'], ['copy', 'Its emails'], ['send', 'Send this audience']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-secondary'}`}>{label}</button>
            ))}
            <div style={{ flex: 1 }} />
            {!frozen && !readOnly && (
              <>
                <button className="btn btn-link btn-sm" disabled={!!busy}
                  onClick={() => act('lock', () => api.post(`/press/segments/${seg.id}/lock`, { locked: !locked }))}>
                  {locked ? 'unlock' : 'lock membership'}
                </button>
                <button className="btn btn-link btn-sm" disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Delete the audience "${seg.name}"? Its ${seg.member_count} contacts stay on the release, unfiled.`)) return;
                    act('delete', () => api.delete(`/press/segments/${seg.id}`));
                  }}>delete</button>
              </>
            )}
          </div>

          {frozen && (
            <div style={{ ...CAP, marginBottom: 'var(--s3)' }}>
              This audience has been sent, so its list and its emails are fixed. Add a new audience for anyone else.
            </div>
          )}

          {tab === 'who' && (
            <Who seg={seg} clientId={clientId} ro={ro} locked={locked} busy={busy} act={act}
              conflicts={conflicts} setConflicts={setConflicts} others={others} toast={toast} />
          )}
          {tab === 'copy' && <Copy seg={seg} ro={ro} steps={steps} busy={busy} act={act} />}
          {tab === 'send' && <Send seg={seg} ro={ro} toast={toast} onChanged={onChanged} onSent={onSent} />}
        </div>
      )}
    </div>
  );
}

// ── Who is in it ─────────────────────────────────────────────────────────────

function Who({ seg, clientId, ro, locked, busy, act, conflicts, setConflicts, others, toast }) {
  const [tagList, setTagList] = useState([]);
  const [picked, setPicked] = useState(() => new Set(seg.tags || []));
  const [pasteText, setPasteText] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { api.get('/press/tags').then((t) => setTagList(Array.isArray(t) ? t : (t?.tags || []))).catch(() => {}); }, []);

  async function addByTags() {
    const tags = [...picked];
    if (!tags.length) return;
    const a = await api.get(`/press/audience?tags=${encodeURIComponent(tags.join(','))}&client_id=${clientId}`);
    if (!a.ids?.length) { toast('Those tags match nobody.', 'info'); return; }
    const r = await api.post(`/press/segments/${seg.id}/members`, { contact_ids: a.ids });
    await api.patch(`/press/segments/${seg.id}`, { tags });
    report(r);
  }

  function report(r) {
    if (r.conflicts?.length) setConflicts(r.conflicts);
    const bits = [];
    if (r.added) bits.push(`${r.added} added`);
    if (r.already) bits.push(`${r.already} already here`);
    if (r.conflicts?.length) bits.push(`${r.conflicts.length} in another audience`);
    toast(bits.length ? bits.join(', ') + '.' : 'Nothing to add.', r.added ? 'success' : 'info');
  }

  async function loadFile(file) {
    if (!file) return;
    if (/\.(xlsx|xls|numbers|pdf|docx?)$/i.test(file.name)) {
      toast(`${file.name} is not a text file. Export it as CSV first.`, 'error'); return;
    }
    if (file.size > 2 * 1024 * 1024) { toast(`${file.name} is over 2MB. Split it up.`, 'error'); return; }
    try {
      const text = await file.text();
      if (!text.trim()) { toast(`${file.name} is empty.`, 'error'); return; }
      setPasteText(text); setFileName(file.name);
    } catch (e) { toast(`Could not read ${file.name}: ${e.message}`, 'error'); }
  }

  // Import into the library first, then file whoever came back into this
  // audience — so the dedupe runs on the import too.
  async function importAndFile() {
    if (!pasteText.trim()) return;
    setImporting(true);
    try {
      const imp = await api.post(`/press/clients/${clientId}/import-smart`, { text: pasteText });
      const ids = (imp.items || []).map((i) => i.id).filter(Boolean);
      const r = ids.length ? await api.post(`/press/segments/${seg.id}/members`, { contact_ids: ids }) : { added: 0 };
      const how = imp.source === 'csv' ? ' Read straight from the spreadsheet, no AI cost.' : '';
      toast(`Sorted ${imp.added} new and ${imp.updated} existing contacts.${how}`, 'success');
      report(r);
      setPasteText(''); setFileName('');
    } catch (e) { toast(e.message, 'error'); }
    finally { setImporting(false); }
  }

  return (
    <div>
      {conflicts.length > 0 && (
        <div style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 'var(--r-sm)', padding: 'var(--s3)', marginBottom: 'var(--s3)' }}>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
            {conflicts.length} already in another audience
          </div>
          <div style={{ ...CAP, margin: 'var(--s1) 0 var(--s2)' }}>
            Each person gets one pitch for this release, so they can only be in one audience. Move them to
            "{seg.name}" or leave them where they are. This changes which email they receive, not their tags.
          </div>
          <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 'var(--s2)' }}>
            {conflicts.map((c) => (
              <div key={c.contact_id} style={{ ...CAP, padding: '2px 0' }}>
                {c.name || c.email} <span style={{ opacity: 0.7 }}>· currently in {c.current_segment_name}</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={ro || !!busy}
              onClick={() => act('resolve', async () => {
                await api.post(`/press/segments/${seg.id}/resolve`, {
                  contact_ids: conflicts.map((c) => c.contact_id), action: 'move',
                });
                setConflicts([]);
              })}>Move all {conflicts.length} to {seg.name}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConflicts([])}>
              Leave them where they are
            </button>
          </div>
        </div>
      )}

      {locked && (
        <div style={{ ...CAP, marginBottom: 'var(--s3)' }}>
          Membership is locked, so retagging a journalist will not move them in or out. Unlock above to change it.
        </div>
      )}

      {!ro && !locked && (
        <>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--s2)' }}>
            Add by tag
          </div>
          <div className="row wrap" style={{ gap: 'var(--s1)', marginBottom: 'var(--s2)' }}>
            {(tagList || []).slice(0, 60).map((t) => {
              const name = typeof t === 'string' ? t : t.tag;
              const on = picked.has(name);
              return (
                <button key={name} className={`chip ${on ? 'chip-on' : ''}`}
                  style={{ cursor: 'pointer', fontWeight: on ? 700 : 400 }}
                  onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; })}>
                  {name}{typeof t !== 'string' && t.count ? ` ${t.count}` : ''}
                </button>
              );
            })}
          </div>
          <button className="btn btn-secondary btn-sm" disabled={!picked.size || !!busy}
            onClick={() => act('tags', addByTags)}>
            {busy === 'tags' ? 'Adding…' : `Add everyone with ${picked.size || 0} tag${picked.size === 1 ? '' : 's'}`}
          </button>

          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', margin: 'var(--s4) 0 var(--s2)' }}>
            Or upload a list
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer?.files?.[0]); }}
            style={{
              padding: 'var(--s2)', borderRadius: 'var(--r-sm)',
              border: `var(--border-w) dashed ${dragOver ? 'var(--accent)' : 'var(--card-border)'}`,
              background: dragOver ? 'var(--accent-soft)' : 'transparent',
            }}>
            <textarea className="input" rows={3} value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setFileName(''); }}
              placeholder="Drop a CSV here, or paste a list. A CSV with an email column is read directly; anything messier goes through Claude."
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 'var(--fs-caption)' }} />
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" style={{ display: 'none' }}
              onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="row center" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" disabled={importing || !pasteText.trim()}
                onClick={importAndFile}>{importing ? 'Sorting…' : `Sort & add to ${seg.name}`}</button>
              <button className="btn btn-link btn-sm" onClick={() => fileRef.current?.click()}>choose a file…</button>
              {fileName && <span style={CAP}>{fileName} · {pasteText.split(/\r?\n/).filter((l) => l.trim()).length.toLocaleString()} lines</span>}
            </div>
          </div>
        </>
      )}

      {others.length > 0 && (
        <div style={{ ...CAP, marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE }}>
          Other audiences on this release: {others.map((o) => `${o.name} (${o.member_count})`).join(', ')}.
        </div>
      )}
    </div>
  );
}

// ── Its emails ───────────────────────────────────────────────────────────────

function Copy({ seg, ro, steps, busy, act }) {
  const [intro, setIntro] = useState(seg.intro || '');
  const [subjects, setSubjects] = useState(() => ({ ...(seg.subjects || {}) }));
  const [followups, setFollowups] = useState(() => (Array.isArray(seg.followups) ? seg.followups : []));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setIntro(seg.intro || '');
    setSubjects({ ...(seg.subjects || {}) });
    setFollowups(Array.isArray(seg.followups) ? seg.followups : []);
    setDirty(false);
  }, [seg.id, seg.updated_at]);

  const stepList = steps.length ? steps : [{ step_number: 1 }];
  const touch = (fn) => { fn(); setDirty(true); };

  return (
    <div>
      <div style={{ ...CAP, marginBottom: 'var(--s3)' }}>
        This audience's covering note and subject lines. The press release itself, and its hero image, are shared
        across every audience. Leave these empty and this audience sends the release's shared pitch instead.
      </div>

      {!ro && (
        <button className="btn btn-secondary btn-sm" disabled={!!busy} style={{ marginBottom: 'var(--s3)' }}
          onClick={() => {
            if (intro.trim() && !window.confirm(`Replace "${seg.name}"'s intro and follow-ups with a new AI draft written for this audience?`)) return;
            act('draft', () => api.post(`/press/segments/${seg.id}/shared-pitch`, { with_followups: true }));
          }}>
          {busy === 'draft' ? '✨ Writing…' : `✨ Draft for ${seg.name} with AI`}
        </button>
      )}
      <div style={{ ...CAP, marginBottom: 'var(--s3)' }}>
        One draft for the whole audience, so it costs about 3 cents however many journalists are in it.
      </div>

      <label style={{ display: 'block', marginBottom: 'var(--s3)' }}>
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)' }}>Intro, first email</span>
        <textarea className="input" rows={6} value={intro} disabled={ro}
          onChange={(e) => touch(() => setIntro(e.target.value))}
          placeholder="Why this story matters to this particular patch. {{first_name}} works here."
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 'var(--s1)' }} />
      </label>

      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--s2)' }}>
        Subject lines for this audience
      </div>
      {stepList.map((st) => (
        <label key={st.step_number} style={{ display: 'block', marginBottom: 'var(--s2)' }}>
          <span style={CAP}>{st.step_number === 1 ? 'First email' : `Follow-up ${st.step_number - 1}`}</span>
          <input className="input" disabled={ro} value={subjects[String(st.step_number)] || ''}
            onChange={(e) => touch(() => setSubjects((p) => ({ ...p, [String(st.step_number)]: e.target.value })))}
            placeholder={st.subject ? `Shared: ${st.subject}` : 'Leave empty to use the shared subject'}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 2 }} />
        </label>
      ))}

      {followups.length > 0 && (
        <>
          <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', margin: 'var(--s3) 0 var(--s2)' }}>
            Follow-up bodies for this audience
          </div>
          {followups.map((f, i) => (
            <label key={i} style={{ display: 'block', marginBottom: 'var(--s2)' }}>
              <span style={CAP}>Follow-up {i + 1}</span>
              <textarea className="input" rows={4} disabled={ro} value={f.body || ''}
                onChange={(e) => touch(() => setFollowups((p) => p.map((x, j) => (j === i ? { ...x, body: e.target.value } : x))))}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 2 }} />
            </label>
          ))}
        </>
      )}

      {!ro && (
        <button className="btn btn-primary btn-sm" disabled={!dirty || !!busy}
          onClick={() => act('save', async () => {
            // Blank subject overrides are stored as absent, so a cleared field
            // falls back to the shared sequence row rather than sending empty.
            const clean = {};
            for (const [k, v] of Object.entries(subjects)) if (String(v || '').trim()) clean[k] = String(v).trim();
            await api.patch(`/press/segments/${seg.id}`, { intro, subjects: clean, followups });
          })}>
          {busy === 'save' ? 'Saving…' : 'Save this audience’s emails'}
        </button>
      )}
    </div>
  );
}

// ── Send this audience ───────────────────────────────────────────────────────

function Send({ seg, ro, toast, onChanged, onSent }) {
  const [plan, setPlan] = useState(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try { setPlan(await api.post(`/press/segments/${seg.id}/send-plan`, {})); }
    catch (e) { toast(e.message, 'error'); }
    finally { setChecking(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg.id]);

  useEffect(() => { refresh(); }, [refresh]);

  if (seg.sent_at) {
    return <div style={CAP}>Sent on {new Date(seg.sent_at).toLocaleString('en-GB')}. Results are on the Results &amp; interest tab.</div>;
  }

  const checks = [
    { ok: (plan?.total || 0) > 0, hard: true, label: 'Someone to send to', detail: `${(plan?.total || 0).toLocaleString()} after suppression and exclusions` },
    { ok: !!seg.locked_at, hard: false, label: 'Membership locked', detail: seg.locked_at ? 'this list is a snapshot' : 'recommended before you write the copy' },
    { ok: !!plan?.tailored, hard: false, label: 'Tailored intro written', detail: plan?.tailored ? `written for ${seg.name}` : 'optional — it will send the release’s shared pitch' },
  ];

  return (
    <div>
      <div style={{ ...CAP, marginBottom: 'var(--s3)' }}>
        Each audience goes out on its own, so you can send this one now and hold the rest.
      </div>
      {checks.map((c, i) => (
        <div key={i} className="row" style={{ gap: 'var(--s2)', padding: 'var(--s2) 0', borderTop: i ? LINE : 'none', alignItems: 'flex-start' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20,
            borderRadius: 'var(--r-md)', flexShrink: 0, fontWeight: 700, fontSize: 'var(--fs-caption)',
            background: c.ok ? 'var(--success, #1a9d5a)' : (c.hard ? 'var(--danger, #c0392b)' : 'var(--card-border)'),
            color: c.ok || c.hard ? '#fff' : 'var(--text-subtle)',
          }}>{c.ok ? '✓' : (c.hard ? '!' : '○')}</span>
          <div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{c.label}</div>
            <div style={CAP}>{c.detail}</div>
          </div>
        </div>
      ))}

      {plan && plan.already > 0 && (
        <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
          {plan.already.toLocaleString()} of them have already had an email on this release, so only{' '}
          {plan.new.toLocaleString()} will be queued.
        </div>
      )}
      {plan && plan.est_cost_usd > 0 && (
        <div style={{ ...CAP, marginTop: 'var(--s2)' }}>
          No tailored intro, so each recipient gets an individually written pitch: about ${plan.est_cost_usd.toFixed(2)}.
          Drafting one intro for the audience instead costs about $0.03.
        </div>
      )}

      <div className="row center" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: LINE, flexWrap: 'wrap' }}>
        <button className="btn btn-link btn-sm" onClick={refresh} disabled={checking}>{checking ? 'checking…' : 'recheck'}</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={ro || sending || !(plan?.total > 0)}
          {...roWrite(ro, {
            onClick: async () => {
              if (!window.confirm(`Send "${seg.name}" to ${plan.new.toLocaleString()} journalist${plan.new === 1 ? '' : 's'}? Follow-ups queue on your timings and stop automatically if they reply.`)) return;
              setSending(true);
              try {
                const r = await api.post(`/press/segments/${seg.id}/send`, {});
                toast(`${seg.name}: ${r.queued} email${r.queued === 1 ? '' : 's'} queued for ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}.`, 'success');
                await onChanged(); onSent?.();
              } catch (e) { toast(e.message, 'error'); }
              finally { setSending(false); }
            },
          })}>
          {sending ? 'Queueing…' : `Send ${seg.name} to ${(plan?.new ?? 0).toLocaleString()}`}
        </button>
      </div>
    </div>
  );
}
