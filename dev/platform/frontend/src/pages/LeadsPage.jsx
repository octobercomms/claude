import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Snapshot Studio — October's own lead list. Enter a prospect's URL → it drafts
// a personalised Growth Snapshot you curate and send. Admin-only.
const STATUS = {
  new: { label: 'New URL', tone: 'var(--text-subtle)' },
  drafted: { label: 'Drafted', tone: 'var(--accent)' },
  sent: { label: 'Snapshot sent', tone: 'var(--positive)' },
  booked: { label: 'Booked', tone: 'var(--positive)' },
  archived: { label: 'Archived', tone: 'var(--text-subtle)' },
};

export default function LeadsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [leads, setLeads] = useState(null);
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); /* eslint-disable-line */ }, []);
  async function load() {
    try { setLeads(await api.get('/leads')); }
    catch (e) { toast(e.message, 'error'); setLeads([]); }
  }

  async function create() {
    if (!url.trim() || creating) return;
    setCreating(true);
    try {
      const lead = await api.post('/leads', { url: url.trim() });
      setUrl('');
      navigate(`/leads/${lead.id}?gather=1`);
    } catch (e) { toast(`Couldn't add: ${e.message}`, 'error'); }
    finally { setCreating(false); }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  return (
    <div>
      <div className="kicker"><span className="pip" />Snapshot Studio</div>
      <header className="hero">
        <h1 className="display">Leads</h1>
        <p className="body mt-4" style={{ maxWidth: 640 }}>
          Enter a prospect's website. We draft a personalised <strong>Growth Snapshot</strong> from their site — a taste of every way October could help — that you curate and send to book the call.
        </p>
      </header>

      <div className="card mb-6" style={{ borderColor: 'var(--accent)' }}>
        <div className="caption mb-2">New snapshot</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 260 }} value={url}
            onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="prospect-website.com" />
          <button className="btn btn-primary" onClick={create} disabled={creating || !url.trim()}>
            {creating ? 'Adding…' : '⚡ Draft snapshot'}
          </button>
        </div>
      </div>

      {leads === null ? (
        <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>
      ) : !leads.length ? (
        <div className="card"><div className="text-subtle" style={{ padding: 20 }}>No leads yet. Add a prospect's URL above to draft their first snapshot.</div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Company</th><th>Website</th><th>Email</th><th>Status</th><th>Added</th></tr></thead>
            <tbody>
              {leads.map(l => {
                const st = STATUS[l.status] || STATUS.new;
                return (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.id}`)}>
                    <td className="strong">{l.company_name || host(l.url)}</td>
                    <td className="text-muted">{host(l.url)}</td>
                    <td className="text-muted">{l.email || '—'}</td>
                    <td><span style={{ color: st.tone, fontWeight: 700 }}>{st.label}</span></td>
                    <td className="text-muted">{fmt(l.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
