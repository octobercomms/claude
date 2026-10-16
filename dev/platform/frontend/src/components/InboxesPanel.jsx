import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// The mailboxes OMI reads over IMAP.
//
// This replaced a single set of IMAP fields, and the reason is worth stating on
// the screen: October sends press releases with a reply-to of press@ while the
// poll read hello@. Every reply to press@ was invisible, and because
// unsubscribe detection runs inside that same poll, journalists who replied
// "remove me" carried on receiving follow-ups. A missing mailbox is not a
// reporting gap; it is mail going to people who asked you to stop.

const BLANK = { label: '', host: 'imap.gmail.com', port: 993, username: '', password: '' };

function fmtWhen(d) {
  if (!d) return 'never';
  const t = new Date(d);
  if (isNaN(t)) return 'never';
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function InboxesPanel() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get('/settings/inboxes')
      .then((d) => setRows(d.inboxes || []))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function testDraft() {
    setBusy('draft');
    try {
      const r = await api.post('/settings/inboxes/test', draft);
      toast(r.ok ? `Connected. ${r.messages} message(s) in the inbox.` : r.error, r.ok ? 'success' : 'error');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function save() {
    setBusy('draft');
    try {
      await api.post('/settings/inboxes', draft);
      toast(`${draft.label || draft.username} added. It will be read on the next poll.`, 'success');
      setDraft(BLANK); setAdding(false); load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function testSaved(row) {
    setBusy(row.id);
    try {
      const r = await api.post('/settings/inboxes/test', { id: row.id });
      toast(r.ok ? `${row.label}: connected, ${r.messages} message(s).` : `${row.label}: ${r.error}`, r.ok ? 'success' : 'error');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function patch(row, change) {
    setBusy(row.id);
    try { await api.patch(`/settings/inboxes/${row.id}`, change); load(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function remove(row) {
    // Removing a mailbox stops its replies and opt-outs being seen, which is
    // the failure this panel exists to prevent. Make it deliberate.
    if (!window.confirm(`Stop reading ${row.label}?\n\nReplies and unsubscribe requests arriving there will no longer be picked up.`)) return;
    setBusy(row.id);
    try { await api.delete(`/settings/inboxes/${row.id}`); toast(`${row.label} removed.`, 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  const field = (k, label, type = 'text', placeholder = '') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>{label}</span>
      <input
        type={type}
        value={draft[k]}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
      />
    </label>
  );

  return (
    <div style={{ borderLeft: `4px solid ${rows?.length ? 'var(--positive)' : 'var(--card-border)'}`, background: rows?.length ? 'var(--positive-soft)' : 'var(--surface-raised)', borderRadius: 'var(--r-sm)', padding: 'var(--s4)' }}>
      <div className="row between center" style={{ marginBottom: 'var(--s2)' }}>
        <div className="h3" style={{ margin: 0 }}>Mailboxes OMI reads</div>
        <span className="chip chip-accent">{rows ? rows.length : '—'}</span>
      </div>

      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', marginBottom: 'var(--s3)' }}>
        Every address journalists might reply to belongs here. A reply-to that no
        mailbox on this list receives is invisible to OMI, and since opt-outs are
        detected by reading replies, anyone who answers “remove me” there keeps
        getting follow-ups. Gmail needs an app password, not your account password.
      </div>

      {err && <div style={{ color: 'var(--negative)', fontSize: 'var(--fs-caption)' }}>{err}</div>}

      {rows?.length === 0 && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--warning)', marginBottom: 'var(--s3)' }}>
          No mailbox connected. Reply detection and reply-based unsubscribes are both off.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {(rows || []).map((r) => (
          <div key={r.id} style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 'var(--s3)', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{r.label}</strong>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{r.username} · {r.host}:{r.port}</span>
              {!r.active && <span className="chip" style={{ background: '#eee', color: 'var(--text-subtle)' }}>Off</span>}
              {r.last_error
                ? <span className="chip" style={{ background: 'var(--negative-soft)', color: 'var(--negative)' }} title={r.last_error}>Last run failed</span>
                : r.last_ok_at
                  ? <span className="chip chip-success">Read {fmtWhen(r.last_ok_at)}</span>
                  : <span className="chip" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>Not read yet</span>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
                <button className="btn btn-secondary btn-sm" disabled={busy === r.id} onClick={() => testSaved(r)}>Test</button>
                <button className="btn btn-secondary btn-sm" disabled={busy === r.id} onClick={() => remove(r)}>Remove</button>
              </span>
            </div>

            {r.last_error && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--negative)', marginTop: 4 }}>{r.last_error}</div>
            )}

            <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', marginTop: 'var(--s2)', fontSize: 'var(--fs-caption)' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={r.active} disabled={busy === r.id} onChange={() => patch(r, { active: !r.active })} />
                On
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={r.poll_replies} disabled={busy === r.id} onChange={() => patch(r, { poll_replies: !r.poll_replies })} />
                Replies and opt-outs
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={r.scan_ooo} disabled={busy === r.id} onChange={() => patch(r, { scan_ooo: !r.scan_ooo })} />
                Contact updates
              </label>
              <label
                style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
                title="For a personal or admin account: only raise a contact update when the sender is already in OMI, so the queue does not fill with supplier auto-replies."
              >
                <input type="checkbox" checked={r.known_senders_only} disabled={busy === r.id || !r.scan_ooo} onChange={() => patch(r, { known_senders_only: !r.known_senders_only })} />
                Known senders only
              </label>
              <span style={{ color: 'var(--text-subtle)', marginLeft: 'auto' }}>
                {r.matched || 0} replies · {r.unsubscribed || 0} opt-outs · {r.ooo_queued || 0} contact updates
              </span>
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div style={{ marginTop: 'var(--s3)', padding: 'var(--s3)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            {field('label', 'Name', 'text', 'press@')}
            {field('username', 'Address', 'text', 'press@octobercomms.com')}
            {field('host', 'IMAP host', 'text', 'imap.gmail.com')}
            {field('port', 'Port', 'text', '993')}
            {field('password', 'App password', 'password', '')}
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            <button className="btn btn-secondary btn-sm" disabled={busy === 'draft'} onClick={testDraft}>Test connection</button>
            <button className="btn btn-primary btn-sm" disabled={busy === 'draft'} onClick={save}>Add mailbox</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setDraft(BLANK); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s3)' }} onClick={() => setAdding(true)}>Add a mailbox</button>
      )}
    </div>
  );
}
