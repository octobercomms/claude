import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';
import PressCampaignAnalytics from './PressCampaignAnalytics';

// Detail view for one press_release campaign, run as a clear five-step flow:
//   1 · Who     — build the audience from tags (scales to thousands) + adds.
//   2 · What    — the four subjects, timings, embed toggle, your footer.
//   3 · Test    — send yourself a faithful copy.
//   4 · Preview — see & edit any journalist's real email, full width.
//   5 · Confirm — green-tick checklist + a Claude sanity check, then send.
// The chosen audience + footer persist on the release, so closing and
// reopening the campaign restores exactly where you were.

const STEPS = [
  { key: 'who', label: 'Who', hint: 'audience' },
  { key: 'what', label: 'What', hint: 'the emails' },
  { key: 'test', label: 'Test', hint: 'send yourself one' },
  { key: 'preview', label: 'Preview', hint: 'see & edit' },
  { key: 'confirm', label: 'Confirm', hint: 'check & send' },
];

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
  const [step, setStep] = useState('who');

  // Audience — built from tags (each tag = a segment of the media DB).
  const [pressTags, setPressTags] = useState([]);          // [{ tag, count }]
  const [selTags, setSelTags] = useState(() => new Set());
  const [audience, setAudience] = useState({ total: 0, ids: [], sample: [] });
  const [resolving, setResolving] = useState(false);
  const [suggestions, setSuggestions] = useState(null);    // [{ tag, reason, count }]
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
  const [signature, setSignature] = useState('');
  const [savingSig, setSavingSig] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [testSteps, setTestSteps] = useState(() => new Set([1]));
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [showHtmlEdit, setShowHtmlEdit] = useState(false);
  const [bodyHtmlDraft, setBodyHtmlDraft] = useState('');
  const [boilerplateDraft, setBoilerplateDraft] = useState('');
  const [savingBody, setSavingBody] = useState(false);
  const [sending, setSending] = useState(false);

  // Preview / edit one recipient's email.
  const [previewing, setPreviewing] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [emailIdx, setEmailIdx] = useState(0); // 0 = release, 1..n = follow-ups
  const [editIntro, setEditIntro] = useState(null);
  const [editFollowUps, setEditFollowUps] = useState(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [previewed, setPreviewed] = useState(false);

  // Claude sanity check.
  const [review, setReview] = useState(null);
  const [reviewing, setReviewing] = useState(false);

  // Effective sender identity (mailbox / legacy config / platform default), so
  // the AM can see who a release goes out as before sending — and is warned if
  // it's still defaulting to the platform address.
  const [sender, setSender] = useState(null);
  const [senderEdit, setSenderEdit] = useState(null); // null = closed; else {from_name, from_email, reply_to}
  const [savingSender, setSavingSender] = useState(false);

  function openSenderEdit() {
    setSenderEdit({
      from_name: sender?.source === 'default' ? '' : (sender?.from_name || ''),
      from_email: sender?.source === 'default' ? '' : (sender?.from_email || ''),
      reply_to: sender?.source === 'default' ? '' : (sender?.reply_to || ''),
    });
  }
  async function saveSender() {
    setSavingSender(true);
    try {
      await api.put(`/outreach/sending/${clientId}`, senderEdit);
      const s = await api.get(`/press/clients/${clientId}/sender`).catch(() => null);
      setSender(s);
      setSenderEdit(null);
      toast('Sender saved — this is who your emails go out as now.', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setSavingSender(false); }
  }

  const hydratedRef = useRef(false);

  useEffect(() => {
    setLoadError(null); setAttribution(null); hydratedRef.current = false;
    api.get(`/press/campaigns/${campaignId}/release`)
      .then(rel => {
        setRelease(rel);
        setSteps(Array.isArray(rel.steps) ? rel.steps : []);
        setSignature(rel.press_signature || '');
        // Restore the saved audience (tags + hand-picked journalists).
        if (Array.isArray(rel.selected_tags)) setSelTags(new Set(rel.selected_tags));
        if (Array.isArray(rel.extra_contacts) && rel.extra_contacts.length) {
          const m = new Map();
          rel.extra_contacts.forEach(c => c && c.id && m.set(c.id, c));
          setExtras(m);
        }
        api.get(`/press/releases/${rel.id}/backlink-attribution`).then(setAttribution).catch(() => setAttribution(null));
      })
      .catch(e => setLoadError(e.message));
  }, [campaignId]);

  useEffect(() => { api.get('/press/tags').then(setPressTags).catch(() => setPressTags([])); }, []);

  // Who this client's emails go out as. Re-checked when the setup view is shown
  // so setting a sender in another tab reflects here without a full reload.
  useEffect(() => {
    if (!clientId) return;
    api.get(`/press/clients/${clientId}/sender`).then(setSender).catch(() => setSender(null));
  }, [clientId, view]);

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

  // Persist the audience (debounced) so close/reopen restores it. Skips the
  // first pass right after hydration, and never writes in read-only mode.
  useEffect(() => {
    if (!release || readOnly) return;
    if (!hydratedRef.current) { hydratedRef.current = true; return; }
    const t = setTimeout(() => {
      api.patch(`/press/releases/${release.id}`, {
        selected_tags: Array.from(selTags),
        extra_contacts: [...extras.values()].map(c => ({ id: c.id, name: c.name, email: c.email, company: c.company })),
      }).catch(() => { /* best-effort; state is still in the UI */ });
    }, 700);
    return () => clearTimeout(t);
  }, [selTags, extras, release, readOnly]);

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

  // Autopilot — suggest the audience TAGS for this story, with a reason each.
  async function runAutopilot() {
    if (!release) return;
    setAutopiloting(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/autopilot`, {});
      const sugg = Array.isArray(r.suggestions) ? r.suggestions
        : (r.suggested_tags || []).map(t => ({ tag: t, reason: null, count: pressTags.find(x => x.tag === t)?.count }));
      setSuggestions(sugg);
      setSelTags(new Set(sugg.map(s => s.tag)));
      toast(sugg.length ? `Suggested ${sugg.length} audience segment${sugg.length === 1 ? '' : 's'} for this story.` : 'No clear audience segments found — pick tags below.', sugg.length ? 'success' : 'info');
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
    setPreviewing(contactId); setPreviewData(null); setEditIntro(null); setEditFollowUps(null); setEmailIdx(0);
    setPreviewed(true);
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
  // The HTML currently shown in the preview (release, or the selected follow-up).
  const shownHtml = previewData
    ? (emailIdx === 0 ? previewData.html : (previewData.follow_ups_html?.[emailIdx - 1] || '<p style="padding:16px;font-family:sans-serif;color:#888">No follow-up body yet.</p>'))
    : '';
  function openInNewTab() {
    if (!shownHtml) return;
    // Open via a blob URL (not document.write) so the tab has a real URL —
    // the AM can then view source, save the page, or share the link.
    const blob = new Blob([shownHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { toast('Allow pop-ups to open the preview in a new tab.', 'info'); URL.revokeObjectURL(url); return; }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  function openHtmlEdit() { setBodyHtmlDraft(release?.body_html || ''); setBoilerplateDraft(release?.boilerplate || ''); setShowHtmlEdit(v => !v); }
  async function saveReleaseHtml() {
    if (!release) return;
    setSavingBody(true);
    try {
      await api.patch(`/press/releases/${release.id}`, { body_html: bodyHtmlDraft, boilerplate: boilerplateDraft });
      setRelease(r => ({ ...r, body_html: bodyHtmlDraft, boilerplate: boilerplateDraft }));
      if (previewing) preview(previewing, true);
      toast('Release content saved.', 'success');
      setShowHtmlEdit(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingBody(false); }
  }
  async function doRefetch() {
    if (!release) return;
    if (!confirm('Re-fetch this release from its source page? Refreshes the embedded content (fixes duplicated or stale scrapes) and keeps your audience, subjects and edits.')) return;
    setRefetching(true);
    try {
      await api.post(`/press/releases/${release.id}/refetch`, {});
      const rel = await api.get(`/press/campaigns/${campaignId}/release`);
      setRelease(r => ({ ...r, body_html: rel.body_html, images: rel.images, boilerplate: rel.boilerplate, dateline: rel.dateline }));
      if (previewing) preview(previewing, true);
      toast('Release re-fetched from source.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setRefetching(false); }
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
  async function saveSignature() {
    if (!release) return;
    setSavingSig(true);
    try {
      await api.put(`/press/clients/${clientId}/press-signature`, { signature });
      toast('Footer saved — it’ll appear on every pitch and follow-up.', 'success');
      if (previewing) preview(previewing, true);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingSig(false); }
  }
  function toggleTestStep(n) {
    setTestSteps(prev => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });
  }
  async function sendTest() {
    const chosen = Array.from(testSteps).sort((a, b) => a - b);
    if (!release || !testEmail.trim() || !chosen.length) return;
    setTesting(true);
    try {
      for (const sn of chosen) {
        const body = { email: testEmail.trim(), step_number: sn };
        if (previewing) body.contact_id = previewing;
        await api.post(`/press/releases/${release.id}/test`, body);
      }
      toast(`Sent ${chosen.length} test email${chosen.length === 1 ? '' : 's'} to ${testEmail.trim()}.`, 'success');
      setTested(true);
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
  async function runReview() {
    if (!release) return;
    setReviewing(true); setReview(null);
    try {
      const r = await api.post(`/press/releases/${release.id}/review`, {
        tags: Array.from(selTags), recipient_count: totalRecipients,
      });
      setReview(r);
    } catch (e) { toast(e.message, 'error'); }
    finally { setReviewing(false); }
  }
  async function send() {
    if (!totalRecipients || !release) return;
    const fuCount = Math.max(0, steps.length - 1);
    // Never let a release go out from an unconfigured (platform-default) sender
    // without an explicit, informed OK — this is what caused a blind send from
    // reports@ that nobody monitored.
    if (sender && sender.source === 'default') {
      const ok = confirm(
        `Heads up — no sender is set for this client, so emails will go FROM the platform default address:\n\n`
        + `From: ${sender.from_name || 'October Communications'} <${sender.from_email || '—'}>\n`
        + `Reply-To: ${sender.reply_to || '—'}\n\n`
        + `Set a proper From/Reply-To (or a mailbox) in Owned → Email → Send first. Send anyway?`
      );
      if (!ok) return;
    }
    // Ask the server how many of these recipients already have this release in
    // this campaign, so we can tell the AM exactly who's new vs. a repeat — and
    // reassure them a re-send won't double up. Falls back to a plain confirm if
    // the check fails.
    let plan = null;
    try { plan = await api.post(`/press/releases/${release.id}/send-plan`, { contact_ids: Array.from(combinedIds) }); }
    catch { /* non-fatal — fall through to the simple confirm */ }
    if (plan && plan.already > 0) {
      if (plan.new === 0) {
        alert(`All ${plan.already} of these recipients have already been sent this release in this campaign. There's no one new to send to.`);
        return;
      }
      const msg = `${plan.already} of these ${plan.total} recipient${plan.total === 1 ? '' : 's'} were already emailed this release in this campaign — they will be skipped automatically (no duplicates).\n\n`
        + `Send the release to the ${plan.new} new recipient${plan.new === 1 ? '' : 's'}? ${fuCount} follow-up${fuCount === 1 ? '' : 's'} will queue on your timings and stop if they reply.`;
      if (!confirm(msg)) return;
    } else if (!confirm(`Send to ${totalRecipients} journalist${totalRecipients === 1 ? '' : 's'}? ${fuCount} follow-up${fuCount === 1 ? '' : 's'} will queue on your timings and stop automatically if they reply.`)) {
      return;
    }
    setSending(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/send`, { contact_ids: Array.from(combinedIds) });
      toast(r.queued ? `Queued ${r.queued} emails.` : 'Nothing new to queue — everyone was already sent.', 'success');
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

  // Completion flags drive the green ticks in the stepper + confirm step.
  const done = {
    who: totalRecipients > 0,
    what: steps.length > 0 && steps.every(s => (s.subject || '').trim()),
    test: tested,
    preview: previewed,
  };

  const visibleTags = pressTags.filter(t => !tagSearch || t.tag.toLowerCase().includes(tagSearch.toLowerCase()));
  const TagChip = ({ tag, count, on }) => (
    <button type="button" onClick={() => toggleTag(tag)}
      style={{ padding: '4px 10px', borderRadius: 14, fontSize: 12, cursor: 'pointer', margin: '0 6px 6px 0',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--card-border)'}`, background: on ? 'var(--accent)' : 'var(--surface)',
        color: on ? '#111' : 'var(--text)', fontWeight: on ? 700 : 400 }}>
      {on ? '✓ ' : ''}{tag}{count != null ? <span style={{ opacity: 0.6 }}> · {count}</span> : ''}
    </button>
  );

  const stepIndex = STEPS.findIndex(s => s.key === step);
  const goNext = () => { const i = STEPS.findIndex(s => s.key === step); if (i < STEPS.length - 1) setStep(STEPS[i + 1].key); };
  const goBack = () => { const i = STEPS.findIndex(s => s.key === step); if (i > 0) setStep(STEPS[i - 1].key); };

  const Stepper = () => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 18 }}>
      {STEPS.map((s, i) => {
        const active = s.key === step;
        const isDone = done[s.key];
        return (
          <button key={s.key} type="button" onClick={() => setStep(s.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer',
              borderRadius: 'var(--r-sm)', border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
              background: active ? 'var(--accent-soft)' : 'var(--surface)', flex: '1 1 120px', minWidth: 0, textAlign: 'left' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 11, flexShrink: 0,
              background: isDone ? 'var(--success, #1a9d5a)' : (active ? 'var(--accent)' : 'var(--card-border)'),
              color: isDone || active ? '#fff' : 'var(--text-subtle)', fontSize: 12, fontWeight: 700 }}>
              {isDone ? '✓' : i + 1}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: active ? 700 : 600, color: 'var(--text)', display: 'block' }}>{s.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{s.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const NavRow = ({ children }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 12 }}>
      <button className="btn btn-secondary btn-sm" onClick={goBack} disabled={stepIndex === 0}>‹ Back</button>
      {children}
    </div>
  );

  return (
    <div>
      <button onClick={onExit} className="btn btn-secondary btn-sm" style={{ marginBottom: 16 }}>← Back to campaigns</button>

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
      <div style={{ marginTop: 4 }}>
        <Stepper />

        {/* ── 1 · WHO ─────────────────────────────────────────────────── */}
        {step === 'who' && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="h3">1 · Who — the audience</div>
                <p style={{ color: 'var(--text-subtle)', fontSize: 12, margin: '2px 0 0' }}>Click tags to add whole segments of your media database. Your selection is saved automatically.</p>
              </div>
              <button {...roWrite(readOnly, { onClick: runAutopilot, disabled: autopiloting })} className="btn btn-secondary btn-sm">
                {autopiloting ? '✨ Choosing…' : '✨ Suggest audience'}
              </button>
            </div>

            {sender && (
              <div style={{
                marginTop: 12, padding: '9px 12px', borderRadius: 'var(--r-sm)', fontSize: 12.5,
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                border: `1px solid ${sender.source === 'default' ? '#e0b400' : 'var(--card-border)'}`,
                background: sender.source === 'default' ? 'var(--warning-soft, #fff8e1)' : 'var(--surface-raised)',
              }}>
                <span style={{ fontWeight: 700 }}>{sender.source === 'default' ? '⚠ Sending as (not set — platform default):' : 'Sending as:'}</span>
                <span>{sender.from_name}{sender.from_email ? ` <${sender.from_email}>` : ''}</span>
                {sender.reply_to && <span style={{ color: 'var(--text-subtle)' }}>· replies → {sender.reply_to}</span>}
                {sender.source === 'mailbox' && <span className="chip">{sender.mailbox_count} mailbox{sender.mailbox_count === 1 ? '' : 'es'} · managed in Owned → Email → Send</span>}
                {sender.source !== 'mailbox' && !senderEdit && (
                  <button {...roWrite(readOnly, { onClick: openSenderEdit })} className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}>
                    {sender.source === 'default' ? 'Set sender →' : 'Change →'}
                  </button>
                )}
              </div>
            )}

            {senderEdit && (
              <div className="card" style={{ marginTop: 8, padding: 12, background: 'var(--surface-raised)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Who these emails send from</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="field"><span className="field-label">From name</span><input className="input" value={senderEdit.from_name} onChange={(e) => setSenderEdit((s) => ({ ...s, from_name: e.target.value }))} placeholder="October Communications" /></label>
                  <label className="field"><span className="field-label">From email</span><input className="input" value={senderEdit.from_email} onChange={(e) => setSenderEdit((s) => ({ ...s, from_email: e.target.value }))} placeholder="press@yourdomain.com" /></label>
                  <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Reply-To (where replies land)</span><input className="input" value={senderEdit.reply_to} onChange={(e) => setSenderEdit((s) => ({ ...s, reply_to: e.target.value }))} placeholder="hello@yourdomain.com" /></label>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '6px 0 10px' }}>The From address must be on a domain you've verified for sending. Applies to every email for this client that isn't sent from a mailbox — including everything not yet sent in this campaign.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" disabled={savingSender || !senderEdit.from_email.trim()} onClick={saveSender}>{savingSender ? 'Saving…' : 'Save sender'}</button>
                  <button className="btn btn-secondary btn-sm" disabled={savingSender} onClick={() => setSenderEdit(null)}>Cancel</button>
                </div>
              </div>
            )}

            {suggestions && suggestions.length > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>✨ Suggested for this story — and why</div>
                {suggestions.map(s => (
                  <div key={s.tag} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
                    <span style={{ flexShrink: 0 }}><TagChip tag={s.tag} count={s.count} on={selTags.has(s.tag)} /></span>
                    {s.reason && <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, paddingTop: 4 }}>{s.reason}</span>}
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>Not right? Toggle any off, or add others below — precise beats broad.</div>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <input value={tagSearch} onChange={e => setTagSearch(e.target.value)} placeholder="filter tags…" className="input" style={{ marginBottom: 8, maxWidth: 260 }} />
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {!visibleTags.length && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No tags found. Tag your journalists, or add journalists individually below.</div>}
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
                  <button {...roWrite(readOnly, { onClick: doPasteImport, disabled: pasting || !pasteText.trim() })} className="btn btn-secondary btn-sm" style={{ marginTop: 6 }}>{pasting ? 'Sorting…' : 'Sort & add'}</button>
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

            <NavRow>
              <button className="btn btn-primary btn-sm" onClick={goNext} disabled={!done.who}>Next: the emails ›</button>
            </NavRow>
          </div>
        )}

        {/* ── 2 · WHAT ────────────────────────────────────────────────── */}
        {step === 'what' && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
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
              <span><strong>Embed the full release in the first email.</strong> <span style={{ color: 'var(--text-subtle)' }}>Off = pitch + link only. Follow-ups are always short, personal emails.</span></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={release.followup_hero !== false}
                onChange={async e => { const next = e.target.checked; setRelease(r => ({ ...r, followup_hero: next })); try { await api.patch(`/press/releases/${release.id}`, { followup_hero: next }); if (previewing) preview(previewing, true); } catch (err) { toast(err.message, 'error'); } }} />
              <span><strong>Add the hero image at the foot of follow-ups.</strong> <span style={{ color: 'var(--text-subtle)' }}>Sits below your sign-off as a reminder of the story. Follow-ups always link to the release and read as standalone pitches; the last one offers a quick 1/2/3 reply.</span></span>
            </label>

            {/* Configurable footer / signature */}
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Your footer</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 6 }}>Appears under your sign-off on every pitch <em>and</em> follow-up. Plain text works, or paste <strong>HTML</strong> for a logo, GIF or table layout — it’s rendered as-is.</div>
              <textarea value={signature} onChange={e => setSignature(e.target.value)} rows={5} className="input"
                placeholder={"Plain text, e.g.\nOctober Communications · +44 20 1234 5678\noctobercomms.com · @octobercomms\n\n…or paste your HTML signature (with <img>/<table>)."} style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: /<[a-z][\s\S]*>/i.test(signature) ? 'monospace' : 'inherit' }} />
              <button {...roWrite(readOnly, { onClick: saveSignature, disabled: savingSig })} className="btn btn-secondary btn-sm" style={{ marginTop: 6 }}>{savingSig ? 'Saving…' : 'Save footer'}</button>
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <button {...roWrite(readOnly, { onClick: saveSteps, disabled: savingSteps })} className="btn btn-secondary btn-sm">{savingSteps ? 'Saving…' : 'Save subjects & timing'}</button>
            </div>

            <NavRow>
              <button className="btn btn-primary btn-sm" onClick={goNext}>Next: send a test ›</button>
            </NavRow>
          </div>
        )}

        {/* ── 3 · TEST ────────────────────────────────────────────────── */}
        {step === 'test' && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div className="h3">3 · Test — send yourself one</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '2px 0 12px' }}>
              A faithful copy — the real template, a real journalist’s personalised pitch, your footer — lands in your inbox, marked <strong>[TEST]</strong>. Nothing is tracked or sent to journalists.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', maxWidth: 520 }}>
              <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@example.com" className="input" style={{ flex: 1, minWidth: 200 }} />
              <button {...roWrite(readOnly, { onClick: sendTest, disabled: testing || !testEmail.trim() || !testSteps.size })} className="btn btn-secondary btn-sm">{testing ? 'Sending…' : `Send ${testSteps.size || 0} test${testSteps.size === 1 ? '' : 's'}`}</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {steps.map(s => {
                const on = testSteps.has(s.step_number);
                return (
                  <label key={s.step_number} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 'var(--r-sm)', cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--card-border)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface)', fontSize: 12 }}>
                    <input type="checkbox" checked={on} onChange={() => toggleTestStep(s.step_number)} />
                    {s.step_number === 1 ? 'Release' : `Follow-up ${s.step_number - 1}`}
                  </label>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>Tick every email you want to check — they’ll all send in one click.</div>
            {tested && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--success, #1a9d5a)', fontWeight: 600 }}>✓ Test sent. Check your inbox, then move on.</div>}

            <NavRow>
              <button className="btn btn-primary btn-sm" onClick={goNext}>Next: preview emails ›</button>
            </NavRow>
          </div>
        )}

        {/* ── 4 · PREVIEW (full width) ────────────────────────────────── */}
        {step === 'preview' && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div className="h3">4 · Preview — see &amp; edit each email</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '2px 0 12px' }}>
              Pick a journalist to see the exact email Claude will send them. Edit the pitch or any follow-up body — subjects come from step&nbsp;2.
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <select value={previewing || ''} onChange={e => e.target.value && preview(e.target.value)} className="input" style={{ minWidth: 240, maxWidth: 360 }}>
                <option value="">{previewList.length ? 'Pick a journalist to preview…' : 'Add an audience first (step 1)'}</option>
                {previewList.map(c => <option key={c.id} value={c.id}>{c.name || '(no name)'}{c.company ? ` · ${c.company}` : ''} — {c.email}</option>)}
              </select>
              {previewList.length > 1 && previewing && (
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => stepPreview(-1)}>‹ prev</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => stepPreview(1)}>next ›</button>
                </span>
              )}
              {previewing && <button className="btn btn-link btn-sm" onClick={() => preview(previewing, true)}>↻ regenerate</button>}
              <button {...roWrite(readOnly, { onClick: doRefetch, disabled: refetching })} className="btn btn-link btn-sm" title="Re-pull the release from its source page (fixes duplicated/stale embedded content)">{refetching ? 're-fetching…' : '⟳ re-fetch release'}</button>
              <button className="btn btn-link btn-sm" onClick={openHtmlEdit} title="Hand-edit the embedded release HTML to fix anything the scrape got wrong">{showHtmlEdit ? '✕ close HTML' : '✎ edit release HTML'}</button>
            </div>

            {showHtmlEdit && (
              <div style={{ marginBottom: 12, padding: 12, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 6 }}>Edit the embedded release directly — remove anything weird, fix a caption, delete a stray duplicate. Saved for the whole campaign; previews regenerate.</div>
                <label className="field-label" style={{ marginTop: 2 }}>Release body (HTML)</label>
                <textarea value={bodyHtmlDraft} onChange={e => setBodyHtmlDraft(e.target.value)} rows={12} className="input"
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }} />
                <label className="field-label" style={{ marginTop: 8 }}>Notes to editors / boilerplate (HTML)</label>
                <textarea value={boilerplateDraft} onChange={e => setBoilerplateDraft(e.target.value)} rows={8} className="input"
                  placeholder="The 'Notes to editors' / About section below the release." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button {...roWrite(readOnly, { onClick: saveReleaseHtml, disabled: savingBody })} className="btn btn-secondary btn-sm">{savingBody ? 'Saving…' : 'Save release content'}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowHtmlEdit(false)}>Cancel</button>
                </div>
              </div>
            )}

            {!previewing && <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: 20, border: '1px dashed var(--card-border)', borderRadius: 'var(--r-sm)' }}>Pick a journalist above to preview and edit the personalised pitch + follow-ups.</div>}
            {previewing && !previewData && <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Generating pitch + follow-ups…</div>}
            {previewData && (
              <div>
                {/* which email in the sequence */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  {steps.map((s, i) => (
                    <button key={s.step_number} type="button" onClick={() => setEmailIdx(i)}
                      className={`btn btn-sm ${emailIdx === i ? 'btn-primary' : 'btn-secondary'}`}>
                      {i === 0 ? 'Release' : `Follow-up ${i}`}
                    </button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-secondary btn-sm" onClick={openInNewTab}>↗ Open in new tab</button>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <strong>Subject:</strong> {steps[emailIdx]?.subject || <span style={{ color: 'var(--text-subtle)' }}>(set in step 2)</span>}
                  {emailIdx === 0 && <span style={{ color: 'var(--text-subtle)' }}> · {release.embed_full_release !== false ? 'pitch + embedded release' : 'pitch + link'}</span>}
                </div>

                <iframe srcDoc={shownHtml} title="Preview" style={{ width: '100%', height: 620, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: '#fff' }} sandbox="" />

                {/* editor adapts to the selected email */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: 'var(--border-w) solid var(--card-border)' }}>
                  {emailIdx === 0 ? (
                    <div>
                      <div className="field-label">Edit this journalist’s pitch</div>
                      <textarea value={editIntro ?? ''} onChange={e => setEditIntro(e.target.value)} rows={5} className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14 }} />
                    </div>
                  ) : (
                    <div>
                      <div className="field-label">Edit follow-up {emailIdx} — body only</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4 }}>Subject is shared across all recipients — change it in step 2.</div>
                      <textarea
                        value={editFollowUps?.[emailIdx - 1]?.body ?? ''}
                        onChange={e => setEditFollowUps(prev => (prev || []).map((f, j) => j === emailIdx - 1 ? { ...f, body: e.target.value } : f))}
                        rows={5} className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 14 }} />
                    </div>
                  )}
                  <button {...roWrite(readOnly, { onClick: saveRecipientEmail, disabled: savingEmail })} className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>{savingEmail ? 'Saving…' : 'Save this email'}</button>
                </div>
              </div>
            )}

            <NavRow>
              <button className="btn btn-primary btn-sm" onClick={goNext}>Next: confirm &amp; send ›</button>
            </NavRow>
          </div>
        )}

        {/* ── 5 · CONFIRM ─────────────────────────────────────────────── */}
        {step === 'confirm' && (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <div className="h3">5 · Confirm — final checks</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '2px 0 14px' }}>Everything below should be green before you send.</div>

            {[
              { ok: done.who, label: 'Audience chosen', detail: `${totalRecipients.toLocaleString()} recipient${totalRecipients === 1 ? '' : 's'}${selTags.size ? ` · ${selTags.size} tag${selTags.size === 1 ? '' : 's'}` : ''}${extras.size ? ` · ${extras.size} added by hand` : ''}`, hard: true },
              { ok: done.what, label: 'Subject lines set', detail: `${steps.length} email${steps.length === 1 ? '' : 's'} in the sequence`, hard: true },
              { ok: done.test, label: 'Test email sent', detail: done.test ? 'you’ve seen a real copy' : 'recommended — go back to step 3', hard: false },
              { ok: done.preview, label: 'Previewed a journalist’s email', detail: done.preview ? 'you’ve reviewed the personalised pitch' : 'recommended — go back to step 4', hard: false },
              { ok: !!signature.trim(), label: 'Footer added', detail: signature.trim() ? 'appears on every email' : 'optional — add one in step 2', hard: false },
              {
                ok: !!(sender && sender.source !== 'default'),
                label: 'Sender set',
                detail: sender
                  ? (sender.source === 'default'
                      ? `⚠ defaulting to ${sender.from_name} <${sender.from_email || '—'}> — set a From/Reply-To in Owned → Email → Send`
                      : `from ${sender.from_name}${sender.from_email ? ` <${sender.from_email}>` : ''}${sender.reply_to ? ` · replies → ${sender.reply_to}` : ''}`)
                  : 'checking…',
                hard: false,
              },
            ].map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: i ? 'var(--border-w) solid var(--card-border)' : 'none' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 11, flexShrink: 0, marginTop: 1,
                  background: c.ok ? 'var(--success, #1a9d5a)' : (c.hard ? 'var(--danger, #c0392b)' : 'var(--card-border)'), color: c.ok || c.hard ? '#fff' : 'var(--text-subtle)', fontSize: 13, fontWeight: 700 }}>
                  {c.ok ? '✓' : (c.hard ? '!' : '○')}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{c.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{c.detail}</div>
                </div>
              </div>
            ))}

            {/* Claude sanity check */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: 'var(--border-w) solid var(--card-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Claude’s sanity check</div>
                <button {...roWrite(readOnly, { onClick: runReview, disabled: reviewing || !done.who })} className="btn btn-secondary btn-sm">{reviewing ? '✨ Reviewing…' : (review ? '↻ Re-run' : '✨ Review this campaign')}</button>
              </div>
              {!review && !reviewing && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Claude looks over the audience, subjects and timing and tells you if it looks like a good campaign to send.</div>}
              {review && (
                <div style={{ padding: 12, borderRadius: 'var(--r-sm)',
                  background: review.rating === 'good' ? 'var(--success-soft, #e7f6ee)' : review.rating === 'concerns' ? 'var(--warning-soft, #fdf3d8)' : 'var(--surface-raised)',
                  border: `1px solid ${review.rating === 'good' ? 'var(--success, #1a9d5a)' : review.rating === 'concerns' ? '#f0d260' : 'var(--card-border)'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, textTransform: 'capitalize' }}>
                    {review.rating === 'good' ? '✓ Looks good' : review.rating === 'concerns' ? '⚠ Some concerns' : 'OK, with notes'}
                  </div>
                  {review.verdict && <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{review.verdict}</div>}
                  {Array.isArray(review.checks) && review.checks.length > 0 && (
                    <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                      {review.checks.map((ck, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
                          <span>{ck.status === 'good' ? '✓' : '⚠'}</span>
                          <span><strong>{ck.label}:</strong> {ck.note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <NavRow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{totalRecipients.toLocaleString()} recipient{totalRecipients === 1 ? '' : 's'}</div>
                <button {...roWrite(readOnly, { onClick: send, disabled: !totalRecipients || sending })} className="btn btn-primary">{sending ? 'Queueing…' : `Send to ${totalRecipients.toLocaleString()}`}</button>
              </div>
            </NavRow>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
