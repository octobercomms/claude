import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

// Single-turn refinement chat that bolts onto any Claude-generated
// artifact (a draft body, a brief, a concept set). Pre-seeds the
// artifact + brand-voice context on the server; AM types a short
// instruction; Claude replies, sometimes with a <revision> block the
// AM can apply with one click.
//
// Stateless server-side. Transcript lives in component state, cleared
// when the artifact changes.
//
// Props:
//   clientId        — required, for the server-side voice + client lookup
//   kind            — 'draft_markdown' | 'brief_json' | 'ad_concepts'
//   artifact        — current value (string for draft_markdown, object for brief_json)
//   artifactMeta    — optional short string ("target keyword: …") added to the prime turn
//   onApplyRevision — function(newArtifact) called when AM clicks Apply
//   onClose         — optional, renders a close button
//   compact         — boolean, render in a narrower side-panel style
export default function RefineChat({ clientId, kind, artifact, artifactMeta, onApplyRevision, onClose, compact = false }) {
  const [messages, setMessages] = useState([]);     // [{role: 'user'|'assistant', content, revision?}]
  const [draftInput, setDraftInput] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);
  const scrollRef = useRef(null);
  const { readOnly } = useAuth();

  // Auto-scroll to the latest message as the conversation grows.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function send() {
    const text = draftInput.trim();
    if (!text || sending) return;
    setErr(null);
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraftInput('');
    setSending(true);
    try {
      const { reply } = await api.post(`/seo/clients/${clientId}/refine-chat`, {
        kind,
        artifact,
        messages: next,
        artifact_meta: artifactMeta,
      });
      setMessages(prev => [...prev, reply]);
    } catch (e) {
      setErr(e.message);
      // Roll the AM message back so they can edit + retry without re-typing.
      setMessages(prev => prev.slice(0, -1));
      setDraftInput(text);
    } finally {
      setSending(false);
    }
  }

  function apply(revision) {
    if (!revision?.content || !onApplyRevision) return;
    onApplyRevision(revision.content);
  }

  function reset() {
    setMessages([]);
    setDraftInput('');
    setErr(null);
  }

  const suggestions = SUGGESTIONS[kind] || [];

  return (
    <div className="card" style={{
      padding: 0, display: 'flex', flexDirection: 'column',
      height: compact ? 480 : 600, minHeight: 320,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s3) var(--s4)', borderBottom: '1px solid var(--card-border)' }}>
        <div>
          <div className="caption">Refine with Claude</div>
          <div className="body-xs text-subtle mt-2">Voice profile + current artifact pinned · British English</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {!!messages.length && <button onClick={reset} className="btn btn-ghost btn-sm" title="Start over">Reset</button>}
          {onClose && <button onClick={onClose} className="btn btn-ghost btn-sm" title="Close">×</button>}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--s3) var(--s4)' }}>
        {!messages.length && (
          <div className="body-sm text-muted" style={{ lineHeight: 1.6 }}>
            <p>Ask Claude to refine the artifact. Short instructions work best.</p>
            {!!suggestions.length && (
              <>
                <div className="caption mt-3 mb-2">Try:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => setDraftInput(s)} className="btn btn-ghost btn-sm" style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '4px 8px', color: 'var(--accent)' }}>{s}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 'var(--s4)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: m.role === 'user' ? 'var(--accent)' : 'var(--text-subtle)', marginBottom: 4 }}>
              {m.role === 'user' ? 'You' : 'Claude'}
            </div>
            <div style={{
              fontSize: 13, lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              padding: 'var(--s3)',
              borderRadius: 'var(--r-sm)',
              background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--surface-raised)',
              color: 'var(--text)',
            }}>
              {m.content || <em style={{ color: 'var(--text-subtle)' }}>(no reply text)</em>}
            </div>
            {m.revision && onApplyRevision && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => apply(m.revision)} className="btn btn-primary btn-sm">
                  Apply revision · {m.revision.scope}
                </button>
                <span className="body-xs text-subtle">{m.revision.content.length.toLocaleString()} chars</span>
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="body-xs text-subtle" style={{ fontStyle: 'italic' }}>Claude is replying…</div>
        )}
      </div>

      {err && <div className="callout callout-danger" style={{ margin: '0 var(--s4)' }}>{err}</div>}

      <div style={{ padding: 'var(--s3) var(--s4)', borderTop: '1px solid var(--card-border)' }}>
        <textarea
          value={draftInput}
          onChange={e => setDraftInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          rows={2}
          placeholder={'Tell Claude what to change…  (⌘+Enter to send)'}
          style={{ width: '100%', padding: 'var(--s2) var(--s3)', fontSize: 13, lineHeight: 1.4, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div className="row between center mt-2">
          <span className="body-xs text-subtle">{messages.length ? `${messages.filter(m => m.role === 'user').length} turn${messages.filter(m => m.role === 'user').length === 1 ? '' : 's'}` : ' '}</span>
          <button {...roWrite(readOnly, { onClick: send, disabled: sending || !draftInput.trim() })} className="btn btn-primary btn-sm">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Suggestion chips per artifact kind — give the AM a starting nudge
// rather than a blank box. Chosen to surface the kinds of asks that
// produce a <revision> block (so the Apply button shows up).
const SUGGESTIONS = {
  draft_markdown: [
    'Punchier intro — same idea, half the length',
    'Add a counter-example to the strongest section',
    'Tighten — drop 20% of the words without losing substance',
    'Switch the tone to plainer / less formal',
    'Add a sceptical objection + my response',
  ],
  brief_json: [
    'Drop section 4, expand section 2',
    'Add a comparison angle to the outline',
    'Switch the target intent to commercial',
  ],
  ad_concepts: [
    'More like #5, less like #2',
    'Punchier headlines across the board',
    'Add a sceptical / objection-handler angle',
  ],
};
