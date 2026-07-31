import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import SuiteTabs from '../components/SuiteTabs';
import { Accordion, AccordionItem } from '../components/ui/Accordion';
import SuiteOverview from '../components/SuiteOverview';
import SuiteReadiness from '../components/SuiteReadiness';
import CoverageFromUrlModal from '../components/CoverageFromUrlModal';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

// Ordered by importance for the AM: won first, in-motion next, dead last.
const STATUSES = [
  ['published', 'Published'], ['confirmed', 'Confirmed'], ['pending', 'Pending'],
  ['interview_prep', 'Interview Prep'], ['pitched', 'Pitched'], ['download', 'Download'],
  ['declined', 'Declined'], ['no_response', 'No Response'],
];

// Colour map so the coverage rows are scannable at a glance. Only the three
// milestones that matter get a colour — Published (won) green, Confirmed
// yellow, Pending orange; everything else is a neutral grey chip.
const STATUS_PILL = {
  published: { bg: '#e6f4ea', fg: '#1f7a3d', border: '#9bcfa8' },   // green — won
  confirmed: { bg: '#fef9c3', fg: '#7a5c00', border: '#efdc57' },   // yellow — locked in
  pending:   { bg: '#ffedd5', fg: '#9a3412', border: '#fdba74' },   // orange — in motion
};
function StatusPill({ status, label }) {
  const s = STATUS_PILL[status];
  const style = s
    ? { background: s.bg, color: s.fg, border: `1px solid ${s.border}`, fontWeight: 700 }
    : { background: '#f1f1f1', color: '#595959', border: '1px solid #d4d4d4', fontWeight: 600 };
  return (
    <span className="chip" style={{ ...style, padding: '2px 10px', fontSize: 11, letterSpacing: 0.2, whiteSpace: 'nowrap' }}>
      {label || status}
    </span>
  );
}
const BLANK = {
  story_title: '', press_contact: '', publication: '', country: '',
  status: 'pitched', issue_date: '', story_url: '', notes_outcome: '',
  pitch_request: '', request_date: '', interview_date: '',
  attachment_url: '', attachment_filename: '',
};

