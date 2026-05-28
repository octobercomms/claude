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
  const [winners, setWinners] = useState([]);
  const [engagement, setEngagement] = useState({});
  const [mediaByPost, setMediaByPost] = useState({});
  const [shareUrl, setShareUrl] = useState(null);

  async function loadAll() {
    const [c, bs, comp, ws, eng] = await Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/social/clients/${id}/batches`),
      api.get(`/social/clients/${id}/competitors`),
      api.get(`/social/clients/${id}/winners?days=90&limit=5`).catch(() => []),
      api.get(`/social/clients/${id}/engagement`).catch(() => []),
    ]);
    setClient(c);
    setBatches(bs);
    setCompetitors(comp.competitors || []);
    setWinners(ws || []);
    const eMap = {};
    for (const e of (eng || [])) eMap[e.post_id] = e;
    setEngagement(eMap);
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
    // Lazy-load media for the visible posts.
    const map = {};
    for (const post of p) {
      try {
        const mediaRows = await api.get(`/social/posts/${post.id}/media`);
        if (mediaRows.length) map[post.id] = mediaRows;
      } catch {}
    }
    setMediaByPost(map);
  }

  async function generateMedia(postId, kind) {
    try {
      const path = kind === 'video' ? 'video' : 'voiceover';
      const { media } = await api.post(`/social/posts/${postId}/${path}`, {});
      setMediaByPost(prev => ({ ...prev, [postId]: [...(prev[postId] || []), media] }));
      toast(`${kind === 'video' ? 'UGC video' : 'Voiceover'} ready.`, 'success');
    } catch (e) {
      toast(`${kind} failed: ${e.message}`, 'error');
    }
  }

  // Render every A / C / G frame in the storyboard via Remotion. Each
  // resolved frame writes a new social_post_media row of kind='motion';
  // we merge them into the per-post media map so the inline players
  // appear without a full refresh.
  async function renderTemplates(postId) {
    try {
      const { rendered } = await api.post(`/social/posts/${postId}/render-templates`, {});
      const success = rendered.filter(r => r.id);
      const errors = rendered.filter(r => r.error);
      setMediaByPost(prev => ({ ...prev, [postId]: [...(prev[postId] || []), ...success] }));
      if (success.length) toast(`Rendered ${success.length} A/C/G clip${success.length === 1 ? '' : 's'} via Remotion.`, 'success');
      if (errors.length) toast(`Some renders failed: ${errors.map(e => `${e.style}: ${e.error}`).join('; ')}`, 'error');
    } catch (e) {
      toast(`Template render failed: ${e.message}`, 'error');
    }
  }

  async function deleteMedia(mediaId, postId) {
    try {
      await api.delete(`/social/media/${mediaId}`);
      setMediaByPost(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(m => m.id !== mediaId) }));
    } catch (e) {
      toast(`Could not delete: ${e.message}`, 'error');
    }
  }

  async function shareBatchForApproval() {
    if (!activeBatchId) return;
    try {
      const { public_url } = await api.post(`/approvals/clients/${id}/links`, {
        scope: 'social_batch',
        scope_id: activeBatchId,
        title: `Social batch — ${client?.name || ''} ${new Date().toLocaleDateString('en-GB')}`,
        expires_days: 14,
      });
      setShareUrl(public_url);
    } catch (e) {
      toast(`Could not generate link: ${e.message}`, 'error');
    }
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

  async function publishPost(postId, url) {
    try {
      const { post } = await api.post(`/social/posts/${postId}/publish`, { published_url: url });
      setPosts(prev => prev.map(p => p.id === postId ? post : p));
      // Refetch engagement so the card shows the first snapshot
      const eng = await api.get(`/social/clients/${id}/engagement`);
      const eMap = {};
      for (const e of eng) eMap[e.post_id] = e;
      setEngagement(eMap);
      toast('Marked published — engagement will refresh daily.', 'success');
    } catch (e) {
      toast(`Could not publish: ${e.message}`, 'error');
    }
  }

  async function refreshInsights(postId) {
    try {
      await api.post(`/social/posts/${postId}/refresh-insights`);
      const eng = await api.get(`/social/clients/${id}/engagement`);
      const eMap = {};
      for (const e of eng) eMap[e.post_id] = e;
      setEngagement(eMap);
      toast('Insights refreshed.', 'success');
    } catch (e) {
      toast(`Refresh failed: ${e.message}`, 'error');
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
        <div style={{ display: 'flex', gap: 8 }}>
          {activeBatchId && (
            <button type="button" style={secondaryBtn} onClick={shareBatchForApproval}>Share for approval</button>
          )}
          <button type="button" style={primaryBtn} onClick={() => setShowBrief(true)} disabled={generating}>
            {generating ? 'Generating…' : 'Generate 9 posts'}
          </button>
        </div>
      </div>

      <CompetitorEditor competitors={competitors} onSave={saveCompetitors} />

      <WinnersPanel winners={winners} />

      {shareUrl && (
        <ShareLinkBanner url={shareUrl} onDismiss={() => setShareUrl(null)} />
      )}

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
              <PostCard key={p.id} post={p} engagement={engagement[p.id]} media={mediaByPost[p.id] || []}
                onChange={patch => updatePost(p.id, patch)}
                onDelete={() => deletePost(p.id)}
                onPublish={(url) => publishPost(p.id, url)}
                onRefreshInsights={() => refreshInsights(p.id)}
                onRenderTemplates={() => renderTemplates(p.id)}
                onGenerateMedia={(kind) => generateMedia(p.id, kind)}
                onDeleteMedia={(mediaId) => deleteMedia(mediaId, p.id)} />
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

function WinnersPanel({ winners }) {
  if (!winners?.length) return null;
  return (
    <div style={{ background: '#fffceb', border: '1px solid #f0d260', padding: '12px 14px', borderRadius: 6, marginTop: 10, marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#7a5a00', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Top performers — last 90 days
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {winners.map(w => (
          <a key={w.id} href={w.published_url} target="_blank" rel="noreferrer" style={{ display: 'block', flex: '1 1 220px', minWidth: 220, padding: 10, background: '#fff', border: '1px solid #f0e0a0', borderRadius: 4, textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>{w.platform} · {w.kind}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', margin: '4px 0', lineHeight: 1.3 }}>{w.hook || '(no hook)'}</div>
            <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{(w.caption || '').slice(0, 110)}…</div>
            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: '#7a5a00' }}>{w.engagement_rate}% engagement</div>
          </a>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>The next batch you generate will model these.</div>
    </div>
  );
}

// Inline badge for each storyboard frame's style code (A-G).
// Colour-coded so the AM can scan a 9-frame storyboard at a glance and
// confirm it follows the A → B → C → B → … → G grammar.
const STYLE_COLOURS = {
  A: { bg: '#1a1a1a', fg: '#fff',    label: 'Hook' },
  B: { bg: '#fff4d6', fg: '#8a6500', label: 'Talk' },
  C: { bg: '#eee',    fg: '#444',    label: 'Word' },
  D: { bg: '#eef2ff', fg: '#3949ab', label: 'Screen' },
  E: { bg: '#e4f4e8', fg: '#1d7a3a', label: 'B-roll' },
  F: { bg: '#f4eafd', fg: '#5e2d8c', label: 'Prop' },
  G: { bg: '#E7CD41', fg: '#1a1a1a', label: 'CTA' },
};

function StyleBadge({ code, duration }) {
  const c = STYLE_COLOURS[code] || { bg: '#eee', fg: '#666', label: code };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 11, background: c.bg, color: c.fg,
        fontSize: 11, fontWeight: 700,
      }}>{code}</span>
      <span style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>
        {c.label}{duration ? ` · ${duration}s` : ''}
      </span>
    </span>
  );
}

function ShareLinkBanner({ url, onDismiss }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ background: '#e4f4e8', border: '1px solid #2e7d32', padding: '10px 14px', borderRadius: 4, marginTop: 10, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <strong style={{ fontSize: 12, color: '#1d7a3a' }}>Approval link ready —</strong>
      <input value={url} readOnly style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid #aac9b0', borderRadius: 3, background: '#fff', fontFamily: 'monospace' }} onFocus={e => e.target.select()} />
      <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ padding: '4px 12px', fontSize: 11, background: '#1d7a3a', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#1d7a3a' }}>×</button>
    </div>
  );
}

function PostCard({ post, engagement, media, onChange, onDelete, onPublish, onRefreshInsights, onGenerateMedia, onRenderTemplates, onDeleteMedia }) {
  const [open, setOpen] = useState(false);
  const [showImg, setShowImg] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  const [provider, setProvider] = useState('replicate');
  const [aspect, setAspect] = useState('1:1');
  const [styleBrief, setStyleBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);
  const [showPublish, setShowPublish] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [renderingMedia, setRenderingMedia] = useState(null);

  async function handleGenerateMedia(kind) {
    setRenderingMedia(kind);
    try { await onGenerateMedia(kind); }
    finally { setRenderingMedia(null); }
  }
  const videos = (media || []).filter(m => m.kind === 'video');
  const audios = (media || []).filter(m => m.kind === 'audio');

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

      {engagement && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: '#fffceb', border: '1px solid #f0d260', borderRadius: 4, fontSize: 11, color: '#5d4000', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {engagement.reach != null && <span><strong>{engagement.reach.toLocaleString()}</strong> reach</span>}
          {engagement.views != null && <span><strong>{engagement.views.toLocaleString()}</strong> views</span>}
          {engagement.likes != null && <span><strong>{engagement.likes.toLocaleString()}</strong> likes</span>}
          {engagement.comments != null && <span><strong>{engagement.comments.toLocaleString()}</strong> comments</span>}
          {engagement.shares != null && <span><strong>{engagement.shares.toLocaleString()}</strong> shares</span>}
          {engagement.saves != null && <span><strong>{engagement.saves.toLocaleString()}</strong> saves</span>}
          <button onClick={onRefreshInsights} style={{ background: 'none', border: 'none', color: '#7a5a00', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>refresh</button>
        </div>
      )}

      {(videos.length > 0 || audios.length > 0) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {videos.map(v => (
            <div key={v.id} style={{ position: 'relative' }}>
              <video src={v.url} controls style={{ width: 180, borderRadius: 4, background: '#000' }} />
              <button onClick={() => onDeleteMedia(v.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#fff', border: '1px solid #ddd', cursor: 'pointer', fontSize: 12, color: '#c62828' }}>×</button>
            </div>
          ))}
          {audios.map(a => (
            <div key={a.id} style={{ position: 'relative', width: 220 }}>
              <audio src={a.url} controls style={{ width: '100%' }} />
              <button onClick={() => onDeleteMedia(a.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#fff', border: '1px solid #ddd', cursor: 'pointer', fontSize: 12, color: '#c62828' }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(o => !o)} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {open ? 'Hide storyboard' : `Storyboard (${(post.storyboard || []).length} frames)`}
        </button>
        <button onClick={async () => {
          try {
            const { url } = await api.get(`/social/posts/${post.id}/brief-url`);
            window.open(url, '_blank');
          } catch (e) { alert(`Could not open brief: ${e.message}`); }
        }} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          Production brief
        </button>
        <button onClick={() => setShowImg(s => !s)} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {showImg ? 'Cancel image' : 'Generate image'}
        </button>
        <button onClick={() => handleGenerateMedia('voiceover')} disabled={renderingMedia === 'voiceover'} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {renderingMedia === 'voiceover' ? 'Rendering…' : 'Generate voiceover'}
        </button>
        <button onClick={() => handleGenerateMedia('video')} disabled={renderingMedia === 'video'} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
          {renderingMedia === 'video' ? 'Rendering UGC…' : 'Generate UGC video'}
        </button>
        {(post.storyboard || []).some(f => ['A', 'C', 'G'].includes(f.style)) && (
          <button onClick={async () => {
            setRenderingMedia('templates');
            try { await onRenderTemplates(); } finally { setRenderingMedia(null); }
          }} disabled={renderingMedia === 'templates'} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
            {renderingMedia === 'templates' ? 'Rendering A/C/G…' : 'Render A/C/G clips'}
          </button>
        )}
        {post.status !== 'published' && (
          <button onClick={() => setShowPublish(s => !s)} style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12 }}>
            {showPublish ? 'Cancel' : 'Mark published'}
          </button>
        )}
        {post.published_url && (
          <a href={post.published_url} target="_blank" rel="noreferrer" style={{ ...secondaryBtn, padding: '5px 12px', fontSize: 12, textDecoration: 'none', display: 'inline-block' }}>View live ↗</a>
        )}
      </div>

      {showPublish && (
        <div style={{ marginTop: 10, padding: 10, background: '#fafafa', border: '1px solid #eee', borderRadius: 4 }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>
            Paste the live Instagram, TikTok or LinkedIn URL once it's published. We'll pull engagement automatically (IG only — paste numbers manually for other networks via Edit).
          </div>
          <input value={publishUrl} onChange={e => setPublishUrl(e.target.value)} placeholder="https://instagram.com/p/…" style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', marginBottom: 8 }} />
          <button onClick={() => { onPublish(publishUrl); setShowPublish(false); setPublishUrl(''); }}
            style={{ ...primaryBtn, padding: '5px 14px', fontSize: 12 }} disabled={!publishUrl.trim()}>
            Save & pull insights
          </button>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10 }}>
          <div style={styles.field}>VISUAL CONCEPT</div>
          <div style={{ fontSize: 12, color: '#444', lineHeight: 1.5, marginBottom: 10 }}>{post.visual_concept}</div>
          <div style={styles.field}>STORYBOARD</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={styles.thSm}>Style</th>
                <th style={styles.thSm}>#</th>
                <th style={styles.thSm}>Shot</th>
                <th style={styles.thSm}>On-screen</th>
                <th style={styles.thSm}>Voiceover</th>
              </tr>
            </thead>
            <tbody>
              {(post.storyboard || []).map((f, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={styles.tdSm}>
                    {f.style ? <StyleBadge code={f.style} duration={f.duration_sec} /> : <span style={{ color: '#bbb' }}>—</span>}
                  </td>
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
            {['replicate', 'ideogram', 'adobe'].map(p => (
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
