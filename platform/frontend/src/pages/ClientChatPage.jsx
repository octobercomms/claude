import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

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
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Report Chat — {client?.name}</h1>
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
                  {msg.content.split('\n').map((line, i, arr) => (
                    <React.Fragment key={i}>
                      {line}
                      {i < arr.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                  <div style={s.timestamp}>
                    {new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude to check data, investigate an issue, or log a decision…"
              style={s.textarea}
              rows={2}
              disabled={sending}
            />
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach image"
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
  toolsUsed: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  toolChip: { fontSize: 10, padding: '2px 7px', background: '#f0f4ff', color: '#3355cc', borderRadius: 10, fontWeight: 500 },
  inputRow: { display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid #e8e8e8', marginTop: 'auto' },
  textarea: { flex: 1, padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, outline: 'none' },
  sendBtn: { padding: '10px 20px', background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, alignSelf: 'flex-end' },
  btnGhost: { padding: '6px 12px', background: 'transparent', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#666' },
  sidebar: { width: 260, flexShrink: 0, borderLeft: '1px solid #e8e8e8', paddingLeft: 20, overflowY: 'auto' },
  logEntry: { padding: '8px 10px', borderRadius: 4, marginBottom: 8 },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 11, padding: '0 2px', lineHeight: 1 },
};
