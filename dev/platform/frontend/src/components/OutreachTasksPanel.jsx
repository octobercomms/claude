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

// Static sample queue for the empty state, so a first-time AM can see
// what a task looks like before any sequence has produced one.
function ExampleTasks() {
  const rows = [
    { channel: 'linkedin_connect', campaign: 'Q3 Architects — London', who: 'Priya Shah · Studio Mara', prompt: 'Send a connection request. No note needed — keep it low-friction.' },
    { channel: 'linkedin_message', campaign: 'Q3 Architects — London', who: 'Daniel Ortega · Ortega & Co', prompt: 'They accepted your connection. Send the step-2 message referencing their recent Shoreditch project.' },
  ];
  return (
    <div>
      <div className="caption" style={{ marginBottom: 'var(--s3)' }}>Example — a typical day's queue</div>
      <div className="stack stack-sm" style={{ opacity: 0.92 }}>
        {rows.map((t, i) => (
          <div key={i} className="card">
            <div className="row between center">
              <div>
                <div className="caption">{CHANNEL_LABEL[t.channel]} · {t.campaign}</div>
                <div className="h3 mt-2">{t.who}</div>
                <p className="body-sm mt-3">{t.prompt}</p>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="btn btn-secondary btn-sm" style={{ pointerEvents: 'none' }}>Skip</span>
                <span className="btn btn-primary btn-sm" style={{ pointerEvents: 'none' }}>Done</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <div>
        <div className="caption">Tasks</div>
        <div className="h2 mt-2 mb-3">Your daily action queue</div>
        <p className="body mb-5" style={{ maxWidth: 660 }}>
          Not every outreach step is an email. When a campaign uses a <strong>multichannel sequence</strong> — a
          LinkedIn visit → connect → message, or a manual to-do — each step lands here as a task the day it's due,
          grouped by client. Check one off and the prospect automatically advances to the next step, exactly as a
          sent email would. Right now there's nothing due.
        </p>
        <ExampleTasks />
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
