import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { primaryBtn, secondaryBtn, dangerBtn } from '../styles/theme';

// Press-release outreach. Three-step flow: paste a downloadfor.press
// URL → preview the parsed release → pick journalists + send. The
// platform writes a Claude-personalised intro per recipient and
// schedules three follow-up chase emails automatically.
export default function PressPanel({ clientId, contacts }) {
  const toast = useToast();
  const [releases, setReleases] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [showFetch, setShowFetch] = useState(false);
  const [url, setUrl] = useState('');
  const [parsed, setParsed] = useState(null);
  const [fetching, setFetching] = useState(false);

  async function refresh() {
    try {
      const r = await api.get(`/press/clients/${clientId}/releases`);
      setReleases(r);
      if (r.length && !activeId) setActiveId(r[0].id);
    } catch (e) {
      toast(`Could not load press releases: ${e.message}`, 'error');
    }
  }
  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

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

  async function saveParsed() {
    if (!parsed) return;
    try {
      const saved = await api.post(`/press/clients/${clientId}/releases`, parsed);
      setReleases(prev => [saved, ...prev]);
      setActiveId(saved.id);
      setShowFetch(false);
      setParsed(null);
      setUrl('');
      toast('Press release saved.', 'success');
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'error');
    }
  }

  async function deleteRelease(id) {
    if (!confirm('Delete this press release? Any sends already queued will be cancelled.')) return;
    try {
      await api.delete(`/press/releases/${id}`);
      const next = releases.filter(r => r.id !== id);
      setReleases(next);
      if (activeId === id) setActiveId(next[0]?.id || null);
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  const active = releases.find(r => r.id === activeId);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Press releases</h2>
          <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0', maxWidth: 720, lineHeight: 1.5 }}>
            Paste a downloadfor.press URL (or any public release page). The platform fetches the content,
            wraps it in a journalist-friendly HTML email, writes a personalised intro per recipient via Claude,
            and queues three follow-up chase emails on a 5 / 10 / 16-day cadence.
          </p>
        </div>
        <button style={primaryBtn} onClick={() => setShowFetch(true)}>+ Fetch release</button>
      </div>

      {showFetch && (
        <FetchModal
          url={url} setUrl={setUrl} parsed={parsed} setParsed={setParsed}
          onFetch={doFetch} onSave={saveParsed} fetching={fetching}
          onClose={() => { setShowFetch(false); setParsed(null); setUrl(''); }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, marginTop: 14 }}>
        <div>
          <div style={styles.h3}>Saved releases</div>
          {!releases.length && <div style={{ fontSize: 12, color: '#888' }}>Nothing yet. Click Fetch release to start.</div>}
          {releases.map(r => (
            <div key={r.id} onClick={() => setActiveId(r.id)} style={{ ...styles.releaseRow, ...(r.id === activeId ? styles.releaseRowActive : {}) }}>
              <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>{r.title}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                {new Date(r.created_at).toLocaleDateString('en-GB')}{r.campaign_id ? ' · sent' : ' · draft'}
              </div>
            </div>
          ))}
        </div>

        <div>
          {!active && <div style={{ color: '#888', padding: 16 }}>Pick a release on the left, or fetch a new one.</div>}
          {active && <ReleaseDetail release={active} contacts={contacts} onDelete={() => deleteRelease(active.id)} clientId={clientId} />}
        </div>
      </div>
    </div>
  );
}

function FetchModal({ url, setUrl, parsed, setParsed, onFetch, onSave, fetching, onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Fetch a press release</h2>
        <label style={styles.label}>downloadfor.press URL (or any public release page)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://downloadfor.press/r/your-release"
            style={{ ...styles.input, flex: 1 }} />
          <button onClick={onFetch} disabled={fetching || !url.trim()} style={primaryBtn}>{fetching ? 'Fetching…' : 'Fetch'}</button>
        </div>

        {parsed && (
          <div style={{ marginTop: 18, padding: 14, background: '#fafafa', border: '1px solid #eee', borderRadius: 4, maxHeight: 480, overflowY: 'auto' }}>
            <div style={styles.label}>Parsed preview — edit if needed before saving</div>
            <label style={{ ...styles.label, marginTop: 8 }}>Title</label>
            <input value={parsed.title || ''} onChange={e => setParsed({ ...parsed, title: e.target.value })} style={styles.input} />
            <label style={{ ...styles.label, marginTop: 8 }}>Dateline</label>
            <input value={parsed.dateline || ''} onChange={e => setParsed({ ...parsed, dateline: e.target.value })} style={styles.input} placeholder="London, 28 May 2026" />
            <label style={{ ...styles.label, marginTop: 8 }}>Body (HTML)</label>
            <textarea rows={8} value={parsed.body_html || ''} onChange={e => setParsed({ ...parsed, body_html: e.target.value })}
              style={{ ...styles.input, minHeight: 160, fontFamily: 'monospace', fontSize: 12 }} />
            <label style={{ ...styles.label, marginTop: 8 }}>Press contact block</label>
            <textarea rows={3} value={parsed.contact_block || ''} onChange={e => setParsed({ ...parsed, contact_block: e.target.value })}
              style={{ ...styles.input, minHeight: 70 }} />
            <label style={{ ...styles.label, marginTop: 8 }}>Boilerplate / Notes to editors</label>
            <textarea rows={3} value={parsed.boilerplate || ''} onChange={e => setParsed({ ...parsed, boilerplate: e.target.value })}
              style={{ ...styles.input, minHeight: 70 }} />
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
          {parsed && <button style={primaryBtn} onClick={onSave}>Save release</button>}
        </div>
      </div>
    </div>
  );
}

function ReleaseDetail({ release, contacts, onDelete, clientId }) {
  const toast = useToast();
  const [previewing, setPreviewing] = useState(null);     // contact id being previewed
  const [previewData, setPreviewData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState('');

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function preview(contactId, force = false) {
    setPreviewing(contactId);
    setPreviewData(null);
    try {
      const p = await api.post(`/press/releases/${release.id}/preview`, { contact_id: contactId, force });
      setPreviewData(p);
    } catch (e) {
      toast(`Preview failed: ${e.message}`, 'error');
      setPreviewing(null);
    }
  }

  async function send() {
    if (!selected.size) return;
    if (!confirm(`Send the release to ${selected.size} journalist${selected.size === 1 ? '' : 's'}? Three follow-ups will be queued automatically.`)) return;
    setSending(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/send`, { contact_ids: Array.from(selected) });
      toast(`Queued ${r.queued} emails (release + 3 follow-ups per recipient).`, 'success');
      setSelected(new Set());
    } catch (e) {
      toast(`Send failed: ${e.message}`, 'error');
    } finally {
      setSending(false);
    }
  }

  // Group contacts by their `contact_type` (the field where journalists'
  // beats / topics live) so the AM can scan by topic before selecting.
  const filteredContacts = contacts.filter(c => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (c.name || '').toLowerCase().includes(f)
        || (c.company || '').toLowerCase().includes(f)
        || (c.contact_type || '').toLowerCase().includes(f);
  });
  const grouped = {};
  for (const c of filteredContacts) {
    const key = c.contact_type || 'untagged';
    (grouped[key] = grouped[key] || []).push(c);
  }
  const groupKeys = Object.keys(grouped).sort();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{release.title}</h2>
          {release.dateline && <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{release.dateline}</div>}
          {release.source_url && <a href={release.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1a4f9c', display: 'inline-block', marginTop: 6 }}>↗ source page</a>}
        </div>
        <button onClick={onDelete} style={{ ...dangerBtn, padding: '5px 12px', fontSize: 12 }}>Delete</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div>
          <div style={styles.h3}>Pick journalists</div>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="filter by name, outlet or beat…"
            style={{ ...styles.input, marginBottom: 10 }} />
          <div style={{ maxHeight: 480, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
            {!filteredContacts.length && <div style={{ padding: 14, color: '#888', fontSize: 12 }}>No contacts match.</div>}
            {groupKeys.map(beat => (
              <div key={beat}>
                <div style={styles.groupHeader}>{beat}</div>
                {grouped[beat].map(c => (
                  <label key={c.id} style={styles.contactRow}>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name || '(no name)'} {c.company && <span style={{ color: '#888', fontWeight: 400 }}>· {c.company}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </div>
                    <button onClick={(e) => { e.preventDefault(); preview(c.id); }} type="button" style={{ ...secondaryBtn, padding: '3px 10px', fontSize: 11 }}>preview</button>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <div style={{ fontSize: 12, color: '#666' }}>{selected.size} selected</div>
            <button onClick={send} disabled={!selected.size || sending} style={primaryBtn}>
              {sending ? 'Queueing…' : `Send to ${selected.size}`}
            </button>
          </div>
        </div>

        <div>
          <div style={styles.h3}>Preview {previewData?.contact ? `· ${previewData.contact.name || previewData.contact.email}` : ''}</div>
          {!previewing && <div style={{ color: '#888', fontSize: 12, padding: 14, border: '1px dashed #ddd', borderRadius: 4 }}>Click <strong>preview</strong> on a journalist to see the personalised intro + email Claude would send them.</div>}
          {previewing && !previewData && <div style={{ color: '#888', padding: 14 }}>Generating intro + follow-ups…</div>}
          {previewData && (
            <div>
              <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={styles.label}>Initial email — short personal pitch with link to the release</div>
                <button onClick={() => preview(previewing, true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a4f9c', fontSize: 11 }}>regenerate</button>
              </div>
              <iframe srcDoc={previewData.html} title="Preview" style={{ width: '100%', height: 520, border: '1px solid #eee', borderRadius: 4, background: '#fff' }} sandbox="" />
              {previewData.follow_ups?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={styles.label}>Follow-ups · sent on day 5 / 10 / 16 if no reply</div>
                  {previewData.follow_ups.map((fu, i) => (
                    <div key={i} style={{ marginTop: 8, padding: 10, background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{i + 1}. {fu.subject}</div>
                      <div style={{ fontSize: 12, color: '#444', marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{fu.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  h3: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  releaseRow: { padding: 10, border: '1px solid #eee', borderRadius: 4, marginBottom: 8, cursor: 'pointer', background: '#fff' },
  releaseRowActive: { background: '#fffceb', borderColor: '#E7CD41' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', zIndex: 1000, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 720, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
  contactRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: '1px solid #f4f4f4', cursor: 'pointer' },
  groupHeader: { padding: '6px 10px', background: '#f6f6f6', fontSize: 10, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
};
