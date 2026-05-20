import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';

export default function ClientChatPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/chat/${id}`),
    ]).then(([c, msgs]) => {
      setClient(c);
      setMessages(msgs);
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const optimistic = { id: `tmp-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setSending(true);

    try {
      const reply = await api.post(`/chat/${id}`, { message: text });
      setMessages(prev => [...prev, reply]);
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

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;

  const SUGGESTIONS = [
    'What sections should we include in this month\'s report?',
    'What metrics should we be paying more attention to?',
    'Are there any trends worth investigating?',
    'What would you suggest removing from our reports?',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Report Chat — {client?.name}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
            Chat with Claude to shape this client's reports. What you discuss here informs what gets included.
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={handleClear} disabled={clearing} style={s.btnGhost}>
            {clearing ? 'Clearing…' : 'Clear history'}
          </button>
        )}
      </div>

      {/* Message thread */}
      <div style={s.thread}>
        {messages.length === 0 && !sending && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: '#444', marginBottom: 8, fontWeight: 600 }}>
              Start building {client?.name}'s reports
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 24, maxWidth: 480, margin: '0 auto 24px' }}>
              Tell Claude what matters to this client, what you want to investigate, or ask for suggestions.
              Everything you discuss here shapes their monthly and weekly reports.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 540, margin: '0 auto' }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  style={suggestionStyle}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            {msg.role === 'assistant' && (
              <div style={s.avatarDot} />
            )}
            <div style={{
              ...s.bubble,
              ...(msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant),
              ...(msg.isError ? { background: '#fff3f3', borderColor: '#f5c6cb' } : {}),
            }}>
              {msg.content.split('\n').map((line, i) => (
                <React.Fragment key={i}>
                  {line}
                  {i < msg.content.split('\n').length - 1 && <br />}
                </React.Fragment>
              ))}
              <div style={s.timestamp}>
                {new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={s.avatarDot} />
            <div style={{ ...s.bubble, ...s.bubbleAssistant }}>
              <span style={s.typing}>
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} style={s.inputRow}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message Claude… (Enter to send, Shift+Enter for new line)"
          style={s.textarea}
          rows={2}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()} style={s.sendBtn}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

const suggestionStyle = {
  padding: '10px 14px', background: 'white', border: '1px solid #e0e0e0',
  borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#444',
  textAlign: 'left', lineHeight: 1.4,
};

const s = {
  thread: {
    flex: 1, overflowY: 'auto', padding: '8px 0 16px',
    display: 'flex', flexDirection: 'column',
  },
  avatarDot: {
    width: 28, height: 28, borderRadius: '50%', background: '#1a1a1a',
    flexShrink: 0, marginRight: 8, marginTop: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, color: 'white', fontWeight: 700,
  },
  bubble: {
    maxWidth: '72%', padding: '10px 14px', borderRadius: 12,
    fontSize: 14, lineHeight: 1.6, border: '1px solid transparent',
  },
  bubbleUser: {
    background: '#1a1a1a', color: 'white', borderBottomRightRadius: 3,
  },
  bubbleAssistant: {
    background: 'white', color: '#1a1a1a', border: '1px solid #e8e8e8',
    borderBottomLeftRadius: 3,
  },
  timestamp: {
    fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right',
  },
  inputRow: {
    display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid #e8e8e8', marginTop: 'auto',
  },
  textarea: {
    flex: 1, padding: '10px 14px', border: '1px solid #e0e0e0', borderRadius: 8,
    fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
    outline: 'none',
  },
  sendBtn: {
    padding: '10px 20px', background: '#1a1a1a', color: 'white', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
    alignSelf: 'flex-end',
  },
  btnGhost: {
    padding: '6px 12px', background: 'transparent', border: '1px solid #ddd',
    borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#666',
  },
  typing: {
    display: 'inline-flex', gap: 4, alignItems: 'center',
  },
};
