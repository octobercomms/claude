import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import SuiteOverview from '../components/SuiteOverview';
import { useToast } from '../context/ToastContext';
import { useTabParam } from '../hooks/useTabParam';

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
  th: ({ children }) => <th style={{ border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface-sunken)', padding: '4px 8px', textAlign: 'left', fontWeight: 700 }}>{children}</th>,
  td: ({ children }) => <td style={{ border: 'var(--border-w) solid var(--card-border)', padding: '4px 8px', verticalAlign: 'top' }}>{children}</td>,
  code: ({ inline, children }) => inline
    ? <code style={{ background: 'var(--surface-sunken)', padding: '1px 5px', borderRadius: 'var(--r-sm)', fontFamily: 'monospace', fontSize: 12 }}>{children}</code>
    : <code style={{ display: 'block', background: 'var(--surface-raised)', padding: 10, borderRadius: 'var(--r-sm)', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: '6px 0' }}>{children}</code>,
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

export default function ClientChatPage({ embedded = false, clientId: clientIdProp } = {}) {
  const toast = useToast();
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
    { id: 'claude-fable-5',    label: 'Fable',    hint: 'Fastest Claude · quick lookups' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet',   hint: 'Balanced · default' },
    { id: 'claude-opus-4-8',   label: 'Opus',     hint: 'Deepest analysis' },
    { id: 'deepseek-chat',     label: 'DeepSeek', hint: '⚠ cheap, but sends this client\'s pulled data to DeepSeek — non-sensitive questions only' },
  ];
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [rangePreset, setRangePreset] = useState('auto');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // Embedded inside Data → AI Analyst: skip the standalone Overview landing and
  // go straight to chat, and use ?ctab= so we don't fight the host over ?tab=.
  const [tab, setTab] = useTabParam(embedded ? 'chat' : 'overview', ['overview', 'chat'], embedded ? 'ctab' : 'tab');
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
    <div className="suite-chat" style={{ display: 'flex', flexDirection: 'column', ...(tab === 'chat' ? { height: embedded ? 'calc(100vh - 230px)' : 'calc(100vh - 64px)' } : {}) }}>
      {!embedded && <div className="kicker"><span className="pip" />{client?.name && <span className="kicker-name">{client.name}</span>}</div>}
      {/* Skip the hero entirely when embedded with nothing to show — an empty
          hero draws a stray divider under the parent section's tabs. */}
      {(!embedded || (tab === 'chat' && messages.length > 0)) && (
        <header className="hero">
          {!embedded && (
          <div>
            <h1 className="display mt-2">AI Data Analyst</h1>
          </div>
          )}
          {tab === 'chat' && messages.length > 0 && (
            <div className="hero-actions">
              <button onClick={handleClear} disabled={clearing} className="btn btn-secondary btn-sm">
                {clearing ? 'Clearing…' : 'Clear history'}
              </button>
            </div>
          )}
        </header>
      )}

      {!embedded && (
        <SuiteTabs tabs={[
          { key: 'overview', label: 'Overview', active: tab === 'overview', onClick: () => setTab('overview') },
          { key: 'chat',     label: 'Chat',     active: tab === 'chat',     onClick: () => setTab('chat') },
        ]} />
      )}

      {tab === 'overview' && (
        <SuiteOverview
          tagline="Ask anything — get answers from the live data."
          description="A conversational layer over every connector. Ask in plain English, get answers with sources, format any reply as a client-ready report, and let Claude log decisions so the knowledge compounds."
          ctaLabel="Start a conversation"
          onCta={() => setTab('chat')}
          status={[
            { label: 'Conversation', value: messages.length ? `${messages.length} messages` : 'Not started yet', ok: messages.length > 0 },
            { label: 'Sources', value: 'Shopify · GA4 · GSC · Ads', ok: true },
          ]}
          flow={[
            { label: 'Connectors', detail: 'Shopify, GA4, GSC, Ads' },
            { label: 'Claude reads', detail: 'Live data on demand' },
            { label: 'Answer',    detail: 'Plain English, with sources' },
            { label: 'Log',       detail: 'Decisions persist in context' },
          ]}
          capabilities={[
            { tag: 'Ask',         title: 'Answer real questions',  cta: 'Start chatting', onClick: () => setTab('chat'), body: '"Why did conversions drop last week?" — Claude pulls Shopify + GA4 and answers with the live numbers, citing sources.' },
            { tag: '/report',     title: 'Turn it into a report',  cta: 'Open chat', onClick: () => setTab('chat'), body: 'Prefix any message with /report and the reply formats as a structured PDF + Word doc you can hand straight to the client.' },
            { tag: 'Attachments', title: 'Bring in images & PDFs', cta: 'Open chat', onClick: () => setTab('chat'), body: 'Drop in a competitor screenshot or a brief PDF and Claude reads it alongside the live data.' },
            { tag: 'Memory',      title: 'Knowledge that compounds', cta: 'Open chat', onClick: () => setTab('chat'), body: 'Decisions, investigations and pending items persist to a sidebar, so the next session picks up where you left off.' },
          ]}
        />
      )}

      {tab === 'chat' && (
      <div className="chat-shell">

      {/* Chat panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
                <span key={i} style={{ fontSize: 12, background: 'var(--surface-sunken)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
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
          {/* Model — pick the brain per question. Claude family for analysis on
              real client data; DeepSeek for cheap, non-sensitive questions. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 4 }}>
            <span className="caption" style={{ color: 'var(--text-subtle)' }}>🧠 Model</span>
            <select className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
              value={model} onChange={e => setModel(e.target.value)} disabled={sending}>
              {CHAT_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span className="caption" style={{ color: model === 'deepseek-chat' ? 'var(--warning)' : 'var(--text-subtle)' }}>
              {CHAT_MODELS.find(m => m.id === model)?.hint}
            </span>
          </div>

          {/* Data window — pins the date range the analyst pulls data for.
              "Auto" sends no range so the analyst chooses per question. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 4 }}>
            <span className="caption" style={{ color: 'var(--text-subtle)' }}>📅 Data window</span>
            <select className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
              value={rangePreset} onChange={e => setRangePreset(e.target.value)} disabled={sending}>
              <option value="auto">Auto (analyst decides)</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="6m">Last 6 months</option>
              <option value="12m">Last 12 months</option>
              <option value="mtd">This month</option>
              <option value="ytd">This year</option>
              <option value="custom">Custom…</option>
            </select>
            {rangePreset === 'custom' && (
              <>
                <input type="date" className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
                  value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)} disabled={sending} />
                <span className="caption" style={{ color: 'var(--text-subtle)' }}>to</span>
                <input type="date" className="input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
                  value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)} disabled={sending} />
              </>
            )}
            {rangePreset !== 'auto' && rangePreset !== 'custom' && (
              <span className="caption" style={{ color: 'var(--text-subtle)' }}>· applied to every data pull</span>
            )}
          </div>
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
          <div key={entry.id} className={`log-entry ${entry.type || ''}`}>
            <div className="log-entry-head">
              <span className="log-entry-type">{entry.type}</span>
              <button onClick={() => handleDeleteEntry(entry.id)} className="btn-ghost" style={{ fontSize: 11, padding: "0 2px" }} title="Remove">✕</button>
            </div>
            <div className="log-entry-body">{entry.content}</div>
            <div className="log-entry-date">
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
          <div key={entry.id} className="log-entry resolved">
            <div className="log-entry-type">{entry.type}</div>
            <div className="log-entry-body">{entry.content}</div>
          </div>
        ))}
      </div>

      </div>
      )}
    </div>
  );
}

const suggestionStyle = {
  padding: '10px 14px', background: 'white', border: 'var(--border-w) solid var(--card-border)',
  borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)',
  textAlign: 'left', lineHeight: 1.4,
};

