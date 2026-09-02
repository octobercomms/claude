import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
// Two-column edit modal — Contact Details on the left, More Info on the right,
// matching the original WordPress plugin layout.
const STATUS_OPTIONS = ['new', 'active', 'unsubscribed', 'bounced', 'do_not_contact'];
const KIND_OPTIONS = [
  ['media', 'Press · journalist'],
  ['industry', 'Press · industry / blogger'],
  ['prospect', 'Prospect / sales lead'],
];
function fmtDate(d) { if (!d) return '—'; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

export default function EditContactModal({ contact, onClose, onSaved, entityLabel = 'contact' }) {
  const toast = useToast();
  const Cap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
  const isPress = (contact.kind || 'media') !== 'prospect';
  const [form, setForm] = useState(() => ({
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    email: contact.email || '',
    // Pre-fill company from the linked outlet name when the freeform company
    // field is empty. Press contacts imported from an editorial-log CSV live
    // with the publication in outlet_id and company blank — the list now
    // surfaces outlet_name in the column, and the modal mirrors the same
    // behaviour so opening the contact doesn't look like the publication has
    // vanished. Saving persists it into company so the two stay in sync.
    company: contact.company || contact.outlet_name || '',
    // kind is the canonical Press / Industry / Prospect classifier — what the
    // library's filter buttons read. Default to 'media' when missing (most
    // workspaces are predominantly press).
    kind: contact.kind || 'media',
    contact_type: contact.contact_type || '',
    title: contact.title || contact.role || '',
    location: contact.location || '',
    linkedin_url: contact.linkedin_url || '',
    source: contact.source || '',
    status: contact.status || 'new',
    notes: contact.notes || '',
  }));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details');
  const [activity, setActivity] = useState(null);
  const [activityErr, setActivityErr] = useState(null);
  // Coverage + journalist-profile data lives at /pr/contacts/:id. The old
  // "View full profile →" path opened JournalistProfilePage to show this; the
  // modal is now the full profile, so we fetch the same payload up front for
  // press contacts and render coverage in its own tab.
  const [pressProfile, setPressProfile] = useState(null);
  const [pressErr, setPressErr] = useState(null);

  useEffect(() => {
    if (tab !== 'activity' || activity) return;
    api.get(`/outreach/contacts/${contact.id}/activity`)
      .then(setActivity)
      .catch(e => setActivityErr(e.message));
  }, [tab, contact.id, activity]);

  useEffect(() => {
    if (!isPress) return;
    api.get(`/pr/contacts/${contact.id}`)
      .then(setPressProfile)
      .catch(e => setPressErr(e.message));
  }, [contact.id, isPress]);

  function update(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const combinedName = [form.first_name, form.last_name].filter(Boolean).join(' ') || null;
      const updated = await api.put(`/outreach/contacts/${contact.id}`, { ...form, name: combinedName, role: form.title });
      toast(`${Cap} saved`, 'success');
      onSaved(updated);
      onClose();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={save} className="modal modal-wide">
        <div className="modal-head">
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{contact.name || contact.email || Cap}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={onClose} className="modal-close">×</button>
          </div>
        </div>

        <div className="tabs">
          <button type="button" onClick={() => setTab('details')}
            className={`tab ${tab === 'details' ? 'active' : ''}`}>Details</button>
          {isPress && (
            <button type="button" onClick={() => setTab('coverage')}
              className={`tab ${tab === 'coverage' ? 'active' : ''}`}>
              Coverage{pressProfile?.coverage ? ` (${pressProfile.coverage.length})` : ''}
            </button>
          )}
          <button type="button" onClick={() => setTab('activity')}
            className={`tab ${tab === 'activity' ? 'active' : ''}`}>Activity</button>
        </div>

        {tab === 'coverage' ? (
          <CoveragePanel profile={pressProfile} err={pressErr} entityLabel={entityLabel} />
        ) : tab === 'activity' ? (
          <ActivityPanel
            contact={contact}
            activity={activity}
            err={activityErr}
            entityLabel={entityLabel}
            onReloadActivity={() => setActivity(null)}
          />
        ) : (
        <div className="grid">
          <Section title={`${Cap} Details`}>
            <Field label="First Name">
              <input className="input" value={form.first_name} onChange={e => update('first_name', e.target.value)} />
            </Field>
            <Field label="Last Name">
              <input className="input" value={form.last_name} onChange={e => update('last_name', e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" className="input" value={form.email} onChange={e => update('email', e.target.value)} placeholder="unknown — optional" />
            </Field>
            <Field label="Publication / company">
              <input className="input" value={form.company} onChange={e => update('company', e.target.value)} placeholder="The outlet they write for, or the company they work at" />
            </Field>
            <Field label="Title">
              <input className="input" value={form.title} onChange={e => update('title', e.target.value)} placeholder="e.g. Editor, Principal Architect" />
            </Field>
            <Field label="Kind">
              <select className="input" value={form.kind} onChange={e => update('kind', e.target.value)}>
                {KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Role detail (optional)">
              <input className="input" list="contact-types" value={form.contact_type}
                onChange={e => update('contact_type', e.target.value)}
                placeholder="More specific than Kind — journalist, editor, architect, agency…" />
              <datalist id="contact-types">
                {['architect', 'interior_designer', 'journalist', 'editor', 'developer', 'retailer', 'distributor', 'agency', 'blogger', 'freelance'].map(t => <option key={t} value={t} />)}
              </datalist>
            </Field>
          </Section>

          <Section title="More Info">
            <Field label="Location">
              <input className="input" value={form.location} onChange={e => update('location', e.target.value)} placeholder="e.g. London, UK" />
            </Field>
            <Field label="LinkedIn URL">
              <input className="input" value={form.linkedin_url} onChange={e => update('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/…" />
            </Field>
            <Field label="Source">
              <input className="input" value={form.source} onChange={e => update('source', e.target.value)} placeholder="hunter / icypeas / manual / csv" />
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={e => update('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Notes" full>
              <textarea className="input" style={{ minHeight: 100, resize: 'vertical' }} value={form.notes} onChange={e => update('notes', e.target.value)} />
            </Field>
          </Section>
        </div>
        )}

        <div className="row end">
          <button type="button" onClick={onClose} className="btn btn-secondary">{tab === 'activity' ? 'Close' : 'Cancel'}</button>
          {tab !== 'activity' && (
            <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : `Save ${Cap}`}</button>
          )}
        </div>
      </form>
    </div>
  );
}

// Mautic-style engagement timeline. Loads sends + opens + clicks + replies
// for this contact and renders them top-down newest-first with a stat row
// across the top.
function ActivityPanel({ contact, activity, err, onReloadActivity, entityLabel = 'contact' }) {
  const toast = useToast();
  const [working, setWorking] = useState(null);
  if (err) {
    return <div style={{ padding: 20, color: 'var(--negative)', fontSize: 13 }}>Couldn't load activity: {err}</div>;
  }
  if (!activity) {
    return <div style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>;
  }
  const { events, totals, memberships, bounce } = activity;
  const fmtTime = (t) => {
    if (!t) return '';
    const d = new Date(t);
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const clientNameById = Object.fromEntries((memberships || []).map(m => [m.client_id, m.client_name]));
  const unsubByClient = (memberships || []).filter(m => m.unsubscribed_at);

  async function resubscribe(clientId) {
    setWorking(`resub-${clientId}`);
    try {
      await api.post(`/outreach/clients/${clientId}/contacts/${contact.id}/resubscribe`, {});
      toast(`Re-subscribed to ${clientNameById[clientId] || 'client'}`, 'success');
      onReloadActivity();
    } catch (e) { toast(e.message, 'error'); }
    finally { setWorking(null); }
  }

  async function clearBounce() {
    if (!confirm('Mark this address as healthy again? Only do this if you have a working email for them — sending to a still-bouncing address will hurt your sender reputation.')) return;
    setWorking('bounce');
    try {
      await api.post(`/outreach/contacts/${contact.id}/clear-bounce`, {});
      toast(`Bounce cleared — ${entityLabel} is sendable again`, 'success');
      onReloadActivity();
    } catch (e) { toast(e.message, 'error'); }
    finally { setWorking(null); }
  }

  return (
    <div>
      <div style={statRow}>
        <Stat label="Sent" value={totals.sent} />
        <Stat label="Opened" value={totals.opened} />
        <Stat label="Clicked" value={totals.clicked} />
        <Stat label="Replied" value={totals.replied} />
      </div>

      {bounce && (
        <div style={{ background: 'var(--negative-soft)', border: '1px solid #f5c6cb', padding: '10px 12px', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--negative)', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <strong>Hard bounce</strong> · {fmtTime(bounce.bounced_at)}
            {bounce.reason && <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 4 }}>{bounce.reason}</div>}
            <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 4 }}>
              This {entityLabel} is suppressed across every client until cleared.
            </div>
          </div>
          <button onClick={clearBounce} disabled={working === 'bounce'} style={resubBtn}>
            {working === 'bounce' ? 'Clearing…' : 'Clear bounce'}
          </button>
        </div>
      )}

      {!!unsubByClient.length && (
        <div style={{ background: 'var(--warning-soft)', border: '1px solid #f0d260', padding: '10px 12px', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--warning)', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Unsubscribed</div>
          {unsubByClient.map(m => (
            <div key={m.client_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid #f0d260', marginTop: 4 }}>
              <span>{m.client_name} <span style={{ color: 'var(--warning)', marginLeft: 6 }}>· {fmtTime(m.unsubscribed_at)}</span></span>
              <button onClick={() => resubscribe(m.client_id)} disabled={working === `resub-${m.client_id}`} style={resubBtn}>
                {working === `resub-${m.client_id}` ? 'Re-subscribing…' : 'Re-subscribe'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!events.length && (
        <div style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13, textAlign: 'center' }}>
          No emails sent to this {entityLabel} yet.
        </div>
      )}

      {!!events.length && (
        <div style={{ maxHeight: 420, overflowY: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
          {events.map((e, i) => (
            <div key={i} style={eventRow}>
              <div style={{ ...iconBadge, background: badgeColor(e.type) }}>{iconFor(e.type)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelFor(e)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.label}
                  {e.client_id && <span style={{ marginLeft: 8 }}>· {clientNameById[e.client_id] || ''}</span>}
                  {e.type === 'clicked' && e.url && <span style={{ marginLeft: 8 }}>→ {shorten(e.url)}</span>}
                  {e.type === 'replied' && e.classification && <span style={{ marginLeft: 8 }}>· {e.classification.replace(/_/g, ' ')}</span>}
                </div>
                {e.type === 'replied' && e.summary && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{e.summary}</div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>{fmtTime(e.at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function iconFor(t) {
  return { sent: '✉', opened: '👁', clicked: '🔗', replied: '↩' }[t] || '·';
}
function badgeColor(t) {
  return { sent: 'var(--accent-soft)', opened: 'var(--positive-soft)', clicked: 'var(--warning-soft)', replied: 'var(--accent-soft)' }[t] || 'var(--surface-sunken)';
}
function labelFor(e) {
  return { sent: 'Email sent', opened: 'Email opened', clicked: 'Link clicked', replied: 'Reply received' }[e.type] || e.type;
}
function shorten(u) {
  try {
    const url = new URL(u);
    return (url.host + url.pathname).slice(0, 60);
  } catch { return String(u).slice(0, 60); }
}

const statRow = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 };
const statBox = { padding: '12px 14px', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', textAlign: 'center' };
const eventRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: '1px solid #f4f4f4' };
const iconBadge = { width: 28, height: 28, borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 };
const resubBtn = { background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)', padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--text)', whiteSpace: 'nowrap' };

function Section({ title, children }) {
  return (
    <div>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '0 0 12px', paddingBottom: 8, borderBottom: '1px solid #e8e8e8' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}
function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}


// Coverage panel for press contacts — folds in what the old
// JournalistProfilePage used to show, so the modal is the full profile and
// there's no separate page to navigate to. Loads from /pr/contacts/:id.
function CoveragePanel({ profile, err, entityLabel = 'contact' }) {
  if (err) return <div style={{ padding: 20, color: 'var(--negative)', fontSize: 13 }}>Couldn't load coverage: {err}</div>;
  if (!profile) return <div style={{ padding: 20, color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>;
  const coverage = profile.coverage || [];
  const published = coverage.filter(r => r.status === 'published' || r.status === 'download').length;
  return (
    <div style={{ padding: '12px 0' }}>
      {profile.outlet && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Currently associated with <strong style={{ color: 'var(--text)' }}>{profile.outlet}</strong>.
        </p>
      )}
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Published</div><div style={{ fontSize: 22, fontWeight: 800 }}>{published}</div></div>
        <div><div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1 }}>Tracked</div><div style={{ fontSize: 22, fontWeight: 800 }}>{coverage.length}</div></div>
        {Array.isArray(profile.beats) && profile.beats.length > 0 && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Beats</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {profile.beats.map(b => <span key={b} className="chip" style={{ fontSize: 11 }}>{b}</span>)}
            </div>
          </div>
        )}
      </div>
      {Array.isArray(profile.latest_articles) && profile.latest_articles.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Latest articles <span style={{ textTransform: 'none', letterSpacing: 0 }}>· from their outlet's feed</span></div>
          <div style={{ border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', maxHeight: 200, overflow: 'auto' }}>
            {profile.latest_articles.map((a, i) => (
              <div key={i} style={{ padding: '7px 10px', borderTop: i ? '1px solid #f4f4f4' : 'none', fontSize: 13 }}>
                {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{(a.title || a.url).slice(0, 100)}</a> : (a.title || '—')}
                {a.published_at && <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}> · {fmtDate(a.published_at)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {coverage.length === 0 ? (
        <p style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No coverage logged for this {entityLabel} yet.</p>
      ) : (
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th>Client</th><th>Publication</th><th>Status</th><th>Date</th><th>Story</th></tr></thead>
          <tbody>
            {coverage.map((r, i) => (
              <tr key={i}>
                <td>{r.client || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.outlet || '—'}</td>
                <td><span className="chip" style={{ fontSize: 11 }}>{r.status}</span></td>
                <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.issue_date)}</td>
                <td>{r.story_url ? <a href={r.story_url} target="_blank" rel="noreferrer">{(r.story_title || 'View').slice(0, 60)}</a> : (r.story_title || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
