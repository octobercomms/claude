import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUSES = [
  ['pitched', 'Pitched'], ['pending', 'Pending'], ['no_response', 'No Response'],
  ['confirmed', 'Confirmed'], ['interview_prep', 'Interview Prep'], ['download', 'Download'],
  ['published', 'Published'], ['declined', 'Declined'],
];
const BLANK = { story_title: '', press_contact: '', publication: '', country: '', status: 'pitched', issue_date: '', story_url: '', notes_outcome: '' };

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
  const [saving, setSaving] = useState(false);
  const [combinedResult, setCombinedResult] = useState(null);
  const [showReports, setShowReports] = useState(false);
  const [reports, setReports] = useState({ alert_email: '', report_cadence: 'off' });
  const [savingReports, setSavingReports] = useState(false);
  const [searches, setSearches] = useState([]);
  const [queue, setQueue] = useState([]);
  const [newSearch, setNewSearch] = useState({ query: '', src_serper: true, src_alerts: false, alerts_rss: '', cadence: 'daily' });
  const [thanks, setThanks] = useState([]);
  const [thankDraft, setThankDraft] = useState(null); // null | { entryId, to, subject, body, tone, confidence, edited }
  const [drafting, setDrafting] = useState(false);
  const [sendingThank, setSendingThank] = useState(false);
  const [thankSettings, setThankSettings] = useState(null); // { thank_stage, stages, record }
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
    api.get(`/pr/clients/${id}/searches`).then((r) => setSearches(r.items || [])).catch(() => {});
    api.get(`/pr/clients/${id}/review-queue`).then((r) => setQueue(r.items || [])).catch(() => {});
  }
  useEffect(() => { if (tab === 'monitor') loadMonitor(); }, [tab, id]);

  async function addSearch() {
    try {
      const sources = [newSearch.src_serper && 'serper', newSearch.src_alerts && 'alerts'].filter(Boolean);
      await api.post(`/pr/clients/${id}/searches`, { query: newSearch.query, sources, alerts_rss: newSearch.alerts_rss, cadence: newSearch.cadence });
      setNewSearch({ query: '', src_serper: true, src_alerts: false, alerts_rss: '', cadence: 'daily' });
      loadMonitor();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function runSearchNow(sid) {
    try { const r = await api.post(`/pr/searches/${sid}/run`, {}); toast(`Found ${r.found} new item(s)`, 'success'); loadMonitor(); }
    catch (e) { toast(e.message, 'error'); }
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
  const linkRow = { background: 'none', border: 'none', textAlign: 'left', color: 'var(--accent)', cursor: 'pointer', padding: '2px 0', font: 'inherit', fontSize: 14 };

  return (
    <div className="suite-client-pr">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Press coverage &amp; journalists</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="display">PR</h1>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--s4)', flexWrap: 'wrap' }}>
        {[['overview', 'Overview'], ['coverage', 'Coverage'], ['journalists', 'Journalists'], ['press', 'Press releases'], ['reports', 'Reports']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} className={'btn ' + (tab === v ? 'btn-primary' : 'btn-secondary')}>
            {l}{v === 'coverage' && queue.length ? ` (${queue.length})` : ''}{v === 'journalists' && thanks.length ? ` (${thanks.length})` : ''}
          </button>
        ))}
      </div>

      {loading && <div className="card"><p style={{ color: 'var(--text-subtle)', padding: 24 }}>Loading…</p></div>}

      {!loading && tab === 'overview' && (
        <div>
          <div className="card" style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
            <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.published : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Published</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.tracked : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Tracked</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.journalists : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Journalists</div></div>
          </div>

          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <h3 className="h3 mb-2">Needs attention</h3>
            {(queue.length || thanks.length || awaitingSignoff || quietCount) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                {queue.length ? <button onClick={() => setTab('coverage')} style={linkRow}>🔎 {queue.length} coverage item{queue.length === 1 ? '' : 's'} to confirm</button> : null}
                {thanks.length ? <button onClick={() => setTab('journalists')} style={linkRow}>🟡 {thanks.length} thank-you{thanks.length === 1 ? '' : 's'} waiting</button> : null}
                {awaitingSignoff ? <button onClick={() => setTab('press')} style={linkRow}>✍️ {awaitingSignoff} release{awaitingSignoff === 1 ? '' : 's'} awaiting sign-off</button> : null}
                {quietCount ? <button onClick={() => setTab('journalists')} style={linkRow}>📉 {quietCount} key journalist{quietCount === 1 ? '' : 's'} gone quiet</button> : null}
              </div>
            ) : <p style={{ color: 'var(--text-subtle)', fontSize: 13, margin: 0 }}>All clear — nothing needs you right now.</p>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
            <button className="btn btn-primary" onClick={() => { setTab('coverage'); startEdit(null); }}>+ Log coverage</button>
            <button className="btn btn-secondary" onClick={() => { setTab('press'); newRelease(); }}>+ Press release</button>
            <button className="btn btn-secondary" onClick={() => setTab('reports')}>✉ Reports &amp; portal</button>
          </div>

          <div className="card">
            <h3 className="h3 mb-2">Recent coverage</h3>
            <table className="table">
              <thead><tr><th>Publication</th><th>Journalist</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
              <tbody>
                {log.slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td>{r.outlet || '—'}</td>
                    <td>{r.journalist || '—'}</td>
                    <td><span className="chip">{r.status_label || r.status}</span></td>
                    <td>{fmtDate(r.issue_date)}</td>
                    <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 50)}</a> : (r.story_title || '—')}</td>
                  </tr>
                ))}
                {!log.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage yet — use “+ Log coverage”.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'coverage' && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
            <button className="btn btn-primary" onClick={() => startEdit(null)}>+ Add entry</button>
            <input ref={fileRef} type="file" accept=".csv" onChange={(e) => doImport(e, false)} style={{ display: 'none' }} />
            <button className="btn btn-secondary" disabled={importing} onClick={() => fileRef.current && fileRef.current.click()}>{importing ? 'Importing…' : '↑ Import (this client)'}</button>
            <input ref={combinedRef} type="file" accept=".csv" onChange={(e) => doImport(e, true)} style={{ display: 'none' }} />
            <button className="btn btn-secondary" disabled={importing} onClick={() => combinedRef.current && combinedRef.current.click()} title="Routes each row to the matching client by the CSV's Client column">↑ Import combined (all clients)</button>
          </div>

          {combinedResult && (
            <div className="card" style={{ marginBottom: 'var(--s4)', borderLeft: '3px solid var(--accent)' }}>
              <strong>{combinedResult.skipped} rows skipped.</strong> Unmatched client names (no platform client with that name):
              <div style={{ marginTop: 6, color: 'var(--text-subtle)', fontSize: 13 }}>{combinedResult.unmatched.join(', ')}</div>
            </div>
          )}

          {editing && (
            <div className="card" style={{ marginBottom: 'var(--s4)' }}>
              <h3 className="h3 mb-2">{editing.id ? 'Edit entry' : 'New entry'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label className="field"><span className="field-label">Story title</span><input className="input" value={f.story_title} onChange={(e) => setF('story_title', e.target.value)} /></label>
                <label className="field"><span className="field-label">Status</span><select className="input" value={f.status} onChange={(e) => setF('status', e.target.value)}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="field"><span className="field-label">Press contact</span><input className="input" value={f.press_contact} onChange={(e) => setF('press_contact', e.target.value)} placeholder="Journalist name" /></label>
                <label className="field"><span className="field-label">Publication</span><input className="input" value={f.publication} onChange={(e) => setF('publication', e.target.value)} /></label>
                <label className="field"><span className="field-label">Country</span><input className="input" value={f.country} onChange={(e) => setF('country', e.target.value)} /></label>
                <label className="field"><span className="field-label">Issue date</span><input className="input" type="date" value={f.issue_date} onChange={(e) => setF('issue_date', e.target.value)} /></label>
                <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Story URL</span><input className="input" value={f.story_url} onChange={(e) => setF('story_url', e.target.value)} placeholder="https://…" /></label>
                <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Notes / outcome (internal)</span><textarea className="input" rows={2} value={f.notes_outcome} onChange={(e) => setF('notes_outcome', e.target.value)} /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary" disabled={saving} onClick={saveEntry}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <table className="table">
              <thead><tr><th>Publication</th><th>Journalist</th><th>Status</th><th>Date</th><th>Story</th><th></th></tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>{r.outlet || '—'}</td>
                    <td>{r.journalist || '—'}</td>
                    <td><span className="chip">{r.status_label || r.status}</span></td>
                    <td>{fmtDate(r.issue_date)}</td>
                    <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => deleteEntry(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!log.length && <tr><td colSpan={6} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage yet. Add an entry, or import your editorial log CSV.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3 className="h3 mb-2">Coverage monitor</h3>
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
                      <button className="btn btn-secondary btn-sm" onClick={() => runSearchNow(s.id)}>Run now</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => deleteSearch(s.id)}>Delete</button>
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
      )}

      {!loading && tab === 'journalists' && (
        <div>
          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <table className="table">
              <thead><tr><th>Journalist</th><th>Outlet</th><th>Published</th><th>Hit rate</th><th>Last featured</th><th>Relationship</th></tr></thead>
              <tbody>
                {journalists.map((j) => (
                  <tr key={j.id}>
                    <td><Link to={`/media/journalist/${j.id}`}>{j.name}</Link></td>
                    <td>{j.outlet || '—'}</td>
                    <td>{j.published}</td>
                    <td>{j.hit_rate == null ? '—' : Math.round(j.hit_rate * 100) + '%'}</td>
                    <td>{fmtDate(j.last_featured)}</td>
                    <td><span className="chip chip-accent">{j.strength} · {j.strength_label}</span>{j.gone_quiet ? <span className="chip" style={{ marginLeft: 6 }}>quiet</span> : null}</td>
                  </tr>
                ))}
                {!journalists.length && <tr><td colSpan={6} style={{ color: 'var(--text-subtle)', padding: 24 }}>No journalists have covered {client?.name || 'this client'} yet.</td></tr>}
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
                      <button className="btn btn-primary btn-sm" onClick={() => openDraft(r)}>Draft thank-you</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => skipThank(r)}>Skip</button>
                    </td>
                  </tr>
                ))}
                {!thanks.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No thank-yous waiting. They appear here once a piece is marked Published or Download and the journalist has an email on file.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'press' && (
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
                <button className="btn btn-primary" disabled={prDrafting} onClick={draftPR}>{prDrafting ? 'Writing…' : '✍️ Draft with Claude'}</button>
                <label className="field"><span className="field-label">Status</span><select className="input" value={pr.status || 'draft'} onChange={(e) => setPr((p) => ({ ...p, status: e.target.value }))}><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="sent">Sent</option></select></label>
                <label className="field"><span className="field-label">Embargo until (optional)</span><input className="input" type="datetime-local" value={pr.embargo_at ? new Date(pr.embargo_at).toISOString().slice(0, 16) : ''} onChange={(e) => setPr((p) => ({ ...p, embargo_at: e.target.value }))} /></label>
                <label className="field" style={{ flex: 1, minWidth: 200 }}><span className="field-label">Published URL (once live)</span><input className="input" value={pr.url || ''} onChange={(e) => setPr((p) => ({ ...p, url: e.target.value }))} placeholder="https://…" /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                <button className="btn btn-secondary" onClick={copyReviewLink}>🔗 Client approval link</button>
                {pr.approved_at && <span className="chip chip-accent">✓ Approved by {pr.approved_by || 'client'}</span>}
                {['approved', 'sent'].includes(pr.status) && (
                  <button className="btn btn-primary" onClick={createPitchCampaign} title="Pitch this release to journalists in the Email tab">{pr.campaign_id ? 'Open pitch campaign →' : '📣 Create pitch campaign →'}</button>
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
                        <button className="btn btn-secondary btn-sm" onClick={() => deletePR(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!releases.length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No press releases yet. Start from a brief and let Claude draft the release.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'reports' && (
        <div className="card">
          <h3 className="h3 mb-2">Automated reports &amp; alerts</h3>
          <p style={{ color: 'var(--text-subtle)', fontSize: 13, marginBottom: 10 }}>Email the client a coverage digest on a schedule, and a "you've been featured" alert when a piece is marked published.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, minWidth: 220 }}><span className="field-label">Report / alert email</span><input className="input" value={reports.alert_email || ''} onChange={(e) => setReports((r) => ({ ...r, alert_email: e.target.value }))} placeholder="client@example.com" /></label>
            <label className="field"><span className="field-label">Cadence</span><select className="input" value={reports.report_cadence || 'off'} onChange={(e) => setReports((r) => ({ ...r, report_cadence: e.target.value }))}><option value="off">Off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <button className="btn btn-primary" disabled={savingReports} onClick={saveReports}>{savingReports ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-secondary" onClick={sendReportNow}>Send report now</button>
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--card-border, #e5e7eb)', paddingTop: 16 }}>
            <button className="btn btn-secondary" onClick={copyPortalLink}>🔗 Copy client coverage link</button>
            <p style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 8, marginBottom: 0 }}>A public, read-only page of this client's published coverage — no login needed.</p>
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
                  <button className="btn btn-primary" disabled={sendingThank || !thankDraft.to || !thankDraft.subject || !thankDraft.body} onClick={sendThank}>{sendingThank ? 'Sending…' : 'Send thank-you'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
