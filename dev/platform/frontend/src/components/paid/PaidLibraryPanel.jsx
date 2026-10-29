import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

// Paid → Build → Creative. Everything rendered for this client, newest first,
// across every batch.
//
// Why this exists: paid renders land in `ad_creative_images` and had no view
// anywhere. The only route to a finished ad was the batch that produced it,
// so finding last month's 4:5 meant remembering which brief it came from.
// Produce has had its Library for exactly this reason; Paid did not, which is
// what made Resize feel orphaned — a tool with nothing to point at.
//
// It is also where Resize starts now, rather than being its own tab asking you
// to upload the file you already made here.
export default function PaidLibraryPanel({ clientId, onResize }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [kind, setKind] = useState('all');     // all | image | video
  const [ratio, setRatio] = useState('all');

  useEffect(() => {
    // Cleared first, so a client change can never show the previous client's
    // creative while the next request is in flight. The Strategist shipped
    // that exact bug to the live platform in October.
    setItems(null); setErr(null); setKind('all'); setRatio('all');
    api.get(`/ad-creatives/clients/${clientId}/library`)
      .then(setItems)
      .catch(e => { setErr(e.message); setItems([]); });
  }, [clientId]);

  const ratios = useMemo(() => {
    const seen = new Set((items || []).map(i => i.aspect_ratio).filter(Boolean));
    return Array.from(seen).sort();
  }, [items]);

  const shown = useMemo(() => (items || []).filter(i => {
    if (kind !== 'all' && (i.media_type || 'image') !== kind) return false;
    if (ratio !== 'all' && i.aspect_ratio !== ratio) return false;
    return true;
  }), [items, kind, ratio]);

  async function remove(item) {
    if (!window.confirm('Delete this creative? This cannot be undone.')) return;
    try {
      await api.delete(`/ad-creatives/images/${item.id}`);
      setItems(prev => (prev || []).filter(i => i.id !== item.id));
    } catch (e) { toast(e.message, 'error'); }
  }

  if (items === null) return <div className="card" style={{ padding: 'var(--s5)', color: 'var(--text-subtle)' }}>Loading the creative…</div>;
  if (err) return <div className="callout callout-danger">{err}</div>;

  if (!items.length) {
    return (
      <div className="card" style={{ padding: 'var(--s5)' }}>
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text)', lineHeight: 1.5, maxWidth: 620 }}>
          Nothing rendered yet. Creative lands here automatically once a batch
          reaches <strong>Render</strong>, and stays here afterwards so you can
          resize it, reuse it in a later batch, or show a client what exists.
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <span className="caption">{shown.length} of {items.length}</span>
        <span style={{ flex: 1 }} />
        {['all', 'image', 'video'].map(k => (
          <button key={k} className={`tab ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'All' : k === 'image' ? 'Images' : 'Video'}
          </button>
        ))}
        {ratios.length > 1 && (
          <select className="select" value={ratio} onChange={e => setRatio(e.target.value)}
            style={{ width: 'auto', paddingTop: 6, paddingBottom: 6 }}>
            <option value="all">Every ratio</option>
            {ratios.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--s3)' }}>
        {shown.map(item => (
          <div key={item.id} className="card" style={{ padding: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            <div style={{ background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {(item.media_type || 'image') === 'video'
                ? <video src={item.url} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <img src={item.url} alt={item.headline || 'Ad creative'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {item.aspect_ratio && <span className="chip">{item.aspect_ratio}</span>}
              {item.is_example && <span className="chip chip-accent">Example</span>}
              <span className="caption" style={{ color: 'var(--text-subtle)' }}>
                {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </div>
            {item.headline && (
              <div className="body-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {item.headline.slice(0, 90)}{item.headline.length > 90 ? '…' : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'auto' }}>
              {onResize && (item.media_type || 'image') === 'image' && (
                <button className="btn btn-secondary btn-sm"
                  {...roWrite(readOnly, { onClick: () => onResize(item) })}>Resize</button>
              )}
              <a className="btn btn-ghost btn-sm" href={item.url} target="_blank" rel="noreferrer">Open</a>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}
                {...roWrite(readOnly, { onClick: () => remove(item) })}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
