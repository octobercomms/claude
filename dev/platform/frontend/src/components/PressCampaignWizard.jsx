import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Two-step modal: paste downloadfor.press URL → preview parsed release
// → save. Saving creates both the press_release row and a backing
// campaign (kind='press_release') in one shot.
//
// `initialUrl` lets the unified NewCampaignModal launch this with the
// URL already filled in — we auto-fetch on mount so the AM lands
// directly on the parsed preview.
export default function PressCampaignWizard({ clientId, initialUrl = '', onClose, onCreated }) {
  const toast = useToast();
  const [url, setUrl] = useState(initialUrl);
  const [parsed, setParsed] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function doFetch(seedUrl) {
    const u = (seedUrl ?? url).trim();
    if (!u) return;
    setFetching(true);
    try {
      const p = await api.post('/press/parse', { url: u });
      setParsed(p);
    } catch (e) {
      toast(`Could not fetch: ${e.message}`, 'error');
    } finally {
      setFetching(false);
    }
  }

  // Auto-fetch when the modal is opened with a URL already in hand
  // (i.e. the unified "+ New campaign" modal handed it over).
  useEffect(() => {
    if (initialUrl) doFetch(initialUrl);
    // eslint-disable-next-line
  }, [initialUrl]);

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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>New press campaign</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Paste a downloadfor.press URL (or another public release page). The platform fetches the content,
          creates a campaign for it, and stages a 4-step sequence (initial pitch + three follow-ups). Claude
          personalises the pitch per recipient when you pick journalists.
        </p>

        <label className="field-label">URL</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && doFetch()}
            placeholder="https://downloadfor.press/press-releases/your-release-slug/"
            className="input" style={{ flex: 1 }} />
          <button onClick={doFetch} disabled={fetching || !url.trim()} className="btn btn-primary">{fetching ? 'Fetching…' : 'Fetch'}</button>
        </div>

        {parsed && (
          <div style={{ marginTop: 18, padding: 14, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', maxHeight: 460, overflowY: 'auto' }}>
            <div className="field-label">Parsed preview — edit if needed</div>
            <label className="field-label" style={{ marginTop: 8 }}>Title</label>
            <input value={parsed.title || ''} onChange={e => setParsed({ ...parsed, title: e.target.value })} className="input" />
            <label className="field-label" style={{ marginTop: 8 }}>Dateline</label>
            <input value={parsed.dateline || ''} onChange={e => setParsed({ ...parsed, dateline: e.target.value })}
              placeholder="London, 28 May 2026" className="input" />
            <label className="field-label" style={{ marginTop: 8 }}>Body (HTML)</label>
            <textarea rows={8} value={parsed.body_html || ''} onChange={e => setParsed({ ...parsed, body_html: e.target.value })}
              className="input" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }} />
            <label className="field-label" style={{ marginTop: 8 }}>Press contact</label>
            <textarea rows={2} value={parsed.contact_block || ''} onChange={e => setParsed({ ...parsed, contact_block: e.target.value })} className="input" style={{ minHeight: 50 }} />
            <label className="field-label" style={{ marginTop: 8 }}>Notes to editors / boilerplate</label>
            <textarea rows={3} value={parsed.boilerplate || ''} onChange={e => setParsed({ ...parsed, boilerplate: e.target.value })} className="input" style={{ minHeight: 70 }} />
            {parsed.images?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="field-label">{parsed.images.length} image{parsed.images.length === 1 ? '' : 's'} found</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {parsed.images.slice(0, 6).map((img, i) => (
                    <img key={i} src={img.src} alt={img.alt} style={{ height: 52, borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)' }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {parsed && <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create campaign'}</button>}
        </div>
      </div>
    </div>
  );
}

