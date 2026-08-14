import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Ask-the-strategist chat. Same tool-using agent as the AI Data Analyst (it can
// pull live connector data, SEO, CRO) but with the strategist persona and its
// own conversation thread, grounded in the latest cross-PESO briefing. Any
// answer can be downloaded as a PDF/Word report; prefix a message with /report
// to have the reply formatted as a self-contained report.

const SUGGESTIONS = [
  'What should we focus on for this client over the next month?',
  'Why is that the top priority — walk me through the numbers.',
  'Where are we leaving money on the table right now?',
  '/report Write a board-ready summary of where the account stands.',
];

export default function StrategistChat({ clientId }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    api.get(`/chat/${clientId}?thread=strategist`).then(setMessages).catch(e => toast(e.message, 'error'));
  }, [clientId]); // eslint-disable-line

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    const optimistic = { id: `tmp-${Date.now()}`, role: 'user', content: msg, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setSending(true);
    try {
      const reply = await api.post(`/chat/${clientId}`, { message: msg, persona: 'strategist', model: 'claude-opus-4-8' });
      setMessages(prev => [...prev, reply]);
    } catch (e) {
      toast(e.message, 'error');
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInput(msg);
    } finally { setSending(false); }
  }

  async function download(msgId, format) {
    const key = `${msgId}.${format}`;
    setDownloading(key);
    try {
      const res = await api.raw(`/chat/${clientId}/messages/${msgId}/export.${format}`);
      if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `strategist-answer.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast(`Download failed: ${e.message}`, 'error'); }
    finally { setDownloading(null); }
  }

  // Promote a point from the conversation into the briefing steer notes, so the
  // next weekly briefing is informed by it.
  async function addToBriefing(text) {
    try {
      await api.post(`/strategist/clients/${clientId}/steer`, { text: (text || '').slice(0, 4000), source: 'chat' });
      toast('Added to the briefing notes');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function clearChat() {
    if (!confirm('Clear this strategist conversation?')) return;
    try { await api.delete(`/chat/${clientId}?thread=strategist`); setMessages([]); }
    catch (e) { toast(e.message, 'error'); }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <p className="caption" style={{ color: 'var(--text-subtle)' }}>
          Grounded in the latest briefing — it can pull live data to answer. Type <code>/report</code> for a formatted, downloadable report.
        </p>
        {messages.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clearChat}>Clear</button>}
      </div>

      <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: '58vh', minHeight: 120, paddingRight: 4 }}>
        {messages.length === 0 && !sending && (
          <div className="empty" style={{ padding: 18 }}>
            <div style={{ marginBottom: 12 }}>Ask the strategist anything about this account.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} className="btn btn-secondary btn-sm" style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                  onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div className={m.role === 'user' ? '' : 'card body-sm'} style={{
              maxWidth: m.role === 'user' ? '80%' : '92%',
              background: m.role === 'user' ? 'var(--text)' : undefined,
              color: m.role === 'user' ? '#fff' : undefined,
              borderRadius: m.role === 'user' ? 'var(--r-md)' : undefined,
              padding: m.role === 'user' ? '10px 14px' : undefined,
              fontSize: 14, lineHeight: 1.55,
            }}>
              {m.role === 'user'
                ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                : <>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content || ''}</ReactMarkdown>
                    {!String(m.id).startsWith('tmp-') && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: '1px solid var(--card-border)', paddingTop: 8 }}>
                        <button className="btn btn-ghost btn-sm" disabled={!!downloading} onClick={() => download(m.id, 'pdf')} title="Download this answer as a PDF">
                          {downloading === `${m.id}.pdf` ? '…' : '↓ PDF'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={!!downloading} onClick={() => download(m.id, 'docx')} title="Download this answer as a Word doc">
                          {downloading === `${m.id}.docx` ? '…' : '↓ Word'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => addToBriefing(m.content)} title="Feed this into the next weekly briefing">
                          + Add to briefing
                        </button>
                      </div>
                    )}
                  </>}
            </div>
          </div>
        ))}

        {sending && <div className="caption" style={{ color: 'var(--text-subtle)', padding: '4px 2px' }}>The strategist is thinking — checking the data…</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
        <textarea ref={taRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} rows={2}
          placeholder="Ask the strategist… (Enter to send, Shift+Enter for a new line). Prefix /report for a downloadable report."
          style={{ flex: 1, resize: 'vertical', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
            border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
        <button className="btn btn-primary" disabled={sending || !input.trim()} onClick={() => send()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: '10px 0 8px' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 15, fontWeight: 700, margin: '14px 0 8px' }} {...p} />,
  h3: ({ node, ...p }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '12px 0 6px' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 10px', lineHeight: 1.55 }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 10px', paddingLeft: 20 }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 10px', paddingLeft: 20 }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 5, lineHeight: 1.5 }} {...p} />,
  table: ({ node, ...p }) => <div className="md-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} {...p} /></div>,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: '7px 9px', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 12 }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: '6px 9px', borderBottom: '1px solid var(--card-border)', verticalAlign: 'top' }} {...p} />,
  code: ({ node, inline, ...p }) => inline
    ? <code style={{ background: 'var(--surface-2, #f3f3f3)', padding: '1px 5px', borderRadius: 4, fontSize: 12.5 }} {...p} />
    : <code style={{ display: 'block', background: 'var(--surface-2, #f3f3f3)', padding: 10, borderRadius: 6, fontSize: 12.5, overflowX: 'auto' }} {...p} />,
};
