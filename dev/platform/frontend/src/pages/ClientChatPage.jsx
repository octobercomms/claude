import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useTabParam } from '../hooks/useTabParam';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

// Style overrides for ReactMarkdown — keeps headings, tables, lists,
// and code blocks legible inside a chat bubble. Same component set is
// reused for every assistant message.
const MD_COMPONENTS = {
  h1: ({ children }) => <div style={{ fontSize: 'var(--fs-title)', fontWeight: 700, margin: 'var(--s3) 0 var(--s2)' }}>{children}</div>,
  h2: ({ children }) => <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s3) 0 var(--s1)' }}>{children}</div>,
  h3: ({ children }) => <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s2) 0 var(--s1)' }}>{children}</div>,
  p: ({ children }) => <p style={{ margin: 'var(--s1) 0' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: 'var(--s1) 0', paddingLeft: 'var(--s5)' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: 'var(--s1) 0', paddingLeft: 'var(--s5)' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: 'var(--s1) 0' }}>{children}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: 'var(--s2) 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-body)', width: '100%' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface-sunken)', padding: 'var(--s1) var(--s2)', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
  td: ({ children }) => <td style={{ border: 'var(--border-w) solid var(--card-border)', padding: 'var(--s1) var(--s2)', verticalAlign: 'top' }}>{children}</td>,
  code: ({ inline, children }) => inline
    ? <code style={{ background: 'var(--surface-sunken)', padding: 'var(--s1) var(--s1)', borderRadius: 'var(--r-sm)', fontFamily: 'monospace', fontSize: 'var(--fs-caption)' }}>{children}</code>
    : <code style={{ display: 'block', background: 'var(--surface-raised)', padding: 'var(--s3)', borderRadius: 'var(--r-sm)', fontFamily: 'monospace', fontSize: 'var(--fs-caption)', whiteSpace: 'pre-wrap', margin: 'var(--s2) 0' }}>{children}</code>,
  pre: ({ children }) => <pre style={{ background: 'transparent', padding: 0, margin: 0 }}>{children}</pre>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #E7CD41', padding: 'var(--s1) var(--s3)', margin: 'var(--s2) 0', color: 'var(--text-muted)', fontStyle: 'italic' }}>{children}</blockquote>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: 'var(--s3) 0' }} />,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', textDecoration: 'underline' }}>{children}</a>,
};

// Icons in the same style as the client bar's (24x24, stroked, round caps), so
// the panel's buttons read as part of the same set rather than a second idiom.
function RobotIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4" />
      <circle cx="9" cy="14" r="1.2" />
      <circle cx="15" cy="14" r="1.2" />
      <path d="M2 13v3" />
      <path d="M22 13v3" />
    </svg>
  );
}

function FileIcon({ label }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      {label === 'pdf' ? <path d="M9 15h6" /> : <><path d="M9 13h6" /><path d="M9 17h4" /></>}
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.4 11.1l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </svg>
  );
}


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

