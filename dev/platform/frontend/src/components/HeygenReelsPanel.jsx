// Social → Reels. The AI video suite (Phase 1): pick a HeyGen avatar / Digital
// Twin + voice, type a script, and HeyGen renders a captioned vertical reel.
// Renders async, so the panel polls while any reel is still processing.

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS = {
  queued:     { label: 'Queued',      cls: 'chip-neutral' },
  processing: { label: 'Rendering…',  cls: 'chip-accent' },
  completed:  { label: 'Ready',       cls: 'chip-success' },
  failed:     { label: 'Failed',      cls: 'chip-warning' },
};

export default function HeygenReelsPanel({ clientId }) {
  const toast = useToast();
  const [opts, setOpts] = useState(null);   // { avatars, voices } | null
  const [optsErr, setOptsErr] = useState(null);
  const [reels, setReels] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [avatar, setAvatar] = useState('');
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  async function loadReels() {
    try { const r = await api.get(`/heygen/clients/${clientId}/heygen/reels`); setReels(r.reels || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  async function loadOptions() {
    try {
      const r = await api.get(`/heygen/clients/${clientId}/heygen/options`);
      setOpts(r);
      if (r.avatars?.length) setAvatar(`${r.avatars[0].type}:${r.avatars[0].id}`);
      if (r.voices?.length) setVoice(r.voices[0].id);
    } catch (e) { setOptsErr(e.message); }
  }
  useEffect(() => { loadOptions(); loadReels(); /* eslint-disable-next-line */ }, [clientId]);

  useEffect(() => {
    const pending = reels.some(r => r.status === 'processing' || r.status === 'queued');
    clearInterval(pollRef.current);
    if (pending) pollRef.current = setInterval(loadReels, 8000);
    return () => clearInterval(pollRef.current);
    /* eslint-disable-next-line */
  }, [reels]);

  async function generate() {
    if (!script.trim()) { toast('Write a script for your avatar to say.', 'error'); return; }
    if (!avatar || !voice) { toast('Pick an avatar and a voice.', 'error'); return; }
    const [avatar_type, avatar_id] = avatar.split(':');
    const avatar_name = opts?.avatars?.find(a => a.id === avatar_id)?.name || null;
    setBusy(true);
    try {
      const reel = await api.post(`/heygen/clients/${clientId}/heygen/reels`, { title: title.trim(), script: script.trim(), avatar_id, avatar_type, avatar_name, voice_id: voice, caption: true });
      setReels(prev => [reel, ...prev]);
      setScript(''); setTitle('');
      toast('Sent to HeyGen — rendering. It’ll appear below in a minute or two.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function refresh(id) {
    try { const r = await api.post(`/heygen/clients/${clientId}/heygen/reels/${id}/refresh`, {}); setReels(prev => prev.map(x => x.id === id ? r : x)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function retry(id) {
    try { const r = await api.post(`/heygen/clients/${clientId}/heygen/reels/${id}/retry`, {}); setReels(prev => [r, ...prev.filter(x => x.id !== id)]); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(id) {
    if (!window.confirm('Delete this reel?')) return;
    try { await api.delete(`/heygen/clients/${clientId}/heygen/reels/${id}`); setReels(prev => prev.filter(x => x.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>AI reels.</strong> Pick your Digital Twin (or a stock avatar) + a voice, type a script, and HeyGen renders a captioned vertical reel. Pay-as-you-go (~$1/min). Create your Digital Twin in the HeyGen app — it then shows up in the avatar list here.
      </div>

      {optsErr ? (
        <div className="callout callout-warning" style={{ marginBottom: 'var(--s5)' }}>{optsErr}</div>
      ) : !opts ? (
        <div className="text-subtle" style={{ marginBottom: 'var(--s5)' }}>Loading avatars & voices…</div>
      ) : (
        <div className="card" style={{ marginBottom: 'var(--s5)' }}>
          {opts.partial && (
            <div className="callout callout-warning" style={{ marginBottom: 'var(--s4)' }}>
              {opts.avatars?.length ? 'Voices' : 'Avatars'} couldn’t load from HeyGen this time — it may be busy. Refresh to try again.
            </div>
          )}
          <div className="stack stack-sm">
            <input className="input" placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="input" rows={4} placeholder="Script — what should your avatar say?" value={script} onChange={e => setScript(e.target.value)} />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '1 1 220px' }}>
                <span className="field-label">Avatar / Digital Twin</span>
                <select className="input" value={avatar} onChange={e => setAvatar(e.target.value)}>
                  {opts.avatars.map(a => <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>{a.name}{a.type === 'talking_photo' ? ' (photo)' : ''}</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 220px' }}>
                <span className="field-label">Voice</span>
                <select className="input" value={voice} onChange={e => setVoice(e.target.value)}>
                  {opts.voices.map(v => <option key={v.id} value={v.id}>{v.name}{v.language ? ` · ${v.language}` : ''}</option>)}
                </select>
              </label>
            </div>
            <div><button className="btn btn-primary" onClick={generate} disabled={busy}>{busy ? 'Sending…' : '✦ Generate reel'}</button></div>
          </div>
        </div>
      )}

      {!reels.length ? (
        <p className="body-sm text-subtle">No reels yet — write a script above to make your first.</p>
      ) : (
        <div className="stack stack-sm">
          {reels.map(r => {
            const st = STATUS[r.status] || STATUS.queued;
            return (
              <div key={r.id} className="card" style={{ padding: 'var(--s4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{r.title || (r.script || '').slice(0, 60) + ((r.script || '').length > 60 ? '…' : '')}</strong>
                    <div className="body-xs text-subtle" style={{ marginTop: 2 }}>{r.avatar_name || r.avatar_id}{r.duration_s ? ` · ${Math.round(r.duration_s)}s` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                    <span className={`chip ${st.cls}`} style={{ fontSize: 10 }}>{st.label}</span>
                    {r.status === 'processing' && <button className="btn btn-ghost btn-sm" onClick={() => refresh(r.id)}>Refresh</button>}
                    {r.status === 'failed' && <button className="btn btn-secondary btn-sm" onClick={() => retry(r.id)}>Retry</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(r.id)} title="Delete">✕</button>
                  </div>
                </div>
                {r.status === 'failed' && r.error && <div className="callout callout-warning" style={{ marginTop: 10, fontSize: 13 }}>{r.error}</div>}
                {r.status === 'completed' && r.video_url && (
                  <div style={{ marginTop: 12 }}>
                    <video src={r.video_url} controls style={{ width: '100%', maxWidth: 280, borderRadius: 'var(--r-sm)', background: '#000' }} />
                    <div style={{ marginTop: 8 }}><a className="btn btn-secondary btn-sm" href={r.video_url} target="_blank" rel="noreferrer" download>Download</a></div>
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
