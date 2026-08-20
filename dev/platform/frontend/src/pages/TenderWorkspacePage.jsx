import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Tender bid workspace — the persistent page behind "Start / Continue with
// Claude". Chat that judges fit, plans the bid and produces the deliverables;
// uploaded files it reads; and the shared October bid profile it learns from.
// Deep-linkable at /tenders/:id, survives refresh (history persists server-side).

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}
function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

async function downloadBlob(path, fallbackName, toast) {
  try {
    const res = await api.raw(path);
    if (!res.ok) { toast('Download failed', 'error'); return; }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = m ? m[1] : fallbackName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { toast(e.message, 'error'); }
}

export default function TenderWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [notice, setNotice] = useState(null);
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);

  // Profile
  const [profileMd, setProfileMd] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    api.get(`/tender/notices/${id}`).then(setNotice).catch(e => toast(e.message, 'error'));
    api.get(`/tender/notices/${id}/chat`).then(setMessages).catch(() => {});
    api.get(`/tender/notices/${id}/files`).then(setFiles).catch(() => {});
    api.get('/tender/profile').then(p => setProfileMd(p.profile_md || '')).catch(() => {});
  }, [id]); // eslint-disable-line
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, sending]);

  const SUGGESTIONS = [
    'Is this a genuine fit for October? Run the go/no-go test.',
    'Draft a capability statement for this bid.',
    'Draft our responses to the buyer’s questions.',
    'What do we need to gather, and what’s the risk?',
  ];

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setMessages(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: msg }]);
    setInput(''); setSending(true);
    try {
      const reply = await api.post(`/tender/notices/${id}/chat`, { message: msg });
      setMessages(prev => [...prev, reply]);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSending(false); }
  }

  async function onUpload(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      picked.forEach(f => fd.append('files', f));
      await api.postForm(`/tender/notices/${id}/files`, fd);
      setFiles(await api.get(`/tender/notices/${id}/files`));
      toast(`Uploaded ${picked.length} file${picked.length > 1 ? 's' : ''}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function deleteFile(f) {
    if (!window.confirm(`Remove "${f.filename}"?`)) return;
    setFiles(prev => prev.filter(x => x.id !== f.id));
    try { await api.delete(`/tender/files/${f.id}`); }
    catch (e) { toast(e.message, 'error'); setFiles(await api.get(`/tender/notices/${id}/files`)); }
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const p = await api.put('/tender/profile', { profile_md: profileMd });
      setProfileMd(p.profile_md || '');
      toast('October bid profile saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingProfile(false); }
  }

  const val = notice?.value_min ? `${notice.currency || ''} ${Number(notice.value_min).toLocaleString('en-GB')}`.trim() : '—';

  return (
    <div className="stack stack-lg" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings?tab=tenders')} style={{ alignSelf: 'flex-start' }}>← Back to tenders</button>

      {/* Notice header */}
      <div className="card">
        <div className="oview-grplabel">Bid workspace</div>
        <h2 className="h3" style={{ margin: '2px 0 6px' }}>{notice?.title || 'Loading…'}</h2>
        <div className="body-sm text-muted" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><strong>Buyer:</strong> {notice?.buyer_name || '—'}{notice?.buyer_country ? ` (${notice.buyer_country})` : ''}</span>
          <span><strong>Value:</strong> {val}</span>
          <span><strong>Closes:</strong> {fmtDate(notice?.closing_at)}</span>
          {notice?.url && <a href={notice.url} target="_blank" rel="noopener noreferrer">Open the notice ↗</a>}
        </div>
        {notice?.description && <p className="body-sm" style={{ margin: '10px 0 0', color: 'var(--text-subtle)' }}>{notice.description}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        {/* Chat */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 460 }}>
          <div className="oview-grplabel">Work with Claude</div>
          <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1, minHeight: 300, maxHeight: '62vh', paddingRight: 4 }}>
            {messages.length === 0 && !sending && (
              <div className="empty" style={{ padding: 14 }}>
                <div style={{ marginBottom: 10 }}>Ask Claude to assess this tender and produce the bid. It reads your uploaded files and October’s bid profile.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUGGESTIONS.map(s => <button key={s} className="btn btn-secondary btn-sm" style={{ textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                <div className={m.role === 'user' ? '' : 'card body-sm'} style={{
                  maxWidth: m.role === 'user' ? '80%' : '96%',
                  background: m.role === 'user' ? 'var(--text)' : undefined, color: m.role === 'user' ? '#fff' : undefined,
                  borderRadius: m.role === 'user' ? 'var(--r-md)' : undefined, padding: m.role === 'user' ? '10px 14px' : undefined,
                  fontSize: 14, lineHeight: 1.55,
                }}>
                  {m.role === 'user'
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                    : <>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content || ''}</ReactMarkdown>
                        {!String(m.id).startsWith('tmp-') && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => downloadBlob(`/tender/notices/${id}/chat/${m.id}/export?format=docx`, 'bid.docx', toast)}>Download Word</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => downloadBlob(`/tender/notices/${id}/chat/${m.id}/export?format=pdf`, 'bid.pdf', toast)}>Download PDF</button>
                          </div>
                        )}
                      </>}
                </div>
              </div>
            ))}
            {sending && <div className="caption" style={{ color: 'var(--text-subtle)', padding: '4px 2px' }}>Thinking…</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask for fit, a plan, or a drafted deliverable… (Enter to send)"
              style={{ flex: 1, resize: 'vertical', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
            <button className="btn btn-primary" disabled={sending || !input.trim()} onClick={() => send()}>{sending ? 'Sending…' : 'Send'}</button>
          </div>
        </div>

        {/* Sidebar: files + profile */}
        <div className="stack stack-md">
          <div className="card">
            <div className="oview-grplabel">Files</div>
            <p className="caption" style={{ margin: '0 0 8px', color: 'var(--text-subtle)' }}>RFP pack, past bids, capability decks. Claude reads PDFs, images and text.</p>
            <input ref={fileRef} type="file" multiple onChange={onUpload} style={{ display: 'none' }} />
            <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload files'}</button>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <button className="btn-link" onClick={() => downloadBlob(`/tender/files/${f.id}/download`, f.filename, toast)}
                    style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', flex: 1, cursor: 'pointer', color: 'var(--link, #06c)', textDecoration: 'underline' }}>
                    {f.filename}
                  </button>
                  <span className="caption" style={{ color: 'var(--text-subtle)' }}>{fmtBytes(f.size_bytes)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => deleteFile(f)} title="Remove">✕</button>
                </div>
              ))}
              {!files.length && <span className="caption" style={{ color: 'var(--text-subtle)' }}>No files yet.</span>}
            </div>
          </div>

          <div className="card">
            <button className="oview-grplabel" onClick={() => setProfileOpen(o => !o)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
              October bid profile {profileOpen ? '▾' : '▸'}
            </button>
            <p className="caption" style={{ margin: '4px 0 0', color: 'var(--text-subtle)' }}>Shared across every bid — Claude reads this and gets sharper as you add wins, losses and reusable boilerplate.</p>
            {profileOpen && (
              <div style={{ marginTop: 10 }}>
                <textarea value={profileMd} onChange={e => setProfileMd(e.target.value)} rows={12}
                  style={{ width: '100%', resize: 'vertical', padding: '8px 10px', fontSize: 12.5, fontFamily: 'ui-monospace, monospace', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
                <button className="btn btn-primary btn-sm" onClick={saveProfile} disabled={savingProfile} style={{ marginTop: 8 }}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 17, fontWeight: 700, margin: '10px 0 8px' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 6px' }} {...p} />,
  h3: ({ node, ...p }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 5px' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 10px', lineHeight: 1.55 }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 10px', paddingLeft: 20 }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 10px', paddingLeft: 20 }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 5, lineHeight: 1.5 }} {...p} />,
  table: ({ node, ...p }) => <div className="md-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} {...p} /></div>,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--card-border)' }} {...p} />,
};
