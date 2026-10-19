import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Add one contact by hand.
//
// Until now the only ways into the library were the CSV wizard and the press
// paste box, both built for lists. Adding a single journalist meant typing one
// line into a paste box labelled for bulk work, and the one visible
// single-contact form (a client's leads tab) posted no kind, so the person
// arrived as a 'prospect' and never appeared in a press audience.
//
// So `kind` is stated here, not defaulted, and it is the first decision on the
// form rather than a field buried below the fold.
//
// The modal deliberately carries only what identifies someone and files them
// correctly. Everything else — country, LinkedIn, notes, status, tags,
// coverage — belongs to the edit modal, which opens on whoever was just
// created, so there is one place where a full record is maintained rather than
// two that drift.

const KIND_OPTIONS = [
  ['media', 'Press · journalist'],
  ['industry', 'Press · industry / blogger'],
  ['prospect', 'Prospect / sales lead'],
];

export default function AddContactModal({
  defaultKind = 'media',
  entityLabel = 'contact',
  clientId = null,
  onClose,
  onCreated,
}) {
  const toast = useToast();
  const Cap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
  const [form, setForm] = useState({
    kind: defaultKind,
    first_name: '',
    last_name: '',
    email: '',
    company: '',
    title: '',
    contact_type: '',
    location: '',
  });
  const [saving, setSaving] = useState(false);
  // When the person is already in the library the server hands the existing
  // record back rather than minting a second one. We hold it here and say so,
  // because a silent "saved" over someone else's record is how a careful
  // operator loses track of what they have.
  const [duplicate, setDuplicate] = useState(null);

  function update(k, v) { setForm(p => ({ ...p, [k]: v })); }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = [form.first_name, form.last_name].filter(Boolean).join(' ').trim();
  const ready = !!(form.email.trim() || name);

  async function save(e) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setDuplicate(null);
    try {
      const created = await api.post('/outreach/contacts', {
        ...form,
        name: name || null,
        role: form.title || null,
        source: 'manual',
        client_id: clientId || null,
      });
      if (created.already_in_library) {
        setDuplicate(created);
        return;
      }
      toast(`${Cap} added`, 'success');
      onCreated(created, { openForEditing: true });
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={save} className="modal">
        <div className="modal-head">
          <h2 style={{ fontSize: 'var(--fs-title)', fontWeight: 700, margin: 0 }}>Add {entityLabel}</h2>
          <button type="button" onClick={onClose} className="modal-close">×</button>
        </div>

        {duplicate ? (
          <DuplicateNotice
            existing={duplicate}
            entityLabel={entityLabel}
            intendedKind={form.kind}
            onOpen={() => onCreated(duplicate, { openForEditing: true })}
            onBack={() => setDuplicate(null)}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <Field label="Kind" hint="What this decides: press audiences, journalist search and release sends only ever see Press contacts.">
              <select className="input" value={form.kind} onChange={e => update('kind', e.target.value)}>
                {KIND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
              <Field label="First name">
                <input className="input" autoFocus value={form.first_name}
                  onChange={e => update('first_name', e.target.value)} />
              </Field>
              <Field label="Last name">
                <input className="input" value={form.last_name}
                  onChange={e => update('last_name', e.target.value)} />
              </Field>
            </div>
            <Field label="Email" hint="Optional, but nothing can be sent to them without it.">
              <input type="email" className="input" value={form.email}
                onChange={e => update('email', e.target.value)} />
            </Field>
            <Field label="Publication / company">
              <input className="input" value={form.company}
                onChange={e => update('company', e.target.value)} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
              <Field label="Title">
                <input className="input" value={form.title}
                  onChange={e => update('title', e.target.value)} />
              </Field>
              <Field label="Location">
                <input className="input" value={form.location}
                  onChange={e => update('location', e.target.value)} />
              </Field>
            </div>
            <Field label="Beat" hint="More specific than Kind.">
              <input className="input" list="add-contact-types" value={form.contact_type}
                onChange={e => update('contact_type', e.target.value)} />
              <datalist id="add-contact-types">
                {['journalist', 'editor', 'architect', 'interior_designer', 'developer',
                  'retailer', 'distributor', 'agency', 'blogger', 'freelance']
                  .map(t => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <p className="body-sm text-muted" style={{ margin: 0 }}>
              Country, LinkedIn, tags, status and notes come next, on the full record.
            </p>
          </div>
        )}

        {!duplicate && (
          <div className="row end">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !ready} className="btn btn-primary"
              title={ready ? '' : 'Give at least a name or an email address'}>
              {saving ? 'Adding…' : `Add ${entityLabel}`}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

// Already in the library. Say who they are, say whether they are filed as the
// kind that was being added (the prospect-default hole leaves journalists
// sitting in the library invisible to every press surface, and this is where
// that shows up), and open the record.
function DuplicateNotice({ existing, entityLabel, intendedKind, onOpen, onBack }) {
  const wrongKind = existing.kind !== intendedKind;
  const KIND_LABEL = Object.fromEntries(KIND_OPTIONS);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
      <div style={{
        background: 'var(--warning-soft)', border: 'var(--border-w) solid var(--card-border)',
        borderRadius: 'var(--r-sm)', padding: 'var(--s3)',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 'var(--s2)' }}>Already in your library</div>
        <div className="body-sm">
          <strong>{existing.name || existing.email}</strong>
          {existing.company ? ` · ${existing.company}` : ''}
          {existing.email ? <div style={{ color: 'var(--text-muted)' }}>{existing.email}</div> : null}
        </div>
        <div className="body-sm" style={{ marginTop: 'var(--s2)', color: 'var(--text-muted)' }}>
          Nothing was created and nothing was overwritten.
          {wrongKind
            ? ` They are filed as ${KIND_LABEL[existing.kind] || existing.kind}, not ${KIND_LABEL[intendedKind] || intendedKind}.`
            + (intendedKind === 'media'
              ? ' Until that changes they will not appear in any press audience or release send.'
              : '')
            : ''}
        </div>
      </div>
      <div className="row end">
        <button type="button" onClick={onBack} className="btn btn-secondary">Add someone else</button>
        <button type="button" onClick={onOpen} className="btn btn-primary">
          Open this {entityLabel}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label style={{
        fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 'var(--s1)',
      }}>{label}</label>
      {children}
      {hint && (
        <div className="body-sm text-muted" style={{ marginTop: 'var(--s1)' }}>{hint}</div>
      )}
    </div>
  );
}
