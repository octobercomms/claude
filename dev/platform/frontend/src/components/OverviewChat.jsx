import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// OverviewChat — the acting agent that fronts each PESO pillar's Overview tab.
// It's the same tool-using agent as the AI Data Analyst / Strategist (routes/chat.js),
// but scoped to one pillar: its own conversation thread, a pillar system prompt,
// and the pillar's read + action tools. It opens knowing the pillar's live numbers
// and can actually do the pillar's jobs (draft, plan, audit) rather than just
// pointing at a page. Any answer downloads as PDF/Word; prefix /report for a
// formatted report.
//
// "Chat leads, data stays": this renders as the lead element on the Overview
// tab, with the existing SuiteOverview launchpad kept directly below it.

// Per-pillar copy + starter prompts. persona === thread === pillar key, which
// the backend maps to the right system prompt and tool set.
const PILLARS = {
  paid: {
    label: 'Paid',
    blurb: 'Ads across Google & Meta. I can pull live spend, ROAS and top campaigns, audit what’s working, and draft new ad creative — just ask.',
    empty: 'Ask me anything about paid — or tell me what to make.',
    suggestions: [
      'How is paid performing over the last 30 days — where’s the money going?',
      'Audit the current ad accounts and tell me what to fix first.',
      'Draft three new ad creative variations for the best-performing campaign.',
      '/report Write a paid-media performance summary for this client.',
    ],
  },
  earned: {
    label: 'Earned',
    blurb: 'PR, coverage and media relations. I can review the coverage log and journalist relationships, build a ranked pitch-target list, and draft a release or a pitch.',
    empty: 'Ask me anything about earned/PR — or tell me what to make.',
    suggestions: [
      'Where do we stand on coverage this quarter?',
      'Build a ranked list of journalists to pitch, with the angle.',
      'Draft a press release for our latest announcement.',
      '/report Write a PR coverage summary for this client.',
    ],
  },
  shared: {
    label: 'Shared',
    blurb: 'Social media. I can review what’s working across channels, spot the winners, and draft a content plan or new posts.',
    empty: 'Ask me anything about social — or tell me what to make.',
    suggestions: [
      'What’s working and what’s not on social right now?',
      'Draft a two-week social content plan for this client.',
      'Which posts performed best, and why?',
      '/report Write a social performance summary for this client.',
    ],
  },
  owned: {
    label: 'Owned',
    blurb: 'SEO and content. I can check rankings and Search Console, audit the site and content, and brief or draft a piece of content.',
    empty: 'Ask me anything about SEO/content — or tell me what to make.',
    suggestions: [
      'How are our rankings trending, and where are the quick wins?',
      'Audit the site and tell me the top three things to fix.',
      'Brief a piece of content for our most important target keyword.',
      '/report Write an SEO performance summary for this client.',
    ],
  },
};

const CHAT_MODEL = 'claude-sonnet-4-6';

export default function OverviewChat({ clientId, pillar }) {
  const cfg = PILLARS[pillar] || PILLARS.owned;
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [open, setOpen] = useState(true);
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    api.get(`/chat/${clientId}?thread=${pillar}`).then(setMessages).catch(e => toast(e.message, 'error'));
  }, [clientId, pillar]); // eslint-disable-line

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
      const reply = await api.post(`/chat/${clientId}`, { message: msg, persona: pillar, model: CHAT_MODEL });
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
      const filename = m ? m[1] : `${pillar}-answer.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast(`Download failed: ${e.message}`, 'error'); }
    finally { setDownloading(null); }
  }

  async function clearChat() {
    if (!confirm(`Clear this ${cfg.label} conversation?`)) return;
    try { await api.delete(`/chat/${clientId}?thread=${pillar}`); setMessages([]); }
    catch (e) { toast(e.message, 'error'); }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="card" style={{ marginBottom: 20, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: open ? 10 : 0 }}>
        <div>
          <h3 style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 700 }}>
            {cfg.label} — ask &amp; act
          </h3>
          <p className="caption" style={{ color: 'var(--text-subtle)', margin: 0, maxWidth: 680 }}>{cfg.blurb}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {messages.length > 0 && open && <button className="btn btn-ghost btn-sm" onClick={clearChat}>Clear</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}>
            {open ? 'Hide' : 'Chat'}
          </button>
        </div>
      </div>

      {open && (
        <>
          <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: '52vh', minHeight: 110, paddingRight: 4 }}>
            {messages.length === 0 && !sending && (
              <div className="empty" style={{ padding: 14 }}>
                <div style={{ marginBottom: 12 }}>{cfg.empty}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cfg.suggestions.map(s => (
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
                          </div>
                        )}
                      </>}
                </div>
              </div>
            ))}

            {sending && <div className="caption" style={{ color: 'var(--text-subtle)', padding: '4px 2px' }}>Working on it — checking the data…</div>}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
            <textarea ref={taRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} rows={2}
              placeholder={`Ask ${cfg.label}… (Enter to send, Shift+Enter for a new line). Prefix /report for a downloadable report.`}
              style={{ flex: 1, resize: 'vertical', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
                border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
            <button className="btn btn-primary" disabled={sending || !input.trim()} onClick={() => send()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </>
      )}
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
