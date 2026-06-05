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
  th: ({ children }) => <th style={{ border: '2px solid var(--accent)', background: 'var(--surface-sunken)', padding: '4px 8px', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '2px solid var(--accent)', padding: '4px 8px', verticalAlign: 'top' }}>{children}</td>,
  code: ({ inline, children }) => inline
    ? <code style={{ background: 'var(--surface-sunken)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: 12 }}>{children}</code>
    : <code style={{ display: 'block', background: 'var(--surface-raised)', padding: 10, borderRadius: 4, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: '6px 0' }}>{children}</code>,
  pre: ({ children }) => <pre style={{ background: 'transparent', padding: 0, margin: 0 }}>{children}</pre>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #E7CD41', padding: '2px 10px', margin: '6px 0', color: 'var(--text-muted)', fontStyle: 'italic' }}>{children}</blockquote>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '10px 0' }} />,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{children}</a>,
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
  decision: 'var(--accent)',
  investigation: 'var(--warning)',
  pending: 'var(--accent)',
  observation: 'var(--positive)',
};

const TYPE_BG = {
  decision: 'var(--accent-soft)',
  investigation: 'var(--warning-soft)',
  pending: 'var(--accent-soft)',
  observation: 'var(--positive-soft)',
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

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>;

  const openEntries = contextLog.filter(e => e.status === 'open');
  const resolvedEntries = contextLog.filter(e => e.status === 'resolved');

  const SUGGESTIONS = [
    'Check for any anomalies this week',
    'What does our SEO performance look like?',
    'Pull the latest GA4 data and summarise it',
    'What should we investigate in the next report?',
  ];

  return (
    <div className="suite-chat" style={{ display: 'flex', gap: 24, height: 'calc(100vh - 64px)', alignItems: 'stretch' }}>

      {/* Chat panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div className="client-name" style={{ fontSize: 22 }}>{client?.name}</div>
            <h1 className="display mt-2" style={{ fontSize: 36 }}>AI <span className="text-accent">Data Analyst</span></h1>
            <p className="body mt-2">
              Claude can read live connector data, check SEO, detect anomalies, and log decisions.
            </p>
          </div>
          {messages.length > 0 && (
            <button onClick={handleClear} disabled={clearing} className="btn btn-secondary">
              {clearing ? 'Clearing…' : 'Clear history'}
            </button>
          )}
        </div>

        <div className="chat-thread">
          {messages.length === 0 && !sending && (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
                Start investigating {client?.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 24, maxWidth: 480, margin: '0 auto 24px' }}>
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
              {msg.role === 'assistant' && <div className="chat-avatar" />}
              <div style={{ maxWidth: '80%' }}>
                {msg.role === 'assistant' && msg.tools_used?.length > 0 && (
                  <div className="row wrap mb-2" style={{ gap: 4 }}>
                    {msg.tools_used.map((t, i) => (
                      <span key={i} className="chip chip-accent" style={{ fontSize: 10 }}>{TOOL_LABELS[t] || t}</span>
                    ))}
                  </div>
                )}
                <div
                  className={`chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}
                  style={msg.isError ? { background: 'var(--negative-soft)', borderColor: 'var(--negative)' } : undefined}>
                  {msg.role === 'assistant' ? (
                    <div >
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
                  <div className="chat-timestamp">
                    {new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {/* Per-message download buttons — assistant only, and
                    only on saved messages (msg.id from the DB, not the
                    optimistic placeholder we render mid-send). */}
                {msg.role === 'assistant' && msg.id && !msg.isError && (
                  <div className="row mt-2" style={{ gap: 6, paddingLeft: 4 }}>
                    <button type="button" onClick={() => downloadMessage(msg.id, 'pdf')} className="btn btn-secondary btn-sm" title="Download as PDF">↓ PDF</button>
                    <button type="button" onClick={() => downloadMessage(msg.id, 'docx')} className="btn btn-secondary btn-sm" title="Download as Word">↓ Word</button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="chat-avatar" />
              <div className="chat-bubble assistant">
                <span className="text-subtle">typing…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="chat-input-row" style={{ flexDirection: 'column', gap: 8 }}>
          {attachedFiles.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {attachedFiles.map((f, i) => (
                <span key={i} style={{ fontSize: 12, background: 'var(--surface-sunken)', border: '2px solid var(--accent)', borderRadius: 4, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📎 {f.name}
                  <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
          {/^\/report(\s|$)/i.test(input) && (
            <div className="body-xs text-subtle mt-2" style={{ paddingLeft: 4 }}>📄 Report mode — reply will format as a structured doc with downloadable PDF + Word.</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude to check data, investigate an issue, or log a decision… Type /report to format the reply as a downloadable PDF/Word report."
              className="textarea"
              rows={2}
              disabled={sending}
            />
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach image or PDF"
              className="btn btn-secondary" style={{ fontSize: 18, padding: '0 14px' }}>
              📎
            </button>
            <button type="submit" disabled={sending || (!input.trim() && attachedFiles.length === 0)} className="btn btn-primary">
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </form>
      </div>

      {/* Context log sidebar */}
      <div className="chat-sidebar">
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--text)' }}>
          Context Log
          <span style={{ fontWeight: 400, color: 'var(--text-subtle)', marginLeft: 6 }}>{openEntries.length} open</span>
        </div>

        {openEntries.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 12 }}>
            No open items. Claude will log decisions and investigations here automatically.
          </div>
        )}

        {openEntries.map(entry => (
          <div key={entry.id} style={{ borderLeft: `3px solid ${TYPE_COLOURS[entry.type]}`, background: TYPE_BG[entry.type] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLOURS[entry.type], textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {entry.type}
              </span>
              <button onClick={() => handleDeleteEntry(entry.id)} className="btn-ghost" style={{ fontSize: 11, padding: "0 2px" }} title="Remove">✕</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4, lineHeight: 1.5 }}>{entry.content}</div>
            <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 6 }}>
              {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </div>
          </div>
        ))}

        {resolvedEntries.length > 0 && (
          <button onClick={() => setShowResolved(p => !p)} className="btn btn-secondary" style={{ width: '100%', marginTop: 8, fontSize: 11 }}>
            {showResolved ? 'Hide' : 'Show'} {resolvedEntries.length} resolved
          </button>
        )}

        {showResolved && resolvedEntries.map(entry => (
          <div key={entry.id} style={{ opacity: 0.5, textDecoration: 'line-through', borderLeft: '3px solid #ccc' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>{entry.type}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{entry.content}</div>
          </div>
        ))}
      </div>

    </div>
  );
}

const suggestionStyle = {
  padding: '10px 14px', background: 'white', border: '2px solid var(--accent)',
  borderRadius: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)',
  textAlign: 'left', lineHeight: 1.4,
};

