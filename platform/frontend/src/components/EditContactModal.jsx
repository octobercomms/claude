import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Two-column edit modal — Contact Details on the left, More Info on the right,
// matching the original WordPress plugin layout.
const STATUS_OPTIONS = ['new', 'active', 'unsubscribed', 'bounced', 'do_not_contact'];

export default function EditContactModal({ contact, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    email: contact.email || '',
    company: contact.company || '',
    contact_type: contact.contact_type || '',
    title: contact.title || contact.role || '',
    location: contact.location || '',
    linkedin_url: contact.linkedin_url || '',
    source: contact.source || '',
    status: contact.status || 'new',
    notes: contact.notes || '',
  }));
  const [saving, setSaving] = useState(false);

  function update(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const combinedName = [form.first_name, form.last_name].filter(Boolean).join(' ') || null;
      const updated = await api.put(`/outreach/contacts/${contact.id}`, { ...form, name: combinedName, role: form.title });
      toast('Contact saved', 'success');
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
    <div style={styles.overlay} onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={save} style={styles.modal}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Edit Contact</h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>×</button>
        </div>

        <div style={styles.grid}>
          <Section title="Contact Details">
            <Field label="First Name">
              <input style={styles.input} value={form.first_name} onChange={e => update('first_name', e.target.value)} />
            </Field>
            <Field label="Last Name">
              <input style={styles.input} value={form.last_name} onChange={e => update('last_name', e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" style={styles.input} value={form.email} onChange={e => update('email', e.target.value)} required />
            </Field>
            <Field label="Company / Practice">
              <input style={styles.input} value={form.company} onChange={e => update('company', e.target.value)} />
            </Field>
            <Field label="Title">
              <input style={styles.input} value={form.title} onChange={e => update('title', e.target.value)} placeholder="e.g. Principal Architect" />
            </Field>
            <Field label="Contact Type">
              <input style={styles.input} list="contact-types" value={form.contact_type}
                onChange={e => update('contact_type', e.target.value)} placeholder="architect / journalist / …" />
              <datalist id="contact-types">
                {['architect', 'interior_designer', 'journalist', 'editor', 'developer', 'retailer', 'distributor', 'agency'].map(t => <option key={t} value={t} />)}
              </datalist>
            </Field>
          </Section>

          <Section title="More Info">
            <Field label="Location">
              <input style={styles.input} value={form.location} onChange={e => update('location', e.target.value)} placeholder="e.g. London, UK" />
            </Field>
            <Field label="LinkedIn URL">
              <input style={styles.input} value={form.linkedin_url} onChange={e => update('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/…" />
            </Field>
            <Field label="Source">
              <input style={styles.input} value={form.source} onChange={e => update('source', e.target.value)} placeholder="hunter / icypeas / manual / csv" />
            </Field>
            <Field label="Status">
              <select style={styles.input} value={form.status} onChange={e => update('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Notes" full>
              <textarea style={{ ...styles.input, minHeight: 100, resize: 'vertical' }} value={form.notes} onChange={e => update('notes', e.target.value)} />
            </Field>
          </Section>
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.btnGhost}>Cancel</button>
          <button type="submit" disabled={saving} style={styles.btn}>{saving ? 'Saving…' : 'Save Contact'}</button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', margin: '0 0 12px', paddingBottom: 8, borderBottom: '1px solid #e8e8e8' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}
function Field({ label, children, full }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 800, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  closeBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 28 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #e8e8e8' },
  input: { padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  btn: { padding: '9px 18px', fontSize: 13, fontWeight: 600, background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  btnGhost: { padding: '9px 18px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' },
};
