import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';
import PressCampaignAnalytics from './PressCampaignAnalytics';

// Detail view for one press_release campaign. Structured who → what → preview:
//  1. Who — build the audience from tags (scales to thousands), + individual adds.
//  2. What — the four subjects, timings, embed toggle, test send.
//  Right panel — preview and edit ANY recipient's personalised email.

function AttrStat({ value, label, big }) {
  return (
    <div>
      <div style={{ fontSize: big ? 26 : 20, fontWeight: 700, lineHeight: 1, color: big ? 'var(--accent)' : 'var(--text)' }}>
        {value == null ? '—' : value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

export default function PressCampaignDetail({ clientId, campaignId, onExit, autoBuild = false }) {
  const toast = useToast();
  const { readOnly, user } = useAuth();
  const [release, setRelease] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState('setup'); // setup | results

  // Audience — built from tags (each tag = a segment of the media DB).
  const [pressTags, setPressTags] = useState([]);          // [{ tag, count }]
  const [selTags, setSelTags] = useState(() => new Set());
  const [audience, setAudience] = useState({ total: 0, ids: [], sample: [] });
  const [resolving, setResolving] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState(null);
  const [autopiloting, setAutopiloting] = useState(false);
  const [extras, setExtras] = useState(() => new Map()); // id -> contact (individual adds)
  const [tagSearch, setTagSearch] = useState('');

  // Individual add: search + paste-and-sort import.
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalResults, setGlobalResults] = useState(null);
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);

  // Emails.
  const [steps, setSteps] = useState([]);
  const [savingSteps, setSavingSteps] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [testStep, setTestStep] = useState(1);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);

  // Preview / edit one recipient's email.
  const [previewing, setPreviewing] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [editIntro, setEditIntro] = useState(null);
  const [editFollowUps, setEditFollowUps] = useState(null);
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    setLoadError(null); setAttribution(null);
    api.get(`/press/campaigns/${campaignId}/release`)
      .then(rel => {
        setRelease(rel);
        setSteps(Array.isArray(rel.steps) ? rel.steps : []);
        api.get(`/press/releases/${rel.id}/backlink-attribution`).then(setAttribution).catch(() => setAttribution(null));
      })
      .catch(e => setLoadError(e.message));
  }, [campaignId]);

  useEffect(() => { api.get('/press/tags').then(setPressTags).catch(() => setPressTags([])); }, []);

  // Resolve selected tags → recipients whenever the tag selection changes.
  useEffect(() => {
    const tags = Array.from(selTags);
    if (!tags.length) { setAudience({ total: 0, ids: [], sample: [] }); return; }
    let cancelled = false;
    setResolving(true);
    api.get(`/press/audience?tags=${encodeURIComponent(tags.join(','))}`)
      .then(a => { if (!cancelled) setAudience(a || { total: 0, ids: [], sample: [] }); })
      .catch(() => { if (!cancelled) setAudience({ total: 0, ids: [], sample: [] }); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [selTags]);

  function toggleTag(tag) {
    setSelTags(prev => { const n = new Set(prev); if (n.has(tag)) n.delete(tag); else n.add(tag); return n; });
  }
  function addExtra(c) { setExtras(prev => { const n = new Map(prev); n.set(c.id, c); return n; }); }
  function removeExtra(id) { setExtras(prev => { const n = new Map(prev); n.delete(id); return n; }); }

  // Combined, de-duped recipient ids (tags ∪ individual adds).
  const combinedIds = React.useMemo(() => {
    const s = new Set(audience.ids);
    for (const id of extras.keys()) s.add(id);
    return s;
  }, [audience, extras]);
  const totalRecipients = combinedIds.size;

  // The list you can preview/edit from (sample of the audience + every extra).
  const previewList = React.useMemo(() => {
    const seen = new Set(); const out = [];
    for (const c of [...extras.values(), ...(audience.sample || [])]) {
      if (c && c.id && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out.slice(0, 300);
  }, [audience, extras]);

  // Autopilot — suggest the audience TAGS for this story and select them.
  async function runAutopilot() {
    if (!release) return;
    setAutopiloting(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/autopilot`, {});
      const tags = r.suggested_tags || [];
      setSuggestedTags(tags);
      setSelTags(new Set(tags));
      toast(tags.length ? `Suggested ${tags.length} audience segment${tags.length === 1 ? '' : 's'} for this story.` : 'No clear audience segments found — pick tags below.', tags.length ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setAutopiloting(false); }
  }
  const autoBuiltRef = useRef(false);
  useEffect(() => {
    if (autoBuild && release && !autoBuiltRef.current) { autoBuiltRef.current = true; runAutopilot(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuild, release]);

  async function searchGlobal() {
    if (!globalQuery.trim()) return;
    setSearchingGlobal(true);
    try { setGlobalResults((await api.get(`/press/journalists?search=${encodeURIComponent(globalQuery.trim())}`)).items || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setSearchingGlobal(false); }
  }
  async function doPasteImport() {
    if (!pasteText.trim() || !release) return;
    setPasting(true);
    try {
      const r = await api.post(`/press/clients/${clientId}/import-smart`, { text: pasteText, campaign_id: release.campaign_id });
      toast(`Sorted: ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}.`, 'success');
      (r.items || []).forEach(it => it.id && addExtra({ id: it.id, name: it.name, email: it.email }));
      setPasteText(''); setShowPaste(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setPasting(false); }
  }

  async function preview(contactId, force = false) {
    if (!release) return;
    setPreviewing(contactId); setPreviewData(null); setEditIntro(null); setEditFollowUps(null);
    try {
      const p = await api.post(`/press/releases/${release.id}/preview`, { contact_id: contactId, force });
      setPreviewData(p); setEditIntro(p.pitch || '');
      setEditFollowUps(Array.isArray(p.follow_ups) ? p.follow_ups.map(f => ({ ...f })) : []);
    } catch (e) { toast(`Preview failed: ${e.message}`, 'error'); setPreviewing(null); }
  }
  // Step through the preview list (preview all).
  function stepPreview(dir) {
    if (!previewList.length) return;
    const i = previewList.findIndex(c => c.id === previewing);
    const next = previewList[(i + dir + previewList.length) % previewList.length];
    if (next) preview(next.id);
  }

  async function saveSteps() {
    if (!release) return;
    setSavingSteps(true);
    try {
      await api.patch(`/press/releases/${release.id}`, { steps: steps.map(s => ({ step_number: s.step_number, subject: s.subject, delay_days: s.delay_days })) });
      toast('Sequence saved.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingSteps(false); }
  }
  function setStepField(stepNumber, field, value) {
    setSteps(prev => prev.map(s => s.step_number === stepNumber ? { ...s, [field]: value } : s));
  }
  async function suggestSubjects() {
    if (!release) return;
    setSuggesting(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/subjects`, {});
      if (Array.isArray(r.steps) && r.steps.length) setSteps(r.steps);
      toast('Fresh subject lines drafted from the release — edit or save.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSuggesting(false); }
  }
  async function sendTest() {
    if (!release || !testEmail.trim()) return;
    setTesting(true);
    try {
      const body = { email: testEmail.trim(), step_number: testStep };
      if (previewing) body.contact_id = previewing;
      const r = await api.post(`/press/releases/${release.id}/test`, body);
      toast(`Test sent to ${r.sent_to}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setTesting(false); }
  }
  async function saveRecipientEmail() {
    if (!release || !previewing) return;
    setSavingEmail(true);
    try {
      await api.put(`/press/releases/${release.id}/emails/${previewing}`, { intro: editIntro, follow_ups: editFollowUps });
      toast('Saved this journalist’s email.', 'success');
      preview(previewing, false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingEmail(false); }
  }
  async function send() {
    if (!totalRecipients || !release) return;
    const fuCount = Math.max(0, steps.length - 1);
    if (!confirm(`Send to ${totalRecipients} journalist${totalRecipients === 1 ? '' : 's'}? ${fuCount} follow-up${fuCount === 1 ? '' : 's'} will queue on your timings and stop automatically if they reply.`)) return;
    setSending(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/send`, { contact_ids: Array.from(combinedIds) });
      toast(`Queued ${r.queued} emails.`, 'success');
    } catch (e) { toast(`Send failed: ${e.message}`, 'error'); }
    finally { setSending(false); }
  }

  if (loadError) {
    return (
      <div>
        <button onClick={onExit} className="btn btn-secondary btn-sm">← Back to campaigns</button>
        <div style={{ padding: 20, background: 'var(--warning-soft)', border: '1px solid #f0d260', borderRadius: 'var(--r-sm)', color: 'var(--warning)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>This campaign isn't linked to a press release</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>It's tagged as a press campaign but has no parsed release attached. Delete it and start a new one via <strong>+ New press campaign</strong>.</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>Server said: {loadError}</div>
        </div>
      </div>
    );
  }
  if (!release) return <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading release…</div>;

  const visibleTags = pressTags.filter(t => !tagSearch || t.tag.toLowerCase().includes(tagSearch.toLowerCase()));
  const TagChip = ({ tag, count, on }) => (
    <button type="button" onClick={() => toggleTag(tag)}
      style={{ padding: '4px 10px', borderRadius: 14, fontSize: 12, cursor: 'pointer', margin: '0 6px 6px 0',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--card-border)'}`, background: on ? 'var(--accent)' : 'var(--surface)',
        color: on ? '#111' : 'var(--text)', fontWeight: on ? 700 : 400 }}>
      {on ? '✓ ' : ''}{tag}{count != null ? <span style={{ opacity: 0.6 }}> · {count}</span> : ''}
    </button>
  );

  return (
    <div>
      <button onClick={onExit} className="btn btn-secondary btn-sm">← Back to campaigns</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>press release</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{release.title}</h2>
          {release.dateline && <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{release.dateline}</div>}
          {release.source_url && <a href={release.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'inline-block', marginTop: 6 }}>↗ source page</a>}
        </div>
      </div>

      {attribution?.launched && (
        <div style={{ marginTop: 16, padding: 14, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>Backlink attribution · {attribution.window_days} days after launch</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <AttrStat value={attribution.new_rds} label="new referring domains" big />
            <AttrStat value={attribution.dofollow_rds} label="dofollow" />
            <AttrStat value={attribution.pitched_rds} label="from outlets you pitched" />
            <AttrStat value={attribution.recipients} label="journalists emailed" />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 16, borderBottom: 'var(--border-w) solid var(--card-border)', paddingBottom: 8 }}>
        <button className={`btn btn-sm ${view === 'setup' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('setup')}>Set up &amp; send</button>
        <button className={`btn btn-sm ${view === 'results' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('results')}>Results &amp; interest</button>
      </div>

      {view === 'results' && <PressCampaignAnalytics clientId={clientId} release={release} />}

      {view === 'setup' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(300px, 400px)', gap: 18, marginTop: 18, alignItems: 'start' }}>
        {/* ── MAIN: who → what ─────────────────────────────────────────── */}
        <div className="stack" style={{ display: 'grid', gap: 16 }}>

          {/* 1 · WHO */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="h3">1 · Who — the audience</div>
                <p style={{ color: 'var(--text-subtle)', fontSize: 12, margin: '2px 0 0' }}>Click tags to add whole segments of your media database. Reaches as many journalists as the tags cover.</p>
              </div>
              <button {...roWrite(readOnly, { onClick: runAutopilot, disabled: autopiloting })} className="btn btn-primary btn-sm">
                {autopiloting ? '✨ Choosing…' : '✨ Suggest audience'}
              </button>
            </div>

            {suggestedTags && suggestedTags.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>✨ Suggested for this story</div>
                <div>{suggestedTags.map(t => <TagChip key={t} tag={t} count={pressTags.find(x => x.tag === t)?.count} on={selTags.has(t)} />)}</div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <input value={tagSearch} onChange={e => setTagSearch(e.target.value)} placeholder="filter tags…" className="input" style={{ marginBottom: 8, maxWidth: 260 }} />
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {!visibleTags.length && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No tags found. Tag your media contacts, or add journalists individually below.</div>}
                {visibleTags.map(t => <TagChip key={t.tag} tag={t.tag} count={t.count} on={selTags.has(t.tag)} />)}
              </div>
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--accent)' }}>{resolving ? '…' : totalRecipients.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>recipients{selTags.size ? ` · ${selTags.size} tag${selTags.size === 1 ? '' : 's'}` : ''}{extras.size ? ` · ${extras.size} added by hand` : ''}</div>
            </div>

            {/* Individual adds */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Add specific journalists</div>
                <button className="btn btn-link btn-sm" onClick={() => setShowPaste(v => !v)}>{showPaste ? 'close paste' : '📋 paste a list'}</button>
              </div>
              {showPaste && (
                <div style={{ marginBottom: 8 }}>
                  <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={3} className="input"
                    placeholder="Paste anything — a spreadsheet, signatures, 'Jane Doe, arts editor, The Times, jane@…'. Claude sorts + de-dupes into your DB and adds them here." style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }} />
                  <button {...roWrite(readOnly, { onClick: doPasteImport, disabled: pasting || !pasteText.trim() })} className="btn btn-primary btn-sm" style={{ marginTop: 6 }}>{pasting ? 'Sorting…' : 'Sort & add'}</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={globalQuery} onChange={e => setGlobalQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchGlobal()} placeholder="search all journalists…" className="input" style={{ flex: 1 }} />
                <button className="btn btn-secondary btn-sm" onClick={searchGlobal} disabled={searchingGlobal}>{searchingGlobal ? '…' : 'Search'}</button>
              </div>
              {globalResults && (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginTop: 8 }}>
                  {!globalResults.length && <div style={{ padding: 10, color: 'var(--text-subtle)', fontSize: 12 }}>No journalists found.</div>}
                  {globalResults.map(c => (
                    <div key={c.id} className="row center" style={{ gap: 8, padding: '6px 10px', borderTop: 'var(--border-w) solid var(--accent-soft)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name || '(no name)'}{c.company && <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}> · {c.company}</span>}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.email}</div>
                      </div>
                      {extras.has(c.id)
                        ? <button className="btn btn-secondary btn-sm" onClick={() => removeExtra(c.id)}>added ✓</button>
                        : <button className="btn btn-secondary btn-sm" onClick={() => addExtra(c)}>add</button>}
                    </div>
                  ))}
                </div>
              )}
              {extras.size > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[...extras.values()].slice(0, 20).map(c => (
                    <span key={c.id} className="chip" style={{ cursor: 'pointer' }} onClick={() => removeExtra(c.id)} title="click to remove">{c.name || c.email} ✕</span>
                  ))}
                  {extras.size > 20 && <span style={{ fontSize: 11, color: 'var(--text-subtle)', alignSelf: 'center' }}>+{extras.size - 20} more</span>}
                </div>
              )}
            </div>
          </div>

          {/* 2 · WHAT */}
          <div className="card" style={{ padding: 16 }}>
            <div className="h3">2 · What — the emails</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '2px 0 10px' }}>
              Four subjects try different angles: if they’ve opened, the follow-up sends; if not, we resend the pitch with a fresh subject. Replies stop the chase.
            </div>
            <button {...roWrite(readOnly, { onClick: suggestSubjects, disabled: suggesting })} className="btn btn-secondary btn-sm" style={{ marginBottom: 10 }}>
              {suggesting ? '✨ Reading the release…' : '✨ Suggest subject lines'}
            </button>
            {steps.map(s => (
              <div key={s.step_number} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 60 }}>{s.step_number === 1 ? 'Release' : `Follow-up ${s.step_number - 1}`}</span>
                  {s.step_number === 1 ? <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>sends immediately</span> : (
                    <span style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 4 }}>after
                      <input type="number" min="1" value={s.delay_days ?? ''} onChange={e => setStepField(s.step_number, 'delay_days', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                        style={{ width: 46, padding: '2px 5px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} /> days
                    </span>
                  )}
                </div>
                <input value={s.subject ?? ''} onChange={e => setStepField(s.step_number, 'subject', e.target.value)}
                  placeholder="Subject line — {{first_name}} to personalise"
                  style={{ width: '100%', padding: '6px 9px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={release.embed_full_release !== false}
                onChange={async e => { const next = e.target.checked; setRelease(r => ({ ...r, embed_full_release: next })); try { await api.patch(`/press/releases/${release.id}`, { embed_full_release: next }); if (previewing) preview(previewing, true); } catch (err) { toast(err.message, 'error'); } }} />
              <span><strong>Embed the full release in the first email.</strong> <span style={{ color: 'var(--text-subtle)' }}>Off = pitch + link only.</span></span>
            </label>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button {...roWrite(readOnly, { onClick: saveSteps, disabled: savingSteps })} className="btn btn-secondary btn-sm">{savingSteps ? 'Saving…' : 'Save subjects & timing'}</button>
            </div>

            {/* Test send */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Send a test</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@example.com" className="input" style={{ flex: 1, minWidth: 160 }} />
                <select value={testStep} onChange={e => setTestStep(parseInt(e.target.value, 10))} className="input" style={{ width: 130 }}>
                  {steps.map(s => <option key={s.step_number} value={s.step_number}>{s.step_number === 1 ? 'Release' : `Follow-up ${s.step_number - 1}`}</option>)}
                </select>
                <button {...roWrite(readOnly, { onClick: sendTest, disabled: testing || !testEmail.trim() })} className="btn btn-secondary btn-sm">{testing ? 'Sending…' : 'Send test'}</button>
              </div>
            </div>

            {/* Preview & edit any email */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Preview &amp; edit emails →</div>
              {!previewList.length ? <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Add an audience above, then pick a journalist to preview and edit their email.</div> : (
                <div style={{ maxHeight: 240, overflowY: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                  {previewList.map(c => (
                    <button key={c.id} type="button" onClick={() => preview(c.id)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', borderTop: 'var(--border-w) solid var(--accent-soft)', cursor: 'pointer',
                        background: previewing === c.id ? 'var(--accent-soft)' : 'transparent' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name || '(no name)'}</span>
                      {c.company && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}> · {c.company}</span>}
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'block' }}>{c.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Send */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{totalRecipients.toLocaleString()} recipient{totalRecipients === 1 ? '' : 's'}</div>
            <button {...roWrite(readOnly, { onClick: send, disabled: !totalRecipients || sending })} className="btn btn-primary">{sending ? 'Queueing…' : `Send to ${totalRecipients.toLocaleString()}`}</button>
          </div>
        </div>

        {/* ── RIGHT: live preview / edit ───────────────────────────────── */}
        <div style={{ position: 'sticky', top: 12, alignSelf: 'start' }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="h3" style={{ margin: 0 }}>Preview {previewData?.contact ? `· ${previewData.contact.name || previewData.contact.email}` : ''}</div>
              {previewList.length > 1 && previewing && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => stepPreview(-1)}>‹</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => stepPreview(1)}>›</button>
                </div>
              )}
            </div>
            {!previewing && <div style={{ color: 'var(--text-subtle)', fontSize: 12, padding: 14, border: '1px dashed var(--card-border)', borderRadius: 'var(--r-sm)' }}>Pick a journalist under <strong>Preview &amp; edit emails</strong> to see and edit the personalised pitch Claude will send them.</div>}
            {previewing && !previewData && <div style={{ color: 'var(--text-subtle)', padding: 14 }}>Generating pitch + follow-ups…</div>}
            {previewData && (
              <div>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="field-label">Initial email{release.embed_full_release !== false ? ' + embedded release' : ' + link'}</div>
                  <button onClick={() => preview(previewing, true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11 }}>regenerate</button>
                </div>
                <iframe srcDoc={previewData.html} title="Preview" style={{ width: '100%', height: 360, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' }} sandbox="" />
                <div style={{ marginTop: 10 }}>
                  <div className="field-label">Edit this journalist’s pitch</div>
                  <textarea value={editIntro ?? ''} onChange={e => setEditIntro(e.target.value)} rows={4} className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }} />
                </div>
                {Array.isArray(editFollowUps) && editFollowUps.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="field-label">Follow-ups</div>
                    {editFollowUps.map((fu, i) => (
                      <div key={i} style={{ marginTop: 6, padding: 8, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                        <input value={fu.subject ?? ''} onChange={e => setEditFollowUps(prev => prev.map((f, j) => j === i ? { ...f, subject: e.target.value } : f))} placeholder="Subject" className="input" style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, fontWeight: 600, marginBottom: 6 }} />
                        <textarea value={fu.body ?? ''} onChange={e => setEditFollowUps(prev => prev.map((f, j) => j === i ? { ...f, body: e.target.value } : f))} rows={3} className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12 }} />
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 10 }}>
                  <button {...roWrite(readOnly, { onClick: saveRecipientEmail, disabled: savingEmail })} className="btn btn-primary btn-sm">{savingEmail ? 'Saving…' : 'Save this email'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
