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

  if (err) return (
    <div className="suite-social" style={{ padding: 'var(--s7) var(--s5)' }}>
      <div className="callout callout-danger" style={{ maxWidth: 600, margin: '40px auto' }}>{err}</div>
    </div>
  );
  if (!data) return (
    <div className="suite-social" style={{ padding: 'var(--s7) var(--s5)' }}>
      <div className="text-subtle" style={{ padding: 40, textAlign: 'center' }}>Loading…</div>
    </div>
  );

  const responsesByPost = {};
  const responsesByCreative = {};
  for (const r of (data.responses || [])) {
    if (r.post_id) (responsesByPost[r.post_id] = responsesByPost[r.post_id] || []).push(r);
    if (r.ad_creative_id) (responsesByCreative[r.ad_creative_id] = responsesByCreative[r.ad_creative_id] || []).push(r);
  }

  return (
    <div className="suite-social" style={{ padding: 'var(--s7) var(--s5)', maxWidth: 1100, margin: '0 auto' }}>
      <header className="hero">
        <div>
          <div className="caption">October Communications</div>
          <h1 className="display mt-2">{data.title || 'For your review'}</h1>
          <p className="body mt-3">For {data.client?.name}</p>
          {data.expires_at && (
            <p className="body-xs text-subtle mt-2">Link expires {new Date(data.expires_at).toLocaleDateString('en-GB')}</p>
          )}
        </div>
      </header>

      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 400 }}>
        <label className="field-label" style={{ margin: 0 }}>Reviewing as</label>
        <input value={reviewerName} onChange={e => { setReviewerName(e.target.value); localStorage.setItem('approve-name', e.target.value); }}
          placeholder="Your name" className="input" style={{ width: 240 }} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', marginTop: 'var(--s5)' }}>
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

function decisionTone(d) {
  if (d === 'approved') return { tone: 'success', label: 'Approved' };
  if (d === 'changes_requested') return { tone: 'warning', label: 'Changes requested' };
  if (d === 'rejected') return { tone: 'danger', label: 'Rejected' };
  return { tone: 'accent', label: 'Comment' };
}

function ResponsesList({ responses }) {
  if (!responses.length) return null;
  return (
    <div className="mt-4" style={{ paddingTop: 10, borderTop: '2px solid var(--accent-soft)' }}>
      {responses.map((r, i) => {
        const t = decisionTone(r.decision);
        return (
          <div key={i} className="mb-3">
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className={`chip chip-${t.tone}`}>{t.label}</span>
              <span className="body-xs text-subtle">{r.reviewer_name || 'anon'} · {new Date(r.created_at).toLocaleString('en-GB')}</span>
            </div>
            {r.comment && <div className="body-sm mt-2" style={{ padding: '6px 8px', background: 'var(--surface-raised)', borderRadius: 'var(--r-sm)' }}>{r.comment}</div>}
          </div>
        );
      })}
    </div>
  );
}

function DecisionForm({ onRespond }) {
  const [comment, setComment] = useState('');
  return (
    <div className="mt-4" style={{ paddingTop: 10, borderTop: '2px solid var(--accent-soft)' }}>
      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional comment / change notes"
        className="textarea" />
      <div className="row wrap mt-3">
        <button onClick={() => onRespond('approved', comment)} className="btn btn-primary btn-sm">Approve</button>
        <button onClick={() => onRespond('changes_requested', comment)} className="btn btn-secondary btn-sm">Request changes</button>
        <button onClick={() => onRespond('commented', comment)} disabled={!comment.trim()} className="btn btn-secondary btn-sm">Comment only</button>
      </div>
    </div>
  );
}

function PostReviewCard({ post, responses, onRespond }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <span className="chip chip-accent">{post.platform}</span>
        <span className="chip chip-accent">{post.kind}</span>
      </div>
      {(post.image_urls || []).length > 0 && (
        <div className="grid" style={{ marginBottom: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
          {post.image_urls.map((u, i) => <img key={i} src={u} alt="" style={{ width: '100%', borderRadius: 'var(--r-sm)' }} />)}
        </div>
      )}
      {(post.media || []).filter(m => m.kind === 'video').map(v => (
        <video key={v.id} src={v.url} controls style={{ width: '100%', borderRadius: 'var(--r-sm)', marginBottom: 8, background: '#000' }} />
      ))}
      {(post.media || []).filter(m => m.kind === 'audio').map(a => (
        <audio key={a.id} src={a.url} controls style={{ width: '100%', marginBottom: 8 }} />
      ))}
      <div className="h3 mb-2">{post.hook}</div>
      <div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{post.caption}</div>
      {(post.hashtags || []).length > 0 && (
        <div className="mt-2">
          {post.hashtags.map(h => <span key={h} className="text-accent" style={{ fontSize: 11, marginRight: 6 }}>#{h.replace(/^#/, '')}</span>)}
        </div>
      )}
      <DecisionForm onRespond={onRespond} />
      <ResponsesList responses={responses} />
    </div>
  );
}

function CreativeReviewCard({ creative, responses, onRespond }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <span className="chip chip-accent">{creative.framework}</span>
        <span className="chip chip-accent">{creative.angle}</span>
      </div>
      {(creative.images || []).length > 0 && (
        <div className="row wrap" style={{ marginBottom: 10, gap: 6 }}>
          {creative.images.map(img => (
            <img key={img.id} src={img.url} alt="" style={{ width: 110, borderRadius: 'var(--r-sm)' }} />
          ))}
        </div>
      )}
      <div className="h2 mb-2">{creative.headline}</div>
      <div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{creative.body}</div>
      <div className="text-accent mt-2" style={{ fontSize: 12, fontWeight: 700 }}>{creative.cta}</div>
      <DecisionForm onRespond={onRespond} />
      <ResponsesList responses={responses} />
    </div>
  );
}
