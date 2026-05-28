import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { primaryBtn, secondaryBtn, dangerBtn, COLORS } from '../styles/theme';

// Social Phase 1 — generate 9 posts at a time, grounded in the client's
// briefing + Google Trends signals. Each post has a hook, caption,
// hashtags, a visual concept, and a frame-by-frame storyboard. AM can
// generate images via Replicate (Flux) or Ideogram.
export default function ClientSocialPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [batches, setBatches] = useState([]);
  const [posts, setPosts] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState('');
  const [platforms, setPlatforms] = useState(['instagram', 'tiktok']);

  async function loadAll() {
    const [c, bs, comp] = await Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/social/clients/${id}/batches`),
      api.get(`/social/clients/${id}/competitors`),
    ]);
    setClient(c);
    setBatches(bs);
    setCompetitors(comp.competitors || []);
    if (bs.length && !activeBatchId) {
      setActiveBatchId(bs[0].id);
      const p = await api.get(`/social/clients/${id}/posts?batch_id=${bs[0].id}`);
      setPosts(p);
    }
  }
  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [id]);

  async function selectBatch(batchId) {
    setActiveBatchId(batchId);
    const p = await api.get(`/social/clients/${id}/posts?batch_id=${batchId}`);
    setPosts(p);
  }

  async function generate() {
    setGenerating(true);
    try {
      const { batch, posts: newPosts } = await api.post(`/social/clients/${id}/generate`, { brief, platforms });
      setBatches([batch, ...batches]);
      setActiveBatchId(batch.id);
      setPosts(newPosts);
      setShowBrief(false);
      setBrief('');
      toast(`Generated ${newPosts.length} posts.`, 'success');
    } catch (e) {
      toast(`Generation failed: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function updatePost(postId, patch) {
    try {
      const updated = await api.put(`/social/posts/${postId}`, patch);
      setPosts(prev => prev.map(p => p.id === postId ? updated : p));
    } catch (e) {
      toast(`Update failed: ${e.message}`, 'error');
    }
  }

  async function deletePost(postId) {
    if (!confirm('Delete this post?')) return;
    try {
      await api.delete(`/social/posts/${postId}`);
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function deleteBatch(batchId) {
    if (!confirm('Delete this entire batch and all its posts?')) return;
    try {
      await api.delete(`/social/batches/${batchId}`);
      const next = batches.filter(b => b.id !== batchId);
      setBatches(next);
      if (next[0]) selectBatch(next[0].id);
      else { setActiveBatchId(null); setPosts([]); }
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function saveCompetitors(next) {
    try {
      const r = await api.put(`/social/clients/${id}/competitors`, { competitors: next });
      setCompetitors(r.competitors || []);
    } catch (e) {
      toast(`Could not save: ${e.message}`, 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Social — {client?.name || ''}</h1>
          <p style={{ fontSize: 13, color: '#666', margin: '6px 0 0', maxWidth: 760, lineHeight: 1.5 }}>
            Generate nine posts at a time, grounded in the client's brief and current Google Trends signals.
            Each post has a hook, caption, hashtags, a visual direction and a frame-by-frame storyboard. Click
            an image generator beside any post to render the visual.
          </p>
        </div>
        <button type="button" style={primaryBtn} onClick={() => setShowBrief(true)} disabled={generating}>
          {generating ? 'Generating…' : 'Generate 9 posts'}
        </button>
      </div>

      <CompetitorEditor competitors={competitors} onSave={saveCompetitors} />

      {showBrief && (
        <BriefModal
          onClose={() => setShowBrief(false)}
          brief={brief} setBrief={setBrief}
          platforms={platforms} setPlatforms={setPlatforms}
          onSubmit={generate} submitting={generating}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 22, marginTop: 18 }}>
        <div>
          <div style={styles.h3}>Past batches</div>
          {!batches.length && <div style={{ color: '#888', fontSize: 13 }}>Nothing yet — click Generate to start.</div>}
          {batches.map(b => (
            <div key={b.id} style={{ ...styles.batchRow, ...(b.id === activeBatchId ? styles.batchRowActive : {}) }} onClick={() => selectBatch(b.id)}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{b.post_count} posts</div>
              {b.brief && <div style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.4 }}>{b.brief.slice(0, 64)}{b.brief.length > 64 ? '…' : ''}</div>}
              {b.id === activeBatchId && (
                <button onClick={(e) => { e.stopPropagation(); deleteBatch(b.id); }} style={{ ...dangerBtn, padding: '3px 10px', fontSize: 11, marginTop: 6 }}>Delete batch</button>
              )}
            </div>
          ))}
        </div>

        <div>
          {!posts.length && <div style={{ color: '#888', padding: 20 }}>Pick a batch on the left, or generate a new one.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {posts.map(p => (
              <PostCard key={p.id} post={p} onChange={patch => updatePost(p.id, patch)} onDelete={() => deletePost(p.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompetitorEditor({ competitors, onSave }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  function add() {
    if (!draft.trim()) return;
    const next = Array.from(new Set([...competitors, draft.trim()])).slice(0, 6);
    onSave(next);
    setDraft('');
  }
  function remove(handle) {
    onSave(competitors.filter(c => c !== handle));
  }
  return (
    <div style={styles.competitorBar}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 8 }}>
        Competitor handles
      </span>
      {competitors.map(c => (
        <span key={c} style={styles.competitorChip}>
          {c}
          {editing && <button onClick={() => remove(c)} style={styles.chipClose}>×</button>}
        </span>
      ))}
      {editing ? (
        <>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="instagram:handle"
            style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, marginLeft: 6 }}
          />
          <button onClick={add} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Add</button>
          <button onClick={() => setEditing(false)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Done</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: '#1a4f9c', cursor: 'pointer', fontSize: 12, marginLeft: 6 }}>edit</button>
      )}
    </div>
  );
}

function BriefModal({ onClose, brief, setBrief, platforms, setPlatforms, onSubmit, submitting }) {
  function togglePlatform(p) {
    setPlatforms(platforms.includes(p) ? platforms.filter(x => x !== p) : [...platforms, p]);
  }
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>Generate 9 posts</h2>
        <p style={{ fontSize: 12, color: '#666', margin: '0 0 14px', lineHeight: 1.5 }}>
          Optional brief — the more specific you are, the more useful the output. Examples:
          "We're launching a new mug colour next week", "Focus on UK studio kitchens", "Lean educational, not salesy."
          Leave empty for a balanced batch.
        </p>
        <label style={modalStyles.label}>Brief</label>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} style={modalStyles.textarea} placeholder="What's the angle? Any constraints?" />
        <label style={modalStyles.label}>Platforms</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['instagram', 'tiktok', 'linkedin', 'facebook'].map(p => (
            <button key={p} onClick={() => togglePlatform(p)} type="button" style={platforms.includes(p) ? modalStyles.pillOn : modalStyles.pill}>
              {p}
            </button>
          ))}
        </div>
        <div style={modalStyles.footer}>
          <button type="button" style={secondaryBtn} onClick={onClose}>Cancel</button>
          <button type="button" style={primaryBtn} onClick={onSubmit} disabled={submitting || !platforms.length}>
            {submitting ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PostCard({ post, onChange, onDelete }) {
  const [open, setOpen] = useState(false);
  const [showImg, setShowImg] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  const [provider, setProvider] = useState('replicate');
  const [aspect, setAspect] = useState('1:1');
  const [styleBrief, setStyleBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);

  async function generateImage() {
    setGenerating(true);
    setErr(null);
    try {
      const r = await api.post(`/social/posts/${post.id}/image`, {
        provider, aspect_ratio: aspect, style_brief: styleBrief,
      });
      onChange({}); // trigger parent re-render via prop pattern
      Object.assign(post, r.post);
      setShowImg(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={styles.platformPill}>{post.platform}</span>
          <span style={styles.kindPill}>{post.kind}</span>
          <span style={styles.statusPill}>{post.status}</span>
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={styles.field}>HOOK</div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{post.hook || <em style={{ color: '#bbb' }}>(none)</em>}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={styles.field}>CAPTION</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#222', whiteSpace: 'pre-wrap' }}>{post.caption}</div>
      </div>

      {(post.hashtags || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          {post.hashtags.map(h => <span key={h} style={styles.hashtag}>#{h.replace(/^#/, '')}</span>)}
        </div>
      )}

      {(post.image_urls || []).length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {post.image_urls.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              <img src={u} alt="" style={styles.thumb} />
            </a>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button onClick={() => setOpen(o => !o)} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {open ? 'Hide storyboard' : `Storyboard (${(post.storyboard || []).length} frames)`}
        </button>
        <button onClick={() => setShowImg(s => !s)} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {showImg ? 'Cancel image' : 'Generate image'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10 }}>
          <div style={styles.field}>VISUAL CONCEPT</div>
          <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5, marginBottom: 10 }}>{post.visual_concept}</div>
          <div style={styles.field}>STORYBOARD</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={styles.thSm}>#</th>
                <th style={styles.thSm}>Shot</th>
                <th style={styles.thSm}>On-screen</th>
                <th style={styles.thSm}>Voiceover</th>
              </tr>
            </thead>
            <tbody>
              {(post.storyboard || []).map((f, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={styles.tdSm}>{f.frame ?? i + 1}</td>
                  <td style={styles.tdSm}>{f.shot}</td>
                  <td style={styles.tdSm}>{f.on_screen_text || ''}</td>
                  <td style={styles.tdSm}>{f.voiceover || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {post.notes && <div style={{ marginTop: 8, fontSize: 11, color: '#888', fontStyle: 'italic' }}>{post.notes}</div>}
        </div>
      )}

      {showImg && (
        <div style={{ marginTop: 10, padding: 10, background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {['replicate', 'ideogram'].map(p => (
              <button key={p} onClick={() => setProvider(p)} type="button" style={provider === p ? styles.providerOn : styles.providerOff}>{p}</button>
            ))}
            <select value={aspect} onChange={e => setAspect(e.target.value)} style={styles.input}>
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
          <input
            value={styleBrief}
            onChange={e => setStyleBrief(e.target.value)}
            placeholder="Style brief — e.g. Josef Müller-Brockmann style"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
          />
          {err && <div style={{ color: '#c62828', fontSize: 11, marginBottom: 6 }}>{err}</div>}
          <button onClick={generateImage} style={{ ...primaryBtn, padding: '5px 14px', fontSize: 12 }} disabled={generating}>
            {generating ? 'Rendering…' : `Render with ${provider}`}
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  h3: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  competitorBar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '8px 12px', background: '#fafafa', border: '1px solid #eee', borderRadius: 4, marginBottom: 6 },
  competitorChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', background: '#fff', border: '1px solid #ddd', borderRadius: 999, fontSize: 12, fontFamily: 'monospace' },
  chipClose: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', color: '#999' },
  batchRow: { padding: 10, border: '1px solid #eee', borderRadius: 4, marginBottom: 8, cursor: 'pointer', background: '#fff' },
  batchRowActive: { background: '#fffceb', borderColor: COLORS.yellow },
  card: { padding: 14, background: '#fff', border: '1px solid #eee', borderRadius: 6 },
  field: { fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  platformPill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#eef2ff', color: '#3949ab', textTransform: 'uppercase', letterSpacing: 0.4 },
  kindPill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#f4eafd', color: '#5e2d8c', textTransform: 'uppercase', letterSpacing: 0.4 },
  statusPill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#eee', color: '#666', textTransform: 'uppercase', letterSpacing: 0.4 },
  hashtag: { display: 'inline-block', fontSize: 11, color: '#3949ab', marginRight: 6 },
  thumb: { width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' },
  thSm: { textAlign: 'left', padding: '5px 6px', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 },
  tdSm: { padding: '5px 6px', verticalAlign: 'top', fontSize: 11, color: '#333', lineHeight: 1.4 },
  providerOn: { padding: '5px 12px', fontSize: 11, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: 'pointer', borderRadius: 999, fontWeight: 700 },
  providerOff: { padding: '5px 12px', fontSize: 11, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', borderRadius: 999 },
  input: { padding: '5px 8px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4 },
};

const modalStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 8, width: '100%', maxWidth: 540, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  textarea: { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  pill: { padding: '5px 12px', fontSize: 12, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', borderRadius: 999, textTransform: 'capitalize' },
  pillOn: { padding: '5px 12px', fontSize: 12, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: 'pointer', borderRadius: 999, fontWeight: 700, textTransform: 'capitalize' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
};
