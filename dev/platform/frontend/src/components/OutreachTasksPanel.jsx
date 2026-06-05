// Daily LinkedIn + manual task queue. Surfaces every pending task
// assigned to (or claimable by) the current user across the clients
// they can see. AM checks off tasks here; checking complete advances
// the per-prospect state machine to the next step exactly like a
// delivered email would.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const CHANNEL_LABEL = {
  linkedin_visit:   'Visit profile',
  linkedin_connect: 'Send connection',
  linkedin_message: 'Send message',
  manual_task:      'Manual task',
};

export default function OutreachTasksPanel() {
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get('/outreach/tasks');
      setTasks(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function complete(t) {
    try { await api.post(`/outreach/tasks/${t.id}/complete`, {}); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function skip(t) {
    const reason = prompt('Why skip?');
    if (reason == null) return;
    try { await api.post(`/outreach/tasks/${t.id}/skip`, { reason }); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  }

  if (loading) return <div className="text-subtle">Loading…</div>;
  if (!tasks.length) {
    return (
      <div className="empty">
        <div className="h3">Nothing to do.</div>
        <p className="body-sm text-muted mt-3">Multichannel sequences create LinkedIn and manual tasks here as they come due.</p>
      </div>
    );
  }

  // Group by client so the AM sees a tidy queue per brand.
  const byClient = {};
  for (const t of tasks) {
    const k = t.client_id || 'other';
    if (!byClient[k]) byClient[k] = { name: t.client_name, rows: [] };
    byClient[k].rows.push(t);
  }

  return (
    <div className="stack stack-lg">
      {Object.entries(byClient).map(([cid, group]) => (
        <div key={cid}>
          <h3 className="h3 mb-3">{group.name}</h3>
          <div className="stack stack-sm">
            {group.rows.map(t => (
              <div key={t.id} className="card">
                <div className="row between center">
                  <div>
                    <div className="caption">{CHANNEL_LABEL[t.channel] || t.channel} · {t.campaign_name}</div>
                    <div className="h3 mt-2">{t.contact_name || t.email}</div>
                    {t.linkedin_url && (
                      <div className="body-xs mt-2">
                        <a href={t.linkedin_url} target="_blank" rel="noreferrer" className="text-accent">{t.linkedin_url}</a>
                      </div>
                    )}
                    {t.prompt && <p className="body-sm mt-3" style={{ whiteSpace: 'pre-wrap' }}>{t.prompt}</p>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button onClick={() => skip(t)} className="btn btn-secondary btn-sm">Skip</button>
                    <button onClick={() => complete(t)} className="btn btn-primary btn-sm">Done</button>
                  </div>
                </div>
                {t.due_at && <div className="body-xs text-subtle mt-2">Due {new Date(t.due_at).toLocaleString('en-GB')}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
