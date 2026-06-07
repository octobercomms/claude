// Mailboxes panel — per-client multi-sender configuration. Rendered
// inside the Email page's Sending tab. The AM adds N senders here;
// the outbound engine rotates across the active ones, respecting
// per-mailbox daily caps and warm-up status.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUSES = [
  { value: 'cold',    label: 'Cold (new, climbing)' },
  { value: 'warming', label: 'Warming up' },
  { value: 'warm',    label: 'Warm (full throughput)' },
  { value: 'paused',  label: 'Paused' },
];

export default function MailboxesPanel({ clientId }) {
  const toast = useToast();
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await api.get(`/outreach/clients/${clientId}/mailboxes`);
      setMailboxes(rows);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function remove(mailbox) {
    if (!confirm(`Remove ${mailbox.from_email} from this client's sender pool?`)) return;
    try {
      await api.delete(`/outreach/mailboxes/${mailbox.id}`);
      toast('Mailbox removed.', 'success');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function togglePause(mailbox) {
    const next = mailbox.warm_up_status === 'paused' ? 'warm' : 'paused';
    try {
      await api.put(`/outreach/mailboxes/${mailbox.id}`, { warm_up_status: next });
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="stack stack-lg">
      <div className="row between">
        <div>
          <h3 className="h2">Sender mailboxes</h3>
          <p className="body-sm text-muted mt-2">
            Add multiple senders to rotate across. Each mailbox has its own daily cap and warm-up state; the engine
            picks the next eligible mailbox round-robin to keep any single inbox under provider limits.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(true); }}>+ Add mailbox</button>
      </div>

      {loading ? (
        <div className="text-subtle">Loading…</div>
      ) : !mailboxes.length ? (
        <div className="empty">
          <div className="h3">No mailboxes yet</div>
          <p className="body-sm text-muted mt-3">Until you add one, the campaign falls back to the legacy single-sender config below.</p>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {mailboxes.map(mb => <MailboxCard key={mb.id} mailbox={mb} onEdit={() => { setEditing(mb); setShowForm(true); }} onRemove={() => remove(mb)} onTogglePause={() => togglePause(mb)} />)}
        </div>
      )}

      {showForm && (
        <MailboxFormModal
          clientId={clientId}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function MailboxCard({ mailbox, onEdit, onRemove, onTogglePause }) {
  const statusClass = mailbox.warm_up_status === 'error' ? 'danger'
    : mailbox.warm_up_status === 'paused' ? 'warning'
    : mailbox.warm_up_status === 'warm' ? 'success'
    : '';
  const cap = mailbox.target_daily_cap || mailbox.daily_cap;
  const sent = mailbox.daily_sent_count || 0;
  return (
    <div className={`card ${statusClass}`}>
      <div className="row between">
        <div className="caption">{mailbox.warm_up_status}</div>
        {!mailbox.active && <div className="chip chip-neutral">inactive</div>}
      </div>
      <h3 className="h3 mt-2">{mailbox.from_name}</h3>
      <p className="body-sm mt-2">{mailbox.from_email}</p>
      <p className="body-xs text-subtle mt-3">
        Today: <strong>{sent} / {cap}</strong> sent
        {mailbox.last_used_at && <span> · last used {new Date(mailbox.last_used_at).toLocaleString('en-GB')}</span>}
      </p>
      {mailbox.error_message && <div className="callout callout-danger mt-3" style={{ fontSize: 11 }}>{mailbox.error_message}</div>}
      <div className="row mt-4 wrap">
        <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
        <button className="btn btn-secondary btn-sm" onClick={onTogglePause}>
          {mailbox.warm_up_status === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

function MailboxFormModal({ clientId, initial, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    from_name: initial?.from_name || '',
    from_email: initial?.from_email || '',
    reply_to: initial?.reply_to || '',
    smtp_host: initial?.smtp_host || '',
    smtp_port: initial?.smtp_port || '',
    smtp_username: initial?.smtp_username || '',
    smtp_password: '',
    daily_cap: initial?.daily_cap || 50,
    target_daily_cap: initial?.target_daily_cap || 50,
    warm_up_status: initial?.warm_up_status || 'warm',
    warmup_days: initial?.warmup_days || 14,
  });
  const [saving, setSaving] = useState(false);
  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.from_name.trim() || !form.from_email.trim()) {
      toast('Name and email are required.', 'error'); return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.smtp_password) delete payload.smtp_password;  // don't blank an existing one
      if (initial) await api.put(`/outreach/mailboxes/${initial.id}`, payload);
      else await api.post(`/outreach/clients/${clientId}/mailboxes`, payload);
      toast('Mailbox saved.', 'success');
      onSaved();
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h2">{initial ? 'Edit mailbox' : 'Add mailbox'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label className="field-label">From name</label>
            <input className="input" value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder="Daniel Nelson" />
          </div>
          <div className="field">
            <label className="field-label">From email</label>
            <input className="input" value={form.from_email} onChange={e => set('from_email', e.target.value)} placeholder="daniel@brand.example" />
          </div>
        </div>

        <div className="field">
          <label className="field-label">Reply-to (optional)</label>
          <input className="input" value={form.reply_to} onChange={e => set('reply_to', e.target.value)} placeholder="replies@octobercomms.com" />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label className="field-label">Daily cap (current)</label>
            <input className="input" type="number" min="1" value={form.daily_cap} onChange={e => set('daily_cap', Number(e.target.value))} />
          </div>
          <div className="field">
            <label className="field-label">Target daily cap (full throughput)</label>
            <input className="input" type="number" min="1" value={form.target_daily_cap} onChange={e => set('target_daily_cap', Number(e.target.value))} />
          </div>
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label className="field-label">Warm-up status</label>
            <select className="input" value={form.warm_up_status} onChange={e => set('warm_up_status', e.target.value)}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Warmup days (climb)</label>
            <input className="input" type="number" min="0" max="90" value={form.warmup_days} onChange={e => set('warmup_days', Number(e.target.value))} />
          </div>
        </div>

        <div className="caption mt-5">SMTP (optional — leave blank to use platform SES/SMTP defaults)</div>
        <div className="grid grid-2 mt-3">
          <div className="field">
            <label className="field-label">SMTP host</label>
            <input className="input" value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" />
          </div>
          <div className="field">
            <label className="field-label">SMTP port</label>
            <input className="input" type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)} placeholder="587" />
          </div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label className="field-label">SMTP username</label>
            <input className="input" value={form.smtp_username} onChange={e => set('smtp_username', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">SMTP password</label>
            <input className="input" type="password" value={form.smtp_password} onChange={e => set('smtp_password', e.target.value)} placeholder={initial ? '(unchanged)' : ''} />
          </div>
        </div>

        <div className="row end mt-6">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save mailbox'}</button>
        </div>
      </div>
    </div>
  );
}
