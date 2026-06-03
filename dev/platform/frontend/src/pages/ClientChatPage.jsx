import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Style overrides for ReactMarkdown — keeps headings, tables, lists,
// and code blocks legible inside a chat bubble. Same component set is
// reused for every assistant message.
const MD_COMPONENTS = {
  h1: ({ children }) => <div style={{ fontSize: 17, fontWeight: 700, margin: '12px 0 6px' }}>{children}</div>,
  h2: ({ children }) => <div style={{ fontSize: 15, fontWeight: 700, margin: '10px 0 5px' }}>{children}</div>,
  h3: ({ children }) => <div style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 4px' }}>{children}</div>,
  p: ({ children }) => <p style={{ margin: '4px 0' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ border: '1px solid #ddd', background: '#f3f3f3', padding: '4px 8px', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top' }}>{children}</td>,
  code: ({ inline, children }) => inline
    ? <code style={{ background: '#f4f4f4', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: 12 }}>{children}</code>
    : <code style={{ display: 'block', background: '#f6f6f6', padding: 10, borderRadius: 4, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: '6px 0' }}>{children}</code>,
  pre: ({ children }) => <pre style={{ background: 'transparent', padding: 0, margin: 0 }}>{children}</pre>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #E7CD41', padding: '2px 10px', margin: '6px 0', color: '#555', fontStyle: 'italic' }}>{children}</blockquote>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '10px 0' }} />,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'underline' }}>{children}</a>,
};

const TOOL_LABELS = {
  get_client_info: 'Client info',
  get_connector_data: 'Connector data',
  get_seo_rankings: 'SEO rankings',
  get_reports: 'Reports',
  detect_anomalies: 'Anomaly check',
  get_context_log: 'Context log',
  add_context_entry: 'Logged entry',
  resolve_context_entry: 'Resolved entry',
};

const TYPE_COLOURS = {
  decision: '#1565c0',
  investigation: '#e65100',
  pending: '#6a1b9a',
  observation: '#2e7d32',
};

const TYPE_BG = {
  decision: '#e3f2fd',
  investigation: '#fff3e0',
  pending: '#f3e5f5',
  observation: '#e8f5e9',
};

export default function ClientChatPage() {
  const toast = useToast();
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [messages, setMessages] = useState([]);
  const [contextLog, setContextLog] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/chat/${id}`),
      api.get(`/chat/${id}/context`),
    ]).then(([c, msgs, ctx]) => {
      setClient(c);
      setMessages(msgs);
      setContextLog(ctx);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Download an assistant message as PDF or DOCX. Fetches with the
  // user's bearer token (api.raw adds the Authorization header),
  // pipes the resulting Blob through an object URL + anchor click so
  // the browser saves it with the server-provided Content-Disposition
  // filename.
  async function downloadMessage(msgId, format) {
    try {
      const res = await api.raw(`/chat/${id}/messages/${msgId}/export.${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(`Download failed: ${err.message}`, 'error');
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || sending) return;

    const optimistic = {
      id: `tmp-${Date.now()}`, role: 'user',
      content: text + (attachedFiles.length ? ` [${attachedFiles.length} file(s) attached]` : ''),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setSending(true);

    try {
      let imageData = null;
      if (attachedFiles.length > 0) {
        // Convert first image to base64 for Claude vision
        const file = attachedFiles[0];
        imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ base64: reader.result.split(',')[1], mediaType: file.type, name: file.name });
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setAttachedFiles([]);
      }
      const reply = await api.post(`/chat/${id}`, { message: text, image: imageData });
      setMessages(prev => [...prev, reply]);
      api.get(`/chat/${id}/context`).then(setContextLog).catch(() => {});
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: `Sorry, something went wrong: ${err.message}`,
        created_at: new Date().toISOString(),
        isError: true,
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    setAttachedFiles(prev => [...prev, ...files].slice(0, 3));
    e.target.value = '';
  }

  async function handleClear() {
    if (!window.confirm('Clear all conversation history for this client?')) return;
    setClearing(true);
    try {
      await api.delete(`/chat/${id}`);
      setMessages([]);
    } finally {
      setClearing(false);
    }
  }

  async function handleDeleteEntry(entryId) {
    try {
      await api.delete(`/chat/${id}/context/${entryId}`);
      setContextLog(prev => prev.filter(e => e.id !== entryId));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  const openEntries = contextLog.filter(e => e.status === 'open');
  const resolvedEntries = contextLog.filter(e => e.status === 'resolved');

  const SUGGESTIONS = [
    'Check for any anomalies this week',
    'What does our SEO performance look like?',
    'Pull the latest GA4 data and summarise it',
    'What should we investigate in the next report?',
  ];

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 64px)', alignItems: 'stretch' }}>

      {/* Chat panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>AI Data Analyst — {client?.name}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
              Claude can read live connector data, check SEO, detect anomalies, and log decisions.
            </p>
          </div>
          {messages.length > 0 && (
            <button onClick={handleClear} disabled={clearing} style={s.btnGhost}>
              {clearing ? 'Clearing…' : 'Clear history'}
            </button>
          )}
        </div>

        <div style={s.thread}>
          {messages.length === 0 && !sending && (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: '#444', marginBottom: 8, fontWeight: 600 }}>
                Start investigating {client?.name}
              </div>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 24, maxWidth: 480, margin: '0 auto 24px' }}>
                Claude can pull live data, spot anomalies, check rankings, and log decisions — ask anything.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 540, margin: '0 auto' }}>
                {SUGGESTIONS.map(sg => (
                  <button key={sg} onClick={() => setInput(sg)} style={suggestionStyle}>{sg}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              {msg.role === 'assistant' && <div style={s.avatarDot} />}
              <div style={{ maxWidth: '80%' }}>
                {msg.role === 'assistant' && msg.tools_used?.length > 0 && (
                  <div style={s.toolsUsed}>
                    {msg.tools_used.map((t, i) => (
                      <span key={i} style={s.toolChip}>{TOOL_LABELS[t] || t}</span>
                    ))}
                  </div>
                )}
                <div style={{
                  ...s.bubble,
                  ...(msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant),
                  ...(msg.isError ? { background: '#fff3f3', borderColor: '#f5c6cb' } : {}),
                }}>
                  {msg.role === 'assistant' ? (
                    <div style={s.markdownBody}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                        {msg.content || ''}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content.split('\n').map((line, i, arr) => (
                      <React.Fragment key={i}>
                        {line}
                        {i < arr.length - 1 && <br />}
                      </React.Fragment>
                    ))
                  )}
                  <div style={s.timestamp}>
                    {new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {/* Per-message download buttons — assistant only, and
                    only on saved messages (msg.id from the DB, not the
                    optimistic placeholder we render mid-send). */}
                {msg.role === 'assistant' && msg.id && !msg.isError && (
                  <div style={s.downloadRow}>
                    <button type="button" onClick={() => downloadMessage(msg.id, 'pdf')} style={s.downloadBtn} title="Download as PDF">↓ PDF</button>
                    <button type="button" onClick={() => downloadMessage(msg.id, 'docx')} style={s.downloadBtn} title="Download as Word">↓ Word</button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={s.avatarDot} />
              <div style={{ ...s.bubble, ...s.bubbleAssistant }}>
                <span style={s.typing}><span /><span /><span /></span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} style={{ ...s.inputRow, flexDirection: 'column', gap: 8 }}>
          {attachedFiles.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {attachedFiles.map((f, i) => (
                <span key={i} style={{ fontSize: 12, background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📎 {f.name}
                  <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
          {/^\/report(\s|$)/i.test(input) && (
            <div style={s.reportHint}>📄 Report mode — reply will format as a structured doc with downloadable PDF + Word.</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude to check data, investigate an issue, or log a decision… Type /report to format the reply as a downloadable PDF/Word report."
              style={s.textarea}
              rows={2}
              disabled={sending}
            />
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach image or PDF"
              style={{ ...s.sendBtn, background: '#f5f5f5', color: '#555', fontSize: 18, padding: '0 14px' }}>
              📎
            </button>
            <button type="submit" disabled={sending || (!input.trim() && attachedFiles.length === 0)} style={s.sendBtn}>
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {/* Context log sidebar */}
      <div style={s.sidebar}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: '#1a1a1a' }}>
          Context Log
          <span style={{ fontWeight: 400, color: '#888', marginLeft: 6 }}>{openEntries.length} open</span>
        </div>

        {openEntries.length === 0 && (
          <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
            No open items. Claude will log decisions and investigations here automatically.
          </div>
        )}

        {openEntries.map(entry => (
          <div key={entry.id} style={{ ...s.logEntry, borderLeft: `3px solid ${TYPE_COLOURS[entry.type]}`, background: TYPE_BG[entry.type] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLOURS[entry.type], textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {entry.type}
              </span>
              <button onClick={() => handleDeleteEntry(entry.id)} style={s.deleteBtn} title="Remove">✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#333', marginTop: 4, lineHeight: 1.5 }}>{entry.content}</div>
            <div style={{ fontSize: 10, color: '#999', marginTop: 6 }}>
              {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </div>
          </div>
        ))}

        {resolvedEntries.length > 0 && (
          <button onClick={() => setShowResolved(p => !p)} style={{ ...s.btnGhost, width: '100%', marginTop: 8, fontSize: 11 }}>
            {showResolved ? 'Hide' : 'Show'} {resolvedEntries.length} resolved
          </button>
        )}

        {showResolved && resolvedEntries.map(entry => (
          <div key={entry.id} style={{ ...s.logEntry, opacity: 0.5, textDecoration: 'line-through', borderLeft: '3px solid #ccc' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>{entry.type}</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{entry.content}</div>
          </div>
        ))}
      </div>

    </div>
  );
}

const suggestionStyle = {
  padding: '10px 14px', background: 'white', border: '1px solid #e0e0e0',
  borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#444',
  textAlign: 'left', lineHeight: 1.4,
};

const s = {
  thread: { flex: 1, overflowY: 'auto', padding: '8px 0 16px', display: 'flex', flexDirection: 'column' },
  avatarDot: { width: 28, height: 28, borderRadius: '50%', background: '#1a1a1a', flexShrink: 0, marginRight: 8, marginTop: 2 },
  bubble: { padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.6, border: '1px solid transparent' },
  bubbleUser: { background: '#1a1a1a', color: 'white', borderBottomRightRadius: 3 },
  bubbleAssistant: { background: 'white', color: '#1a1a1a', border: '1px solid #e8e8e8', borderBottomLeftRadius: 3 },
  timestamp: { fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' },
  // Tame react-markdown defaults to look right inside a chat bubble.
  // Removes the big top/bottom margins on headings, pulls list bullets
  // in to the bubble's padding, makes tables compact, code blocks
  // monospace + grey, blockquotes left-bordered.
  markdownBody: {
    lineHeight: 1.5,
  },
  downloadRow: { display: 'flex', gap: 6, marginTop: 6, paddingLeft: 4 },
  downloadBtn: { background: 'white', border: '1px solid #ddd', borderRadius: 4, padding: '3px 8px', fontSize: 11, color: '#555', cursor: 'pointer' },
  reportHint: { fontSize: 11, color: '#888', marginTop: 4, paddingLeft: 4 },
  toolsUsed: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  toolChip: { fontSize: 10, padding: '2px 7px', background: '#f0f4ff', color: '#3355cc', borderRadius: 10, fontWeight: 500 },
  inputRow: { display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid #e8e8e8', marginTop: 'auto' },
  textarea: { flex: 1, padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, outline: 'none' },
  sendBtn: { padding: '10px 22px', background: '#E7CD41', color: '#1a1a1a', border: 'none', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 700, alignSelf: 'flex-end' },
  btnGhost: { padding: '6px 14px', background: '#fff', border: '1px solid #ddd', borderRadius: 999, cursor: 'pointer', fontSize: 12, color: '#1a1a1a', fontWeight: 600 },
  sidebar: { width: 260, flexShrink: 0, borderLeft: '1px solid #e8e8e8', paddingLeft: 20, overflowY: 'auto' },
  logEntry: { padding: '8px 10px', borderRadius: 4, marginBottom: 8 },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 11, padding: '0 2px', lineHeight: 1 },
};
