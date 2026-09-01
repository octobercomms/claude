import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';
import PressCampaignAnalytics from './PressCampaignAnalytics';
// Detail view for a single press_release campaign. Opened when the AM
// clicks a press-flavoured campaign in the Campaigns tab. Two
// halves: pick journalists on the left (grouped by their beat /
// contact_type), preview the personalised pitch on the right.
// One stat in the attribution strip. `big` bumps the headline metric.
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

export default function PressCampaignDetail({ clientId, campaignId, contacts, onExit }) {
  const toast = useToast();
  const { readOnly, user } = useAuth();
  const [release, setRelease] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState('');
  const [tagFilter, setTagFilter] = useState(new Set());
  const [allTags, setAllTags] = useState([]);
  // Phase 1: editable sequence (all steps' subject + timing), test-send, and
  // per-recipient email editing.
  const [steps, setSteps] = useState([]);
  const [savingSteps, setSavingSteps] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [testStep, setTestStep] = useState(1);
  const [testing, setTesting] = useState(false);
  const [editFollowUps, setEditFollowUps] = useState(null); // local copy while editing
  const [editIntro, setEditIntro] = useState(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [view, setView] = useState('setup'); // setup | results
  // Global targeting: search the whole media library, not just client-linked.
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalResults, setGlobalResults] = useState(null);
  const [searchingGlobal, setSearchingGlobal] = useState(false);
  // Paste-and-sort import.
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  // One-paste autopilot.
  const [suggestions, setSuggestions] = useState(null);
  const [autopiloting, setAutopiloting] = useState(false);

  useEffect(() => {
    setLoadError(null);
    setAttribution(null);
    api.get(`/press/campaigns/${campaignId}/release`)
      .then(rel => {
        setRelease(rel);
        setSteps(Array.isArray(rel.steps) ? rel.steps : []);
        // Backlink attribution (E4) — best-effort; hidden if it errors.
        api.get(`/press/releases/${rel.id}/backlink-attribution`)
          .then(setAttribution)
          .catch(() => setAttribution(null));
      })
      .catch(e => setLoadError(e.message));
  }, [campaignId]);

  useEffect(() => {
    api.get(`/outreach/tags?client_id=${clientId}`).then(setAllTags).catch(() => setAllTags([]));
  }, [clientId]);

  function toggleTagFilter(tag) {
    setTagFilter(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runAutopilot() {
    if (!release) return;
    setAutopiloting(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/autopilot`, {});
      setSuggestions(r.suggestions || []);
      // Pre-select all suggestions so it's a one-click approve to send.
      setSelected(prev => { const n = new Set(prev); (r.suggestions || []).forEach(su => n.add(su.contact_id)); return n; });
      toast(`Autopilot picked ${r.suggestions?.length || 0} journalists from ${r.candidates} in your database.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setAutopiloting(false); }
  }

  async function doPasteImport() {
    if (!pasteText.trim() || !release) return;
    setPasting(true);
    try {
      const r = await api.post(`/press/clients/${clientId}/import-smart`, { text: pasteText, campaign_id: release.campaign_id });
      toast(`Sorted: ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}.`, 'success');
      // Pre-select everything just imported so it's ready to send.
      setSelected(prev => { const n = new Set(prev); (r.items || []).forEach(it => it.id && n.add(it.id)); return n; });
      setPasteText(''); setShowPaste(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setPasting(false); }
  }

  async function searchGlobal() {
    if (!globalQuery.trim()) return;
    setSearchingGlobal(true);
    try {
      const r = await api.get(`/press/journalists?search=${encodeURIComponent(globalQuery.trim())}`);
      setGlobalResults(r.items || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSearchingGlobal(false); }
  }

  async function preview(contactId, force = false) {
    if (!release) return;
    setPreviewing(contactId);
    setPreviewData(null);
    setEditIntro(null);
    setEditFollowUps(null);
    try {
      const p = await api.post(`/press/releases/${release.id}/preview`, { contact_id: contactId, force });
      setPreviewData(p);
      setEditIntro(p.pitch || '');
      setEditFollowUps(Array.isArray(p.follow_ups) ? p.follow_ups.map(f => ({ ...f })) : []);
    } catch (e) {
      toast(`Preview failed: ${e.message}`, 'error');
      setPreviewing(null);
    }
  }

  // Save the AM's edits to a step's subject / timing across the whole sequence.
  async function saveSteps() {
    if (!release) return;
    setSavingSteps(true);
    try {
      await api.patch(`/press/releases/${release.id}`, {
        steps: steps.map(s => ({ step_number: s.step_number, subject: s.subject, delay_days: s.delay_days })),
      });
      toast('Sequence saved.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingSteps(false); }
  }
  function setStepField(stepNumber, field, value) {
    setSteps(prev => prev.map(s => s.step_number === stepNumber ? { ...s, [field]: value } : s));
  }
  const [suggesting, setSuggesting] = useState(false);
  // Read the release and generate 4 distinct, enticing subject lines as bait.
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

  // Send one faithful [TEST] copy to an address (personalised for a real
  // journalist so it shows the true thing).
  async function sendTest() {
    if (!release || !testEmail.trim()) return;
    setTesting(true);
    try {
      const body = { email: testEmail.trim(), step_number: testStep };
      if (previewing) body.contact_id = previewing; // personalise for whoever's previewed
      const r = await api.post(`/press/releases/${release.id}/test`, body);
      toast(`Test sent to ${r.sent_to}.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setTesting(false); }
  }

  // Persist the AM's manual edits to THIS journalist's generated email.
  async function saveRecipientEmail() {
    if (!release || !previewing) return;
    setSavingEmail(true);
    try {
      await api.put(`/press/releases/${release.id}/emails/${previewing}`, {
        intro: editIntro, follow_ups: editFollowUps,
      });
      toast('Saved this journalist’s email.', 'success');
      preview(previewing, false); // re-render the iframe with the saved copy
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingEmail(false); }
  }

  async function send() {
    if (!selected.size || !release) return;
    const fuCount = Math.max(0, steps.length - 1);
    if (!confirm(`Send to ${selected.size} journalist${selected.size === 1 ? '' : 's'}? ${fuCount} follow-up${fuCount === 1 ? '' : 's'} will queue on your set timings, and stop automatically if they reply.`)) return;
    setSending(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/send`, { contact_ids: Array.from(selected) });
      toast(`Queued ${r.queued} emails.`, 'success');
      setSelected(new Set());
    } catch (e) {
      toast(`Send failed: ${e.message}`, 'error');
    } finally {
      setSending(false);
    }
  }

  const filteredContacts = (contacts || []).filter(c => {
    if (tagFilter.size) {
      const cTags = new Set(c.tags || []);
      let hit = false;
      for (const t of tagFilter) if (cTags.has(t)) { hit = true; break; }
      if (!hit) return false;
    }
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (c.name || '').toLowerCase().includes(f)
        || (c.company || '').toLowerCase().includes(f)
        || (c.contact_type || '').toLowerCase().includes(f)
        || (c.tags || []).some(t => t.toLowerCase().includes(f));
  });
  const grouped = {};
  for (const c of filteredContacts) {
    const key = c.contact_type || 'untagged';
    (grouped[key] = grouped[key] || []).push(c);
  }
  const groupKeys = Object.keys(grouped).sort();

  if (loadError) {
    return (
      <div>
        <button onClick={onExit} className="btn btn-secondary btn-sm">← Back to campaigns</button>
        <div style={{ padding: 20, background: 'var(--warning-soft)', border: '1px solid #f0d260', borderRadius: 'var(--r-sm)', color: 'var(--warning)' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>This campaign isn't linked to a press release</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            It's tagged as a press campaign but has no parsed release attached — usually because it was created
            before the press flow existed, or the release was deleted. You can either delete this campaign and start
            a new one via <strong>+ New press release</strong>, or open it via the standard outreach wizard if it's
            still useful as a cold campaign.
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>Server said: {loadError}</div>
        </div>
      </div>
    );
  }
  if (!release) return <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading release…</div>;

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
          <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>
            Backlink attribution · {attribution.window_days} days after launch
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <AttrStat value={attribution.new_rds} label="new referring domains" big />
            <AttrStat value={attribution.dofollow_rds} label="dofollow" />
            <AttrStat value={attribution.pitched_rds} label="from outlets you pitched" />
            <AttrStat value={attribution.recipients} label="journalists emailed" />
            <AttrStat value={attribution.rds_per_recipient == null ? '—' : attribution.rds_per_recipient} label="RDs per recipient" />
          </div>
          {attribution.snapshot_captured_at ? (
            attribution.domains?.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attribution.domains.slice(0, 12).map((d, i) => (
                  <span key={d.domain + i} title={d.pitched ? 'from an outlet you pitched' : ''}
                    style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: d.pitched ? 'var(--accent-soft)' : 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', color: d.pitched ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {d.pitched ? '★ ' : ''}{d.domain}
                  </span>
                ))}
                {attribution.domains.length > 12 && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>+{attribution.domains.length - 12} more</span>}
              </div>
            )
          ) : (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-subtle)' }}>
              No backlink snapshot captured for this client yet — figures fill in after the first 3-day sweep.
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)' }}>
            Launched {new Date(attribution.launch_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}.
            Domains whose first backlink appeared within {attribution.window_days} days of launch. ★ = an outlet on this campaign.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 16, borderBottom: 'var(--border-w) solid var(--card-border)', paddingBottom: 8 }}>
        <button className={`btn btn-sm ${view === 'setup' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('setup')}>Set up &amp; send</button>
        <button className={`btn btn-sm ${view === 'results' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('results')}>Results &amp; interest</button>
      </div>

      {view === 'results' && <PressCampaignAnalytics clientId={clientId} release={release} />}

      {view === 'setup' && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="h3">Pick journalists</div>
            <button {...roWrite(readOnly, { onClick: runAutopilot, disabled: autopiloting })} className="btn btn-primary btn-sm">
              {autopiloting ? '✨ Building…' : '✨ Auto-build audience'}
            </button>
          </div>
          {suggestions && (
            <div style={{ marginBottom: 10, padding: 10, border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)', background: 'var(--accent-soft)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                ✨ Autopilot picked {suggestions.length} for this story — review &amp; send
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {!suggestions.length && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No strong matches found — add journalists or search the library below.</div>}
                {suggestions.map(su => (
                  <label key={su.contact_id} className="row center" style={{ gap: 8, padding: '6px 4px', borderTop: 'var(--border-w) solid rgba(0,0,0,0.06)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(su.contact_id)} onChange={() => toggle(su.contact_id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{su.name || '(no name)'}{su.company && <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}> · {su.company}</span>}{su.on_client_list ? <span className="chip" style={{ marginLeft: 6 }}>on list</span> : null}</div>
                      {su.reason ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{su.reason}</div> : null}
                    </div>
                    <button onClick={(e) => { e.preventDefault(); preview(su.contact_id); }} type="button" className="btn btn-secondary btn-sm">preview</button>
                  </label>
                ))}
              </div>
            </div>
          )}
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="filter by name, outlet or beat…"
            className="input" style={{ marginBottom: 10 }} />
          <div style={{ maxHeight: 520, overflowY: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
            {!filteredContacts.length && <div style={{ padding: 14, color: 'var(--text-subtle)', fontSize: 12 }}>No contacts match. Add some on the Contacts tab first.</div>}
            {groupKeys.map(beat => (
              <div key={beat}>
                <div className="caption" style={{ padding: "6px 10px", background: "var(--surface-raised)" }}>{beat} <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>· {grouped[beat].length}</span></div>
                {grouped[beat].map(c => (
                  <label key={c.id} className="row center" style={{ gap: 10, padding: "8px 10px", borderTop: "var(--border-w) solid var(--accent-soft)", cursor: "pointer" }}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name || '(no name)'} {c.company && <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>· {c.company}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </div>
                    <button onClick={(e) => { e.preventDefault(); preview(c.id); }} type="button" className="btn btn-secondary btn-sm">preview</button>
                  </label>
                ))}
              </div>
            ))}
          </div>
          {/* Global targeting — reach journalists across the whole media library,
              not only those already on this client. Picked ones are auto-attached
              on send. */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Add from the full media library</div>
              <button className="btn btn-link btn-sm" onClick={() => setShowPaste(v => !v)}>{showPaste ? 'close paste' : '📋 paste a list'}</button>
            </div>
            {showPaste && (
              <div style={{ marginBottom: 8 }}>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4} className="input"
                  placeholder="Paste anything — a spreadsheet, email signatures, 'Jane Doe, arts editor, The Times, jane@thetimes.co.uk'. Claude sorts, de-dupes and adds them to your list + this campaign." style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }} />
                <button {...roWrite(readOnly, { onClick: doPasteImport, disabled: pasting || !pasteText.trim() })} className="btn btn-primary btn-sm" style={{ marginTop: 6 }}>
                  {pasting ? 'Sorting…' : 'Sort & add'}
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={globalQuery} onChange={e => setGlobalQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchGlobal()}
                placeholder="search all journalists by name, outlet or email…" className="input" style={{ flex: 1 }} />
              <button className="btn btn-secondary btn-sm" onClick={searchGlobal} disabled={searchingGlobal}>{searchingGlobal ? '…' : 'Search'}</button>
            </div>
            {globalResults && (
              <div style={{ maxHeight: 220, overflowY: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginTop: 8 }}>
                {!globalResults.length && <div style={{ padding: 12, color: 'var(--text-subtle)', fontSize: 12 }}>No journalists found.</div>}
                {globalResults.map(c => (
                  <label key={c.id} className="row center" style={{ gap: 10, padding: '7px 10px', borderTop: 'var(--border-w) solid var(--accent-soft)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name || '(no name)'}{c.company && <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}> · {c.company}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.email}{c.contact_type ? ` · ${c.contact_type}` : ''}{c.location ? ` · ${c.location}` : ''}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selected.size} selected</div>
            <button {...roWrite(readOnly, { onClick: send, disabled: !selected.size || sending })} className="btn btn-primary">
              {sending ? 'Queueing…' : `Send to ${selected.size}`}
            </button>
          </div>
        </div>

        <div>
          <div className="h3">Preview {previewData?.contact ? `· ${previewData.contact.name || previewData.contact.email}` : ''}</div>

          {/* Sequence & timing — every step's subject + follow-up delays are
              editable, plus the embed toggle and a real test-send. Persists via
              PATCH /press/releases/:id. */}
          {release && (
            <div style={{ marginBottom: 12, padding: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Sequence &amp; timing
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 8 }}>
                If they’ve opened, the follow-up sends. If they haven’t opened yet, we resend the original with this new subject to catch their eye. Replies stop the chase.
              </div>
              <button {...roWrite(readOnly, { onClick: suggestSubjects, disabled: suggesting })} className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }}>
                {suggesting ? '✨ Reading the release…' : '✨ Suggest subject lines'}
              </button>
              {steps.map(s => (
                <div key={s.step_number} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 54 }}>
                      {s.step_number === 1 ? 'Release' : `Follow-up ${s.step_number - 1}`}
                    </span>
                    {s.step_number === 1 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>sends immediately</span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        after
                        <input type="number" min="1" value={s.delay_days ?? ''} onChange={e => setStepField(s.step_number, 'delay_days', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                          style={{ width: 46, padding: '2px 5px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
                        days
                      </span>
                    )}
                  </div>
                  <input value={s.subject ?? ''} onChange={e => setStepField(s.step_number, 'subject', e.target.value)}
                    placeholder="Subject line — use {{first_name}} to personalise"
                    style={{ width: '100%', padding: '6px 9px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={release.embed_full_release !== false}
                  onChange={async e => {
                    const next = e.target.checked;
                    setRelease(r => ({ ...r, embed_full_release: next }));
                    try {
                      await api.patch(`/press/releases/${release.id}`, { embed_full_release: next });
                      if (previewing) preview(previewing, true);
                    } catch (err) { toast(err.message, 'error'); }
                  }}
                />
                <span><strong>Embed the full release in the first email.</strong>{' '}
                  <span style={{ color: 'var(--text-subtle)' }}>Off = pitch + link only.</span></span>
              </label>
              <div style={{ marginTop: 10 }}>
                <button {...roWrite(readOnly, { onClick: saveSteps, disabled: savingSteps })} className="btn btn-secondary btn-sm">
                  {savingSteps ? 'Saving…' : 'Save subjects & timing'}
                </button>
              </div>

              {/* Test send */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Send a test</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@example.com"
                    className="input" style={{ flex: 1, minWidth: 160 }} />
                  <select value={testStep} onChange={e => setTestStep(parseInt(e.target.value, 10))} className="input" style={{ width: 130 }}>
                    {steps.map(s => <option key={s.step_number} value={s.step_number}>{s.step_number === 1 ? 'Release' : `Follow-up ${s.step_number - 1}`}</option>)}
                  </select>
                  <button {...roWrite(readOnly, { onClick: sendTest, disabled: testing || !testEmail.trim() })} className="btn btn-secondary btn-sm">
                    {testing ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  Personalised for {previewing ? 'the previewed journalist' : 'a sample journalist on this client'}. Subject is prefixed [TEST]; not tracked.
                </div>
              </div>
            </div>
          )}

          {!previewing && <div style={{ color: 'var(--text-subtle)', fontSize: 12, padding: 14, border: '1px dashed #ddd', borderRadius: 'var(--r-sm)' }}>Click <strong>preview</strong> on a journalist to see the personalised pitch + follow-ups Claude would send them.</div>}
          {previewing && !previewData && <div style={{ color: 'var(--text-subtle)', padding: 14 }}>Generating pitch + follow-ups…</div>}
          {previewData && (
            <div>
              <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="field-label">Initial email — personal pitch{release?.embed_full_release !== false ? ' + embedded release' : ' + release link'}</div>
                <button onClick={() => preview(previewing, true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11 }}>regenerate</button>
              </div>
              <iframe srcDoc={previewData.html} title="Preview" style={{ width: '100%', height: 420, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' }} sandbox="" />

              {/* Editable pitch for THIS journalist. */}
              <div style={{ marginTop: 12 }}>
                <div className="field-label">Edit this journalist’s pitch</div>
                <textarea value={editIntro ?? ''} onChange={e => setEditIntro(e.target.value)} rows={5}
                  className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }} />
              </div>

              {/* Editable follow-ups for THIS journalist, with real timings. */}
              {Array.isArray(editFollowUps) && editFollowUps.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-label">Follow-ups (stop automatically if they reply)</div>
                  {editFollowUps.map((fu, i) => {
                    const step = steps.find(s => s.step_number === i + 2);
                    return (
                      <div key={i} style={{ marginTop: 8, padding: 10, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>
                          Follow-up {i + 1}{step?.delay_days != null ? ` · after ${step.delay_days} days` : ''}
                        </div>
                        <input value={fu.subject ?? ''} onChange={e => setEditFollowUps(prev => prev.map((f, j) => j === i ? { ...f, subject: e.target.value } : f))}
                          placeholder="Subject" className="input" style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontWeight: 600, marginBottom: 6 }} />
                        <textarea value={fu.body ?? ''} onChange={e => setEditFollowUps(prev => prev.map((f, j) => j === i ? { ...f, body: e.target.value } : f))}
                          rows={3} className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12 }} />
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <button {...roWrite(readOnly, { onClick: saveRecipientEmail, disabled: savingEmail })} className="btn btn-primary btn-sm">
                  {savingEmail ? 'Saving…' : 'Save this journalist’s email'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

