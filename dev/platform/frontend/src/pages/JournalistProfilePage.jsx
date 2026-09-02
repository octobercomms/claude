import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

const AVAIL = [
  ['active', 'Active'], ['maternity_leave', 'Maternity / parental leave'],
  ['sabbatical', 'Sabbatical'], ['moved_on', 'Moved on / left outlet'], ['unreachable', 'Unreachable'],
];
function fmtDate(d) { if (!d) return '—'; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default function JournalistProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { readOnly } = useAuth();
  const [c, setC] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  // Outlet picker — fetch the full publications list once so we can offer it
  // as a dropdown. Server-side ILIKE search is overkill at the typical scale
  // (a few thousand publications); preload + client filter is snappier.
  const [outlets, setOutlets] = useState([]);
  const [outletQuery, setOutletQuery] = useState('');

  function load() {
    api.get(`/pr/contacts/${id}`).then((d) => {
      setC(d);
      setForm({
        first_name: d.first_name || '', last_name: d.last_name || '',
        notes: d.notes || '', availability_status: d.availability_status || 'active',
        available_from: dateInput(d.available_from), photo_url: d.photo_url || '',
        location: d.location || '', bio_link: d.bio_link || '', email: (d.email || '').includes('@import.local') ? '' : (d.email || ''),
        beats: (Array.isArray(d.beats) ? d.beats : []).join(', '),
        outlet_id: d.outlet_id || '',
      });
    }).catch((e) => toast(e.message, 'error'));
  }
  useEffect(() => { load(); }, [id]);
  useEffect(() => { api.get('/pr/outlets').then((r) => setOutlets(r.items || [])).catch(() => {}); }, []);

  if (!c || !form) return <div className="suite-profile"><p style={{ padding: 24, color: 'var(--text-subtle)' }}>Loading…</p></div>;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/pr/contacts/${id}`, {
        ...form,
        outlet_id: form.outlet_id || null,
        beats: form.beats.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast('Saved', 'success'); load();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  }
  async function deleteJournalist() {
    const covered = (c.coverage || []).length;
    const tail = covered
      ? `${covered} coverage entr${covered === 1 ? 'y' : 'ies'} will lose their byline link (the stories stay, the journalist becomes blank).`
      : 'No coverage attached.';
    const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'this journalist';
    if (!window.confirm(`Delete "${fullName}"?\n\n${tail}\n\nCannot be undone.`)) return;
    try {
      await api.delete(`/pr/contacts/${id}`);
      toast('Journalist deleted', 'success');
      nav('/settings?tab=contacts');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function suggestBeats() {
    setSuggesting(true);
    try {
      const r = await api.post(`/pr/contacts/${id}/suggest-beats`, {});
      const existing = form.beats.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      (r.beats || []).forEach((b) => { if (!existing.includes(b)) existing.push(b); });
      set('beats', existing.join(', '));
      toast('Beats suggested — review and Save', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setSuggesting(false); }
  }

  return (
    <div className="suite-profile">
      <div className="kicker"><span className="pip" /><span>Media database • Journalist</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="display">{`${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Journalist'}</h1>
        <button className="btn btn-secondary" onClick={() => nav(-1)}>← Back</button>
      </header>

      <div className="card" style={{ marginBottom: 'var(--s4)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', gridColumn: '1/-1' }}>
          {form.photo_url
            ? <img src={form.photo_url} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-soft,#eef2ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{((c.first_name || ' ')[0] + (c.last_name || ' ')[0]).toUpperCase()}</div>}
          <div style={{ flex: 1 }}><label className="field"><span className="field-label">Photo URL</span><input className="input" value={form.photo_url} onChange={(e) => set('photo_url', e.target.value)} placeholder="https://… headshot" /></label></div>
        </div>
        <label className="field"><span className="field-label">First name</span><input className="input" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></label>
        <label className="field"><span className="field-label">Last name</span><input className="input" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></label>
        <label className="field"><span className="field-label">Publication</span>
          <input className="input" list="outlet-options" value={outletQuery || (outlets.find((o) => o.id === form.outlet_id)?.name || '')}
            onChange={(e) => {
              const v = e.target.value;
              setOutletQuery(v);
              const match = outlets.find((o) => o.name.toLowerCase() === v.toLowerCase());
              if (match) { set('outlet_id', match.id); setOutletQuery(''); }
              else if (!v.trim()) { set('outlet_id', ''); }
            }}
            placeholder="Type to filter publications…" />
          <datalist id="outlet-options">
            {outlets.slice(0, 1000).map((o) => <option key={o.id} value={o.name} />)}
          </datalist>
        </label>
        <label className="field"><span className="field-label">Email</span><input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="unknown" /></label>
        <label className="field"><span className="field-label">Availability</span><select className="input" value={form.availability_status} onChange={(e) => set('availability_status', e.target.value)}>{AVAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {form.availability_status !== 'active' && <label className="field"><span className="field-label">Back / review on</span><input type="date" className="input" value={form.available_from} onChange={(e) => set('available_from', e.target.value)} /></label>}
        <label className="field"><span className="field-label">Location</span><input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} /></label>
        <label className="field"><span className="field-label">Bio link</span><input className="input" value={form.bio_link} onChange={(e) => set('bio_link', e.target.value)} /></label>
        <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Beats / topics <button type="button" className="btn btn-secondary btn-sm" style={{ float: 'right' }} {...roWrite(readOnly, { onClick: suggestBeats, disabled: suggesting })}>{suggesting ? '…' : '✨ Suggest from coverage'}</button></span><input className="input" value={form.beats} onChange={(e) => set('beats', e.target.value)} placeholder="architecture, interiors" /></label>
        <label className="field" style={{ gridColumn: '1/-1' }}><span className="field-label">Notes</span><textarea className="input" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save profile'}</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-danger btn-sm" onClick={deleteJournalist}
            title="Hard-delete this journalist. Coverage entries pointing at them stay (the byline becomes blank). Cannot be undone.">
            Delete journalist
          </button>
        </div>
      </div>

      {Array.isArray(c.auto_topics) && c.auto_topics.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="h3 mb-2">Writes about <span className="body-sm text-muted">· learned from their recent articles</span></h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {c.auto_topics.map((t, i) => <span key={i} className="chip">{t}</span>)}
          </div>
        </div>
      )}

      {Array.isArray(c.latest_articles) && c.latest_articles.length > 0 && (
        <>
          <h3 className="h3 mb-2">Latest articles <span className="body-sm text-muted">· from their outlet's feed</span></h3>
          <div className="card" style={{ marginBottom: 16 }}>
            {c.latest_articles.map((a, i) => (
              <div key={i} style={{ padding: '7px 0', borderTop: i ? '1px solid #f4f4f4' : 'none', fontSize: 13 }}>
                {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{(a.title || a.url).slice(0, 110)}</a> : (a.title || '—')}
                {a.published_at && <span className="text-muted" style={{ fontSize: 11 }}> · {fmtDate(a.published_at)}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="h3 mb-2">Coverage history ({c.coverage?.length || 0})</h3>
      <div className="card">
        <table className="table">
          <thead><tr><th>Client</th><th>Publication</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
          <tbody>
            {(c.coverage || []).map((r, i) => (
              <tr key={i}>
                <td>{r.client || '—'}</td><td>{r.outlet || '—'}</td><td><span className="chip">{r.status}</span></td>
                <td>{fmtDate(r.issue_date)}</td>
                <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
              </tr>
            ))}
            {!(c.coverage || []).length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage logged.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
