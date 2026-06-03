import React, { useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { primaryBtn, secondaryBtn } from '../styles/theme';

// Two-step modal: paste downloadfor.press URL → preview parsed release
// → save. Saving creates both the press_release row and a backing
// campaign (kind='press_release') in one shot.
export default function PressCampaignWizard({ clientId, onClose, onCreated }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [parsed, setParsed] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function doFetch() {
    if (!url.trim()) return;
    setFetching(true);
    try {
      const p = await api.post('/press/parse', { url: url.trim() });
      setParsed(p);
    } catch (e) {
      toast(`Could not fetch: ${e.message}`, 'error');
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    if (!parsed) return;
    setSaving(true);
    try {
      const saved = await api.post(`/press/clients/${clientId}/releases`, parsed);
      toast('Press campaign created.', 'success');
      onCreated?.(saved);
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>New press campaign</h2>
        <p style={{ fontSize: 12, color: '#666', margin: '0 0 16px', lineHeight: 1.5 }}>
          Paste a downloadfor.press URL (or another public release page). The platform fetches the content,
          creates a campaign for it, and stages a 4-step sequence (initial pitch + three follow-ups). Claude
          personalises the pitch per recipient when you pick journalists.
        </p>

        <label style={styles.label}>URL</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && doFetch()}
            placeholder="https://downloadfor.press/press-releases/your-release-slug/"
            style={{ ...styles.input, flex: 1 }} />
          <button onClick={doFetch} disabled={fetching || !url.trim()} style={primaryBtn}>{fetching ? 'Fetching…' : 'Fetch'}</button>
        </div>

        {parsed && (
          <div style={{ marginTop: 18, padding: 14, background: '#fafafa', border: '1px solid #eee', borderRadius: 4, maxHeight: 460, overflowY: 'auto' }}>
            <div style={styles.label}>Parsed preview — edit if needed</div>
            <label style={{ ...styles.label, marginTop: 8 }}>Title</label>
            <input value={parsed.title || ''} onChange={e => setParsed({ ...parsed, title: e.target.value })} style={styles.input} />
            <label style={{ ...styles.label, marginTop: 8 }}>Dateline</label>
            <input value={parsed.dateline || ''} onChange={e => setParsed({ ...parsed, dateline: e.target.value })}
              placeholder="London, 28 May 2026" style={styles.input} />
            <label style={{ ...styles.label, marginTop: 8 }}>Body (HTML)</label>
            <textarea rows={8} value={parsed.body_html || ''} onChange={e => setParsed({ ...parsed, body_html: e.target.value })}
              style={{ ...styles.input, minHeight: 160, fontFamily: 'monospace', fontSize: 12 }} />
            <label style={{ ...styles.label, marginTop: 8 }}>Press contact</label>
            <textarea rows={2} value={parsed.contact_block || ''} onChange={e => setParsed({ ...parsed, contact_block: e.target.value })} style={{ ...styles.input, minHeight: 50 }} />
            <label style={{ ...styles.label, marginTop: 8 }}>Notes to editors / boilerplate</label>
            <textarea rows={3} value={parsed.boilerplate || ''} onChange={e => setParsed({ ...parsed, boilerplate: e.target.value })} style={{ ...styles.input, minHeight: 70 }} />
            {parsed.images?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={styles.label}>{parsed.images.length} image{parsed.images.length === 1 ? '' : 's'} found</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {parsed.images.slice(0, 6).map((img, i) => (
                    <img key={i} src={img.src} alt={img.alt} style={{ height: 52, borderRadius: 3, border: '1px solid #ddd' }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={secondaryBtn} onClick={onClose}>Cancel</button>
          {parsed && <button style={primaryBtn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create campaign'}</button>}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 720, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
};