// `persona` picks which conversation this is. The backend has carried four
// PESO pillar personas since they were built — owned, shared, paid, earned —
// each with its own history thread and its own action tool, and nothing in the
// frontend had ever asked for one. The analyst panel does: on Paid you get the
// paid persona, on Owned the one that can draft content. Anything else is the
// general analyst.
export default function ClientChatPage({ embedded = false, clientId: clientIdProp, persona = 'analyst', onChatState, clearRef } = {}) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const { id: routeId } = useParams();
  const id = clientIdProp || routeId;
  const [client, setClient] = useState(null);
  const [messages, setMessages] = useState([]);
  const [contextLog, setContextLog] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState(() => localStorage.getItem('oc_analyst_model') || 'claude-sonnet-4-6');
  useEffect(() => { localStorage.setItem('oc_analyst_model', model); }, [model]);
  const CHAT_MODELS = [
    { id: 'claude-haiku-4-5',  label: 'Haiku',    hint: 'Fastest, cheapest Claude · quick lookups' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet',   hint: 'Balanced · default' },
    { id: 'claude-opus-4-8',   label: 'Opus',     hint: 'Deepest analysis' },
    { id: 'claude-fable-5',    label: 'Fable',    hint: 'Most capable Claude · premium cost' },
    { id: 'deepseek-chat',     label: 'DeepSeek', hint: '⚠ cheap, but sends this client\'s pulled data to DeepSeek — non-sensitive questions only' },
  ];
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  // Context log is folded away at the foot of the panel; closed by default.
  const [ctxOpen, setCtxOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [rangePreset, setRangePreset] = useState('auto');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // Embedded inside Data → AI Analyst: skip the standalone Overview landing and
  // go straight to chat, and use ?ctab= so we don't fight the host over ?tab=.
  // Overview deleted Oct 2026 — it described the chat rather than being it.
  // Chat is the only thing here now, embedded or not.
  const [tab, setTab] = useTabParam('chat', ['chat'], embedded ? 'ctab' : 'tab');
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/chat/${id}?thread=${persona}`),
      api.get(`/chat/${id}/context`),
    ]).then(([c, msgs, ctx]) => {
      setClient(c);
      setMessages(msgs);
      setContextLog(ctx);
    }).finally(() => setLoading(false));
    // persona belongs in here: each one is its own history thread, so moving
    // from Paid to Owned has to reload the conversation rather than leave the
    // previous section's messages on screen under a new heading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, persona]);

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

  // Resolve the selected preset (or custom dates) to a concrete {start,end}.
  // 'auto' returns null — no window is sent, so the analyst picks its own.
  function resolveRange() {
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (rangePreset === 'auto') return null;
    if (rangePreset === 'custom') return (customStart && customEnd) ? { start: customStart, end: customEnd } : null;
    const end = new Date();
    const start = new Date();
    if (rangePreset === '7d') start.setDate(end.getDate() - 7);
    else if (rangePreset === '30d') start.setDate(end.getDate() - 30);
    else if (rangePreset === '90d') start.setDate(end.getDate() - 90);
    else if (rangePreset === '6m') start.setMonth(end.getMonth() - 6);
    else if (rangePreset === '12m') start.setFullYear(end.getFullYear() - 1);
    else if (rangePreset === 'mtd') start.setDate(1);
    else if (rangePreset === 'ytd') { start.setMonth(0); start.setDate(1); }
    return { start: fmt(start), end: fmt(end) };
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
      const range = resolveRange();
      const reply = await api.post(`/chat/${id}`, {
        message: text,
        image: imageData,
        model,
        persona,
        ...(range ? { start_date: range.start, end_date: range.end } : {}),
      });
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

  // Hand the clear action and the "is there anything to clear?" flag to a host
  // (the analyst panel, which renders Clear history up beside its close button).
  // The ref is reassigned every render so the handler never goes stale.
  if (clearRef) clearRef.current = handleClear;
  useEffect(() => {
    onChatState?.({ hasMessages: messages.length > 0, clearing });
  }, [messages.length, clearing, onChatState]);

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

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 'var(--s8)' }}>Loading…</div>;

  const openEntries = contextLog.filter(e => e.status === 'open');
  const resolvedEntries = contextLog.filter(e => e.status === 'resolved');

  const SUGGESTIONS = [
    'Check for any anomalies this week',
    'What does our SEO performance look like?',
    'Pull the latest GA4 data and summarise it',
    'What should we investigate in the next report?',
  ];

  return (
    <div className="suite-chat" style={{ display: 'flex', flexDirection: 'column', ...(tab === 'chat' ? (embedded ? { flex: 1, minHeight: 0 } : { height: 'calc(100vh - 64px)' }) : {}) }}>
      {/* Embedded, the panel supplies its own header (and the Clear-history
          button beside its close ×), so the hero is only for the standalone page. */}
      {!embedded && (
        <>
          <div className="kicker"><span className="pip" />{client?.name && <span className="kicker-name">{client.name}</span>}</div>
          <header className="hero">
            <div><h1 className="display mt-2">AI Data Analyst</h1></div>
            {tab === 'chat' && messages.length > 0 && (
              <div className="hero-actions">
                <button onClick={handleClear} disabled={clearing} className="btn btn-secondary btn-sm">
                  {clearing ? 'Clearing…' : 'Clear history'}
                </button>
              </div>
            )}
          </header>
        </>
      )}

      {tab === 'chat' && (
      <>
        {/* Chat fills the panel; the thread is the only thing that scrolls. */}
        <div className="chat-thread">
          {messages.length === 0 && !sending && (
            <div style={{ padding: 'var(--s7) 0', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginBottom: 'var(--s2)', fontWeight: 600 }}>
                Start investigating {client?.name}
              </div>
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-subtle)', marginBottom: 'var(--s6)', maxWidth: 480, margin: '0 auto var(--s6)' }}>
                Claude can pull live data, spot anomalies, check rankings, and log decisions — ask anything.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)', maxWidth: 540, margin: '0 auto' }}>
                {SUGGESTIONS.map(sg => (
                  <button key={sg} onClick={() => setInput(sg)} style={suggestionStyle}>{sg}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 'var(--s3)' }}>
              {msg.role === 'assistant' && <div className="chat-avatar"><RobotIcon /></div>}
              <div style={{ maxWidth: '80%', minWidth: 0 }}>
                {msg.role === 'assistant' && msg.tools_used?.length > 0 && (
                  <div className="row wrap mb-2" style={{ gap: 'var(--s1)' }}>
                    {msg.tools_used.map((t, i) => (
                      <span key={i} className="chip chip-accent" style={{ fontSize: 'var(--fs-caption)' }}>{TOOL_LABELS[t] || t}</span>
                    ))}
                  </div>
                )}
                {/* The bubble and its download icons share a row: PDF/Word to the
                    right of the reply rather than a button bar underneath it,
                    which cost a line of height on every saved answer. */}
                <div className="chat-msg">
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
                {/* Assistant only, and only on saved messages (msg.id from the
                    DB, not the optimistic placeholder we render mid-send). */}
                {msg.role === 'assistant' && msg.id && !msg.isError && (
                  <div className="chat-msg-actions">
                    <button type="button" onClick={() => downloadMessage(msg.id, 'pdf')}
                      className="btn-icon btn-icon-sm" title="Download as PDF" aria-label="Download as PDF">
                      <FileIcon label="pdf" />
                    </button>
                    <button type="button" onClick={() => downloadMessage(msg.id, 'docx')}
                      className="btn-icon btn-icon-sm" title="Download as Word" aria-label="Download as Word">
                      <FileIcon label="docx" />
                    </button>
                  </div>
                )}
                </div>
              </div>
            </div>
          ))}

          {sending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
              <div className="chat-avatar"><RobotIcon /></div>
              <div className="chat-bubble assistant">
                <span className="text-subtle">typing…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="chat-input-row" style={{ flexDirection: 'column', gap: 'var(--s2)' }}>
          {attachedFiles.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
              {attachedFiles.map((f, i) => (
                <span key={i} style={{ fontSize: 'var(--fs-caption)', background: 'var(--surface-sunken)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 'var(--s1) var(--s2)', display: 'flex', alignItems: 'center', gap: 'var(--s1)' }}>
                  📎 {f.name}
                  <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                    className="btn-icon btn-icon-sm">×</button>
                </span>
              ))}
            </div>
          )}
          {/^\/report(\s|$)/i.test(input) && (
            <div className="body-xs text-subtle mt-2" style={{ paddingLeft: 'var(--s1)' }}>📄 Report mode — reply will format as a structured doc with downloadable PDF + Word.</div>
          )}
          {/* Model and data window on one line. Each option's detail lives in
              the select's own title, so the row costs one line instead of four.
              The DeepSeek warning is the exception and stays on screen: it says
              this client's pulled data leaves for a third party, which is not
              something to hide behind a hover. */}
          <div className="chat-controls">
            <span className="caption chat-controls-label">Model</span>
            <select className="input" value={model} onChange={e => setModel(e.target.value)} disabled={sending}
              title={CHAT_MODELS.map(m => `${m.label} — ${m.hint}`).join('\n')}>
              {CHAT_MODELS.map(m => <option key={m.id} value={m.id} title={m.hint}>{m.label}</option>)}
            </select>
            <span className="caption chat-controls-label">Window</span>
            <select className="input" value={rangePreset} onChange={e => setRangePreset(e.target.value)} disabled={sending}
              title="The date range every data pull uses. Auto lets the analyst choose per question.">
              <option value="auto">Auto</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="6m">6 months</option>
              <option value="12m">12 months</option>
              <option value="mtd">This month</option>
              <option value="ytd">This year</option>
              <option value="custom">Custom…</option>
            </select>
            {rangePreset === 'custom' && (
              <>
                <input type="date" className="input" aria-label="Range start"
                  value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)} disabled={sending} />
                <input type="date" className="input" aria-label="Range end"
                  value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)} disabled={sending} />
              </>
            )}
            {model === 'deepseek-chat' && (
              <span className="caption" style={{ color: 'var(--warning)' }}>
                sends this client's pulled data to DeepSeek
              </span>
            )}
          </div>
          {/* Attach above Send in a column beside the box. In a row they
              stretched to the textarea's height and read as tall slabs; sized
              to their own content they are the pills `.btn` already describes. */}
          <div className="chat-send-row">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude to check data, investigate an issue, or log a decision… Type /report for a downloadable PDF/Word report."
              className="textarea"
              rows={2}
              disabled={sending}
            />
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            <div className="chat-send-actions">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                title="Attach image or PDF" aria-label="Attach image or PDF"
                className="btn btn-secondary btn-sm">
                <ClipIcon />
              </button>
              <button type="submit" {...roWrite(readOnly, { disabled: sending || (!input.trim() && attachedFiles.length === 0) })} className="btn btn-primary btn-sm">
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </form>

        {/* Context log — folded into a thin bar at the foot of the panel. The
            body sits above the toggle, so opening it grows upward. */}
        <div className="analyst-ctx">
          {ctxOpen && (
            <div className="analyst-ctx-body">
              {openEntries.length === 0 && (
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginBottom: 'var(--s3)' }}>
                  No open items. Claude will log decisions and investigations here automatically.
                </div>
              )}

              {openEntries.map(entry => (
                <div key={entry.id} className={`log-entry ${entry.type || ''}`}>
                  <div className="log-entry-head">
                    <span className="log-entry-type">{entry.type}</span>
                    <button onClick={() => handleDeleteEntry(entry.id)} className="btn-ghost" style={{ fontSize: 'var(--fs-caption)', padding: "0 var(--s1)" }} title="Remove">✕</button>
                  </div>
                  <div className="log-entry-body">{entry.content}</div>
                  <div className="log-entry-date">
                    {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              ))}

              {resolvedEntries.length > 0 && (
                <button onClick={() => setShowResolved(p => !p)} className="btn btn-secondary" style={{ width: '100%', marginTop: 'var(--s2)', fontSize: 'var(--fs-caption)' }}>
                  {showResolved ? 'Hide' : 'Show'} {resolvedEntries.length} resolved
                </button>
              )}

              {showResolved && resolvedEntries.map(entry => (
                <div key={entry.id} className="log-entry resolved">
                  <div className="log-entry-type">{entry.type}</div>
                  <div className="log-entry-body">{entry.content}</div>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="analyst-ctx-toggle" onClick={() => setCtxOpen(o => !o)} aria-expanded={ctxOpen}>
            <span>Context Log <span className="analyst-ctx-count">{openEntries.length} open</span></span>
            <span className="analyst-ctx-caret" aria-hidden="true">{ctxOpen ? '▾' : '▴'}</span>
          </button>
        </div>
      </>
      )}
    </div>
  );
}

const suggestionStyle = {
  padding: 'var(--s3) var(--s4)', background: 'white', border: 'var(--border-w) solid var(--card-border)',
  borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)',
  textAlign: 'left', lineHeight: 1.4,
};

