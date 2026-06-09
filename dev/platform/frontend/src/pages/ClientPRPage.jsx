import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  const toast = useToast();
  const fileRef = useRef(null);
  const combinedRef = useRef(null);
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('coverage');
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

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch((e) => toast(e.message, 'error')); }, [id]);

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

  return (
    <div className="suite-client-pr">
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Press coverage &amp; journalists</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="display">PR</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={copyPortalLink}>🔗 Client coverage link</button>
          <button className="btn btn-secondary" onClick={() => setShowReports((s) => !s)}>✉ Reports</button>
          <button className="btn btn-primary" onClick={() => startEdit(null)}>+ Add entry</button>
          <input ref={fileRef} type="file" accept=".csv" onChange={(e) => doImport(e, false)} style={{ display: 'none' }} />
          <button className="btn btn-secondary" disabled={importing} onClick={() => fileRef.current && fileRef.current.click()}>{importing ? 'Importing…' : '↑ Import (this client)'}</button>
          <input ref={combinedRef} type="file" accept=".csv" onChange={(e) => doImport(e, true)} style={{ display: 'none' }} />
          <button className="btn btn-secondary" disabled={importing} onClick={() => combinedRef.current && combinedRef.current.click()} title="Routes each row to the matching client by the CSV's Client column">↑ Import combined (all clients)</button>
        </div>
      </header>

      {showReports && (
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <h3 className="h3 mb-2">Automated reports &amp; alerts</h3>
          <p style={{ color: 'var(--text-subtle)', fontSize: 13, marginBottom: 10 }}>Email the client a coverage digest on a schedule, and a "you've been featured" alert when a piece is marked published.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, minWidth: 220 }}><span className="field-label">Report / alert email</span><input className="input" value={reports.alert_email || ''} onChange={(e) => setReports((r) => ({ ...r, alert_email: e.target.value }))} placeholder="client@example.com" /></label>
            <label className="field"><span className="field-label">Cadence</span><select className="input" value={reports.report_cadence || 'off'} onChange={(e) => setReports((r) => ({ ...r, report_cadence: e.target.value }))}><option value="off">Off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <button className="btn btn-primary" disabled={savingReports} onClick={saveReports}>{savingReports ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-secondary" onClick={sendReportNow}>Send report now</button>
          </div>
        </div>
      )}

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

      <div className="card" style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.published : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Published</div></div>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.tracked : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Tracked</div></div>
        <div><div style={{ fontSize: 28, fontWeight: 700 }}>{stats ? stats.journalists : '—'}</div><div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Journalists</div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--s4)' }}>
        <button onClick={() => setTab('coverage')} className={'btn ' + (tab === 'coverage' ? 'btn-primary' : 'btn-secondary')}>Coverage</button>
        <button onClick={() => setTab('journalists')} className={'btn ' + (tab === 'journalists' ? 'btn-primary' : 'btn-secondary')}>Journalists</button>
        <button onClick={() => setTab('monitor')} className={'btn ' + (tab === 'monitor' ? 'btn-primary' : 'btn-secondary')}>Monitor{queue.length ? ` (${queue.length})` : ''}</button>
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--text-subtle)', padding: 24 }}>Loading…</p>
        ) : tab === 'coverage' ? (
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
        ) : tab === 'journalists' ? (
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
        ) : (
          <div>
            <h3 className="h3 mb-2">Saved searches</h3>
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
        )}
      </div>
    </div>
  );
}
