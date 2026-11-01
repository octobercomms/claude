import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import DangerConfirm from '../components/ui/DangerConfirm';

// Snapshot Studio — October's own lead list. Enter a prospect's URL → it drafts
// a personalised Growth Snapshot you curate and send. Admin-only.
const STATUS = {
  new: { label: 'New URL', tone: 'var(--text-subtle)' },
  drafted: { label: 'Drafted', tone: 'var(--accent)' },
  sent: { label: 'Snapshot sent', tone: 'var(--positive)' },
  booked: { label: 'Call booked', tone: 'var(--positive)' },
  proposal: { label: 'Proposal out', tone: 'var(--accent)' },
  won: { label: 'Won', tone: 'var(--positive)' },
  archived: { label: 'Archived', tone: 'var(--text-subtle)' },
};

export default function LeadsPage({ embedded = false } = {}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [leads, setLeads] = useState(null);
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  // Archived leads are hidden by default. A lead you archived is a lead you
  // decided not to look at; leaving it in the list means the list is no
  // longer the pipeline.
  const [showArchived, setShowArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  // Archive is a status change, so it is reversible and loses nothing.
  async function setArchived(lead, archived) {
    try {
      await api.patch(`/leads/${lead.id}`, { status: archived ? 'archived' : 'new' });
      toast(archived ? `${label(lead)} archived.` : `${label(lead)} is back in the pipeline.`, 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Delete is not. It takes the lead, its snapshot, its images and its call
  // notes, and there is no undo, which is why the dialog asks for the
  // company's name rather than an OK.
  async function runDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/leads/${pendingDelete.id}`);
      toast(`${label(pendingDelete)} deleted.`, 'success');
      setPendingDelete(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setDeleting(false); }
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const label = (l) => l.company_name || host(l.url);

  const archivedCount = (leads || []).filter(l => l.status === 'archived').length;
  const visible = (leads || []).filter(l => showArchived || l.status !== 'archived');

  return (
    <div>
      {!embedded && (<>
      <div className="kicker"><span className="pip" />Snapshot Studio</div>
      <header className="hero">
        <h1 className="display">Leads</h1>
        <p className="body mt-4" style={{ maxWidth: 640 }}>
          Enter a prospect's website. We draft a personalised <strong>Growth Snapshot</strong> from their site — a taste of every way October could help — that you curate and send to book the call.
        </p>
      </header>
      </>)}

      <div className="card mb-6" style={{ borderColor: 'var(--accent)' }}>
        <div className="caption mb-2">New snapshot</div>
        <div className="row" style={{ gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 260 }} value={url}
            onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="prospect-website.com" />
          <button className="btn btn-primary" onClick={create} disabled={creating || !url.trim()}>
            {creating ? 'Adding…' : '⚡ Draft snapshot'}
          </button>
        </div>
      </div>

      {archivedCount > 0 && (
        <div className="row" style={{ gap: 'var(--s2)', alignItems: 'center', marginBottom: 'var(--s3)' }}>
          <label className="body-sm text-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={() => setShowArchived(v => !v)} />
            Show archived ({archivedCount})
          </label>
        </div>
      )}

      {leads === null ? (
        <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>
      ) : !visible.length ? (
        <div className="card"><div className="text-subtle" style={{ padding: 'var(--s5)' }}>No leads yet. Add a prospect's URL above to draft their first snapshot.</div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Company</th><th>Website</th><th>Email</th><th>Source</th><th>Status</th><th>Added</th><th style={{ width: 170 }}></th></tr></thead>
            <tbody>
              {visible.map(l => {
                const st = STATUS[l.status] || STATUS.new;
                return (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.id}`)}>
                    <td className="strong">{l.company_name || host(l.url)}</td>
                    <td className="text-muted">{host(l.url)}</td>
                    <td className="text-muted">{l.email || '—'}</td>
                    <td className="text-muted">{l.referral_source || (l.source === 'public' ? 'Snapshot' : 'Manual')}</td>
                    <td><span style={{ color: st.tone, fontWeight: 700 }}>{st.label}</span></td>
                    <td className="text-muted">{fmt(l.created_at)}</td>
                    {/* The row navigates, so every button in it has to stop
                        the click, or archiving opens the lead you archived. */}
                    <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setArchived(l, l.status !== 'archived')}
                      >
                        {l.status === 'archived' ? 'Restore' : 'Archive'}
                      </button>
                      <button
                        className="btn-icon danger"
                        style={{ marginLeft: 'var(--s1)' }}
                        title={`Delete ${label(l)} permanently`}
                        aria-label="Delete permanently"
                        onClick={() => setPendingDelete(l)}
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete && (
        <DangerConfirm
          count={1}
          noun="lead"
          phrase={label(pendingDelete)}
          detail={`Everything on this lead goes with it: the drafted snapshot, any images you uploaded, the call notes and the email history. Archive instead if you only want it out of the list — ${label(pendingDelete)} would then be one click from coming back.`}
          busy={deleting}
          onConfirm={runDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
