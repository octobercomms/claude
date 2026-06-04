// Public approval page — opened from an email link the AM sent the
// client. No login. The reviewer types their name once, then approves /
// requests changes / leaves comments per post or per ad creative.

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

export default function ApprovePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [reviewerName, setReviewerName] = useState(() => localStorage.getItem('approve-name') || '');

  async function load() {
    try {
      const res = await fetch(`/api/approvals/public/${token}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [token]);

  async function respond({ post_id, ad_creative_id, decision, comment }) {
    try {
      const res = await fetch(`/api/approvals/public/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id, ad_creative_id, decision, comment, reviewer_name: reviewerName }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      load();
    } catch (e) { alert(e.message); }
  }

  if (err) return <div style={styles.page}><div style={styles.error}>{err}</div></div>;
  if (!data) return <div style={styles.page}><div style={{ color: '#888', padding: 40, textAlign: 'center' }}>Loading…</div></div>;

  const responsesByPost = {};
  const responsesByCreative = {};
  for (const r of (data.responses || [])) {
    if (r.post_id) (responsesByPost[r.post_id] = responsesByPost[r.post_id] || []).push(r);
    if (r.ad_creative_id) (responsesByCreative[r.ad_creative_id] = responsesByCreative[r.ad_creative_id] || []).push(r);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.brandLine}>October Communications</div>
        <h1 style={styles.title}>{data.title || 'For your review'}</h1>
        <div style={styles.client}>For {data.client?.name}</div>
        {data.expires_at && (
          <div style={styles.expires}>Link expires {new Date(data.expires_at).toLocaleDateString('en-GB')}</div>
        )}
      </div>

      <div style={styles.nameBar}>
        <label style={{ fontSize: 12, color: '#666' }}>Reviewing as:</label>
        <input value={reviewerName} onChange={e => { setReviewerName(e.target.value); localStorage.setItem('approve-name', e.target.value); }}
          placeholder="Your name" style={styles.nameInput} />
      </div>

      <div style={styles.grid}>
        {(data.posts || []).map(p => (
          <PostReviewCard key={p.id} post={p} responses={responsesByPost[p.id] || []} onRespond={(decision, comment) => respond({ post_id: p.id, decision, comment })} />
        ))}
        {(data.creatives || []).map(c => (
          <CreativeReviewCard key={c.id} creative={c} responses={responsesByCreative[c.id] || []} onRespond={(decision, comment) => respond({ ad_creative_id: c.id, decision, comment })} />
        ))}
      </div>
    </div>
  );
}

function decisionBadge(d) {
  if (d === 'approved') return { background: '#e4f4e8', color: '#1d7a3a', label: 'Approved' };
  if (d === 'changes_requested') return { background: '#fff4d6', color: '#8a6500', label: 'Changes requested' };
  if (d === 'rejected') return { background: '#fdecea', color: '#c62828', label: 'Rejected' };
  return { background: '#eef2ff', color: '#3949ab', label: 'Comment' };
}

function ResponsesList({ responses }) {
  if (!responses.length) return null;
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #eee' }}>
      {responses.map((r, i) => {
        const b = decisionBadge(r.decision);
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, fontWeight: 700, background: b.background, color: b.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{b.label}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{r.reviewer_name || 'anon'} · {new Date(r.created_at).toLocaleString('en-GB')}</span>
            </div>
            {r.comment && <div style={{ fontSize: 12, color: '#444', marginTop: 4, padding: '6px 8px', background: '#fafafa', borderRadius: 3 }}>{r.comment}</div>}
          </div>
        );
      })}
    </div>
  );
}

function DecisionForm({ onRespond }) {
  const [comment, setComment] = useState('');
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #eee' }}>
      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional comment / change notes"
        style={{ width: '100%', padding: 8, fontSize: 12, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', minHeight: 60 }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={() => onRespond('approved', comment)} style={{ ...styles.btn, background: '#1d7a3a', color: '#fff' }}>Approve</button>
        <button onClick={() => onRespond('changes_requested', comment)} style={{ ...styles.btn, background: '#fff4d6', color: '#8a6500' }}>Request changes</button>
        <button onClick={() => onRespond('commented', comment)} disabled={!comment.trim()} style={{ ...styles.btn, background: '#eef2ff', color: '#3949ab', opacity: comment.trim() ? 1 : 0.4 }}>Comment only</button>
      </div>
    </div>
  );
}

function PostReviewCard({ post, responses, onRespond }) {
  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <span style={styles.pill}>{post.platform}</span>
        <span style={styles.pill}>{post.kind}</span>
      </div>
      {(post.image_urls || []).length > 0 && (
        <div style={{ marginBottom: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
          {post.image_urls.map((u, i) => <img key={i} src={u} alt="" style={{ width: '100%', borderRadius: 4 }} />)}
        </div>
      )}
      {(post.media || []).filter(m => m.kind === 'video').map(v => (
        <video key={v.id} src={v.url} controls style={{ width: '100%', borderRadius: 4, marginBottom: 8, background: '#000' }} />
      ))}
      {(post.media || []).filter(m => m.kind === 'audio').map(a => (
        <audio key={a.id} src={a.url} controls style={{ width: '100%', marginBottom: 8 }} />
      ))}
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{post.hook}</div>
      <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{post.caption}</div>
      {(post.hashtags || []).length > 0 && (
        <div style={{ marginBottom: 4 }}>
          {post.hashtags.map(h => <span key={h} style={{ fontSize: 11, color: '#3949ab', marginRight: 6 }}>#{h.replace(/^#/, '')}</span>)}
        </div>
      )}
      <DecisionForm onRespond={onRespond} />
      <ResponsesList responses={responses} />
    </div>
  );
}

function CreativeReviewCard({ creative, responses, onRespond }) {
  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <span style={styles.pill}>{creative.framework}</span>
        <span style={styles.pill}>{creative.angle}</span>
      </div>
      {(creative.images || []).length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {creative.images.map(img => (
            <img key={img.id} src={img.url} alt="" style={{ width: 110, borderRadius: 4 }} />
          ))}
        </div>
      )}
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{creative.headline}</div>
      <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{creative.body}</div>
      <div style={{ fontSize: 12, color: '#1a4f9c', fontWeight: 700, marginBottom: 8 }}>{creative.cta}</div>
      <DecisionForm onRespond={onRespond} />
      <ResponsesList responses={responses} />
    </div>
  );
}

const styles = {
  page: { background: '#fafafa', minHeight: '100vh', padding: '32px 20px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' },
  header: { maxWidth: 1100, margin: '0 auto 18px' },
  brandLine: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 },
  title: { fontSize: 26, fontWeight: 700, margin: '6px 0 4px' },
  client: { fontSize: 14, color: '#666' },
  expires: { fontSize: 12, color: '#999', marginTop: 4 },
  nameBar: { maxWidth: 1100, margin: '0 auto 18px', display: 'flex', alignItems: 'center', gap: 10 },
  nameInput: { padding: '6px 10px', fontSize: 13, border: '2px solid var(--accent)', borderRadius: 4, width: 240 },
  grid: { maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 },
  card: { background: '#fff', border: '2px solid var(--accent)', borderRadius: 6, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  pill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: '#eef2ff', color: '#3949ab', textTransform: 'uppercase', letterSpacing: 0.4 },
  btn: { padding: '6px 14px', fontSize: 12, border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 600 },
  error: { color: '#c62828', padding: 20, background: '#fdecea', borderRadius: 4, maxWidth: 600, margin: '40px auto' },
};
