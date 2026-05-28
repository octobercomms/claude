import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { primaryBtn, secondaryBtn, dangerBtn } from '../styles/theme';

// Detail view for a single press_release campaign. Opened when the AM
// clicks a press-flavoured campaign in the Campaigns tab. Two
// halves: pick journalists on the left (grouped by their beat /
// contact_type), preview the personalised pitch on the right.
export default function PressCampaignDetail({ clientId, campaignId, contacts, onExit }) {
  const toast = useToast();
  const [release, setRelease] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.get(`/press/campaigns/${campaignId}/release`)
      .then(setRelease)
      .catch(e => toast(`Could not load release: ${e.message}`, 'error'));
  }, [campaignId, toast]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function preview(contactId, force = false) {
    if (!release) return;
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
    if (!selected.size || !release) return;
    if (!confirm(`Send to ${selected.size} journalist${selected.size === 1 ? '' : 's'}? Three follow-ups will queue automatically.`)) return;
    setSending(true);
    try {
      const r = await api.post(`/press/releases/${release.id}/send`, { contact_ids: Array.from(selected) });
      toast(`Queued ${r.queued} emails.`, 'success');
      setSelected(new Set());
    } catch (e) {
      toast(`Send failed: ${e.message}`, 'error');
    } finally {
      setSending(false);
    }
  }

  const filteredContacts = (contacts || []).filter(c => {
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

  if (!release) return <div style={{ color: '#888', padding: 20 }}>Loading release…</div>;

  return (
    <div>
      <button onClick={onExit} style={{ ...secondaryBtn, padding: '5px 14px', fontSize: 12, marginBottom: 14 }}>← Back to campaigns</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>press release</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{release.title}</h2>
          {release.dateline && <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{release.dateline}</div>}
          {release.source_url && <a href={release.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#1a4f9c', display: 'inline-block', marginTop: 6 }}>↗ source page</a>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <div>
          <div style={styles.h3}>Pick journalists</div>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="filter by name, outlet or beat…"
            style={{ ...styles.input, marginBottom: 10 }} />
          <div style={{ maxHeight: 520, overflowY: 'auto', border: '1px solid #eee', borderRadius: 4 }}>
            {!filteredContacts.length && <div style={{ padding: 14, color: '#888', fontSize: 12 }}>No contacts match. Add some on the Contacts tab first.</div>}
            {groupKeys.map(beat => (
              <div key={beat}>
                <div style={styles.groupHeader}>{beat} <span style={{ color: '#999', fontWeight: 400 }}>· {grouped[beat].length}</span></div>
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
          {!previewing && <div style={{ color: '#888', fontSize: 12, padding: 14, border: '1px dashed #ddd', borderRadius: 4 }}>Click <strong>preview</strong> on a journalist to see the personalised pitch + follow-ups Claude would send them.</div>}
          {previewing && !previewData && <div style={{ color: '#888', padding: 14 }}>Generating pitch + follow-ups…</div>}
          {previewData && (
            <div>
              <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={styles.label}>Initial pitch · short personal email with the release link</div>
                <button onClick={() => preview(previewing, true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a4f9c', fontSize: 11 }}>regenerate</button>
              </div>
              <iframe srcDoc={previewData.html} title="Preview" style={{ width: '100%', height: 520, border: '1px solid #eee', borderRadius: 4, background: '#fff' }} sandbox="" />
              {previewData.follow_ups?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={styles.label}>Follow-ups · day 5 / 10 / 16 if no reply</div>
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
  input: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  contactRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: '1px solid #f4f4f4', cursor: 'pointer' },
  groupHeader: { padding: '6px 10px', background: '#f6f6f6', fontSize: 10, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
};
