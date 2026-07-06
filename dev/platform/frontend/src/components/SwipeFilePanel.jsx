// Social → Swipe file. Paste a reel/video URL; the worker downloads it
// (yt-dlp), transcribes it (Whisper), and Claude turns it into a reusable idea
// card. Result is saved here and emailed back. See your morning reel routine,
// automated.

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useIsMobile } from '../hooks/useIsMobile';

const STATUS = {
  queued:     { label: 'Queued',       cls: 'chip-neutral' },
  processing: { label: 'Transcribing…', cls: 'chip-accent' },
  done:       { label: 'Ready',        cls: 'chip-success' },
  failed:     { label: 'Failed',       cls: 'chip-warning' },
};

// Build a brainstorm brief from a swipe-file idea card so the AM can make
// posts in the style of a reel they liked.
function ideaToBrief(it, card = {}) {
  const lines = [`Make posts inspired by this reel (${it.title || it.url}).`];
  if (card.hook) lines.push(`Its hook: "${card.hook}".`);
  if (card.summary) lines.push(`What it does: ${card.summary}`);
  if (card.why_it_works) lines.push(`Why it works: ${card.why_it_works}`);
  if (Array.isArray(card.angles) && card.angles.length) lines.push(`Angles to adapt: ${card.angles.join('; ')}.`);
  return lines.join('\n');
}

export default function SwipeFilePanel({ clientId, onUseAsBrief }) {
  const toast = useToast();
  const isMobile = useIsMobile();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({}); // id → transcript expanded
  const [openCard, setOpenCard] = useState({}); // id → card expanded
  const pollRef = useRef(null);
  // Every reel starts collapsed to a compact title row (on desktop too) so the
  // saved list stays a scannable index — click ▾ to reveal its idea card. On
  // phones the list also scrolls inside a capped box rather than growing the page.
  const cardOpen = (id) => !!openCard[id];

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
        <div className="stack stack-sm"
          style={isMobile ? { maxHeight: '58vh', overflowY: 'auto', paddingRight: 4 } : undefined}>
          <div className="body-xs text-subtle" style={{ marginBottom: 2 }}>
            {items.length} saved · open a reel to see its idea card
          </div>
          {items.map(it => {
            const st = STATUS[it.status] || STATUS.queued;
            const card = it.idea_card || null;
            // Prefer a readable label — Claude's short title, then its hook —
            // over the scraped "Video by @handle" metadata title.
            const rawTitle = card?.title || card?.hook || it.title || it.url;
            const label = rawTitle && rawTitle.length > 90 ? rawTitle.slice(0, 89) + '…' : rawTitle;
            return (
              <div key={it.id} className="card" style={{ padding: 'var(--s4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 0' }}>
                    <a href={it.url} target="_blank" rel="noreferrer" title={it.title || it.url} style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{label}</a>
                    <div className="body-xs text-subtle" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>
                      {it.platform || 'video'}{it.notes ? ` · ${it.notes}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                    <span className={`chip ${st.cls}`} style={{ fontSize: 10 }}>{st.label}</span>
                    {it.status === 'failed' && <button className="btn btn-secondary btn-sm" onClick={() => retry(it.id)}>Retry</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(it.id)} title="Delete">✕</button>
                    {(card || it.error) && (
                      <button className="btn btn-ghost btn-sm" aria-expanded={cardOpen(it.id)}
                        onClick={() => setOpenCard(p => ({ ...p, [it.id]: !p[it.id] }))}
                        title={cardOpen(it.id) ? 'Hide idea card' : 'Show idea card'}>
                        {cardOpen(it.id) ? '▴' : '▾'}
                      </button>
                    )}
                  </div>
                </div>

                {cardOpen(it.id) && it.status === 'failed' && it.error && (
                  <div className="callout callout-warning" style={{ marginTop: 10, fontSize: 13 }}>{it.error}</div>
                )}

                {cardOpen(it.id) && card && (
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
                    {onUseAsBrief && (
                      <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}
                        onClick={() => onUseAsBrief(ideaToBrief(it, card))}>
                        ✦ Use as brief →
                      </button>
                    )}
                  </div>
                )}

                {cardOpen(it.id) && it.transcript && (
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
