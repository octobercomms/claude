// Social → Swipe file. Paste a reel/video URL; the worker downloads it
// (yt-dlp), transcribes it (Whisper), and Claude turns it into a reusable idea
// card. Result is saved here and emailed back. See your morning reel routine,
// automated.

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS = {
  queued:     { label: 'Queued',       cls: 'chip-neutral' },
  processing: { label: 'Transcribing…', cls: 'chip-accent' },
  done:       { label: 'Ready',        cls: 'chip-success' },
  failed:     { label: 'Failed',       cls: 'chip-warning' },
};

export default function SwipeFilePanel({ clientId }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({}); // id → transcript expanded
  const pollRef = useRef(null);

  async function load() {
    try { const r = await api.get(`/swipe-file/clients/${clientId}/swipe`); setItems(r.items || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  // Poll while anything is still being worked.
  useEffect(() => {
    const pending = items.some(i => i.status === 'queued' || i.status === 'processing');
    clearInterval(pollRef.current);
    if (pending) pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
    /* eslint-disable-next-line */
  }, [items]);

  async function add() {
    if (!url.trim()) { toast('Paste a reel or video URL.', 'error'); return; }
    setBusy(true);
    try {
      const it = await api.post(`/swipe-file/clients/${clientId}/swipe`, { url: url.trim(), notes: notes.trim() });
      setItems(prev => [it, ...prev]);
      setUrl(''); setNotes('');
      toast('Added — transcribing in the background. You\'ll get an email when it\'s ready.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    if (!window.confirm('Delete this saved idea?')) return;
    try { await api.delete(`/swipe-file/clients/${clientId}/swipe/${id}`); setItems(prev => prev.filter(i => i.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function retry(id) {
    try { const it = await api.post(`/swipe-file/clients/${clientId}/swipe/${id}/retry`, {}); setItems(prev => prev.map(i => i.id === id ? it : i)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied.', 'success'); }
    catch { toast('Copy failed.', 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>Reel → ideas.</strong> Paste a reel or video URL — OMI downloads it, transcribes it, and turns it into a reusable idea card (hook, why it works, angles to steal). Saved here and emailed back. Works with Instagram, TikTok, YouTube and more.
      </div>

      <div className="card" style={{ marginBottom: 'var(--s5)' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '3 1 320px' }} placeholder="Paste a reel / video URL…"
            value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <input className="input" style={{ flex: '2 1 200px' }} placeholder="Optional note (why you saved it)"
            value={notes} onChange={e => setNotes(e.target.value)} />
          <button className="btn btn-primary" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Save & transcribe'}</button>
        </div>
      </div>

      {!items.length ? (
        <p className="body-sm text-subtle">No saved reels yet — paste a URL above to capture your first idea.</p>
      ) : (
        <div className="stack stack-sm">
          {items.map(it => {
            const st = STATUS[it.status] || STATUS.queued;
            const card = it.idea_card || null;
            return (
              <div key={it.id} className="card" style={{ padding: 'var(--s4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <a href={it.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>{it.title || it.url}</a>
                    <div className="body-xs text-subtle" style={{ marginTop: 2 }}>
                      {it.platform || 'video'}{it.notes ? ` · ${it.notes}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                    <span className={`chip ${st.cls}`} style={{ fontSize: 10 }}>{st.label}</span>
                    {it.status === 'failed' && <button className="btn btn-secondary btn-sm" onClick={() => retry(it.id)}>Retry</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(it.id)} title="Delete">✕</button>
                  </div>
                </div>

                {it.status === 'failed' && it.error && (
                  <div className="callout callout-warning" style={{ marginTop: 10, fontSize: 13 }}>{it.error}</div>
                )}

                {card && (
                  <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                    {card.hook && <p className="body-sm" style={{ margin: '0 0 6px' }}><strong>Hook:</strong> {card.hook}</p>}
                    {card.summary && <p className="body-sm" style={{ margin: '0 0 6px' }}><strong>Summary:</strong> {card.summary}</p>}
                    {card.why_it_works && <p className="body-sm" style={{ margin: '0 0 6px' }}><strong>Why it works:</strong> {card.why_it_works}</p>}
                    {card.format && <p className="body-sm" style={{ margin: '0 0 6px' }}><strong>Format:</strong> {card.format}</p>}
                    {Array.isArray(card.angles) && card.angles.length > 0 && (
                      <div style={{ margin: '6px 0' }}>
                        <div className="body-sm"><strong>Angles to steal:</strong></div>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{card.angles.map((a, i) => <li key={i} className="body-sm">{a}</li>)}</ul>
                      </div>
                    )}
                    {Array.isArray(card.tags) && card.tags.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {card.tags.map((t, i) => <span key={i} className="chip chip-outline" style={{ fontSize: 10 }}>{t}</span>)}
                      </div>
                    )}
                  </div>
                )}

                {it.transcript && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(p => ({ ...p, [it.id]: !p[it.id] }))}>
                      {open[it.id] ? '▴ Hide transcript' : '▾ Transcript'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => copy(it.transcript)}>Copy transcript</button>
                    {open[it.id] && (
                      <div className="body-sm" style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: 'var(--text-muted)', maxHeight: 260, overflow: 'auto' }}>{it.transcript}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
