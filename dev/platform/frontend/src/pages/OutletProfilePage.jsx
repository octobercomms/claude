import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

function fmtDate(d) { if (!d) return '—'; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

export default function OutletProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [o, setO] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [gen, setGen] = useState(false);

  function load() {
    api.get(`/pr/outlets/${id}`).then((d) => {
      setO(d);
      setForm({ name: d.name || '', summary: d.summary || '', tier: d.tier || '', region: d.region || '', notes: d.notes || '', domain: d.domain || '' });
    }).catch((e) => toast(e.message, 'error'));
  }
  useEffect(() => { load(); }, [id]);

  if (!o || !form) return <div className="suite-profile"><p style={{ padding: 24, color: 'var(--text-subtle)' }}>Loading…</p></div>;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const published = (o.coverage || []).filter((r) => r.status === 'published' || r.status === 'download').length;

  async function save() {
    setSaving(true);
    try { await api.patch(`/pr/outlets/${id}`, form); toast('Saved', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  }
  async function generate() {
    setGen(true);
    try { const r = await api.post(`/pr/outlets/${id}/summary`, {}); set('summary', r.summary || ''); toast('Summary drafted — review and Save', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setGen(false); }
  }

  return (
    <div className="suite-profile">
      <div className="kicker"><span className="pip" /><span>Media database • Publication</span></div>
      <header className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="display">{o.name}</h1>
        <button className="btn btn-secondary" onClick={() => nav(-1)}>← Back</button>
      </header>

      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <label className="field"><span className="field-label">Publication name</span><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Wallpaper*" /></label>
        <label className="field"><span className="field-label">About <button type="button" className="btn btn-secondary btn-sm" style={{ float: 'right' }} disabled={gen} onClick={generate}>{gen ? '…' : '✨ Generate'}</button></span><textarea className="input" rows={3} value={form.summary} onChange={(e) => set('summary', e.target.value)} placeholder="Who they are — Claude can draft this from your coverage." /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label className="field"><span className="field-label">Tier</span><input className="input" value={form.tier} onChange={(e) => set('tier', e.target.value)} placeholder="National, Trade…" /></label>
          <label className="field"><span className="field-label">Region</span><input className="input" value={form.region} onChange={(e) => set('region', e.target.value)} placeholder="UK" /></label>
          <label className="field"><span className="field-label">Domain</span><input className="input" value={form.domain} onChange={(e) => set('domain', e.target.value)} /></label>
        </div>
        <label className="field"><span className="field-label">Notes</span><textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          <span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{published} published · {(o.coverage || []).length} tracked</span>
        </div>
      </div>

      {(o.journalists || []).length > 0 && (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <h3 className="h3 mb-2">Journalists here</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {o.journalists.map((j) => <Link key={j.id} className="chip chip-accent" to={`/media/journalist/${j.id}`} style={{ textDecoration: 'none' }}>{j.name}</Link>)}
          </div>
        </div>
      )}

      <h3 className="h3 mb-2">Coverage with {o.name} ({(o.coverage || []).length})</h3>
      <div className="card">
        <table className="table">
          <thead><tr><th>Client</th><th>Journalist</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
          <tbody>
            {(o.coverage || []).map((r, i) => (
              <tr key={i}>
                <td>{r.client || '—'}</td><td>{r.journalist || '—'}</td><td><span className="chip">{r.status}</span></td>
                <td>{fmtDate(r.issue_date)}</td>
                <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
              </tr>
            ))}
            {!(o.coverage || []).length && <tr><td colSpan={5} style={{ color: 'var(--text-subtle)', padding: 24 }}>No coverage logged.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
