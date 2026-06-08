import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import PipelineStep from './PipelineStep';
import RefineChat from '../RefineChat';

// Pipeline → Draft. Takes a brief, asks Claude to write a full blog
// post grounded in the client's brand briefing + uploaded brand assets,
// strips the standard AI tells (delve / leverage / robust / etc), and
// stores the result as both markdown and HTML so the publisher can push
// to any platform. AM can edit inline before publishing.
export default function DraftPanel({ clientId, onNext }) {
  const [drafts, setDrafts] = useState([]);
  const [activeDraft, setActiveDraft] = useState(null);
  const [brief, setBrief] = useState('');
  const [targetKeyword, setTargetKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMeta, setEditMeta] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function refresh() {
    setLoading(true);
    try {
      const { drafts: d } = await api.get(`/seo/clients/${clientId}/drafts`);
      setDrafts(d);
      if (d.length) await openDraft(d[0].id);
      else { setActiveDraft(null); }
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openDraft(id) {
    try {
      const d = await api.get(`/drafts/${id}`);
      setActiveDraft(d);
      setEditBody(d.body_markdown || '');
      setEditTitle(d.title || '');
      setEditMeta(d.meta_description || '');
      setDirty(false);
    } catch (e) { setErr(e.message); }
  }

  async function generate() {
    if (!brief.trim()) return;
    setGenerating(true);
    setErr(null);
    try {
      const d = await api.post(`/seo/clients/${clientId}/drafts`, {
        brief: brief.trim(), target_keyword: targetKeyword.trim() || null,
      });
      setDrafts(prev => [d, ...prev]);
      setActiveDraft(d);
      setEditBody(d.body_markdown || ''); setEditTitle(d.title); setEditMeta(d.meta_description || ''); setDirty(false);
      setBrief(''); setTargetKeyword('');
    } catch (e) { setErr(e.message); }
    finally { setGenerating(false); }
  }

  async function save() {
    if (!activeDraft || !dirty) return;
    setSaving(true);
    try {
      const updated = await api.put(`/drafts/${activeDraft.id}`, {
        title: editTitle, meta_description: editMeta, body_markdown: editBody,
      });
      setActiveDraft(updated);
      setDrafts(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d));
      setDirty(false);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function deleteDraft(id) {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    try {
      await api.delete(`/drafts/${id}`);
      const next = drafts.filter(d => d.id !== id);
      setDrafts(next);
      if (activeDraft?.id === id) {
        if (next[0]) openDraft(next[0].id);
        else { setActiveDraft(null); setEditBody(''); setEditTitle(''); setEditMeta(''); }
      }
    } catch (e) { setErr(e.message); }
  }

  return (
    <PipelineStep
      num={3} title="Draft" onNext={onNext} nextLabel="Publish"
      tagline="Claude writes the full post in the client's voice — grounded in the brand briefing and uploaded brand assets. Standard AI tells are stripped automatically. Edit inline before publishing."
    >
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="caption mb-2">Generate a new draft from a brief</div>
        <textarea
          value={brief} onChange={e => setBrief(e.target.value)} rows={4}
          placeholder="Paste a brief — title, outline, target intent, key questions, word count. Or write a brief directly from a Brief step run."
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            value={targetKeyword} onChange={e => setTargetKeyword(e.target.value)}
            placeholder="Target keyword (optional)"
            style={{ flex: 1, padding: '7px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}
          />
          <button onClick={generate} className="btn btn-primary" disabled={generating || !brief.trim()}>
            {generating ? 'Writing — 30-90s…' : 'Write draft'}
          </button>
        </div>
      </div>

      {err && <div className="callout callout-danger" style={{ marginBottom: 14 }}>{err}</div>}

      {loading && !drafts.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : !drafts.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No drafts yet. Paste a brief above to generate the first one.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 22 }}>
          <div>
            <div className="caption mb-3">Drafts</div>
            {drafts.map(d => (
              <div key={d.id} className="card"
                style={{ padding: 10, marginBottom: 8, cursor: 'pointer',
                  background: d.id === activeDraft?.id ? 'var(--accent-soft)' : 'var(--surface)' }}
                onClick={() => openDraft(d.id)}>
                <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3 }}>{d.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  {new Date(d.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short' })}
                  {' · '}{d.word_count?.toLocaleString() || 0} words
                  {' · '}<span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{d.status}</span>
                </div>
                {(d.publications || []).length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4 }}>
                    Published to {d.publications.map(p => p.platform).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div>
            {activeDraft && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div className="caption">Editor</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => deleteDraft(activeDraft.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                    <button onClick={() => setChatOpen(o => !o)} className={`btn ${chatOpen ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
                      {chatOpen ? 'Hide Claude' : '✦ Refine with Claude'}
                    </button>
                    <button onClick={save} className="btn btn-primary btn-sm" disabled={!dirty || saving}>
                      {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                    </button>
                  </div>
                </div>
                <div style={{ display: chatOpen ? 'grid' : 'block', gridTemplateColumns: chatOpen ? 'minmax(0, 1fr) 380px' : undefined, gap: chatOpen ? 'var(--s4)' : 0 }}>
                  <div>
                <input
                  value={editTitle}
                  onChange={e => { setEditTitle(e.target.value); setDirty(true); }}
                  placeholder="Title"
                  style={{ width: '100%', padding: '10px 12px', fontSize: 18, fontWeight: 700, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 8, boxSizing: 'border-box' }}
                />
                <input
                  value={editMeta}
                  onChange={e => { setEditMeta(e.target.value); setDirty(true); }}
                  placeholder="Meta description (≤155 chars)"
                  maxLength={160}
                  style={{ width: '100%', padding: '7px 12px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 8, boxSizing: 'border-box' }}
                />
                <textarea
                  value={editBody}
                  onChange={e => { setEditBody(e.target.value); setDirty(true); }}
                  rows={28}
                  style={{ width: '100%', padding: '12px 14px', fontSize: 13, lineHeight: 1.6, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', boxSizing: 'border-box', resize: 'vertical' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6 }}>
                  Markdown · {editBody.split(/\s+/).filter(Boolean).length.toLocaleString()} words
                </div>
                  </div>
                  {chatOpen && (
                    <RefineChat
                      clientId={clientId}
                      kind="draft_markdown"
                      artifact={editBody}
                      artifactMeta={activeDraft.target_keyword ? `target keyword: ${activeDraft.target_keyword}` : null}
                      onApplyRevision={(next) => { setEditBody(next); setDirty(true); }}
                      onClose={() => setChatOpen(false)}
                      compact
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PipelineStep>
  );
}