// Liveness colour for a coverage story link. NULL = never checked, render as
// a normal link. 'broken' = high-confidence dead (404/410/DNS) — red, so the
// AM hunts for the new URL. 'uncertain' = anti-bot or transient (403/429/5xx)
// — amber, to flag without crying wolf. 'ok' = 2xx, normal link.
function linkStyleFor(status) {
  if (status === 'broken') return { color: '#a32020', textDecoration: 'line-through' };
  if (status === 'uncertain') return { color: '#8c5a00' };
  return null;
}
function linkTitleFor(status, code, checkedAt, finalUrl) {
  if (!status) return null;
  const when = checkedAt ? new Date(checkedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const label = status === 'broken' ? 'Broken' : status === 'uncertain' ? 'Uncertain (may be anti-bot)' : 'OK';
  const codeStr = code ? ` · HTTP ${code}` : '';
  const finalStr = finalUrl ? ` · final: ${finalUrl}` : '';
  return `${label}${codeStr} · checked ${when}${finalStr}`;
}

function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d);
  return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default function ClientPRPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { readOnly } = useAuth();
  const fileRef = useRef(null);
  const combinedRef = useRef(null);
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);
  const [journalists, setJournalists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null); // null | {id?, ...form}
  const [urlModal, setUrlModal] = useState(false); // "log coverage from a link"
  const [saving, setSaving] = useState(false);
  const [combinedResult, setCombinedResult] = useState(null);
  // Coverage tab — status filter + sort. Defaults to "all" / newest first
  // because the table is already sorted by issue/request date on the server.
  const [coverageFilter, setCoverageFilter] = useState('all');
  const [coverageSort, setCoverageSort] = useState('date_desc');
  const [coverageQuery, setCoverageQuery] = useState('');
  const [checkingLinks, setCheckingLinks] = useState(false);
  const [importOpen, setImportOpen] = useState(false); // Import ▾ dropdown
  const importMenuRef = useRef(null);
  useEffect(() => {
    if (!importOpen) return;
    const away = (e) => { if (importMenuRef.current && !importMenuRef.current.contains(e.target)) setImportOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [importOpen]);
  const [showReports, setShowReports] = useState(false);
  const [reports, setReports] = useState({ alert_email: '', report_cadence: 'off' });
  const [savingReports, setSavingReports] = useState(false);
  const [searches, setSearches] = useState([]);
  const [serperOn, setSerperOn] = useState(true);
  const [queue, setQueue] = useState([]);
  const [newSearch, setNewSearch] = useState({ query: '', src_serper: true, src_alerts: false, alerts_rss: '', cadence: 'daily' });
  const [thanks, setThanks] = useState([]);
  const [thankDraft, setThankDraft] = useState(null); // null | { entryId, to, subject, body, tone, confidence, edited }
  const [drafting, setDrafting] = useState(false);
  const [sendingThank, setSendingThank] = useState(false);
  const [thankSettings, setThankSettings] = useState(null); // { thank_stage, stages, record }
  const [pitch, setPitch] = useState({ url: '', brief: '' });
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchResult, setPitchResult] = useState(null);

  async function findTargets() {
    if (!pitch.url.trim() && !pitch.brief.trim()) { toast('Paste a press-release URL or a brief', 'error'); return; }
    setPitchLoading(true); setPitchResult(null);
    try {
      const r = await api.post(`/pr/clients/${id}/pitch-targets`, { url: pitch.url.trim(), brief: pitch.brief.trim() });
      if (r.error) { toast(r.error, 'error'); return; }
      setPitchResult(r);
    } catch (e) { toast(e.message, 'error'); }
    finally { setPitchLoading(false); }
  }
  const [releases, setReleases] = useState([]);
  const [pr, setPr] = useState(null); // null | release row being edited
  const [prDrafting, setPrDrafting] = useState(false);
  const [prSaving, setPrSaving] = useState(false);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch((e) => toast(e.message, 'error')); }, [id]);

  function loadReleases() {
    api.get(`/pr/clients/${id}/press-releases`).then((r) => setReleases(r.items || [])).catch(() => {});
  }
  useEffect(() => { if (tab === 'press') loadReleases(); }, [tab, id]);

  async function newRelease() {
    try {
      const row = await api.post(`/pr/clients/${id}/press-releases`, { title: '', brand: client?.name || '' });
      setPr(row);
    } catch (e) { toast(e.message, 'error'); }
  }
  async function openRelease(rid) {
    try { setPr(await api.get(`/pr/press-releases/${rid}`)); } catch (e) { toast(e.message, 'error'); }
  }
  async function savePR(extra) {
    if (!pr) return;
    setPrSaving(true);
    try {
      const body = { title: pr.title, brand: pr.brand, angle: pr.angle, key_facts: pr.key_facts, body_html: pr.body_html, status: pr.status, url: pr.url, embargo_at: pr.embargo_at || null, ...(extra || {}) };
      const row = await api.patch(`/pr/press-releases/${pr.id}`, body);
      setPr(row);
      if (!extra) { toast('Saved', 'success'); loadReleases(); }
      return row;
    } catch (e) { toast(e.message, 'error'); }
    finally { setPrSaving(false); }
  }
  async function draftPR() {
    if (!pr) return;
    if (!pr.title) { toast('Add a headline first', 'error'); return; }
    setPrDrafting(true);
    try {
      await savePR({}); // persist the brief before drafting
      const r = await api.post(`/pr/press-releases/${pr.id}/draft`, {});
      if (r.error) { toast(r.error, 'error'); return; }
      setPr((p) => ({ ...p, body_html: r.body_html }));
      toast('Draft written — review and edit', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setPrDrafting(false); }
  }
  async function deletePR(row) {
    if (!window.confirm('Delete this press release?')) return;
    try { await api.delete(`/pr/press-releases/${row.id}`); if (pr && pr.id === row.id) setPr(null); loadReleases(); }
    catch (e) { toast(e.message, 'error'); }
  }
  function reviewUrl(token) { return `${window.location.origin}/press-release/${token}`; }
  async function copyReviewLink() {
    const row = await savePR({ status: pr.status === 'draft' ? 'in_review' : pr.status });
    const token = row && row.review_token;
    if (!token) { toast('Set status to In review to generate a link', 'error'); return; }
    const url = reviewUrl(token);
    try { await navigator.clipboard.writeText(url); toast('Client approval link copied', 'success'); }
    catch { window.prompt('Client approval link:', url); }
  }
  async function createPitchCampaign() {
    if (!pr) return;
    if (pr.campaign_id) { navigate(`/clients/${id}/outreach`); return; }
    try {
      const r = await api.post(`/pr/press-releases/${pr.id}/create-campaign`, {});
      if (r.error) { toast(r.error, 'error'); return; }
      setPr((p) => ({ ...p, campaign_id: r.campaign_id }));
      toast('Pitch campaign created — opening Email', 'success');
      navigate(`/clients/${id}/outreach`);
    } catch (e) { toast(e.message, 'error'); }
  }

  function loadThanks() {
    api.get(`/pr/clients/${id}/thank-opportunities`).then((r) => setThanks(r.items || [])).catch(() => {});
    api.get(`/pr/clients/${id}/thank-settings`).then(setThankSettings).catch(() => {});
  }
  useEffect(() => { if (tab === 'thanks') loadThanks(); }, [tab, id]);

  async function setThankStage(stage) {
    try {
      await api.patch(`/pr/clients/${id}/thank-settings`, { thank_stage: stage });
      setThankSettings((s) => ({ ...(s || {}), thank_stage: stage }));
      toast('Auto-send stage updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openDraft(row) {
    setDrafting(true);
    setThankDraft({ entryId: row.id, journalist: row.journalist, outlet: row.outlet, to: '', subject: '', body: '', tone: '', confidence: 0, edited: false });
    try {
      const d = await api.post(`/pr/editorial-log/${row.id}/thank-draft`, {});
      if (d.error) { toast(d.error, 'error'); setThankDraft(null); return; }
      setThankDraft((t) => ({ ...t, to: d.to || '', subject: d.subject || '', body: d.body || '', tone: d.tone || '', confidence: d.confidence || 0 }));
    } catch (e) { toast(e.message, 'error'); setThankDraft(null); }
    finally { setDrafting(false); }
  }
  async function sendThank() {
    if (!thankDraft) return;
    setSendingThank(true);
    try {
      const r = await api.post(`/pr/editorial-log/${thankDraft.entryId}/thank-send`, {
        subject: thankDraft.subject, body: thankDraft.body, tone: thankDraft.tone,
        confidence: thankDraft.confidence, edited: thankDraft.edited,
      });
      if (r.error) { toast(r.error, 'error'); return; }
      toast('Thank-you sent', 'success');
      setThankDraft(null);
      loadThanks();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSendingThank(false); }
  }
  async function skipThank(row) {
    try { await api.post(`/pr/editorial-log/${row.id}/thank-skip`, {}); loadThanks(); }
    catch (e) { toast(e.message, 'error'); }
  }

  function loadMonitor() {
    api.get(`/pr/clients/${id}/searches`).then((r) => { setSearches(r.items || []); setSerperOn(r.serper_configured !== false); }).catch(() => {});
    api.get(`/pr/clients/${id}/review-queue`).then((r) => setQueue(r.items || [])).catch(() => {});
  }
  useEffect(() => { if (tab === 'coverage') loadMonitor(); }, [tab, id]);

  async function addSearch() {
    try {
      const sources = [newSearch.src_serper && 'serper', newSearch.src_alerts && 'alerts'].filter(Boolean);
      await api.post(`/pr/clients/${id}/searches`, { query: newSearch.query, sources, alerts_rss: newSearch.alerts_rss, cadence: newSearch.cadence });
      setNewSearch({ query: '', src_serper: true, src_alerts: false, alerts_rss: '', cadence: 'daily' });
      loadMonitor();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function runSearchNow(sid) {
    try {
      const r = await api.post(`/pr/searches/${sid}/run`, {});
      if (r.found > 0) toast(`Found ${r.found} new item(s)`, 'success');
      else if (r.uses_serper && r.serper_configured === false) toast('No results — add a Serper API key in Settings → October Outreach to enable Google News.', 'error');
      else toast('No new items found for this query.', 'warning');
      loadMonitor();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function deleteSearch(sid) {
    if (!window.confirm('Delete this search?')) return;
    try { await api.delete(`/pr/searches/${sid}`); loadMonitor(); } catch (e) { toast(e.message, 'error'); }
  }
  async function reviewItem(entryId, status) {
    try { await api.patch(`/pr/editorial-log/${entryId}`, { status }); loadMonitor(); loadData(); }
    catch (e) { toast(e.message, 'error'); }
  }
  useEffect(() => { api.get(`/pr/clients/${id}/report-settings`).then(setReports).catch(() => {}); }, [id]);

  async function saveReports() {
    setSavingReports(true);
    try { await api.patch(`/pr/clients/${id}/report-settings`, reports); toast('Report settings saved', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setSavingReports(false); }
  }
  async function sendReportNow() {
    try {
      const r = await api.post(`/pr/clients/${id}/send-report`, {});
      toast(r.sent ? `Report sent (${r.count} items)` : (r.skipped ? 'Nothing new to report' : 'Done'), r.sent ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
  }

  function loadData() {
    setLoading(true);
    Promise.all([
      api.get(`/pr/clients/${id}/stats`).then(setStats),
      api.get(`/pr/clients/${id}/editorial-log`).then((r) => setLog(r.items || [])),
      api.get(`/pr/clients/${id}/journalists`).then((r) => setJournalists(r.items || [])),
    ]).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }
  useEffect(() => { loadData(); }, [id]);
  // ESC closes whichever modal is open. Skip while a save is mid-flight so
  // the AM can't accidentally cancel an in-progress request.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (editing && !saving) setEditing(null);
      else if (thankDraft && !sendingThank) setThankDraft(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, saving, thankDraft, sendingThank]);
  // Load the secondary queues once on open so the Overview "needs attention"
  // badges are populated regardless of which tab is active.
  useEffect(() => { loadThanks(); loadMonitor(); loadReleases(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const quietCount = journalists.filter((j) => j.gone_quiet).length;
  const awaitingSignoff = releases.filter((r) => r.status === 'in_review').length;

  async function doImport(e, combined) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImporting(true);
    setCombinedResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (combined) {
        const r = await api.postForm('/pr/import', fd);
        toast(`Imported ${r.imported} rows · ${r.skipped} skipped`, 'success');
        if (r.unmatched && r.unmatched.length) setCombinedResult(r);
      } else {
        const r = await api.postForm(`/pr/clients/${id}/import`, fd);
        toast(`Imported ${r.imported} rows`, 'success');
      }
      loadData();
    } catch (err) { toast(err.message, 'error'); }
    finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
      if (combinedRef.current) combinedRef.current.value = '';
    }
  }

  function startEdit(row) {
    setEditing(row ? {
      id: row.id, story_title: row.story_title || '', press_contact: row.journalist || '',
      publication: row.outlet || '', country: row.country || '', status: row.status || 'pitched',
      issue_date: dateInput(row.issue_date), story_url: row.story_url || '', notes_outcome: row.notes_outcome || '',
      pitch_request: row.pitch_request || '',
      request_date: dateInput(row.request_date),
      interview_date: dateInput(row.interview_date),
      attachment_url: row.attachment_url || '',
      attachment_filename: row.attachment_filename || '',
    } : { ...BLANK });
  }

  async function saveEntry() {
    setSaving(true);
    try {
      const body = { ...editing };
      if (editing.id) await api.patch(`/pr/editorial-log/${editing.id}`, body);
      else await api.post(`/pr/clients/${id}/editorial-log`, body);
      toast('Saved', 'success');
      setEditing(null);
      loadData();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  const attachRef = useRef(null);
  const [attaching, setAttaching] = useState(false);
  async function uploadAttachment(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !editing?.id) return;
    setAttaching(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.postForm(`/pr/editorial-log/${editing.id}/attachment`, fd);
      setEditing((cur) => ({ ...cur, attachment_url: r.attachment_url, attachment_filename: r.attachment_filename }));
      toast('Attachment uploaded', 'success');
      loadData();
    } catch (err) { toast(err.message, 'error'); }
    finally {
      setAttaching(false);
      if (attachRef.current) attachRef.current.value = '';
    }
  }
  async function removeAttachment() {
    if (!editing?.id) return;
    if (!window.confirm('Remove the attached PDF?')) return;
    try {
      await api.delete(`/pr/editorial-log/${editing.id}/attachment`);
      setEditing((cur) => ({ ...cur, attachment_url: '', attachment_filename: '' }));
      toast('Attachment removed', 'success');
      loadData();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function checkLinks() {
    setCheckingLinks(true);
    try {
      const r = await api.post(`/pr/clients/${id}/check-links`, {});
      const parts = [`Checked ${r.checked}`];
      if (r.broken) parts.push(`${r.broken} broken`);
      if (r.uncertain) parts.push(`${r.uncertain} uncertain`);
      toast(parts.join(' · '), r.broken ? 'error' : 'success');
      loadData();
    } catch (err) { toast(err.message, 'error'); }
    finally { setCheckingLinks(false); }
  }

  async function copyPortalLink() {
    try {
      const { token } = await api.get(`/pr/clients/${id}/portal`);
      const url = `${window.location.origin}/coverage/${token}`;
      try { await navigator.clipboard.writeText(url); toast('Client coverage link copied to clipboard', 'success'); }
      catch { window.prompt('Client coverage link:', url); }
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteEntry(row) {
    if (!window.confirm('Delete this entry?')) return;
    try { await api.delete(`/pr/editorial-log/${row.id}`); loadData(); }
    catch (err) { toast(err.message, 'error'); }
  }

  const f = editing || {};
  const setF = (k, v) => setEditing((e) => ({ ...e, [k]: v }));

  const renderShare = () => (
        <div className="card">
          <h3 className="h3 mb-2">Automated reports &amp; alerts</h3>
          <p style={{ color: 'var(--text-subtle)', fontSize: 13, marginBottom: 10 }}>Email the client a coverage digest on a schedule, and a "you've been featured" alert when a piece is marked published.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}><span className="field-label">Report / alert email</span><input className="input" value={reports.alert_email || ''} onChange={(e) => setReports((r) => ({ ...r, alert_email: e.target.value }))} placeholder="client@example.com" /></label>
            <label className="field" style={{ marginBottom: 0 }}><span className="field-label">Cadence</span><select className="input" value={reports.report_cadence || 'off'} onChange={(e) => setReports((r) => ({ ...r, report_cadence: e.target.value }))}><option value="off">Off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <button className="btn btn-primary" disabled={savingReports} onClick={saveReports}>{savingReports ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: sendReportNow })}>Send report now</button>
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--card-border, #e5e7eb)', paddingTop: 16 }}>
            <button className="btn-link" onClick={copyPortalLink}>🔗 Copy client coverage link</button>
            <p style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 8, marginBottom: 0 }}>A public, read-only page of this client's published coverage — no login needed.</p>
          </div>
        </div>
  );

  const renderReleases = () => (
        <div className="card">
          {pr ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h3 className="h3" style={{ margin: 0 }}>{pr.title || 'New press release'}</h3>
                <button className="btn btn-secondary btn-sm" onClick={() => { setPr(null); loadReleases(); }}>← All releases</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label className="field"><span className="field-label">Headline / working title</span><input className="input" value={pr.title || ''} onChange={(e) => setPr((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Forgeworks unveils House of Wood Shingle" /></label>
                <label className="field"><span className="field-label">Brand</span><input className="input" value={pr.brand || ''} onChange={(e) => setPr((p) => ({ ...p, brand: e.target.value }))} /></label>
                <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Angle / why it's newsworthy</span><textarea className="input" rows={2} value={pr.angle || ''} onChange={(e) => setPr((p) => ({ ...p, angle: e.target.value }))} placeholder="The hook a journalist would care about." /></label>
                <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Key facts</span><textarea className="input" rows={4} value={pr.key_facts || ''} onChange={(e) => setPr((p) => ({ ...p, key_facts: e.target.value }))} placeholder="Who, what, where, when, numbers, quotes…" /></label>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }}>
                <button className="btn btn-primary" {...roWrite(readOnly, { onClick: draftPR, disabled: prDrafting })}>{prDrafting ? 'Writing…' : '✍️ Draft with Claude'}</button>
                <label className="field"><span className="field-label">Status</span><select className="input" value={pr.status || 'draft'} onChange={(e) => setPr((p) => ({ ...p, status: e.target.value }))}><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="sent">Sent</option></select></label>
                <label className="field"><span className="field-label">Embargo until (optional)</span><input className="input" type="datetime-local" value={pr.embargo_at ? new Date(pr.embargo_at).toISOString().slice(0, 16) : ''} onChange={(e) => setPr((p) => ({ ...p, embargo_at: e.target.value }))} /></label>
                <label className="field" style={{ flex: 1, minWidth: 200 }}><span className="field-label">Published URL (once live)</span><input className="input" value={pr.url || ''} onChange={(e) => setPr((p) => ({ ...p, url: e.target.value }))} placeholder="https://…" /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                <button className="btn btn-secondary" onClick={copyReviewLink}>🔗 Client approval link</button>
                {pr.approved_at && <span className="chip chip-accent">✓ Approved by {pr.approved_by || 'client'}</span>}
                {['approved', 'sent'].includes(pr.status) && (
                  <button className="btn btn-primary" {...roWrite(readOnly, { onClick: createPitchCampaign, title: 'Pitch this release to journalists in the Email tab' })}>{pr.campaign_id ? 'Open pitch campaign →' : '📣 Create pitch campaign →'}</button>
                )}
              </div>
              <label className="field"><span className="field-label">Release body <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>— Claude marks assumptions in [brackets] to fill in</span></span><textarea className="input" rows={16} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} value={pr.body_html || ''} onChange={(e) => setPr((p) => ({ ...p, body_html: e.target.value }))} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary" disabled={prSaving} onClick={() => savePR()}>{prSaving ? 'Saving…' : 'Save'}</button>
                <button className="btn btn-secondary" onClick={() => { setPr(null); loadReleases(); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <p style={{ color: 'var(--text-subtle)', fontSize: 13, margin: 0 }}>Write a release from a brief, have Claude draft it, then send a client approval link for sign-off.</p>
                <button className="btn btn-primary" onClick={newRelease}>+ New press release</button>
              </div>
              <table className="table">
                <thead><tr><th>Title</th><th>Brand</th><th>Status</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.id}>
                      <td><button className="link-btn" onClick={() => openRelease(r.id)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}>{r.title || '(untitled)'}</button></td>
                      <td>{r.brand || '—'}</td>
                      <td><span className="chip">{({ draft: 'Draft', in_review: 'In review', approved: 'Approved', sent: 'Sent' })[r.status] || r.status}</span></td>
                      <td>{fmtDate(r.created_at)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openRelease(r.id)}>Edit</button>{' '}
                        <button className="btn btn-danger btn-sm" onClick={() => deletePR(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!releases.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No press releases yet. Start from a brief and let Claude draft the release.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
  );

  const renderPitch = () => (
        <div>
          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <h3 className="h3 mb-2">✨ Who should I pitch this to?</h3>
            <p style={{ color: 'var(--text-subtle)', fontSize: 13, marginBottom: 10 }}>Paste a press-release URL or a short brief — Claude mines your contacts' beats and your relationship history to build a targeted list.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
              <label className="field" style={{ flex: 1, minWidth: 240 }}><span className="field-label">Press release URL</span><input className="input" value={pitch.url} onChange={(e) => setPitch((p) => ({ ...p, url: e.target.value }))} placeholder="https://…" /></label>
              <button className="btn btn-primary" {...roWrite(readOnly, { onClick: findTargets, disabled: pitchLoading })}>{pitchLoading ? 'Finding…' : 'Find journalists'}</button>
            </div>
            <label className="field"><span className="field-label">…or paste a brief</span><textarea className="input" rows={2} value={pitch.brief} onChange={(e) => setPitch((p) => ({ ...p, brief: e.target.value }))} placeholder="What's the story?" /></label>
            {pitchResult && (
              <div style={{ marginTop: 12 }}>
                {pitchResult.angle && <p style={{ fontSize: 13, marginBottom: 8 }}><strong>Angle:</strong> {pitchResult.angle}</p>}
                {pitchResult.targets && pitchResult.targets.length ? (
                  <table className="table">
                    <thead><tr><th>Journalist</th><th>Outlet</th><th>Tier</th><th>Why</th></tr></thead>
                    <tbody>
                      {pitchResult.targets.map((t) => (
                        <tr key={t.id}>
                          <td><Link to={`/media/journalist/${t.id}`}>{t.name}</Link>{t.strength_label ? <span className="chip" style={{ marginLeft: 6 }}>{t.strength_label}</span> : null}{t.has_email ? null : <span className="chip" style={{ marginLeft: 6 }}>no email</span>}</td>
                          <td>{t.outlet || '—'}</td>
                          <td>{t.tier ? `T${t.tier}` : '—'}</td>
                          <td style={{ fontSize: 13 }}>{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{pitchResult.note || 'No strong matches found.'}</p>}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <table className="table">
              <thead><tr><th>Journalist</th><th>Outlet</th><th>Tier</th><th>Published</th><th>Hit rate</th><th>Last featured</th><th>Relationship</th></tr></thead>
              <tbody>
                {journalists.map((j) => (
                  <tr key={j.id}>
                    <td><Link to={`/media/journalist/${j.id}`}>{j.name}</Link></td>
                    <td>{j.outlet || '—'}</td>
                    <td>{j.tier ? <span className="chip">T{j.tier}</span> : '—'}</td>
                    <td>{j.published}</td>
                    <td>{j.hit_rate == null ? '—' : Math.round(j.hit_rate * 100) + '%'}</td>
                    <td>{fmtDate(j.last_featured)}</td>
                    <td><span className="chip chip-accent">{j.strength} · {j.strength_label}</span>{j.gone_quiet ? <span className="chip" style={{ marginLeft: 6 }}>quiet</span> : null}</td>
                  </tr>
                ))}
                {!journalists.length && <tr><td colSpan={7} style={{ color: 'var(--text-subtle)', padding: 24 }}>No journalists have covered {client?.name || 'this client'} yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h3 className="h3 mb-2">Thank-yous</h3>
                <p style={{ color: 'var(--text-subtle)', fontSize: 13, margin: 0 }}>
                  Journalists who featured {client?.name || 'this client'} and have a real email on file but haven't been thanked yet. Claude drafts a fresh, never-repeating note — review and send.
                </p>
              </div>
              {thankSettings && (
                <label className="field" style={{ minWidth: 280 }}>
                  <span className="field-label">Auto-send</span>
                  <select className="input" value={thankSettings.thank_stage || 'assist'} onChange={(e) => setThankStage(e.target.value)}>
                    {Object.entries(thankSettings.stages || { assist: 'Assisted — I approve every send' }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              )}
            </div>
            {thankSettings && thankSettings.record && (thankSettings.record.approved + thankSettings.record.edited + thankSettings.record.rejected + thankSettings.record.auto > 0) && (
              <p style={{ color: 'var(--text-subtle)', fontSize: 12, marginBottom: 12 }}>
                Track record: {thankSettings.record.approved} approved · {thankSettings.record.edited} edited · {thankSettings.record.auto} auto-sent · {thankSettings.record.rejected} skipped.
                {thankSettings.thank_stage === 'assist' ? ' Once the approvals build up, switch on supervised or auto sending above.' : ''}
              </p>
            )}
            <table className="table">
              <thead><tr><th>Journalist</th><th>Publication</th><th>Story</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {thanks.map((r) => (
                  <tr key={r.id}>
                    <td>{r.journalist || '—'}</td>
                    <td>{r.outlet || '—'}</td>
                    <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
                    <td>{fmtDate(r.issue_date)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" {...roWrite(readOnly, { onClick: () => openDraft(r) })}>Draft thank-you</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => skipThank(r)}>Skip</button>
                    </td>
                  </tr>
                ))}
                {!thanks.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No thank-yous waiting. They appear here once a piece is marked Published and the journalist has an email on file.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
  );

  const renderTrack = () => (
        <div>
          {/* One primary action, one secondary; the CSV imports fold into a
              single menu and the utilities become quiet links, so the row
              reads as a clear hierarchy rather than six equal pills. */}
          <input ref={fileRef} type="file" accept=".csv" onChange={(e) => doImport(e, false)} style={{ display: 'none' }} />
          <input ref={combinedRef} type="file" accept=".csv" onChange={(e) => doImport(e, true)} style={{ display: 'none' }} />
          <div className="row between center wrap" style={{ gap: 12, marginBottom: 'var(--s4)' }}>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={() => startEdit(null)}>+ Add entry</button>
              <button className="btn btn-secondary" onClick={() => setUrlModal(true)} title="Paste a coverage URL — AI pulls the publication, journalist, headline and date, then asks to merge with a pending pitch or log as new">🔗 From a link</button>
              <div className="menu-anchor" ref={importMenuRef}>
                <button className="btn btn-secondary" disabled={importing} aria-haspopup="menu" aria-expanded={importOpen}
                  onClick={() => setImportOpen(o => !o)}>{importing ? 'Importing…' : '↑ Import ▾'}</button>
                {importOpen && (
                  <div className="menu-panel" role="menu">
                    <button role="menuitem" className="menu-item" disabled={importing}
                      onClick={() => { setImportOpen(false); fileRef.current && fileRef.current.click(); }}>
                      This client
                      <span className="menu-item-sub">Import a CSV editorial log for {client?.name || 'this client'}</span>
                    </button>
                    <button role="menuitem" className="menu-item" disabled={importing}
                      onClick={() => { setImportOpen(false); combinedRef.current && combinedRef.current.click(); }}>
                      Combined — all clients
                      <span className="menu-item-sub">Routes each row to the matching client by the CSV's Client column</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="row" style={{ gap: 16, alignItems: 'center' }}>
              <button className="btn-link" onClick={copyPortalLink} title="Copy the read-only public coverage URL for sharing with the client">🔗 Copy coverage link</button>
              <button className="btn-link" disabled={checkingLinks} onClick={checkLinks} title="HEAD every story URL — flags 404s and DNS failures so you can hunt for the new link">{checkingLinks ? 'Checking…' : '🔍 Check links'}</button>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 'var(--s4)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="caption" style={{ marginRight: 4 }}>Status</span>
            <div className="filter-bar">
              {[['all', 'All'], ...STATUSES].map(([v, l]) => {
                const count = v === 'all' ? log.length : log.filter(r => r.status === v).length;
                return (
                  <button key={v} type="button" onClick={() => setCoverageFilter(v)}
                    className={`filter-tab ${coverageFilter === v ? 'active' : ''}`}>
                    {l}<span className="tab-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            <input
              className="input"
              style={{ width: 'auto', minWidth: 200 }}
              value={coverageQuery}
              onChange={(e) => setCoverageQuery(e.target.value)}
              placeholder="Search coverage…"
              aria-label="Search coverage"
            />
            <span className="caption">Sort</span>
            <select className="input" style={{ width: 'auto' }} value={coverageSort} onChange={(e) => setCoverageSort(e.target.value)}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="outlet">Publication A→Z</option>
              <option value="journalist">Journalist A→Z</option>
            </select>
          </div>

          {combinedResult && (
            <div className="card" style={{ marginBottom: 'var(--s4)', borderLeft: '3px solid var(--accent)' }}>
              <strong>{combinedResult.skipped} rows skipped.</strong> Unmatched client names (no platform client with that name):
              <div style={{ marginTop: 6, color: 'var(--text-subtle)', fontSize: 13 }}>{combinedResult.unmatched.join(', ')}</div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <table className="table">
              <thead><tr>
                <th>Publication</th><th>Country</th><th>Journalist</th><th>Status</th>
                <th>Issue</th><th>Request</th><th>Interview</th><th>Story</th><th></th>
              </tr></thead>
              <tbody>
                {(() => {
                  const q = coverageQuery.trim().toLowerCase();
                  const filtered = log.filter(r => {
                    if (coverageFilter !== 'all' && r.status !== coverageFilter) return false;
                    if (!q) return true;
                    return [r.outlet, r.journalist, r.story_title, r.story_url, r.country, r.notes_outcome, r.status_label]
                      .some(v => v && String(v).toLowerCase().includes(q));
                  });
                  const sorted = [...filtered].sort((a, b) => {
                    if (coverageSort === 'date_asc') return new Date(a.issue_date || 0) - new Date(b.issue_date || 0);
                    if (coverageSort === 'outlet') return (a.outlet || '').localeCompare(b.outlet || '');
                    if (coverageSort === 'journalist') return (a.journalist || '').localeCompare(b.journalist || '');
                    return new Date(b.issue_date || 0) - new Date(a.issue_date || 0);
                  });
                  if (!sorted.length) return (
                    <tr><td colSpan={9} style={{ color: 'var(--text-subtle)', padding: 24 }}>
                      {log.length ? (q ? `No coverage matches “${coverageQuery.trim()}”.` : `No coverage matches "${coverageFilter}".`) : 'No coverage yet. Add an entry, or import your editorial log CSV.'}
                    </td></tr>
                  );
                  return sorted.map((r) => (
                    <tr key={r.id}>
                      <td title={r.outlet || ''}>{r.outlet || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.country || '—'}</td>
                      <td title={r.journalist || ''}>{r.journalist || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}><StatusPill status={r.status} label={r.status_label || r.status} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.issue_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.request_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.interview_date)}</td>
                      <td>
                        {r.story_url
                          ? <a
                              href={r.story_url} target="_blank" rel="noreferrer"
                              style={linkStyleFor(r.link_status) || undefined}
                              title={linkTitleFor(r.link_status, r.link_status_code, r.link_checked_at, r.link_final_url) || r.story_title || r.story_url}
                            >{r.story_title || 'View'}{r.link_status === 'broken' ? ' ⚠' : r.link_status === 'uncertain' ? ' ?' : ''}</a>
                          : (r.story_title || '—')}
                        {r.attachment_url ? <> · <a href={r.attachment_url} target="_blank" rel="noreferrer" title={r.attachment_filename || 'Attached PDF'}>📎 PDF</a></> : null}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button>{' '}
                        <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(r)}>Delete</button>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3 className="h3 mb-2">Coverage monitor</h3>
            <p style={{ color: 'var(--text-subtle)', fontSize: 13, marginBottom: 12 }}>
              Saved searches check Google News (via Serper) and your Google Alerts RSS on a schedule (twice daily). New hits land in the review queue below for you to confirm or dismiss.
            </p>
            {!serperOn && (
              <div className="card" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 13, marginBottom: 12, padding: '10px 12px' }}>
                <strong>Google News is off.</strong> No Serper API key is set, so News searches return nothing — add one in <strong>Settings → October Outreach</strong>. Google Alerts RSS searches still work without it.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <label className="field" style={{ flex: 1, minWidth: 200 }}><span className="field-label">Google News query</span><input className="input" value={newSearch.query} onChange={(e) => setNewSearch((s) => ({ ...s, query: e.target.value }))} placeholder='e.g. "Forgeworks" architecture' /></label>
              <label className="field" style={{ minWidth: 220 }}><span className="field-label">Google Alerts RSS (optional)</span><input className="input" value={newSearch.alerts_rss} onChange={(e) => setNewSearch((s) => ({ ...s, alerts_rss: e.target.value }))} placeholder="https://www.google.com/alerts/feeds/…" /></label>
              <label className="field"><span className="field-label">Frequency</span><select className="input" value={newSearch.cadence} onChange={(e) => setNewSearch((s) => ({ ...s, cadence: e.target.value }))}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
              <button className="btn btn-primary" onClick={addSearch}>Add search</button>
            </div>
            <table className="table" style={{ marginBottom: 24 }}>
              <thead><tr><th>Query</th><th>Sources</th><th>Frequency</th><th>Last run</th><th></th></tr></thead>
              <tbody>
                {searches.map((s) => (
                  <tr key={s.id}>
                    <td>{s.query || '—'}</td>
                    <td>{(s.sources || '').replace('serper', 'News').replace('alerts', 'Alerts')}</td>
                    <td>{s.cadence}</td>
                    <td>{s.last_run_at ? fmtDate(s.last_run_at) : 'never'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: () => runSearchNow(s.id) })}>Run now</button>{' '}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteSearch(s.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!searches.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No saved searches. Add one above — it checks Google News + your Alerts feed on a schedule.</td></tr>}
              </tbody>
            </table>

            <h3 className="h3 mb-2">Review queue {queue.length ? `(${queue.length})` : ''}</h3>
            <table className="table">
              <thead><tr><th>Publication</th><th>Story</th><th>Date</th><th>Source</th><th></th></tr></thead>
              <tbody>
                {queue.map((r) => (
                  <tr key={r.id}>
                    <td>{r.outlet || '—'}</td>
                    <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 70)}</a> : (r.story_title || '—')}</td>
                    <td>{fmtDate(r.issue_date)}</td>
                    <td>{r.source === 'alerts' ? 'Alerts' : 'News'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => reviewItem(r.id, 'published')}>✓ Confirm</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => reviewItem(r.id, 'dismissed')}>Dismiss</button>
                    </td>
                  </tr>
                ))}
                {!queue.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>Nothing awaiting review. Run a search or wait for the scheduled check.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
  );

  // Redesign spine (docs/omi/redesign-brief.md §3): Overview + Health + Build.
  // Health (read-outs) = Track + Share; Build (make & ship) = Pitch + Releases.
  // Accordions are tab-driven — opening a section sets the underlying tab so the
  // existing lazy-load effects (coverage monitor, releases) still fire.
  const HEALTH_SECTIONS = [
    { id: 'track', tab: 'coverage', fn: 'measure',    title: 'Track', sub: 'Coverage log & auto-monitor', render: renderTrack },
    { id: 'share', tab: 'reports',  fn: 'distribute', title: 'Share', sub: 'Client digests & live coverage', render: renderShare },
  ];
  const BUILD_SECTIONS = [
    { id: 'pitch',    tab: 'journalists', fn: 'research', title: 'Pitch',    sub: 'Media database & targeting', render: renderPitch },
    { id: 'releases', tab: 'press',       fn: 'create',   title: 'Releases', sub: 'Draft, sign-off & pitch', render: renderReleases },
  ];
  const TAB_SECTION = { coverage: 'track', reports: 'share', journalists: 'pitch', press: 'releases' };
  const suiteGroup = tab === 'overview' ? 'overview'
    : (tab === 'coverage' || tab === 'reports') ? 'health'
    : (tab === 'journalists' || tab === 'press') ? 'build'
    : 'overview';

  return (
    <div className="suite-client-pr">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Earned</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="display">Earned</h1>
      </header>

      {/* Tab labels show natural totals (coverage rows / journalist heads)
          rather than workflow-queue counts — the previous "(N)" badges on
          Coverage and Journalists were the number of items in the
          auto-monitor queue and the unsent-thank-yous list respectively,
          which read as "Journalists (2)" but meant "2 thank-yous pending"
          and was confusing. Workflow nudges are surfaced on the Overview
          page's "needs attention" rail instead. */}
      <SuiteTabs tabs={[
        { key: 'overview', label: 'Overview', active: suiteGroup === 'overview', onClick: () => setTab('overview') },
        { key: 'health',   label: 'Health',   fn: 'measure', active: suiteGroup === 'health',   onClick: () => setTab('coverage') },
        { key: 'build',    label: 'Build',    fn: 'create',  active: suiteGroup === 'build',    onClick: () => setTab('journalists') },
      ]} />

      {loading && <div className="card"><p style={{ color: 'var(--text-subtle)', padding: 24 }}>Loading…</p></div>}

      {!loading && suiteGroup === 'health' && (
        <Accordion open={new Set([TAB_SECTION[tab] || 'track'])} onToggle={(sid) => setTab(HEALTH_SECTIONS.find(s => s.id === sid).tab)}>
          {HEALTH_SECTIONS.map(s => (
            <AccordionItem key={s.id} id={s.id} fn={s.fn} title={s.title} subtitle={s.sub}>{s.render}</AccordionItem>
          ))}
        </Accordion>
      )}

      {!loading && suiteGroup === 'build' && (
        <Accordion open={new Set([TAB_SECTION[tab] || 'pitch'])} onToggle={(sid) => setTab(BUILD_SECTIONS.find(s => s.id === sid).tab)}>
          {BUILD_SECTIONS.map(s => (
            <AccordionItem key={s.id} id={s.id} fn={s.fn} title={s.title} subtitle={s.sub}>{s.render}</AccordionItem>
          ))}
        </Accordion>
      )}

      {!loading && tab === 'overview' && (
        <div className="stack stack-lg">
          <SuiteOverview
            tagline="Never pitch from memory — or lose a hit — again."
            description="Every pitch, placement and journalist relationship in one log. Coverage records itself from a link, your best targets come ranked, and the client gets a live page of their wins."
            ctaLabel="Find who to pitch"
            onCta={() => setTab('journalists')}
            status={[
              { label: 'Published', value: stats ? String(stats.published) : '—', ok: !!(stats && stats.published) },
              { label: 'Tracked', value: stats ? String(stats.tracked) : '—', ok: !!(stats && stats.tracked) },
              { label: 'Journalists', value: stats ? String(stats.journalists) : '—', ok: !!(stats && stats.journalists) },
            ]}
            actions={<>
              <button className="btn btn-primary" onClick={() => { setTab('coverage'); startEdit(null); }}>+ Log coverage</button>
              <button className="btn btn-secondary" onClick={() => { setTab('press'); newRelease(); }}>+ Press release</button>
              <a className="btn btn-secondary" href={`/api/pr/clients/${id}/overview-report.pdf`} download>📄 Export Overview PDF</a>
            </>}
            interstitial={<>
              <SuiteReadiness clientId={id} suite="earned_setup" title="PR pipeline" steps={[
                { key: 'contacts',  title: 'Contacts',  sub: 'Journalists on file', onClick: () => setTab('journalists') },
                { key: 'pitched',   title: 'Pitched',   sub: 'Stories out the door', onClick: () => setTab('journalists') },
                { key: 'published', title: 'Published', sub: 'Coverage logged',      onClick: () => setTab('coverage') },
                { key: 'thanked',   title: 'Thanked',   sub: 'Relationships kept',   onClick: () => setTab('journalists') },
              ]} />
              <div className="card">
                <h3 className="h3 mb-2">Needs attention</h3>
                {(queue.length || thanks.length || awaitingSignoff || quietCount) ? (
                  <div className="task-row">
                    {queue.length ? <button className="task-chip" onClick={() => setTab('coverage')}>🔎 <span><span className="n">{queue.length}</span> coverage item{queue.length === 1 ? '' : 's'} to confirm</span></button> : null}
                    {thanks.length ? <button className="task-chip" onClick={() => setTab('journalists')}>🟡 <span><span className="n">{thanks.length}</span> thank-you{thanks.length === 1 ? '' : 's'} waiting</span></button> : null}
                    {awaitingSignoff ? <button className="task-chip" onClick={() => setTab('press')}>✍️ <span><span className="n">{awaitingSignoff}</span> release{awaitingSignoff === 1 ? '' : 's'} awaiting sign-off</span></button> : null}
                    {quietCount ? <button className="task-chip" onClick={() => setTab('journalists')}>📉 <span><span className="n">{quietCount}</span> key journalist{quietCount === 1 ? '' : 's'} gone quiet</span></button> : null}
                  </div>
                ) : <p style={{ color: 'var(--text-subtle)', fontSize: 13, margin: 0 }}>All clear — nothing needs you right now.</p>}
              </div>
            </>}
            mapLayout="grid"
            map={[
              { title: 'Health', subtitle: 'Coverage, monitoring & what the client sees', nodes: [
                { label: 'Coverage log',   onClick: () => setTab('coverage') },
                { label: 'Auto monitor',   onClick: () => setTab('coverage') },
                { label: 'Link checks',    onClick: () => setTab('coverage') },
                { label: 'Client digests', onClick: () => setTab('reports') },
                { label: 'Live coverage',  onClick: () => setTab('reports') },
              ] },
              { title: 'Build', subtitle: 'Media targeting → release → pitch', nodes: [
                { label: 'Media DB',        onClick: () => setTab('journalists') },
                { label: 'Pitch targeting', onClick: () => setTab('journalists') },
                { label: 'Thank-yous',      onClick: () => setTab('journalists') },
                { label: 'Draft release',   onClick: () => setTab('press') },
                { label: 'Sign-off',        onClick: () => setTab('press') },
                { label: 'Pitch',           onClick: () => setTab('press') },
              ] },
            ]}
          />
        </div>
      )}





      {editing && (
        <div className="modal-backdrop" onClick={() => !saving && setEditing(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{editing.id ? 'Edit entry' : 'New entry'}</h2>
              <button type="button" onClick={() => setEditing(null)} className="modal-close" aria-label="Close">×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="field"><span className="field-label">Story title</span><input className="input" value={f.story_title} onChange={(e) => setF('story_title', e.target.value)} /></label>
              <label className="field"><span className="field-label">Status</span><select className="input" value={f.status} onChange={(e) => setF('status', e.target.value)}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="field"><span className="field-label">Press contact</span><input className="input" value={f.press_contact} onChange={(e) => setF('press_contact', e.target.value)} placeholder="Journalist name" /></label>
              <label className="field"><span className="field-label">Publication</span><input className="input" value={f.publication} onChange={(e) => setF('publication', e.target.value)} /></label>
              <label className="field"><span className="field-label">Country</span><input className="input" value={f.country} onChange={(e) => setF('country', e.target.value)} /></label>
              <label className="field"><span className="field-label">Issue date</span><input className="input" type="date" value={f.issue_date} onChange={(e) => setF('issue_date', e.target.value)} /></label>
              <label className="field"><span className="field-label">Request date</span><input className="input" type="date" value={f.request_date} onChange={(e) => setF('request_date', e.target.value)} /></label>
              <label className="field"><span className="field-label">Interview date</span><input className="input" type="date" value={f.interview_date} onChange={(e) => setF('interview_date', e.target.value)} /></label>
              <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Story URL</span><input className="input" value={f.story_url} onChange={(e) => setF('story_url', e.target.value)} placeholder="https://…" /></label>
              <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Pitch / request</span><textarea className="input" rows={2} value={f.pitch_request} onChange={(e) => setF('pitch_request', e.target.value)} placeholder="What the journalist asked for, or your original pitch angle" /></label>
              <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Notes / outcome (internal)</span><textarea className="input" rows={2} value={f.notes_outcome} onChange={(e) => setF('notes_outcome', e.target.value)} /></label>
              <div className="field" style={{ gridColumn: '1/-1' }}>
                <span className="field-label">Attachment (PDF — magazine scan, cutout, advance copy)</span>
                {editing.id ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {f.attachment_url ? (
                      <>
                        <a href={f.attachment_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">📎 {f.attachment_filename || 'View PDF'}</a>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={removeAttachment}>Remove</button>
                      </>
                    ) : (
                      <>
                        <input ref={attachRef} type="file" accept="application/pdf,.pdf" onChange={uploadAttachment} style={{ display: 'none' }} />
                        <button className="btn btn-secondary btn-sm" type="button" disabled={attaching} onClick={() => attachRef.current && attachRef.current.click()}>{attaching ? 'Uploading…' : '↑ Attach PDF'}</button>
                        <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>For coverage that only exists in print.</span>
                      </>
                    )}
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>Save the entry first, then re-open to attach a PDF.</span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveEntry}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {thankDraft && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => !sendingThank && setThankDraft(null)}>
          <div className="card" style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="h3 mb-2">Thank {thankDraft.journalist || 'journalist'}{thankDraft.outlet ? ` · ${thankDraft.outlet}` : ''}</h3>
            {drafting ? (
              <p style={{ color: 'var(--text-subtle)', padding: 24 }}>Drafting…</p>
            ) : (
              <>
                {thankDraft.tone || thankDraft.confidence ? (
                  <p style={{ color: 'var(--text-subtle)', fontSize: 12, marginBottom: 10 }}>
                    {thankDraft.tone ? <>Tone: <strong>{thankDraft.tone}</strong>. </> : null}
                    {thankDraft.confidence ? <>Claude confidence: <strong>{Math.round(thankDraft.confidence * 100)}%</strong></> : null}
                  </p>
                ) : null}
                {!thankDraft.to && <div className="card" style={{ borderLeft: '3px solid var(--accent)', marginBottom: 10, fontSize: 13 }}>No real email on file for this journalist — can't send.</div>}
                <label className="field" style={{ marginBottom: 10 }}><span className="field-label">To</span><input className="input" value={thankDraft.to} readOnly placeholder="—" /></label>
                <label className="field" style={{ marginBottom: 10 }}><span className="field-label">Subject</span><input className="input" value={thankDraft.subject} onChange={(e) => setThankDraft((t) => ({ ...t, subject: e.target.value, edited: true }))} /></label>
                <label className="field" style={{ marginBottom: 10 }}><span className="field-label">Message</span><textarea className="input" rows={8} value={thankDraft.body} onChange={(e) => setThankDraft((t) => ({ ...t, body: e.target.value, edited: true }))} /></label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" disabled={sendingThank} onClick={() => setThankDraft(null)}>Cancel</button>
                  <button className="btn btn-primary" {...roWrite(readOnly, { onClick: sendThank, disabled: sendingThank || !thankDraft.to || !thankDraft.subject || !thankDraft.body })}>{sendingThank ? 'Sending…' : 'Send thank-you'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {urlModal && (
        <CoverageFromUrlModal clientId={id} onClose={() => setUrlModal(false)} onSaved={() => { loadData(); }} />
      )}
    </div>
  );
}
